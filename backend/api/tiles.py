"""Revision-safe raster tiles backed by cataloged COG or GeoZarr frames."""

from __future__ import annotations

import functools
import logging
import math
import os
from threading import BoundedSemaphore
from typing import Any

from affine import Affine
from fastapi import APIRouter, HTTPException, Query, Response
import numpy as np
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject, transform_bounds
from rio_tiler.io import Reader
from rio_tiler.errors import TileOutsideBounds
from rio_tiler.models import ImageData
import zarr

from api.bucket import (
    HF_BUCKET_URL,
    fsspec_storage_options,
    resolve_path,
    storage_mode,
    USE_LOCAL_MOUNT,
)
from api.catalog import CatalogFrame, normalize_product, resolve_catalog_frame
from api.cog_cache import BucketRateLimitError, local_cog
from api.raster_runtime import cog_reader


router = APIRouter()
logger = logging.getLogger(__name__)
TILE_SIZE = 256
WEB_MERCATOR_LIMIT = 20037508.342789244
OPERA_WGS84_BOUNDS = (-39.552438, 31.749398, 57.81137, 73.931257)
STATUS_UNDETECT = 1
STATUS_NODATA = 2


DBZH_CMAP = [
    ((-35.0, 0.0),   (100, 130, 160, 50)),  # scanning area: subtle semi-transparent blue-grey
    ((0.0, 5.0),     (40, 116, 144, 255)),  # dark teal blue
    ((5.0, 10.0),    (40, 153, 192, 255)),  # medium teal blue
    ((10.0, 15.0),   (32, 191, 239, 255)),  # sky blue cyan
    ((15.0, 20.0),   (0, 255, 0, 255)),     # bright green
    ((20.0, 25.0),   (0, 208, 0, 255)),     # green
    ((25.0, 30.0),   (0, 160, 0, 255)),     # medium green
    ((30.0, 35.0),   (0, 96, 0, 255)),      # dark green
    ((35.0, 40.0),   (255, 208, 0, 255)),   # bright yellow
    ((40.0, 45.0),   (255, 153, 0, 255)),   # orange
    ((45.0, 50.0),   (255, 0, 0, 255)),     # red
    ((50.0, 55.0),   (176, 0, 0, 255)),     # dark red
    ((55.0, 60.0),   (80, 0, 0, 255)),      # very dark maroon
    ((60.0, 65.0),   (255, 0, 255, 255)),   # magenta
    ((65.0, 70.0),   (144, 19, 254, 255)),  # purple
    ((70.0, 150.0),  (255, 0, 128, 255)),   # hot pink
]
RATE_CMAP = [
    ((-15.0, -5.0), (100, 130, 160, 50)),   # scanning area: subtle semi-transparent blue-grey
    ((0.0, 0.1), (205, 245, 255, 150)),
    ((0.1, 0.5), (0, 255, 255, 255)),
    ((0.5, 1.0), (0, 170, 255, 255)),
    ((1.0, 2.0), (0, 85, 255, 255)),
    ((2.0, 5.0), (0, 0, 255, 255)),
    ((5.0, 10.0), (0, 255, 0, 255)),
    ((10.0, 20.0), (0, 170, 0, 255)),
    ((20.0, 50.0), (255, 255, 0, 255)),
    ((50.0, 100.0), (255, 170, 0, 255)),
    ((100.0, 1000.0), (255, 0, 0, 255)),
]
ACRR_CMAP = [
    ((-15.0, -5.0), (100, 130, 160, 50)),   # scanning area: subtle semi-transparent blue-grey
    ((0.0, 0.1), (205, 245, 255, 150)),
    ((0.1, 0.5), (0, 255, 255, 255)),
    ((0.5, 1.0), (0, 170, 255, 255)),
    ((1.0, 2.0), (0, 85, 255, 255)),
    ((2.0, 5.0), (0, 0, 255, 255)),
    ((5.0, 10.0), (0, 255, 0, 255)),
    ((10.0, 20.0), (0, 170, 0, 255)),
    ((20.0, 50.0), (255, 255, 0, 255)),
    ((50.0, 100.0), (255, 170, 0, 255)),
    ((100.0, 1000.0), (255, 0, 0, 255)),
]
COLORMAPS = {"DBZH": DBZH_CMAP, "RATE": RATE_CMAP, "ACRR": ACRR_CMAP}
RENDER_SLOTS = BoundedSemaphore(max(1, int(os.getenv("TILE_RENDER_CONCURRENCY", "4"))))
RENDER_QUEUE_TIMEOUT_SECONDS = max(
    1.0, float(os.getenv("TILE_RENDER_QUEUE_TIMEOUT_SECONDS", "30"))
)
COG_VRT_OPTIONS = {
    "NUM_THREADS": os.getenv("GDAL_NUM_THREADS", "1")
}


