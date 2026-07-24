"""Revision-safe raster tiles backed by cataloged COG or GeoZarr frames."""

from __future__ import annotations

import functools
import gzip
import logging
import math
import os
from collections import OrderedDict
from threading import BoundedSemaphore, Event, Lock
from typing import Any

from affine import Affine
from fastapi import APIRouter, HTTPException, Query, Request, Response
import numpy as np
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.windows import Window, from_bounds as window_from_bounds
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
RAW_RENDER_VERSION = 2


DBZH_CMAP = [
    ((-35.0, 0.12618),   (120, 120, 120, 90)),  # scanning area: subtle semi-transparent blue-grey
    ((0.12619, 5.0),     (40, 116, 144, 255)),  # dark teal blue
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
    ((-15.0, 0.09999), (120, 120, 120, 90)),   # scanning area: subtle semi-transparent blue-grey
    ((0.1, 0.5), (0, 255, 255, 255)),
    ((0.5, 1.0), (0, 170, 255, 255)),
    ((1.0, 2.0), (0, 85, 255, 255)),
    ((2.0, 5.0), (0, 0, 255, 255)),
    ((5.0, 10.0), (0, 255, 0, 255)),
    ((10.0, 20.0), (0, 170, 0, 255)),
    ((20.0, 50.0), (0, 85, 0, 255)),
    ((50.0, 100.0), (255, 255, 0, 255)),
    ((100.0, 200.0), (255, 170, 0, 255)),
    ((200.0, 300.0), (255, 0, 0, 255)),
    ((300.0, 1000.0), (170, 0, 0, 255)),
]
ACRR_CMAP = [
    ((-15.0, 0.09999), (120, 120, 120, 90)),   # scanning area: subtle semi-transparent blue-grey
    ((0.1, 0.5), (0, 255, 255, 255)),
    ((0.5, 1.0), (0, 170, 255, 255)),
    ((1.0, 2.0), (0, 85, 255, 255)),
    ((2.0, 5.0), (0, 0, 255, 255)),
    ((5.0, 10.0), (0, 255, 0, 255)),
    ((10.0, 20.0), (0, 170, 0, 255)),
    ((20.0, 50.0), (0, 85, 0, 255)),
    ((50.0, 100.0), (255, 255, 0, 255)),
    ((100.0, 200.0), (255, 170, 0, 255)),
    ((200.0, 300.0), (255, 0, 0, 255)),
    ((300.0, 1000.0), (170, 0, 0, 255)),
]
COLORMAPS = {"DBZH": DBZH_CMAP, "RATE": RATE_CMAP, "ACRR": ACRR_CMAP}
RENDER_SLOTS = BoundedSemaphore(max(1, int(os.getenv("TILE_RENDER_CONCURRENCY", "2"))))
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
        resampling=Resampling.bilinear,
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
        has_quality = frame.product == "DBZH" and min_quality is not None and cog.dataset.count >= 2
        try:
            image = cog.tile(
                x, y, z,
                indexes=(1,),
                resampling_method="bilinear",
                reproject_method="bilinear",
                vrt_options=COG_VRT_OPTIONS,
            )
            if has_quality:
                q_image = cog.tile(
                    x, y, z,
                    indexes=(2,),
                    resampling_method="nearest",
                    reproject_method="nearest",
                    vrt_options=COG_VRT_OPTIONS,
                )
                destination = np.copy(image.array)
                destination_quality = q_image.array[0]
                known = np.isfinite(destination_quality) & (destination_quality >= 0) & (destination_quality <= 1)
                destination[0][known & (destination_quality < min_quality)] = np.nan

                return ImageData(
                    np.ma.array(destination, copy=True),
                    bounds=image.bounds,
                    crs=image.crs,
                    assets=image.assets,
                    metadata=image.metadata,
                    band_names=image.band_names,
                )
        except TileOutsideBounds:
            # A map viewport routinely requests tiles beyond the finite OPERA
            # composite footprint. Those are transparent pixels, not storage
            # or rendering failures, and must not trigger GeoZarr fallback.
            return _empty_image()

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
        has_quality = frame.product == "DBZH" and min_quality is not None and cog.dataset.count >= 2

        image = cog.part(
            bounds,
            bounds_crs=CRS.from_epsg(4326),
            dst_crs=CRS.from_epsg(3857),
            max_size=max_size,
            indexes=(1,),
            resampling_method="bilinear",
            reproject_method="bilinear",
            vrt_options=COG_VRT_OPTIONS,
        )
        raw_b1 = np.asarray(image.array[0], dtype=np.float32)
        scanning_area_mask = np.isnan(raw_b1)
        nodata_mask = np.isclose(raw_b1, -9999000.0)

        if has_quality:
            q_image = cog.part(
                bounds,
                bounds_crs=CRS.from_epsg(4326),
                dst_crs=CRS.from_epsg(3857),
                max_size=max_size,
                indexes=(2,),
                resampling_method="nearest",
                reproject_method="nearest",
                vrt_options=COG_VRT_OPTIONS,
            )
            q_mask = np.ma.getmaskarray(q_image.array[0])
            destination_quality = np.asarray(q_image.array[0].data, dtype=np.float32)
            destination_quality[q_mask] = np.nan
            known = np.isfinite(destination_quality) & (destination_quality >= 0) & (destination_quality <= 1)
            quality_filtered_mask = known & (destination_quality < min_quality)
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
        resampling=Resampling.bilinear,
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


