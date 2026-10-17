"""Catalog-gated exact-pixel queries against the permanent GeoZarr archive."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from contextlib import contextmanager, suppress
from contextvars import ContextVar
import csv
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import copy
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
import io
import json
import logging
import math
import os
from threading import Event, RLock
import time as clock
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
import numpy as np
from pyproj import CRS, Transformer
from starlette.concurrency import run_in_threadpool
import zarr

from api.bucket import HF_BUCKET_URL, fsspec_storage_options, USE_LOCAL_MOUNT, resolve_path
from api.catalog import CatalogFrame, cataloged_frames_between, normalize_product
from api.pixel_work import PixelBlockCache, PixelBusy, PixelCancelled, PixelSlots, SharedPixelWork, check_cancelled


router = APIRouter()
logger = logging.getLogger("uvicorn.error")
STATUS_NAMES = {0: "detected", 1: "undetect", 2: "nodata"}
PIXEL_METADATA_CACHE_SECONDS = max(
    1.0, float(os.getenv("PIXEL_METADATA_CACHE_SECONDS", "30"))
)
PIXEL_RESPONSE_CACHE_SECONDS = max(
    0.0, float(os.getenv("PIXEL_RESPONSE_CACHE_SECONDS", "300"))
)
PIXEL_RESPONSE_CACHE_ENTRIES = max(
    0, int(os.getenv("PIXEL_RESPONSE_CACHE_ENTRIES", "128"))
)

_pixel_response_cache: OrderedDict[tuple[Any, ...], tuple[float, list[dict[str, Any]]]] = (
    OrderedDict()
)
_pixel_response_cache_lock = RLock()
_pixel_work = SharedPixelWork()
_pixel_blocks = PixelBlockCache(
    max(0, int(os.getenv("PIXEL_BLOCK_CACHE_MAX_BYTES", str(64 * 1024 * 1024)))),
    max(0, int(os.getenv("PIXEL_BLOCK_CACHE_ENTRIES", "1024"))),
    PIXEL_RESPONSE_CACHE_SECONDS,
)
# Limit each uncancellable storage operation without spawning a task per frame.
_PIXEL_READ_BATCH = 32
_PIXEL_BLOCK_SIDE = 32
_PIXEL_IO_WORKERS = max(1, min(4, int(os.getenv("PIXEL_IO_WORKERS", "2"))))
_pixel_slots = PixelSlots(
    int(os.getenv("PIXEL_EXTRACTION_CONCURRENCY", "1")),
    int(os.getenv("PIXEL_EXTRACTION_QUEUE_SIZE", "8")),
    float(os.getenv("PIXEL_EXTRACTION_WAIT_SECONDS", "15")),
)
_pixel_cancelled: ContextVar[Callable[[], bool]] = ContextVar("pixel_cancelled", default=lambda: False)
_pixel_timings: ContextVar[dict[str, float] | None] = ContextVar("pixel_timings", default=None)


@contextmanager
def _phase(name: str):
    started = clock.perf_counter()
    try:
        yield
    finally:
        timings = _pixel_timings.get()
        if timings is not None:
            timings[name] = timings.get(name, 0.0) + (clock.perf_counter() - started) * 1000


def _metadata_cache_bucket() -> int:
    return int(clock.monotonic() // PIXEL_METADATA_CACHE_SECONDS)


@lru_cache(maxsize=8)
def _open_group_cached(store_path: str, _cache_bucket: int) -> Any:
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


def _open_group(store_path: str) -> Any:
    return _open_group_cached(store_path, _metadata_cache_bucket())


_open_group.cache_clear = _open_group_cached.cache_clear  # type: ignore[attr-defined]
_open_group.cache_info = _open_group_cached.cache_info  # type: ignore[attr-defined]


@lru_cache(maxsize=32)
def _read_time_coords_cached(store_path: str, _cache_bucket: int) -> np.ndarray:
    group = _open_group(store_path)
    return np.asarray(group["time"][:], dtype=np.int64)


def _read_time_coords(store_path: str) -> np.ndarray:
    return _read_time_coords_cached(store_path, _metadata_cache_bucket())


_read_time_coords.cache_clear = _read_time_coords_cached.cache_clear  # type: ignore[attr-defined]
_read_time_coords.cache_info = _read_time_coords_cached.cache_info  # type: ignore[attr-defined]


def _time_lower_bound(
    time_array: Any, target_epoch: int, *, read: Callable[[int], int] | None = None,
    lower: int = 0,
) -> int:
    read = read or (lambda index: int(_safe_scalar(time_array[index])))
    low, high = lower, int(time_array.shape[0])
    guesses = 0
    while low < high:
        # Near-regular timestamps often resolve in a few reads. Interpolation
        # only chooses a probe: every comparison still reads the exact epoch.
        # Bound the guesses before reverting to binary search on irregular data.
        if guesses < 3 and high - low > 1:
            first, last = read(low), read(high - 1)
            if target_epoch <= first:
                return low
            if target_epoch > last:
                return high
            middle = (low + (target_epoch - first) * (high - low - 1) // (last - first)
                      if last > first else (low + high) // 2)
            guesses += 1
        else:
            middle = (low + high) // 2
        if read(middle) < target_epoch:
            low = middle + 1
        else:
            high = middle
    return low


def _time_batches(first: int, stop: int) -> list[tuple[int, int]]:
    batches = []
    while first < stop:
        end = min(stop, (first // _PIXEL_READ_BATCH + 1) * _PIXEL_READ_BATCH)
        batches.append((first, end))
        first = end
    return batches


def _read_time_window_uncached(
    store_path: str, start_epoch: int, end_epoch: int, cancelled: Callable[[], bool],
) -> tuple[int, np.ndarray]:
    check_cancelled(cancelled)
    time_array = _open_group(store_path)["time"]

    @lru_cache(maxsize=128)
    def read(index: int) -> int:
        check_cancelled(cancelled)
        value = int(_safe_scalar(time_array[index]))
        check_cancelled(cancelled)
        return value

    first_index = _time_lower_bound(time_array, start_epoch, read=read)
    final_index = _time_lower_bound(time_array, end_epoch + 1, read=read, lower=first_index)
    batches = _time_batches(first_index, final_index)
    if not batches:
        return first_index, np.empty(0, dtype=np.int64)

    def read_batch(bounds: tuple[int, int]) -> np.ndarray:
        check_cancelled(cancelled)
        first, stop = bounds
        values = np.asarray(time_array[first:stop], dtype=np.int64)
        check_cancelled(cancelled)
        return values

    # Timestamp chunks contain one value each. Bound parallel range reads just
    # like measurement reads, without changing Zarr's process-wide concurrency.
    if len(batches) == 1:
        values = read_batch(batches[0])
    else:
        with ThreadPoolExecutor(max_workers=min(_PIXEL_IO_WORKERS, len(batches)), thread_name_prefix="pixel-time") as executor:
            values = np.concatenate(list(executor.map(read_batch, batches)))
    return first_index, values


@lru_cache(maxsize=64)
def _read_time_window_cached(
    store_path: str, start_epoch: int, end_epoch: int, _cache_bucket: int,
) -> tuple[int, np.ndarray]:
    return _pixel_work.run(
        ("time", store_path, start_epoch, end_epoch, _cache_bucket),
        lambda cancelled: _read_time_window_uncached(store_path, start_epoch, end_epoch, cancelled),
        _pixel_cancelled.get(),
    )


def _read_time_window(
    store_path: str, start_epoch: int, end_epoch: int
) -> tuple[int, np.ndarray]:
    return _read_time_window_cached(
        store_path, start_epoch, end_epoch, _metadata_cache_bucket()
    )


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


def _read_pixel_span(
    array: Any, time_slice: slice, y_index: int, x_index: int,
    cache_key: tuple[Any, ...], cancelled: Callable[[], bool],
) -> np.ndarray:
    chunks = getattr(array, "chunks", None)
    shape = getattr(array, "shape", None)
    use_blocks = _pixel_blocks.enabled and chunks is not None and shape is not None
    if use_blocks:
        # Stay inside one physical chunk, including irregular edge chunks.
        def extent(index: int, chunk: int, size: int) -> tuple[int, int]:
            origin = index // chunk * chunk
            start = origin + (index - origin) // _PIXEL_BLOCK_SIDE * _PIXEL_BLOCK_SIDE
            return start, min(start + _PIXEL_BLOCK_SIDE, origin + chunk, size)
        y0, y1 = extent(y_index, chunks[1], shape[1])
        x0, x1 = extent(x_index, chunks[2], shape[2])
    values = []
    for first in range(time_slice.start, time_slice.stop, _PIXEL_READ_BATCH):
        check_cancelled(cancelled)
        stop = min(first + _PIXEL_READ_BATCH, time_slice.stop)
        if use_blocks:
            key = ("block", cache_key, first, stop, y0, y1, x0, x1)
            def read_block(shared_cancelled: Callable[[], bool]) -> np.ndarray:
                check_cancelled(shared_cancelled)
                cached = _pixel_blocks.get(key)
                if cached is not None:
                    return cached
                data = np.asarray(array[first:stop, y0:y1, x0:x1])
                check_cancelled(shared_cancelled)
                _pixel_blocks.put(key, data)
                return data
            block = _pixel_blocks.get(key)
            if block is None:
                block = _pixel_work.run(key, read_block, cancelled)
            values.append(block[:, y_index - y0, x_index - x0])
        else:
            values.append(np.asarray(array[first:stop, y_index, x_index]).reshape(-1))
        check_cancelled(cancelled)
    return np.concatenate(values)


def _read_bounds_span(
    array: Any, indexes: list[int], cancelled: Callable[[], bool],
) -> dict[int, np.ndarray]:
    # Read only rows missing catalog bounds, grouping adjacent rows into batches.
    values: dict[int, np.ndarray] = {}
    position = 0
    while position < len(indexes):
        check_cancelled(cancelled)
        first = indexes[position]
        stop = first + 1
        position += 1
        while position < len(indexes) and indexes[position] == stop and stop - first < _PIXEL_READ_BATCH:
            stop += 1
            position += 1
        block = np.asarray(array[first:stop], dtype=np.int64)
        check_cancelled(cancelled)
        values.update((first + offset, row) for offset, row in enumerate(block))
    return values


def _pixel_cache_get(key: tuple[Any, ...]) -> list[dict[str, Any]] | None:
    if PIXEL_RESPONSE_CACHE_ENTRIES == 0 or PIXEL_RESPONSE_CACHE_SECONDS == 0:
        return None
    now = clock.monotonic()
    with _pixel_response_cache_lock:
        cached = _pixel_response_cache.get(key)
        if cached is None:
            return None
        expires_at, rows = cached
        if expires_at <= now:
            del _pixel_response_cache[key]
            return None
        _pixel_response_cache.move_to_end(key)
        return copy.deepcopy(rows)


def _pixel_cache_put(key: tuple[Any, ...], rows: list[dict[str, Any]]) -> None:
    if PIXEL_RESPONSE_CACHE_ENTRIES == 0 or PIXEL_RESPONSE_CACHE_SECONDS == 0:
        return
    expires_at = clock.monotonic() + PIXEL_RESPONSE_CACHE_SECONDS
    with _pixel_response_cache_lock:
        _pixel_response_cache[key] = (expires_at, copy.deepcopy(rows))
        _pixel_response_cache.move_to_end(key)
        while len(_pixel_response_cache) > PIXEL_RESPONSE_CACHE_ENTRIES:
            _pixel_response_cache.popitem(last=False)


def _clear_pixel_response_cache() -> None:
    with _pixel_response_cache_lock:
        _pixel_response_cache.clear()


def _extract_store_frames(
    product: str,
    store_path: str,
    frames: list[CatalogFrame],
    lon: float,
    lat: float,
    cancelled: Callable[[], bool] = lambda: False,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    check_cancelled(cancelled)
    with _phase("metadata"):
        group = _open_group(store_path)
        check_cancelled(cancelled)
        metadata = _store_metadata(store_path)
        check_cancelled(cancelled)
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

    frame_identity = tuple(
        (
            frame.nominal_time,
            frame.start_time,
            frame.end_time,
            frame.revision,
            tuple(frame.quality_variables),
        )
        for frame in frames
    )
    cache_key = (product, store_path, y_index, x_index, frame_identity)
    cached_rows = _pixel_cache_get(cache_key)
    if cached_rows is not None:
        return cached_rows, location

    if not frames:
        return [], location

    def load(shared_cancelled: Callable[[], bool]) -> list[dict[str, Any]]:
        check_cancelled(shared_cancelled)
        # Another flight may have populated the cache after the first lookup.
        cached = _pixel_cache_get(cache_key)
        if cached is not None:
            return cached
        # Admit only the shared cell owner. Waiters and response-cache hits do
        # not consume extraction slots. Check again after queueing: a nearby
        # extraction may have warmed the decoded blocks in the meantime.
        with _phase("queue"):
            _pixel_slots.acquire(shared_cancelled)
        try:
            rows = _read_store_frames(
                product, store_path, frames, group, y_index, x_index,
                (product, store_path, frame_identity), shared_cancelled,
            )
        finally:
            _pixel_slots.release()
        check_cancelled(shared_cancelled)
        _pixel_cache_put(cache_key, rows)
        return rows

    rows = _pixel_work.run(("cell", cache_key), load, cancelled)
    return copy.deepcopy(rows), location


def _read_store_frames(
    product: str, store_path: str, frames: list[CatalogFrame], group: Any,
    y_index: int, x_index: int, cache_key: tuple[Any, ...],
    cancelled: Callable[[], bool],
) -> list[dict[str, Any]]:
    frame_epochs = [
        int(datetime.fromisoformat(frame.nominal_time.replace("Z", "+00:00")).timestamp())
        for frame in frames
    ]
    token = _pixel_cancelled.set(cancelled)
    try:
        with _phase("time_index"):
            first_time_index, time_values = _read_time_window(
                store_path, min(frame_epochs), max(frame_epochs)
            )
    finally:
        _pixel_cancelled.reset(token)
    time_lookup = {
        int(epoch): first_time_index + offset
        for offset, epoch in enumerate(time_values)
    }
    check_cancelled(cancelled)
    if len(time_lookup) != len(time_values):
        raise HTTPException(status_code=503, detail="Duplicate timestamps in GeoZarr time window")
    status_array = group[f"{product}_status"]
    measurement_array = group[product]
    needs_bounds = any(not frame.start_time or not frame.end_time for frame in frames)
    time_bounds = group["time_bnds"] if needs_bounds and "time_bnds" in group else None
    quality_names = sorted({name for frame in frames for name in frame.quality_variables if name in group})

    indexed_frames: list[tuple[CatalogFrame, int]] = []
    for frame, epoch in zip(frames, frame_epochs, strict=True):
        index = time_lookup.get(epoch)
        if index is None:
            # Catalog is authoritative: absence in the store is a consistency
            # error, not an empty observation.
            raise HTTPException(status_code=503, detail=f"Cataloged frame missing from GeoZarr: {frame.nominal_time}")
        indexed_frames.append((frame, index))

    if not indexed_frames:
        return []

    first_index = min(index for _, index in indexed_frames)
    final_index = max(index for _, index in indexed_frames) + 1
    arrays = {"status": status_array, "measurement": measurement_array}
    arrays.update({f"quality:{name}": group[name] for name in quality_names})
    batches = _time_batches(first_index, final_index)
    indexed_identities = [(index, identity) for (_, index), identity in zip(indexed_frames, cache_key[2], strict=True)]
    # Interior batches retain their identity when the rolling window advances.
    # A new or corrected frame invalidates only the batches containing it.
    def batch_key(first: int, stop: int, array_key: str) -> tuple[Any, ...]:
        identities = tuple(item for item in indexed_identities if first <= item[0] < stop)
        return ((product, store_path, identities), array_key)
    worker_count = min(_PIXEL_IO_WORKERS, len(arrays) * len(batches) + int(time_bounds is not None))
    with _phase("data"), ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="pixel-zarr") as executor:
        # A fixed, configurable worker pool schedules array/time batches
        # together, within the process-wide heavy-extraction admission limit.
        futures = [
            (key, executor.submit(
                _read_pixel_span, array, slice(first, stop),
                y_index, x_index, batch_key(first, stop, key), cancelled,
            ))
            for first, stop in batches for key, array in arrays.items()
        ]
        bounds_future = (
            executor.submit(
                _read_bounds_span, time_bounds,
                sorted({index for frame, index in indexed_frames if not frame.start_time or not frame.end_time}),
                cancelled,
            )
            if time_bounds is not None else None
        )
        parts: dict[str, list[np.ndarray]] = {key: [] for key in arrays}
        for key, future in futures:
            parts[key].append(future.result())
        pixel_values = {key: np.concatenate(values) for key, values in parts.items()}
        bounds_values = bounds_future.result() if bounds_future is not None else None

    check_cancelled(cancelled)
    results: list[dict[str, Any]] = []
    for frame, index in indexed_frames:
        offset = index - first_index
        status_code = int(_safe_scalar(pixel_values["status"][offset]))
        status = STATUS_NAMES.get(status_code, "unknown")
        raw_value = float(_safe_scalar(pixel_values["measurement"][offset]))
        value = raw_value if status == "detected" and math.isfinite(raw_value) else None

        if value is not None:
            if product == "DBZH" and value < 0.12619:
                status = "undetect"
                status_code = 1
                value = None
            elif product in ("RATE", "ACRR") and value < 0.1:
                status = "undetect"
                status_code = 1
                value = None
        quality: dict[str, float | None] = {}
        for name in quality_names:
            raw_quality = float(_safe_scalar(pixel_values[f"quality:{name}"][offset]))
            quality[name] = raw_quality if math.isfinite(raw_quality) and 0.0 <= raw_quality <= 1.0 else None

        start_time = frame.start_time
        end_time = frame.end_time
        if bounds_values is not None and index in bounds_values:
            bounds = np.asarray(bounds_values[index], dtype=np.int64).reshape(-1)
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
    return results


def extract_pixel_series(
    product: str,
    lon: float,
    lat: float,
    start_dt: datetime,
    end_dt: datetime,
    cancelled: Callable[[], bool] = lambda: False,
) -> dict[str, Any]:
    check_cancelled(cancelled)
    product = normalize_product(product)
    with _phase("catalog"):
        frames = cataloged_frames_between(product, start_dt, end_dt)
    check_cancelled(cancelled)
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
        check_cancelled(cancelled)
        extracted, store_location = _extract_store_frames(product, store_path, store_frames, lon, lat, cancelled)
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
    request: Request,
    response: Response,
    product: str = Query(...),
    lon: float = Query(...),
    lat: float = Query(...),
    start: str = Query(...),
    end: str = Query(...),
) -> dict[str, Any]:
    normalized, start_dt, end_dt = _validate_request(product, lon, lat, start, end)
    disconnected = Event()

    async def watch_disconnect() -> None:
        while not disconnected.is_set():
            if await request.is_disconnected():
                disconnected.set()
                return
            await asyncio.sleep(0.05)

    watcher = asyncio.create_task(watch_disconnect())
    timings: dict[str, float] = {}
    timing_token = _pixel_timings.set(timings)
    started = clock.perf_counter()
    outcome = "error"
    try:
        result = await run_in_threadpool(
            extract_pixel_series, normalized, lon, lat, start_dt, end_dt,
            disconnected.is_set,
        )
        timings["total"] = (clock.perf_counter() - started) * 1000
        response.headers["Server-Timing"] = ", ".join(f"{name};dur={duration:.1f}" for name, duration in timings.items())
        outcome = "ready"
        return result
    except PixelBusy as exc:
        outcome = "busy"
        raise HTTPException(
            status_code=503, detail="Point extraction is busy. Please retry shortly.",
            headers={"Retry-After": "2"},
        ) from exc
    except PixelCancelled as exc:
        outcome = "cancelled"
        raise HTTPException(status_code=499, detail="Pixel request cancelled") from exc
    finally:
        timings["total"] = (clock.perf_counter() - started) * 1000
        if timings["total"] >= 5000 or outcome != "ready":
            # No coordinates, credentials, or full query strings in diagnostics.
            logger.info("Pixel extraction product=%s outcome=%s timings_ms=%s",
                        normalized, outcome, {key: round(value, 1) for key, value in timings.items()})
        _pixel_timings.reset(timing_token)
        disconnected.set()
        watcher.cancel()
        with suppress(asyncio.CancelledError):
            await watcher


@router.get("/csv")
async def get_pixel_csv(
    request: Request,
    response: Response,
    product: str = Query(...),
    lon: float = Query(...),
    lat: float = Query(...),
    start: str = Query(...),
    end: str = Query(...),
) -> StreamingResponse:
    data = await get_pixel_series(request=request, response=response, product=product, lon=lon, lat=lat, start=start, end=end)
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
        headers={
            "Content-Disposition": f'attachment; filename="pixel-{data["product"].lower()}.csv"',
            "Server-Timing": response.headers.get("Server-Timing", ""),
        },
    )