def parse_min_quality(product: str, value: str) -> float | None:
    if value.lower() == "off":
        return None
    try:
        threshold = float(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="min_quality must be off or a number from 0 to 1") from exc
    if not math.isfinite(threshold) or not 0.0 <= threshold <= 1.0:
        raise HTTPException(status_code=422, detail="min_quality must be between 0 and 1")
    if product != "DBZH":
        raise HTTPException(status_code=422, detail="Quality threshold filtering is currently supported only for DBZH")
    return threshold


def apply_quality_filter(image: ImageData, min_quality: float) -> ImageData:
    """Return band 1 masked only where normalized band-2 quality is known and low."""

    if image.count < 2:
        return ImageData(
            np.ma.array(image.array[:1], copy=True),
            assets=image.assets,
            bounds=image.bounds,
            crs=image.crs,
            metadata=image.metadata,
            band_names=image.band_names[:1],
        )
    measurement = np.ma.array(image.array[:1], copy=True)
    quality = np.ma.array(image.array[1], copy=False)
    quality_data = np.asarray(quality.data)
    quality_known = (
        ~np.ma.getmaskarray(quality)
        & np.isfinite(quality_data)
        & (quality_data >= 0.0)
        & (quality_data <= 1.0)
    )
    measurement.mask = np.ma.getmaskarray(measurement) | (
        quality_known & (quality_data < min_quality)
    )[np.newaxis, :, :]
    return ImageData(
        measurement,
        assets=image.assets,
        bounds=image.bounds,
        crs=image.crs,
        metadata=image.metadata,
        band_names=image.band_names[:1],
    )


def is_valid_tile(z: int, x: int, y: int) -> bool:
    return 0 <= z <= 22 and 0 <= x < 2**z and 0 <= y < 2**z


def web_mercator_tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    span = (2.0 * WEB_MERCATOR_LIMIT) / (2**z)
    left = -WEB_MERCATOR_LIMIT + x * span
    right = left + span
    top = WEB_MERCATOR_LIMIT - y * span
    bottom = top - span
    return left, bottom, right, top


@functools.lru_cache(maxsize=8)
def _open_group(store_path: str) -> Any:
    if USE_LOCAL_MOUNT:
        store = zarr.storage.LocalStore(resolve_path(store_path))
    else:
        store = zarr.storage.FsspecStore.from_url(
            f"{HF_BUCKET_URL}/{store_path}", storage_options=fsspec_storage_options()
        )
    try:
        return zarr.open_consolidated(store=store, mode="r")
    except Exception:
        return zarr.open_group(store=store, mode="r")


_open_geozarr = _open_group


@functools.lru_cache(maxsize=16)
def _read_time_coords(path: str) -> np.ndarray:
    group = _open_geozarr(path)
    return np.asarray(group["time"][:], dtype=np.int64)


@functools.lru_cache(maxsize=16)
def _geozarr_metadata(path: str, product: str) -> dict[str, Any]:
    group = _open_geozarr(path)
    x_coords = np.asarray(group["x"][:], dtype=np.float64)
    y_coords = np.asarray(group["y"][:], dtype=np.float64)
    times = _read_time_coords(path)
    crs_attrs = dict(group["crs"].attrs)
    crs = CRS.from_string(crs_attrs["proj4_params"])
    transform_values = [float(value) for value in crs_attrs["GeoTransform"].split()]
    return {
        "x": x_coords,
        "y": y_coords,
        "times": times,
        "crs": crs,
        "transform": Affine.from_gdal(*transform_values),
    }


def _frame_time_index(times: np.ndarray, frame: CatalogFrame) -> int:
    epoch = int(datetime_from_iso(frame.nominal_time).timestamp())
    matches = np.flatnonzero(times == epoch)
    if len(matches) != 1:
        raise HTTPException(status_code=503, detail="Cataloged frame is not uniquely present in GeoZarr")
    return int(matches[0])


def datetime_from_iso(value: str):
    from datetime import datetime

    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _empty_image() -> ImageData:
    values = np.ma.masked_all((1, TILE_SIZE, TILE_SIZE), dtype=np.float32)
    return ImageData(values, crs=CRS.from_epsg(3857), band_names=["measurement"])


def _apply_geozarr_status(data: np.ndarray, status: np.ndarray) -> np.ndarray:
    """Render observed no-echo cells while keeping true nodata transparent."""
    result = np.asarray(data, dtype=np.float32).copy()
    result[status == STATUS_UNDETECT] = -10.0
    result[status == STATUS_NODATA] = np.nan
    return result