def _destination_grid(
    bounds: tuple[float, ...],
    max_size: int,
    source_width: int,
) -> tuple[tuple[float, ...], int, int, Affine]:
    """Return the shared COG/GeoZarr Web Mercator output grid."""
    merc_bounds = transform_bounds("EPSG:4326", "EPSG:3857", *bounds)
    merc_w = max(1.0, merc_bounds[2] - merc_bounds[0])
    merc_h = max(1.0, merc_bounds[3] - merc_bounds[1])
    out_w = min(max_size, max(1, source_width))
    out_h = max(1, int(out_w * merc_h / merc_w))
    if out_h > max_size:
        out_w = max(1, int(out_w * max_size / out_h))
        out_h = max_size
    return merc_bounds, out_w, out_h, from_bounds(*merc_bounds, out_w, out_h)


def _expanded_dataset_window(dataset: Any, bounds: tuple[float, ...]) -> Window:
    """Crop after transforming the requested bounds, retaining one edge cell."""
    source_bounds = transform_bounds(
        "EPSG:4326", dataset.crs, *bounds, densify_pts=21
    )
    fractional = window_from_bounds(*source_bounds, transform=dataset.transform)
    col_start = max(0, math.floor(fractional.col_off) - 1)
    row_start = max(0, math.floor(fractional.row_off) - 1)
    col_end = min(
        dataset.width,
        math.ceil(fractional.col_off + fractional.width) + 1,
    )
    row_end = min(
        dataset.height,
        math.ceil(fractional.row_off + fractional.height) + 1,
    )
    if col_start >= col_end or row_start >= row_end:
        raise TileOutsideBounds("Requested bounds do not intersect the COG")
    return Window(
        col_start,
        row_start,
        col_end - col_start,
        row_end - row_start,
    )


def _prepare_cog_measurement(
    raw: np.ndarray,
    nodata: float | None,
) -> np.ndarray:
    """Restore OPERA undetect before interpolation and preserve true nodata."""
    data = np.asarray(raw, dtype=np.float32).copy()
    # The upstream OPERA COG uses NaN for undetect and an explicit finite
    # sentinel (normally -9999000) for nodata. Classification must happen
    # before bilinear reprojection; otherwise NaNs erode sparse echo edges.
    undetect = np.isnan(data)
    true_nodata = (
        np.isclose(data, float(nodata))
        if nodata is not None and math.isfinite(float(nodata))
        else np.zeros(data.shape, dtype=bool)
    )
    data[undetect] = -10.0
    data[true_nodata] = np.nan
    data[~np.isfinite(data)] = np.nan
    return data


