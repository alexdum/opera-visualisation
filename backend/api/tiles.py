"""Revision-safe raster tiles backed by cataloged COG or GeoZarr frames."""

from __future__ import annotations

import functools
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

from api.bucket import HF_BUCKET_URL, fsspec_storage_options
from api.catalog import CatalogFrame, normalize_product, resolve_catalog_frame
from api.cog_cache import BucketRateLimitError, local_cog


router = APIRouter()
TILE_SIZE = 256
WEB_MERCATOR_LIMIT = 20037508.342789244


DBZH_CMAP = [
    ((-5.0, 0.0), (10, 130, 200, 255)),
    ((0.0, 5.0), (10, 155, 180, 255)),
    ((5.0, 10.0), (10, 185, 175, 255)),
    ((10.0, 15.0), (5, 205, 170, 255)),
    ((15.0, 20.0), (140, 230, 20, 255)),
    ((20.0, 25.0), (240, 240, 20, 255)),
    ((25.0, 30.0), (255, 205, 20, 255)),
    ((30.0, 35.0), (255, 150, 50, 255)),
    ((35.0, 40.0), (255, 80, 60, 255)),
    ((40.0, 45.0), (250, 120, 255, 255)),
    ((45.0, 150.0), (190, 255, 255, 255)),
]
RATE_CMAP = [
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
def _open_geozarr(path: str) -> Any:
    store = zarr.storage.FsspecStore.from_url(
        f"{HF_BUCKET_URL}/{path}", storage_options=fsspec_storage_options()
    )
    return zarr.open_group(store=store, mode="r")


@functools.lru_cache(maxsize=16)
def _geozarr_metadata(path: str, product: str) -> dict[str, Any]:
    group = _open_geozarr(path)
    x_coords = np.asarray(group["x"][:], dtype=np.float64)
    y_coords = np.asarray(group["y"][:], dtype=np.float64)
    times = np.asarray(group["time"][:], dtype=np.int64)
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
    time_index = _frame_time_index(metadata["times"], frame)
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
        data[np.isclose(data, float(undetect_value))] = -4.999 if frame.product == "DBZH" else 0.0
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
    with Reader(str(cog_path)) as cog:
        indexes = (1, 2) if frame.product == "DBZH" and min_quality is not None and cog.dataset.count >= 2 else 1
        try:
            image = cog.tile(x, y, z, indexes=indexes)
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
        except Exception:
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