def _render_geozarr_image(
    frame: CatalogFrame,
    z: int,
    x: int,
    y: int,
    min_quality: float | None,
) -> ImageData:
    group = _open_geozarr(frame.geozarr)
    metadata = _geozarr_metadata(frame.geozarr, frame.product)
    x_coords: np.ndarray = metadata["x"]
    y_coords: np.ndarray = metadata["y"]
    times = np.asarray(group["time"][:], dtype=np.int64) if "time" in group else metadata.get("times", np.array([], dtype=np.int64))
    time_index = _frame_time_index(times, frame)
    destination_bounds = web_mercator_tile_bounds(z, x, y)
    source_bounds = transform_bounds(
        "EPSG:3857", metadata["crs"], *destination_bounds, densify_pts=21
    )

    x_start = max(0, int(np.searchsorted(x_coords, source_bounds[0], side="left")) - 1)
    x_end = min(len(x_coords), int(np.searchsorted(x_coords, source_bounds[2], side="right")) + 1)
    y_hits = np.flatnonzero((y_coords >= source_bounds[1]) & (y_coords <= source_bounds[3]))
    if x_start >= x_end or len(y_hits) == 0:
        return _empty_image()
    y_start = max(0, int(y_hits[0]) - 1)
    y_end = min(len(y_coords), int(y_hits[-1]) + 2)

    measurement_array = group[frame.product]
    data = np.asarray(measurement_array[time_index, y_start:y_end, x_start:x_end], dtype=np.float32)
    # Undetect is a valid observed state and is rendered at the bottom of the
    # product scale; nodata remains transparent.
    data = data.copy()
    undetect_value = measurement_array.attrs.get("undetect_value")
    if undetect_value is not None:
        data[np.isclose(data, float(undetect_value))] = -10.0
    status_name = f"{frame.product}_status"
    if status_name in group:
        status = np.asarray(
            group[status_name][time_index, y_start:y_end, x_start:x_end]
        )
        data = _apply_geozarr_status(data, status)
    data[~np.isfinite(data)] = np.nan

    source_transform = metadata["transform"] * Affine.translation(x_start, y_start)
    destination_transform = from_bounds(*destination_bounds, TILE_SIZE, TILE_SIZE)
    destination = np.full((TILE_SIZE, TILE_SIZE), np.nan, dtype=np.float32)
    reproject(
        source=data,
        destination=destination,
        src_transform=source_transform,
        src_crs=metadata["crs"],
        dst_transform=destination_transform,
        dst_crs="EPSG:3857",
        src_nodata=np.nan,
        dst_nodata=np.nan,
        resampling=Resampling.max,
    )

    if frame.product == "DBZH" and min_quality is not None and frame.quality_variables:
        quality_name = frame.quality_variables[0]
        if quality_name in group:
            source_quality = np.asarray(
                group[quality_name][time_index, y_start:y_end, x_start:x_end], dtype=np.float32
            )
            destination_quality = np.full((TILE_SIZE, TILE_SIZE), np.nan, dtype=np.float32)
            reproject(
                source=source_quality,
                destination=destination_quality,
                src_transform=source_transform,
                src_crs=metadata["crs"],
                dst_transform=destination_transform,
                dst_crs="EPSG:3857",
                src_nodata=np.nan,
                dst_nodata=np.nan,
                resampling=Resampling.nearest,
            )
            known = np.isfinite(destination_quality) & (destination_quality >= 0) & (destination_quality <= 1)
            destination[known & (destination_quality < min_quality)] = np.nan

    masked = np.ma.masked_invalid(destination)[np.newaxis, :, :]
    return ImageData(
        masked,
        bounds=destination_bounds,
        crs=CRS.from_epsg(3857),
        band_names=[frame.product],
    )


def _render_cog_image(frame: CatalogFrame, z: int, x: int, y: int, min_quality: float | None) -> ImageData:
    if not frame.hot_cog:
        raise FileNotFoundError("Catalog does not advertise a hot COG")
    cog_path = local_cog(
        frame.product, frame.timestamp, frame.revision, frame.hot_cog
    )
    with cog_reader(cog_path, Reader) as cog:
        indexes = (1, 2) if frame.product == "DBZH" and min_quality is not None and cog.dataset.count >= 2 else 1
        try:
            image = cog.tile(
                x,
                y,
                z,
                indexes=indexes,
                resampling_method="bilinear",
                reproject_method="max",
                vrt_options=COG_VRT_OPTIONS,
            )
        except TileOutsideBounds:
            # A map viewport routinely requests tiles beyond the finite OPERA
            # composite footprint. Those are transparent pixels, not storage
            # or rendering failures, and must not trigger GeoZarr fallback.
            return _empty_image()
    if frame.product == "DBZH" and min_quality is not None:
        return apply_quality_filter(image, min_quality)
    if image.count > 1:
        return ImageData(
            np.ma.array(image.array[:1], copy=True),
            assets=image.assets,
            bounds=image.bounds,
            crs=image.crs,
            metadata=image.metadata,
            band_names=image.band_names[:1],
        )
    return image