def _read_reprojected_cog(
    dataset: Any,
    product: str,
    bounds: tuple[float, ...],
    max_size: int,
    *,
    destination_grid: tuple[tuple[float, ...], int, int, Affine] | None = None,
    include_quality: bool = True,
) -> tuple[np.ndarray, np.ndarray, tuple[tuple[float, ...], int, int, Affine]]:
    """Read native COG cells, classify them, then reproject like GeoZarr."""
    window = _expanded_dataset_window(dataset, bounds)
    source = _prepare_cog_measurement(
        dataset.read(1, window=window, masked=False),
        dataset.nodata,
    )
    source_transform = dataset.window_transform(window)
    grid = destination_grid or _destination_grid(bounds, max_size, source.shape[1])
    _merc_bounds, out_w, out_h, destination_transform = grid
    destination = np.full((out_h, out_w), np.nan, dtype=np.float32)
    reproject(
        source=source,
        destination=destination,
        src_transform=source_transform,
        src_crs=dataset.crs,
        dst_transform=destination_transform,
        dst_crs="EPSG:3857",
        resampling=Resampling.bilinear,
        src_nodata=np.nan,
        dst_nodata=np.nan,
    )

    quality = np.full((out_h, out_w), np.nan, dtype=np.float32)
    if include_quality and product == "DBZH" and dataset.count >= 2:
        source_quality = np.asarray(
            dataset.read(2, window=window, masked=False),
            dtype=np.float32,
        )
        if dataset.nodata is not None and math.isfinite(float(dataset.nodata)):
            source_quality[
                np.isclose(source_quality, float(dataset.nodata))
            ] = np.nan
        source_quality[~np.isfinite(source_quality)] = np.nan
        reproject(
            source=source_quality,
            destination=quality,
            src_transform=source_transform,
            src_crs=dataset.crs,
            dst_transform=destination_transform,
            dst_crs="EPSG:3857",
            resampling=Resampling.nearest,
            src_nodata=np.nan,
            dst_nodata=np.nan,
        )
    return destination, quality, grid


