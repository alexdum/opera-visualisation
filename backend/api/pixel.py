"""Catalog-gated exact-pixel queries against the permanent GeoZarr archive."""

from __future__ import annotations

import csv
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
import io
import json
import math
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
import numpy as np
from pyproj import CRS, Transformer
from starlette.concurrency import run_in_threadpool
import zarr

from api.bucket import HF_BUCKET_URL, fsspec_storage_options, USE_LOCAL_MOUNT, resolve_path
from api.catalog import CatalogFrame, cataloged_frames_between, normalize_product


router = APIRouter()
STATUS_NAMES = {0: "detected", 1: "undetect", 2: "nodata"}


@lru_cache(maxsize=8)
def _open_group(store_path: str) -> Any:
    if USE_LOCAL_MOUNT:
        store = zarr.storage.LocalStore(resolve_path(store_path))
    else:
        store = zarr.storage.FsspecStore.from_url(
            f"{HF_BUCKET_URL}/{store_path}", storage_options=fsspec_storage_options()
        )
    return zarr.open_group(store=store, mode="r")


@lru_cache(maxsize=16)
def _store_metadata(store_path: str) -> dict[str, Any]:
    group = _open_group(store_path)
    crs_attrs = dict(group["crs"].attrs)
    source_crs = CRS.from_user_input(crs_attrs["proj4_params"])
    return {
        "x": np.asarray(group["x"][:], dtype=np.float64),
        "y": np.asarray(group["y"][:], dtype=np.float64),
        "to_native": Transformer.from_crs("EPSG:4326", source_crs, always_xy=True),
        "to_wgs84": Transformer.from_crs(source_crs, "EPSG:4326", always_xy=True),
    }


def _parse_time_bound(value: str, field: str, *, end_of_day: bool) -> datetime:
    """Parse an ISO date or timestamp, normalizing the result to UTC.

    Date-only values remain supported for existing clients. Their bounds cover
    the complete UTC day, while timestamp values allow the UI to request an
    exact rolling 24-hour window.
    """
    try:
        parsed_date = date.fromisoformat(value)
        return datetime.combine(parsed_date, time.max if end_of_day else time.min, tzinfo=timezone.utc)
    except ValueError as exc:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"{field} must be an ISO 8601 UTC date or timestamp",
            ) from exc
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)


def _to_iso(epoch_seconds: int) -> str:
    return datetime.fromtimestamp(int(epoch_seconds), tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_scalar(value: Any) -> Any:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, np.generic):
        return value.item()
    return value


def _read_pixel_span(array: Any, time_slice: slice, y_index: int, x_index: int) -> np.ndarray:
    return np.asarray(array[time_slice, y_index, x_index]).reshape(-1)


def _read_bounds_span(array: Any, time_slice: slice) -> np.ndarray:
    return np.asarray(array[time_slice], dtype=np.int64)


def _extract_store_frames(
    product: str,
    store_path: str,
    frames: list[CatalogFrame],
    lon: float,
    lat: float,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    group = _open_group(store_path)
    metadata = _store_metadata(store_path)
    x_coords: np.ndarray = metadata["x"]
    y_coords: np.ndarray = metadata["y"]
    x_native, y_native = metadata["to_native"].transform(lon, lat)
    if not (x_coords.min() <= x_native <= x_coords.max() and y_coords.min() <= y_native <= y_coords.max()):
        raise HTTPException(status_code=400, detail=f"Point ({lon}, {lat}) is outside the OPERA grid")

    x_index = int(np.abs(x_coords - x_native).argmin())
    y_index = int(np.abs(y_coords - y_native).argmin())
    center_lon, center_lat = metadata["to_wgs84"].transform(x_coords[x_index], y_coords[y_index])
    location = {
        "x_index": x_index,
        "y_index": y_index,
        "native_x": float(x_coords[x_index]),
        "native_y": float(y_coords[y_index]),
        "pixel_center_lon": float(center_lon),
        "pixel_center_lat": float(center_lat),
    }

    # Grid geometry and CRS are immutable and safely cached, but the monthly
    # time coordinate grows throughout the month. Read it live for every
    # query so newly cataloged frames are immediately addressable without a
    # backend restart.
    time_values = np.asarray(group["time"][:], dtype=np.int64)
    time_lookup = {int(epoch): index for index, epoch in enumerate(time_values)}
    status_array = group[f"{product}_status"]
    measurement_array = group[product]
    time_bounds = group["time_bnds"] if "time_bnds" in group else None
    quality_names = sorted({name for frame in frames for name in frame.quality_variables if name in group})

    indexed_frames: list[tuple[CatalogFrame, int]] = []
    for frame in frames:
        epoch = int(datetime.fromisoformat(frame.nominal_time.replace("Z", "+00:00")).timestamp())
        index = time_lookup.get(epoch)
        if index is None:
            # Catalog is authoritative: absence in the store is a consistency
            # error, not an empty observation.
            raise HTTPException(status_code=503, detail=f"Cataloged frame missing from GeoZarr: {frame.nominal_time}")
        indexed_frames.append((frame, index))

    if not indexed_frames:
        return [], location

    # Fetch each time-dependent array once for the requested interval. Remote
    # Zarr stores otherwise turn a 24-hour query into hundreds of sequential
    # object reads (one read per frame and variable).
    first_index = min(index for _, index in indexed_frames)
    final_index = max(index for _, index in indexed_frames) + 1
    time_slice = slice(first_index, final_index)
    arrays = {"status": status_array, "measurement": measurement_array}
    arrays.update({f"quality:{name}": group[name] for name in quality_names})
    worker_count = min(4, len(arrays) + int(time_bounds is not None))
    with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="pixel-zarr") as executor:
        futures = {
            key: executor.submit(_read_pixel_span, array, time_slice, y_index, x_index)
            for key, array in arrays.items()
        }
        bounds_future = (
            executor.submit(_read_bounds_span, time_bounds, time_slice)
            if time_bounds is not None
            else None
        )
        status_values = futures["status"].result()
        measurement_values = futures["measurement"].result()
        quality_values = {name: futures[f"quality:{name}"].result() for name in quality_names}
        bounds_values = bounds_future.result() if bounds_future is not None else None

    results: list[dict[str, Any]] = []
    for frame, index in indexed_frames:
        offset = index - first_index
        status_code = int(_safe_scalar(status_values[offset]))
        status = STATUS_NAMES.get(status_code, "unknown")
        raw_value = float(_safe_scalar(measurement_values[offset]))
        value = raw_value if status == "detected" and math.isfinite(raw_value) else None
        quality: dict[str, float | None] = {}
        for name in quality_names:
            raw_quality = float(_safe_scalar(quality_values[name][offset]))
            quality[name] = raw_quality if math.isfinite(raw_quality) and 0.0 <= raw_quality <= 1.0 else None

        start_time = frame.start_time
        end_time = frame.end_time
        if bounds_values is not None:
            bounds = np.asarray(bounds_values[offset], dtype=np.int64).reshape(-1)
            if len(bounds) >= 2:
                start_time = start_time or _to_iso(int(bounds[0]))
                end_time = end_time or _to_iso(int(bounds[1]))

        results.append(
            {
                "time": frame.nominal_time,
                "start_time": start_time,
                "end_time": end_time,
                "value": value,
                "product": product,
                "status": status,
                "status_code": status_code,
                "quality": quality,
                "revision": frame.revision,
            }
        )
    return results, location