@functools.lru_cache(maxsize=2048)
def _render_tile_cached(
    product: str,
    timestamp: str,
    revision: str,
    z: int,
    x: int,
    y: int,
    min_quality: float | None,
    hot_cog: str | None,
    geozarr: str,
    hot_cog_ready: bool,
    nominal_time: str,
    start_time: str | None,
    end_time: str | None,
    quality_variables: tuple[str, ...],
) -> tuple[bytes, str]:
    frame = CatalogFrame(
        product=product,
        timestamp=timestamp,
        nominal_time=nominal_time,
        start_time=start_time,
        end_time=end_time,
        revision=revision,
        archive_ready=True,
        hot_cog_ready=hot_cog_ready,
        hot_cog=hot_cog,
        geozarr=geozarr,
        quality_variables=list(quality_variables),
        backend="cog" if hot_cog_ready else "geozarr",
    )
    backend = "geozarr"
    image: ImageData
    if hot_cog_ready:
        try:
            image = _render_cog_image(frame, z, x, y, min_quality)
            backend = "cog"
        except BucketRateLimitError:
            raise
        except Exception as exc:
            logger.warning(
                "Hot COG tile render failed for %s %s revision %s (%s); "
                "falling back to GeoZarr",
                product,
                timestamp,
                revision,
                type(exc).__name__,
                exc_info=True,
            )
            image = _render_geozarr_image(frame, z, x, y, min_quality)
    else:
        image = _render_geozarr_image(frame, z, x, y, min_quality)
    return image.render(img_format="WEBP", colormap=COLORMAPS[product]), backend


@router.get("/{product}/{timestamp}/{revision}/{z}/{x}/{y}.webp")
def get_tile(
    product: str,
    timestamp: str,
    revision: str,
    z: int,
    x: int,
    y: int,
    min_quality: str = Query("0.10"),
    source: str = Query("auto", pattern="^(auto|cog|geozarr)$"),
) -> Response:
    product = normalize_product(product)
    if not is_valid_tile(z, x, y):
        raise HTTPException(status_code=400, detail="Invalid tile coordinates")
    threshold = parse_min_quality(product, min_quality if product == "DBZH" else "off")
    frame = resolve_catalog_frame(product, timestamp, revision)
    if source == "geozarr":
        frame = frame.model_copy(
            update={"hot_cog_ready": False, "hot_cog": None, "backend": "geozarr"}
        )
    acquired = RENDER_SLOTS.acquire(timeout=RENDER_QUEUE_TIMEOUT_SECONDS)
    if not acquired:
        raise HTTPException(
            status_code=503,
            detail="Tile renderer is busy; retry shortly",
            headers={"Retry-After": "2"},
        )
    try:
        image_buffer, backend = _render_tile_cached(
            product, timestamp, revision, z, x, y, threshold,
            frame.hot_cog, frame.geozarr, frame.hot_cog_ready,
            frame.nominal_time, frame.start_time, frame.end_time,
            tuple(frame.quality_variables),
        )
    except BucketRateLimitError as exc:
        raise HTTPException(
            status_code=503,
            detail="Hugging Face rate limit reached while caching the radar frame",
            headers={"Retry-After": exc.retry_after or "60"},
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Frame rendering failed") from exc
    finally:
        RENDER_SLOTS.release()
    return Response(
        content=image_buffer,
        media_type="image/webp",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-OPERA-Backend": backend,
            "X-OPERA-Revision": revision,
        },
    )


def _render_cog_frame(
    frame: CatalogFrame, min_quality: float | None,
    max_size: int = 1024, bounds: tuple[float, ...] = OPERA_WGS84_BOUNDS,
) -> ImageData:
    """Render a region of the OPERA COG as a single image in Web Mercator."""
    if not frame.hot_cog:
        raise FileNotFoundError("Catalog does not advertise a hot COG")
    cog_path = local_cog(frame.product, frame.timestamp, frame.revision, frame.hot_cog)
    with cog_reader(cog_path, Reader) as cog:
        indexes = (1, 2) if frame.product == "DBZH" and min_quality is not None and cog.dataset.count >= 2 else 1
        image = cog.part(
            bounds,
            bounds_crs=CRS.from_epsg(4326),
            dst_crs=CRS.from_epsg(3857),
            max_size=max_size,
            indexes=indexes,
            resampling_method="bilinear",
            reproject_method="max",
            vrt_options=COG_VRT_OPTIONS,
        )
        raw_b1 = np.asarray(image.array[0], dtype=np.float32)
        scanning_area_mask = np.isnan(raw_b1)
        nodata_mask = np.isclose(raw_b1, -9999000.0)

        if frame.product == "DBZH" and min_quality is not None and image.count == 2:
            image = apply_quality_filter(image, min_quality)
            quality_filtered_mask = np.ma.getmaskarray(image.array[:1])[0]
        else:
            quality_filtered_mask = np.zeros(raw_b1.shape, dtype=bool)

    d = np.asarray(image.array[:1], dtype=np.float32).copy()
    d[0][scanning_area_mask] = -10.0
    d[0][nodata_mask] = np.nan
    d[0][quality_filtered_mask] = np.nan

    mask = np.isnan(d[0])
    masked_data = np.ma.MaskedArray(d, mask=mask[np.newaxis, :, :])
    return ImageData(
        masked_data,
        bounds=image.bounds,
        crs=image.crs,
        assets=image.assets,
        metadata=image.metadata,
        band_names=[frame.product],
    )