def _get_raw_cog_frame(
    frame: CatalogFrame, max_size: int = 1024, bounds: tuple[float, ...] = OPERA_WGS84_BOUNDS,
    dbzh_frame: CatalogFrame | None = None,
) -> bytes:
    if not frame.hot_cog:
        raise FileNotFoundError("Catalog does not advertise a hot COG")
    cog_path = local_cog(frame.product, frame.timestamp, frame.revision, frame.hot_cog)
    try:
        with cog_reader(cog_path, Reader) as cog:
            d, q, grid = _read_reprojected_cog(
                cog.dataset,
                frame.product,
                bounds,
                max_size,
            )

            if frame.product == "DBZH":
                d = np.where((d < 0.12619) & np.isfinite(d), -10.0, d)
            elif frame.product in ("RATE", "ACRR"):
                d = np.where((d < 0.1) & np.isfinite(d), -10.0, d)
                d_dbzh = None
                if dbzh_frame is not None and dbzh_frame.hot_cog:
                    try:
                        dbzh_cog_path = local_cog(dbzh_frame.product, dbzh_frame.timestamp, dbzh_frame.revision, dbzh_frame.hot_cog)
                        with cog_reader(dbzh_cog_path, Reader) as dbzh_cog:
                            d_dbzh, _dbzh_quality, _dbzh_grid = _read_reprojected_cog(
                                dbzh_cog.dataset,
                                dbzh_frame.product,
                                bounds,
                                max_size,
                                destination_grid=grid,
                                include_quality=False,
                            )
                    except Exception:
                        pass
                
                if d_dbzh is not None:
                    dbzh_missing = np.isnan(d_dbzh)
                    # 1. Crop artifacts: if DBZH is transparent, RATE must be transparent
                    d[dbzh_missing] = np.nan
                    # 2. Fill holes: if DBZH is valid, but RATE is missing, paint scanning area
                    d[np.isnan(d) & ~dbzh_missing] = -10.0

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
    frame: CatalogFrame, max_size: int = 1024, bounds: tuple[float, ...] = OPERA_WGS84_BOUNDS,
    dbzh_frame: CatalogFrame | None = None,
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

    merc_bounds, out_w, out_h, dst_transform = _destination_grid(
        bounds, max_size, src_w
    )
    dst_data = np.full((1, out_h, out_w), np.nan, dtype=np.float32)

    reproject(
        slab.reshape(1, src_h, src_w),
        dst_data,
        src_transform=src_transform,
        src_crs=metadata["crs"],
        dst_transform=dst_transform,
        dst_crs="EPSG:3857",
        resampling=Resampling.bilinear,
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

    d = dst_data[0]
    q = dst_quality[0]
    if frame.product == "DBZH":
        d = np.where((d < 0.12619) & np.isfinite(d), -10.0, d)
    elif frame.product in ("RATE", "ACRR"):
        d = np.where((d < 0.1) & np.isfinite(d), -10.0, d)
        d_dbzh = None
        if dbzh_frame is not None and dbzh_frame.geozarr:
            try:
                dbzh_group = _open_geozarr(dbzh_frame.geozarr)
                dbzh_metadata = _geozarr_metadata(dbzh_frame.geozarr, dbzh_frame.product)
                
                dbzh_times = np.asarray(dbzh_group["time"][:], dtype=np.int64) if "time" in dbzh_group else dbzh_metadata.get("times", np.array([], dtype=np.int64))
                dbzh_time_index = _frame_time_index(dbzh_times, dbzh_frame)
                
                dbzh_slab = np.asarray(dbzh_group[dbzh_frame.product][dbzh_time_index, y_start:y_end, x_start:x_end], dtype=np.float32)
                
                dbzh_undetect = dbzh_group[dbzh_frame.product].attrs.get("undetect_value", None)
                if dbzh_undetect is not None:
                    dbzh_slab[np.isclose(dbzh_slab, float(dbzh_undetect))] = -10.0
                dbzh_status_name = f"{dbzh_frame.product}_status"
                if dbzh_status_name in dbzh_group:
                    dbzh_status_slab = np.asarray(dbzh_group[dbzh_status_name][dbzh_time_index, y_start:y_end, x_start:x_end])
                    dbzh_slab = _apply_geozarr_status(dbzh_slab, dbzh_status_slab)
                dbzh_slab[~np.isfinite(dbzh_slab)] = np.nan
                
                dbzh_dst_data = np.full((1, out_h, out_w), np.nan, dtype=np.float32)
                reproject(
                    dbzh_slab.reshape(1, src_h, src_w),
                    dbzh_dst_data,
                    src_transform=src_transform,
                    src_crs=metadata["crs"],
                    dst_transform=dst_transform,
                    dst_crs="EPSG:3857",
                    resampling=Resampling.bilinear,
                    src_nodata=np.nan,
                    dst_nodata=np.nan,
                )
                d_dbzh = dbzh_dst_data[0]
            except Exception:
                pass

        if d_dbzh is not None:
            dbzh_missing = np.isnan(d_dbzh)
            d[dbzh_missing] = np.nan
            d[np.isnan(d) & ~dbzh_missing] = -10.0

    return _pack_raw_buffer(d, q, frame.product)


# ---------- Byte-bounded compressed-response cache ----------
_RAW_CACHE_MAX_BYTES = int(os.getenv("RAW_CACHE_MAX_BYTES", str(3 * 1024**3)))  # 3 GiB
_CacheEntry = tuple[bytes, str]  # (gzip-compressed bytes, backend)
_raw_cache: OrderedDict[str, _CacheEntry] = OrderedDict()
_raw_cache_bytes = 0
_raw_cache_lock = Lock()

# Single-flight coalescing: prevent duplicate renders for the same key
_inflight: dict[str, Event] = {}
_inflight_lock = Lock()


def _normalize_bbox(bbox_key: str) -> str:
    """Canonicalize bbox to clamped, rounded values so equivalent inputs share a cache key."""
    if not bbox_key:
        return ""
    try:
        parts = tuple(float(x) for x in bbox_key.split(","))
        if len(parts) != 4 or parts[0] >= parts[2] or parts[1] >= parts[3]:
            return ""
        clamped = _clamp_bounds(parts)
        return ",".join(f"{v:.6f}" for v in clamped)
    except ValueError:
        return ""


def _cache_key(product: str, timestamp: str, revision: str, source: str,
               max_size: int, bbox_key: str, allow_archive_fallback: bool,
               render_version: int) -> str:
    norm_product = product.upper()
    norm_source = source.lower()
    norm_bbox = _normalize_bbox(bbox_key)
    return (
        f"{norm_product}:{timestamp}:{revision}:{norm_source}:{max_size}:"
        f"{norm_bbox}:{allow_archive_fallback}:v{render_version}"
    )


def _put_cache(key: str, entry: _CacheEntry) -> None:
    global _raw_cache_bytes
    size = len(entry[0])
    if size > _RAW_CACHE_MAX_BYTES:
        return
    with _raw_cache_lock:
        if key in _raw_cache:
            return
        while _raw_cache_bytes + size > _RAW_CACHE_MAX_BYTES and _raw_cache:
            _, evicted = _raw_cache.popitem(last=False)
            _raw_cache_bytes -= len(evicted[0])
        _raw_cache[key] = entry
        _raw_cache_bytes += size


def _get_cache(key: str) -> _CacheEntry | None:
    with _raw_cache_lock:
        if key in _raw_cache:
            _raw_cache.move_to_end(key)
            return _raw_cache[key]
    return None


def _render_and_compress(
    product: str, timestamp: str, revision: str, source: str,
    max_size: int, bbox_key: str, allow_archive_fallback: bool,
) -> _CacheEntry:
    """Render a raw frame and return (gzip-level-1 compressed bytes, backend)."""
    frame = resolve_catalog_frame(product, timestamp, revision)
    bounds = OPERA_WGS84_BOUNDS
    if bbox_key:
        try:
            parts = tuple(float(x) for x in bbox_key.split(","))
            if len(parts) == 4 and parts[0] < parts[2] and parts[1] < parts[3]:
                bounds = _clamp_bounds(parts)
        except ValueError:
            pass

    dbzh_frame = None
    if product in ("RATE", "ACRR"):
        try:
            dbzh_frame = resolve_catalog_frame("DBZH", timestamp, revision)
        except Exception:
            pass

    use_cog = (source != "geozarr" and frame.hot_cog and frame.hot_cog_ready)
    raw: bytes | None = None
    backend: str = "cog"
    try:
        acquired = RENDER_SLOTS.acquire(timeout=RENDER_QUEUE_TIMEOUT_SECONDS)
        if not acquired:
            raise HTTPException(
                status_code=503,
                detail="Server is busy rendering other frames. Please retry.",
            )
        try:
            if use_cog:
                raw = _get_raw_cog_frame(frame, max_size, bounds, dbzh_frame=dbzh_frame)
                backend = "cog"
            else:
                raw = _get_raw_geozarr_frame(frame, max_size, bounds, dbzh_frame=dbzh_frame)
                backend = "geozarr"
        finally:
            RENDER_SLOTS.release()
    except HTTPException:
        raise
    except Exception as exc:
        if allow_archive_fallback and frame.archive_ready and frame.geozarr:
            logger.warning(
                "Hot COG frame render failed for %s %s revision %s (%s); "
                "falling back to GeoZarr",
                product, timestamp, revision, type(exc).__name__,
                exc_info=True,
            )
            acquired = RENDER_SLOTS.acquire(timeout=RENDER_QUEUE_TIMEOUT_SECONDS)
            if not acquired:
                raise HTTPException(
                    status_code=503,
                    detail="Server is busy rendering other frames. Please retry.",
                )
            try:
                raw = _get_raw_geozarr_frame(frame, max_size, bounds, dbzh_frame=dbzh_frame)
                backend = "geozarr"
            finally:
                RENDER_SLOTS.release()
        else:
            raise

    compressed = gzip.compress(raw, compresslevel=1)
    return compressed, backend


def _wants_gzip(request: Request) -> bool:
    """Return True unless the client explicitly refuses gzip."""
    accept = (request.headers.get("accept-encoding") or "gzip").lower()

    tokens = [t.strip() for t in accept.split(",")]
    gzip_q = None
    star_q = None

    for token in tokens:
        parts = [p.strip() for p in token.split(";")]
        if not parts:
            continue
        name = parts[0]
        q_value = 1.0
        for part in parts[1:]:
            if part.startswith("q="):
                try:
                    q_value = float(part[2:])
                except ValueError:
                    pass
        if name == "gzip":
            gzip_q = q_value
        elif name == "*":
            star_q = q_value

    if gzip_q is not None:
        return gzip_q > 0.0
    if star_q is not None:
        return star_q > 0.0

    return "gzip" in accept or "*" in accept


def _make_response(entry: _CacheEntry, revision: str, use_gzip: bool) -> Response:
    """Build a Response from a cache entry, decompressing if the client refuses gzip."""
    compressed, backend = entry
    if use_gzip:
        return Response(
            content=compressed,
            media_type="application/octet-stream",
            headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "Vary": "Accept-Encoding",
                "Content-Encoding": "gzip",
                "X-OPERA-Backend": backend,
                "X-OPERA-Revision": revision,
            },
        )
    else:
        return Response(
            content=gzip.decompress(compressed),
            media_type="application/octet-stream",
            headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "Vary": "Accept-Encoding",
                "X-OPERA-Backend": backend,
                "X-OPERA-Revision": revision,
            },
        )


