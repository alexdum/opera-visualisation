"""Catalog-gated frame discovery for visualization consumers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import lru_cache
import re
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query
import httpx
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from api.bucket import HF_BUCKET_URL, auth_headers, object_url


router = APIRouter()
VALID_PRODUCTS = ("DBZH", "RATE", "ACRR")
SUPPORTED_SCHEMA_VERSION = 1
CATALOG_CACHE_SECONDS = 30
TIMESTAMP_RE = re.compile(r"^\d{12}$")


class CatalogFrame(BaseModel):
    product: str
    timestamp: str = Field(description="UTC timestamp formatted as YYYYMMDDHHMM")
    nominal_time: str
    start_time: str | None = None
    end_time: str | None = None
    revision: str
    archive_ready: bool
    hot_cog_ready: bool
    hot_cog: str | None = None
    geozarr: str
    quality_variables: list[str] = Field(default_factory=list)
    backend: str


class Catalog(BaseModel):
    schema_version: int
    product: str
    date: str | None = None
    latest_timestamp: str = ""
    timestamps: list[str] = Field(default_factory=list)
    frames: list[CatalogFrame] = Field(default_factory=list)
    archive_ready: bool = False
    hot_cog_ready: bool = False
    hot_window_start: str | None = None


def normalize_product(product: str) -> str:
    value = product.upper()
    if value not in VALID_PRODUCTS:
        raise HTTPException(status_code=400, detail=f"Unsupported product: {product}")
    return value


def _validate_schema(document: dict[str, Any]) -> None:
    version = document.get("schema_version", SUPPORTED_SCHEMA_VERSION)
    if version != SUPPORTED_SCHEMA_VERSION:
        raise HTTPException(
            status_code=503,
            detail=f"Unsupported catalog schema version: {version}",
        )


def _cache_bucket() -> int:
    return int(time.time() // CATALOG_CACHE_SECONDS)


@lru_cache(maxsize=128)
def _fetch_json_cached(path: str, _bucket: int) -> dict[str, Any]:
    try:
        response = httpx.get(
            object_url(path),
            headers=auth_headers(),
            follow_redirects=True,
            timeout=20.0,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail=f"Catalog unavailable: {path}") from exc
        if exc.response.status_code == 429:
            raise HTTPException(
                status_code=503,
                detail="Hugging Face rate limit reached; configure the server-side HF_TOKEN",
                headers={"Retry-After": exc.response.headers.get("Retry-After", "60")},
            ) from exc
        raise HTTPException(status_code=503, detail=f"Catalog unavailable: {path}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"Catalog request failed: {path}") from exc
    try:
        document = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=f"Catalog is not valid JSON: {path}") from exc
    if not isinstance(document, dict):
        raise HTTPException(status_code=503, detail=f"Catalog has invalid shape: {path}")
    _validate_schema(document)
    return document


def fetch_catalog_json(path: str) -> dict[str, Any]:
    return _fetch_json_cached(path, _cache_bucket())


def iso_to_compact(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=f"Invalid catalog timestamp: {value}") from exc
    return parsed.astimezone(timezone.utc).strftime("%Y%m%d%H%M")


def compact_to_datetime(value: str) -> datetime:
    if not TIMESTAMP_RE.fullmatch(value):
        raise HTTPException(status_code=400, detail="Timestamp must use YYYYMMDDHHMM")
    try:
        return datetime.strptime(value, "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Timestamp is not a valid UTC date") from exc


def parse_daily_catalog(raw_data: dict[str, Any], product: str = "DBZH") -> list[CatalogFrame]:
    """Return only consumer-visible frames for one product."""

    _validate_schema(raw_data)
    product = normalize_product(product)
    products = raw_data.get("products")
    if not isinstance(products, dict):
        raise HTTPException(status_code=503, detail="Daily catalog has no products object")
    product_data = products.get(product, {})
    if not isinstance(product_data, dict):
        raise HTTPException(status_code=503, detail=f"Invalid {product} catalog section")

    geozarr = product_data.get("geozarr")
    frames = product_data.get("frames", [])
    if not isinstance(frames, list):
        raise HTTPException(status_code=503, detail=f"Invalid {product} frame list")

    parsed: list[CatalogFrame] = []
    for frame in frames:
        if not isinstance(frame, dict) or frame.get("archive_ready") is not True:
            continue
        nominal_time = frame.get("nominal_time")
        revision = frame.get("revision")
        frame_geozarr = frame.get("geozarr") or geozarr
        if not isinstance(nominal_time, str) or not isinstance(revision, str) or not frame_geozarr:
            continue
        hot_ready = frame.get("hot_cog_ready") is True and isinstance(frame.get("hot_cog"), str)
        parsed.append(
            CatalogFrame(
                product=product,
                timestamp=iso_to_compact(nominal_time),
                nominal_time=nominal_time,
                start_time=frame.get("start_time"),
                end_time=frame.get("end_time"),
                revision=revision,
                archive_ready=True,
                hot_cog_ready=hot_ready,
                hot_cog=frame.get("hot_cog") if hot_ready else None,
                geozarr=str(frame_geozarr),
                quality_variables=[str(value) for value in frame.get("quality_variables", [])],
                backend="cog" if hot_ready else "geozarr",
            )
        )
    parsed.sort(key=lambda frame: (frame.nominal_time, frame.revision))
    return parsed


def catalog_response(
    *,
    product: str,
    frames: list[CatalogFrame],
    date: str | None,
    hot_window_start: str | None = None,
) -> Catalog:
    timestamps = [f"{frame.timestamp}_{frame.revision}" for frame in frames]
    return Catalog(
        schema_version=SUPPORTED_SCHEMA_VERSION,
        product=product,
        date=date,
        latest_timestamp=timestamps[-1] if timestamps else "",
        timestamps=timestamps,
        frames=frames,
        archive_ready=bool(frames),
        hot_cog_ready=bool(frames and frames[-1].hot_cog_ready),
        hot_window_start=hot_window_start,
    )


def apply_hot_window(frames: list[CatalogFrame], hot_window_start: str | None) -> list[CatalogFrame]:
    if not hot_window_start:
        return frames
    try:
        floor = datetime.fromisoformat(hot_window_start.replace("Z", "+00:00"))
    except ValueError:
        return frames
    adjusted: list[CatalogFrame] = []
    for frame in frames:
        nominal = datetime.fromisoformat(frame.nominal_time.replace("Z", "+00:00"))
        if nominal < floor:
            adjusted.append(
                frame.model_copy(
                    update={"hot_cog_ready": False, "hot_cog": None, "backend": "geozarr"}
                )
            )
        else:
            adjusted.append(frame)
    return adjusted


def force_geozarr_backend(frames: list[CatalogFrame]) -> list[CatalogFrame]:
    """Route an explicitly historical view through the permanent archive."""

    return [
        frame.model_copy(
            update={"hot_cog_ready": False, "hot_cog": None, "backend": "geozarr"}
        )
        for frame in frames
    ]


def load_day(product: str, date: str, archive_only: bool = False) -> Catalog:
    product = normalize_product(product)
    try:
        parsed_date = datetime.strptime(date, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Date must use YYYY-MM-DD") from exc
    path = f"catalog/{parsed_date:%Y/%m}/{date}.json"
    frames = parse_daily_catalog(fetch_catalog_json(path), product)
    hot_window_start = None
    try:
        hot_window_start = fetch_catalog_json("catalog/latest.json").get("hot_window_start")
    except HTTPException:
        # Historical archive access remains useful if the latest pointer is
        # temporarily unavailable; the renderer will attempt COG then GeoZarr.
        pass
    frames = apply_hot_window(frames, hot_window_start)
    if archive_only:
        frames = force_geozarr_backend(frames)
    return catalog_response(
        product=product,
        frames=frames,
        date=date,
        hot_window_start=hot_window_start,
    )


def load_latest(product: str, hours: int) -> Catalog:
    product = normalize_product(product)
    latest = fetch_catalog_json("catalog/latest.json")
    paths = latest.get("daily_catalogs", [])
    if not isinstance(paths, list):
        raise HTTPException(status_code=503, detail="Latest catalog has invalid daily_catalogs")

    latest_product = latest.get("products", {}).get(product, {})
    latest_time_value = latest_product.get("nominal_time") if isinstance(latest_product, dict) else None
    if not isinstance(latest_time_value, str):
        return catalog_response(product=product, frames=[], date=None)
    latest_time = datetime.fromisoformat(latest_time_value.replace("Z", "+00:00"))
    floor = latest_time - timedelta(hours=hours)

    frames: list[CatalogFrame] = []
    # The latest document normally contains only a few paths. Parsing all listed
    # days makes the rolling window correct across midnight without object listing.
    for path in paths:
        if isinstance(path, str):
            frames.extend(parse_daily_catalog(fetch_catalog_json(path), product))
    frames = [
        frame
        for frame in frames
        if floor <= datetime.fromisoformat(frame.nominal_time.replace("Z", "+00:00")) <= latest_time
    ]
    frames = apply_hot_window(frames, latest.get("hot_window_start"))
    frames.sort(key=lambda frame: frame.nominal_time)
    return catalog_response(
        product=product,
        frames=frames,
        date=None,
        hot_window_start=latest.get("hot_window_start"),
    )


def resolve_catalog_frame(product: str, timestamp: str, revision: str) -> CatalogFrame:
    product = normalize_product(product)
    parsed = compact_to_datetime(timestamp)
    catalog = load_day(product, parsed.strftime("%Y-%m-%d"))
    for frame in catalog.frames:
        if frame.timestamp == timestamp and frame.revision == revision:
            return frame
    raise HTTPException(status_code=404, detail="Frame is not published in the authoritative catalog")


def cataloged_frames_between(product: str, start: datetime, end: datetime) -> list[CatalogFrame]:
    frames: list[CatalogFrame] = []
    cursor = start.date()
    while cursor <= end.date():
        date_text = cursor.isoformat()
        try:
            frames.extend(load_day(product, date_text).frames)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
        cursor += timedelta(days=1)
    return [
        frame
        for frame in frames
        if start <= datetime.fromisoformat(frame.nominal_time.replace("Z", "+00:00")) <= end
    ]


@router.get("/latest", response_model=Catalog)
async def catalog_latest(
    product: str = Query("DBZH"),
    hours: int = Query(24, ge=1, le=48),
) -> Catalog:
    return await run_in_threadpool(load_latest, product, hours)


@router.get("/day", response_model=Catalog)
async def catalog_day(date: str, product: str = Query("DBZH")) -> Catalog:
    return await run_in_threadpool(load_day, product, date, True)