def _render_geozarr_frame(
    frame: CatalogFrame, min_quality: float | None,
    max_size: int = 1024, bounds: tuple[float, ...] = OPERA_WGS84_BOUNDS,
) -> ImageData:
    """Render a region of the OPERA GeoZarr archive as a single image in Web Mercator."""
    group = _open_geozarr(frame.geozarr)
    metadata = _geozarr_metadata(frame.geozarr, frame.product)
    
    times = np.asarray(group["time"][:], dtype=np.int64) if "time" in group else metadata.get("times", np.array([], dtype=np.int64))
    time_index = _frame_time_index(times, frame)

    x_coords: np.ndarray = metadata["x"]
    y_coords: np.ndarray = metadata["y"]
    source_bounds = transform_bounds("EPSG:4326", metadata["crs"], *bounds, densify_pts=21)

    x_start = max(0, int(np.searchsorted(x_coords, source_bounds[0], side="left")) - 1)
    x_end = min(len(x_coords), int(np.searchsorted(x_coords, source_bounds[2], side="right")) + 1)
    y_hits = np.flatnonzero((y_coords >= source_bounds[1]) & (y_coords <= source_bounds[3]))
    
    if x_start >= x_end or len(y_hits) == 0:
        x_start, x_end = 0, 1
        y_start, y_end = 0, 1
    else:
        y_start = max(0, int(y_hits[0]) - 1)
        y_end = min(len(y_coords), int(y_hits[-1]) + 2)

    slice_h = y_end - y_start
    slice_w = x_end - x_start
    
    slab = np.asarray(group[frame.product][time_index, y_start:y_end, x_start:x_end], dtype=np.float32)

    undetect = group[frame.product].attrs.get("undetect_value", None)
    if undetect is not None:
        slab[np.isclose(slab, float(undetect))] = -10.0
    status_name = f"{frame.product}_status"
    if status_name in group:
        status_slab = np.asarray(group[status_name][time_index, y_start:y_end, x_start:x_end])
        slab = _apply_geozarr_status(slab, status_slab)
    slab[~np.isfinite(slab)] = np.nan

    src_transform = metadata["transform"] * Affine.translation(x_start, y_start)
    src_h, src_w = slab.shape

    # Compute output grid in Web Mercator so MapLibre can render without
    # CRS distortion (its image source interpolates linearly in Mercator).
    merc_bounds = transform_bounds("EPSG:4326", "EPSG:3857", *bounds)
    merc_w = merc_bounds[2] - merc_bounds[0]
    merc_h = merc_bounds[3] - merc_bounds[1]
    out_w = min(max_size, src_w)
    out_h = max(1, int(out_w * merc_h / merc_w))
    
    dst_transform = from_bounds(*merc_bounds, out_w, out_h)
    dst_data = np.full((1, out_h, out_w), np.nan, dtype=np.float32)
    
    reproject(
        slab.reshape(1, src_h, src_w),
        dst_data,
        src_transform=src_transform,
        src_crs=metadata["crs"],
        dst_transform=dst_transform,
        dst_crs="EPSG:3857",
        resampling=Resampling.max,
        src_nodata=np.nan,
        dst_nodata=np.nan,
    )

    if frame.product == "DBZH" and min_quality is not None:
        quality_vars = frame.quality_variables or []
        if quality_vars:
            q_var = quality_vars[0]
            if q_var in group:
                q_slab = np.asarray(group[q_var][time_index, y_start:y_end, x_start:x_end], dtype=np.float32)
                q_slab[~np.isfinite(q_slab)] = np.nan
                dst_quality = np.full((1, out_h, out_w), np.nan, dtype=np.float32)
                reproject(
                    q_slab.reshape(1, src_h, src_w),
                    dst_quality,
                    src_transform=src_transform,
                    src_crs=metadata["crs"],
                    dst_transform=dst_transform,
                    dst_crs="EPSG:3857",
                    resampling=Resampling.nearest,
                    src_nodata=np.nan,
                    dst_nodata=np.nan,
                )

                q_data = dst_quality[0]
                quality_known = np.isfinite(q_data) & (q_data >= 0.0) & (q_data <= 1.0)
                below_threshold = quality_known & (q_data < min_quality)
                dst_data[0][below_threshold] = np.nan
    
    mask = np.isnan(dst_data)
    masked_data = np.ma.MaskedArray(dst_data, mask=mask)
    
    return ImageData(
        masked_data,
        bounds=merc_bounds,
        crs=CRS.from_epsg(3857),
        band_names=[frame.product],
    )