def extract_pixel_series(
    product: str,
    lon: float,
    lat: float,
    start_dt: datetime,
    end_dt: datetime,
) -> dict[str, Any]:
    product = normalize_product(product)
    frames = cataloged_frames_between(product, start_dt, end_dt)
    grouped: dict[str, list[CatalogFrame]] = {}
    for frame in frames:
        grouped.setdefault(frame.geozarr, []).append(frame)

    results: list[dict[str, Any]] = []
    location: dict[str, Any] = {
        "x_index": None,
        "y_index": None,
        "native_x": None,
        "native_y": None,
        "pixel_center_lon": None,
        "pixel_center_lat": None,
    }
    for store_path, store_frames in sorted(grouped.items()):
        extracted, store_location = _extract_store_frames(product, store_path, store_frames, lon, lat)
        results.extend(extracted)
        location = store_location
    results.sort(key=lambda row: row["time"])
    return {
        "product": product,
        "lon": lon,
        "lat": lat,
        **location,
        "start": start_dt.isoformat().replace("+00:00", "Z"),
        "end": end_dt.isoformat().replace("+00:00", "Z"),
        "count": len(results),
        "series": results,
    }


def _validate_request(product: str, lon: float, lat: float, start: str, end: str) -> tuple[str, datetime, datetime]:
    normalized = normalize_product(product)
    if not (-180 <= lon <= 180) or not (-90 <= lat <= 90):
        raise HTTPException(status_code=400, detail="Coordinates out of range")
    start_dt = _parse_time_bound(start, "start", end_of_day=False)
    end_dt = _parse_time_bound(end, "end", end_of_day=True)
    if end_dt < start_dt:
        raise HTTPException(status_code=400, detail="End date must not precede start date")
    if end_dt - start_dt > timedelta(hours=24):
        raise HTTPException(status_code=400, detail="Maximum pixel-analysis period is 24 hours")
    return normalized, start_dt, end_dt


@router.get("")
async def get_pixel_series(
    product: str = Query(...),
    lon: float = Query(...),
    lat: float = Query(...),
    start: str = Query(...),
    end: str = Query(...),
) -> dict[str, Any]:
    normalized, start_dt, end_dt = _validate_request(product, lon, lat, start, end)
    return await run_in_threadpool(extract_pixel_series, normalized, lon, lat, start_dt, end_dt)


@router.get("/csv")
async def get_pixel_csv(
    product: str = Query(...),
    lon: float = Query(...),
    lat: float = Query(...),
    start: str = Query(...),
    end: str = Query(...),
) -> StreamingResponse:
    data = await get_pixel_series(product=product, lon=lon, lat=lat, start=start, end=end)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "time_utc",
            "start_time_utc",
            "end_time_utc",
            "value",
            "product",
            "unit",
            "status",
            "status_code",
            "quality_json",
            "revision",
        ]
    )
    units = {"DBZH": "dBZ", "RATE": "mm/h", "ACRR": "mm"}
    for row in data["series"]:
        writer.writerow(
            [
                row["time"],
                row["start_time"],
                row["end_time"],
                row["value"],
                row["product"],
                units[row["product"]],
                row["status"],
                row["status_code"],
                json.dumps(row["quality"], sort_keys=True),
                row["revision"],
            ]
        )
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="pixel-{data["product"].lower()}.csv"'},
    )