@router.get("/raw/{product}/{timestamp}/{revision}.bin")
def get_raw_frame(
    request: Request,
    product: str,
    timestamp: str,
    revision: str,
    source: str = Query("auto", pattern="^(auto|cog|geozarr)$"),
    max_size: int = Query(1024, ge=256, le=4096),
    bbox: str = Query(""),
    allow_archive_fallback: bool = Query(True),
    render_version: int = Query(RAW_RENDER_VERSION, ge=RAW_RENDER_VERSION, le=RAW_RENDER_VERSION),
) -> Response:
    key = _cache_key(
        product,
        timestamp,
        revision,
        source,
        max_size,
        bbox,
        allow_archive_fallback,
        render_version,
    )
    use_gzip = _wants_gzip(request)

    # 1. Check cache
    cached = _get_cache(key)
    if cached is not None:
        logger.info(
            "Radar frame cache hit product=%s timestamp=%s storage=%s",
            product, timestamp, storage_mode(),
        )
        return _make_response(cached, revision, use_gzip)

    # 2. Single-flight coalescing: only one thread renders a given key
    is_renderer = False
    with _inflight_lock:
        event = _inflight.get(key)
        if event is None:
            event = Event()
            _inflight[key] = event
            is_renderer = True

    if not is_renderer:
        waited = event.wait(timeout=60)
        if not waited:
            raise HTTPException(status_code=503, detail="Server is busy rendering this frame. Please retry.")

        cached = _get_cache(key)
        if cached is not None:
            return _make_response(cached, revision, use_gzip)
        else:
            raise HTTPException(status_code=503, detail="Raw frame rendering failed in another thread.")

    # 3. Render, compress, cache, then signal waiters
    try:
        entry = _render_and_compress(
            product, timestamp, revision, source, max_size, bbox, allow_archive_fallback,
        )
        _put_cache(key, entry)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Raw frame rendering failed") from exc
    finally:
        with _inflight_lock:
            _inflight.pop(key, None)
        event.set()  # Wake up waiting threads AFTER cache is populated (or failed)

    compressed, backend = entry
    logger.info(
        "Radar frame served product=%s timestamp=%s backend=%s storage=%s compressed=%d",
        product, timestamp, backend, storage_mode(), len(compressed),
    )
    return _make_response(entry, revision, use_gzip)