def _clamp_bounds(bbox: tuple[float, ...]) -> tuple[float, ...]:
    """Clamp a WGS84 bbox to the OPERA radar extent."""
    return (
        max(bbox[0], OPERA_WGS84_BOUNDS[0]),
        max(bbox[1], OPERA_WGS84_BOUNDS[1]),
        min(bbox[2], OPERA_WGS84_BOUNDS[2]),
        min(bbox[3], OPERA_WGS84_BOUNDS[3]),
    )


@functools.lru_cache(maxsize=256)
def _render_frame_cached(
    product: str, timestamp: str, revision: str,
    min_quality_key: str, source: str, max_size: int,
    bbox_key: str,
) -> bytes:
    frame = resolve_catalog_frame(product, timestamp, revision)
    min_quality = parse_min_quality(product, min_quality_key)
    bounds = OPERA_WGS84_BOUNDS
    if bbox_key:
        try:
            parts = tuple(float(x) for x in bbox_key.split(","))
            if len(parts) == 4 and parts[0] < parts[2] and parts[1] < parts[3]:
                bounds = _clamp_bounds(parts)
        except ValueError:
            pass
    
    use_cog = (
        source != "geozarr"
        and frame.hot_cog
        and frame.hot_cog_ready
    )
    
    try:
        if use_cog:
            image = _render_cog_frame(frame, min_quality, max_size, bounds)
        else:
            image = _render_geozarr_frame(frame, min_quality, max_size, bounds)
    except Exception:
        if frame.archive_ready and frame.geozarr:
            image = _render_geozarr_frame(frame, min_quality, max_size, bounds)
        else:
            raise
    
    return image.render(img_format="WEBP", colormap=COLORMAPS[product])


@router.get("/frame/{product}/{timestamp}/{revision}.webp")
def get_frame(
    product: str,
    timestamp: str,
    revision: str,
    min_quality: str = Query("0.10"),
    source: str = Query("auto", pattern="^(auto|cog|geozarr)$"),
    max_size: int = Query(1024, ge=256, le=4096),
    bbox: str = Query(""),
) -> Response:
    try:
        content = _render_frame_cached(
            product, timestamp, revision, min_quality, source, max_size, bbox,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Frame rendering failed") from exc
    return Response(
        content=content,
        media_type="image/webp",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )

import struct

PRODUCT_BOUNDS = {
    "DBZH": (-35.0, 75.0),
    "RATE": (-10.0, 150.0),
    "ACRR": (-10.0, 300.0),
}


def _pack_raw_buffer(measurement: np.ndarray, quality: np.ndarray, product: str = "DBZH") -> bytes:
    H, W = measurement.shape
    min_val, max_val = PRODUCT_BOUNDS.get(product, (-35.0, 75.0))
    nodata_val = -9999.0
    
    # uint8 0 is reserved for nodata (NaN / invalid)
    # uint8 1..255 maps min_val..max_val linearly
    valid_mask = np.isfinite(measurement)
    scaled = 1.0 + np.clip((measurement - min_val) / (max_val - min_val), 0.0, 1.0) * 254.0
    meas_uint8 = np.where(valid_mask, np.round(scaled), 0).astype(np.uint8)
    
    # Channel 1: Quality (0..254 = 0.0..1.0, 255 = unknown/unfiltered)
    valid_q = np.isfinite(quality) & (quality >= 0.0) & (quality <= 1.0)
    q_scaled = np.clip(np.round(quality * 254.0), 0, 254)
    q_uint8 = np.where(valid_q, q_scaled, 255).astype(np.uint8)
    
    header = struct.pack('<HHfff', W, H, min_val, max_val, nodata_val)
    payload = np.empty((H, W, 2), dtype=np.uint8)
    payload[:, :, 0] = meas_uint8
    payload[:, :, 1] = q_uint8
    
    return header + payload.tobytes()

def _get_raw_cog_frame(
    frame: CatalogFrame, max_size: int = 1024, bounds: tuple[float, ...] = OPERA_WGS84_BOUNDS
) -> bytes:
    if not frame.hot_cog:
        raise FileNotFoundError("Catalog does not advertise a hot COG")
    cog_path = local_cog(frame.product, frame.timestamp, frame.revision, frame.hot_cog)
    try:
        with cog_reader(cog_path, Reader) as cog:
            has_quality = frame.product == "DBZH" and cog.dataset.count >= 2
            indexes = (1, 2) if has_quality else (1,)
            image = cog.part(
                bounds,
                bounds_crs=CRS.from_epsg(4326),
                dst_crs=CRS.from_epsg(3857),
                max_size=None,
                indexes=indexes,
                resampling_method="nearest",
                reproject_method="nearest",
                vrt_options=COG_VRT_OPTIONS,
            )
            native_h, native_w = image.array.shape[1], image.array.shape[2]
            merc_bounds = transform_bounds("EPSG:4326", "EPSG:3857", *bounds)
            merc_w = merc_bounds[2] - merc_bounds[0]
            merc_h = merc_bounds[3] - merc_bounds[1]
            out_w = min(max_size, native_w)
            out_h = max(1, int(out_w * merc_h / merc_w))
            if out_h > max_size:
                out_w = max(1, int(out_w * max_size / out_h))
                out_h = max_size
                
            src_transform = from_bounds(*image.bounds, native_w, native_h)
            dst_transform = from_bounds(*image.bounds, out_w, out_h)
            
            dst_data = np.full((1, out_h, out_w), np.nan, dtype=np.float32)
            d_raw = np.asarray(image.array[0], dtype=np.float32)
            
            reproject(
                d_raw.reshape(1, native_h, native_w),
                dst_data,
                src_transform=src_transform,
                src_crs="EPSG:3857",
                dst_transform=dst_transform,
                dst_crs="EPSG:3857",
                resampling=Resampling.max,
                src_nodata=np.nan,
                dst_nodata=np.nan,
            )
            d = dst_data[0]
            scanning_area_mask = np.isnan(d)
            nodata_mask = np.isclose(d, -9999000.0)
            
            d[scanning_area_mask] = -10.0
            d[nodata_mask] = np.nan
            
            if has_quality:
                q_raw = np.asarray(image.array[1], dtype=np.float32)
                dst_quality = np.full((1, out_h, out_w), np.nan, dtype=np.float32)
                reproject(
                    q_raw.reshape(1, native_h, native_w),
                    dst_quality,
                    src_transform=src_transform,
                    src_crs="EPSG:3857",
                    dst_transform=dst_transform,
                    dst_crs="EPSG:3857",
                    resampling=Resampling.nearest,
                    src_nodata=np.nan,
                    dst_nodata=np.nan,
                )
                q = dst_quality[0]
            else:
                q = np.full(d.shape, np.nan, dtype=np.float32)
                
            return _pack_raw_buffer(d, q, frame.product)
    except TileOutsideBounds:
        merc_bounds = transform_bounds("EPSG:4326", "EPSG:3857", *bounds)
        merc_w = max(1.0, merc_bounds[2] - merc_bounds[0])
        merc_h = max(1.0, merc_bounds[3] - merc_bounds[1])
        out_w = max_size
        out_h = max(1, int(out_w * merc_h / merc_w))
        d = np.full((out_h, out_w), np.nan, dtype=np.float32)
        q = np.full((out_h, out_w), np.nan, dtype=np.float32)
        return _pack_raw_buffer(d, q, frame.product)

def _get_raw_geozarr_frame(
    frame: CatalogFrame, max_size: int = 1024, bounds: tuple[float, ...] = OPERA_WGS84_BOUNDS
) -> bytes:
    group = _open_geozarr(frame.geozarr)
    metadata = _geozarr_metadata(frame.geozarr, frame.product)
    
    times = np.asarray(group["time"][:], dtype=np.int64) if "time" in group else metadata.get("times", np.array([], dtype=np.int64))
    time_index = _frame_time_index(times, frame)

    x_coords: np.ndarray = metadata["x"]
    y_coords: np.ndarray = metadata["y"]
    source_bounds = transform_bounds("EPSG:4326", metadata["crs"], *bounds, densify_pts=21)

    x_start = max(0, int(np.searchsorted(x_coords, source_bounds[0], side="left")) - 1)
    x_end = min(len(x_coords), int(np.searchsorted(x_coords, source_bounds[2], side="right")) + 1)
    y_hits = np.flatnonzero((y_coords >= source_bounds[1]) & (y_coords <= source_bounds[3]))
    
    if x_start >= x_end or len(y_hits) == 0:
        x_start, x_end = 0, 1
        y_start, y_end = 0, 1
    else:
        y_start = max(0, int(y_hits[0]) - 1)
        y_end = min(len(y_coords), int(y_hits[-1]) + 2)

    slice_h = y_end - y_start
    slice_w = x_end - x_start
    
    slab = np.asarray(group[frame.product][time_index, y_start:y_end, x_start:x_end], dtype=np.float32)

    undetect = group[frame.product].attrs.get("undetect_value", None)
    if undetect is not None:
        slab[np.isclose(slab, float(undetect))] = -10.0
    status_name = f"{frame.product}_status"
    if status_name in group:
        status_slab = np.asarray(group[status_name][time_index, y_start:y_end, x_start:x_end])
        slab = _apply_geozarr_status(slab, status_slab)
    slab[~np.isfinite(slab)] = np.nan

    src_transform = metadata["transform"] * Affine.translation(x_start, y_start)
    src_h, src_w = slab.shape

    merc_bounds = transform_bounds("EPSG:4326", "EPSG:3857", *bounds)
    merc_w = merc_bounds[2] - merc_bounds[0]
    merc_h = merc_bounds[3] - merc_bounds[1]
    out_w = min(max_size, src_w)
    out_h = max(1, int(out_w * merc_h / merc_w))
    if out_h > max_size:
        out_w = max(1, int(out_w * max_size / out_h))
        out_h = max_size
    
    dst_transform = from_bounds(*merc_bounds, out_w, out_h)
    dst_data = np.full((1, out_h, out_w), np.nan, dtype=np.float32)
    
    reproject(
        slab.reshape(1, src_h, src_w),
        dst_data,
        src_transform=src_transform,
        src_crs=metadata["crs"],
        dst_transform=dst_transform,
        dst_crs="EPSG:3857",
        resampling=Resampling.max,
        src_nodata=np.nan,
        dst_nodata=np.nan,
    )

    dst_quality = np.full((1, out_h, out_w), np.nan, dtype=np.float32)
    if frame.product == "DBZH":
        quality_vars = frame.quality_variables or []
        if quality_vars:
            q_var = quality_vars[0]
            if q_var in group:
                q_slab = np.asarray(group[q_var][time_index, y_start:y_end, x_start:x_end], dtype=np.float32)
                q_slab[~np.isfinite(q_slab)] = np.nan
                reproject(
                    q_slab.reshape(1, src_h, src_w),
                    dst_quality,
                    src_transform=src_transform,
                    src_crs=metadata["crs"],
                    dst_transform=dst_transform,
                    dst_crs="EPSG:3857",
                    resampling=Resampling.nearest,
                    src_nodata=np.nan,
                    dst_nodata=np.nan,
                )
    
    return _pack_raw_buffer(dst_data[0], dst_quality[0], frame.product)


@functools.lru_cache(maxsize=256)
def _get_raw_frame_cached(
    product: str, timestamp: str, revision: str, source: str, max_size: int,
    bbox_key: str, allow_archive_fallback: bool,
) -> tuple[bytes, str]:
    frame = resolve_catalog_frame(product, timestamp, revision)
    bounds = OPERA_WGS84_BOUNDS
    if bbox_key:
        try:
            parts = tuple(float(x) for x in bbox_key.split(","))
            if len(parts) == 4 and parts[0] < parts[2] and parts[1] < parts[3]:
                bounds = _clamp_bounds(parts)
        except ValueError:
            pass
            
    use_cog = (source != "geozarr" and frame.hot_cog and frame.hot_cog_ready)
    try:
        if use_cog:
            return _get_raw_cog_frame(frame, max_size, bounds), "cog"
        else:
            return _get_raw_geozarr_frame(frame, max_size, bounds), "geozarr"
    except Exception as exc:
        if allow_archive_fallback and frame.archive_ready and frame.geozarr:
            logger.warning(
                "Hot COG frame render failed for %s %s revision %s (%s); "
                "falling back to GeoZarr",
                product,
                timestamp,
                revision,
                type(exc).__name__,
                exc_info=True,
            )
            return _get_raw_geozarr_frame(frame, max_size, bounds), "geozarr"
        raise

@router.get("/raw/{product}/{timestamp}/{revision}.bin")
def get_raw_frame(
    product: str,
    timestamp: str,
    revision: str,
    source: str = Query("auto", pattern="^(auto|cog|geozarr)$"),
    max_size: int = Query(1024, ge=256, le=4096),
    bbox: str = Query(""),
    allow_archive_fallback: bool = Query(True),
) -> Response:
    try:
        content, backend = _get_raw_frame_cached(
            product, timestamp, revision, source, max_size, bbox, allow_archive_fallback,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Raw frame rendering failed") from exc
    logger.info(
        "Radar frame served product=%s timestamp=%s backend=%s storage=%s",
        product,
        timestamp,
        backend,
        storage_mode(),
    )
    return Response(
        content=content,
        media_type="application/octet-stream",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-OPERA-Backend": backend,
            "X-OPERA-Revision": revision,
        },
    )
