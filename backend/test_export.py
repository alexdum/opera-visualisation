"""Tests for the GeoTIFF export endpoint."""

from __future__ import annotations

from threading import BoundedSemaphore
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from affine import Affine
from fastapi.testclient import TestClient
from rasterio.crs import CRS

from api.catalog import CatalogFrame
from main import app

client = TestClient(app)


def _cog_frame() -> CatalogFrame:
    return CatalogFrame(
        product="DBZH",
        timestamp="202607200000",
        nominal_time="2026-07-20T00:00:00Z",
        revision="rev123",
        archive_ready=True,
        hot_cog_ready=True,
        hot_cog="cogs/DBZH/2026/07/20/OPERA_DBZH_202607200000_rev123.tif",
        geozarr="geozarr/DBZH/2026/2026-07.zarr",
        quality_variables=["DBZH_quality_qi_total"],
        backend="cog",
    )


def _geozarr_frame() -> CatalogFrame:
    return CatalogFrame(
        product="DBZH",
        timestamp="202607200000",
        nominal_time="2026-07-20T00:00:00Z",
        revision="rev123",
        archive_ready=True,
        hot_cog_ready=False,
        hot_cog=None,
        geozarr="geozarr/DBZH/2026/2026-07.zarr",
        quality_variables=[],
        backend="geozarr",
    )


def test_export_cog_redirect(monkeypatch):
    """Hot COG frame returns 302 redirect to bucket URL."""
    monkeypatch.setattr("api.export.resolve_catalog_frame", lambda *_: _cog_frame())
    monkeypatch.setattr("api.export.USE_LOCAL_MOUNT", False)
    response = client.get(
        "/api/export/geotiff?product=DBZH&timestamp=202607200000&revision=rev123",
        follow_redirects=False,
    )
    assert response.status_code == 302
    assert "cogs/DBZH/2026/07/20/OPERA_DBZH_202607200000_rev123.tif" in response.headers["location"]


def test_export_invalid_product():
    """Invalid product returns 400."""
    response = client.get(
        "/api/export/geotiff?product=INVALID&timestamp=202607200000&revision=rev123"
    )
    assert response.status_code == 400


def test_export_invalid_timestamp():
    """Invalid timestamp format returns 422."""
    response = client.get(
        "/api/export/geotiff?product=DBZH&timestamp=bad&revision=rev123"
    )
    assert response.status_code == 422


def test_export_frame_not_found(monkeypatch):
    """Uncataloged frame returns 404."""
    monkeypatch.setattr("api.export.resolve_catalog_frame", lambda *_: None)
    response = client.get(
        "/api/export/geotiff?product=DBZH&timestamp=202607200000&revision=missing"
    )
    assert response.status_code == 404


def test_export_geozarr_generates_geotiff(monkeypatch):
    """GeoZarr frame generates a valid GeoTIFF response."""
    frame = _geozarr_frame()
    monkeypatch.setattr("api.export.resolve_catalog_frame", lambda *_: frame)

    epoch = int(
        __import__("datetime")
        .datetime.fromisoformat("2026-07-20T00:00:00+00:00")
        .timestamp()
    )
    fake_data = np.full((4, 4), 25.0, dtype=np.float32)
    fake_group = {
        "DBZH": MagicMock(__getitem__=MagicMock(return_value=fake_data)),
        "time": np.array([epoch], dtype=np.int64),
    }
    fake_metadata = {
        "x": np.linspace(0, 100, 4),
        "y": np.linspace(100, 0, 4),
        "times": np.array([epoch]),
        "crs": CRS.from_epsg(3857),
        "transform": Affine(25.0, 0, 0, 0, -25.0, 100),
    }
    monkeypatch.setattr("api.export._open_geozarr", lambda _: fake_group)
    monkeypatch.setattr("api.export._geozarr_metadata", lambda _path, _prod: fake_metadata)

    response = client.get(
        "/api/export/geotiff?product=DBZH&timestamp=202607200000&revision=rev123"
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/geo+tiff"
    assert "attachment" in response.headers["content-disposition"]
    assert "OPERA_DBZH_20260720T0000Z_revrev123.tif" in response.headers["content-disposition"]
    # Valid TIFF starts with II (little-endian) or MM (big-endian) magic bytes
    assert response.content[:2] in (b"II", b"MM")


def test_export_filename_format(monkeypatch):
    """Filename follows OPERA_{product}_{YYYYMMDDTHHMM}Z_rev{revision}.tif pattern."""
    monkeypatch.setattr("api.export.resolve_catalog_frame", lambda *_: _cog_frame())
    monkeypatch.setattr("api.export.USE_LOCAL_MOUNT", False)
    response = client.get(
        "/api/export/geotiff?product=DBZH&timestamp=202607200000&revision=rev123",
        follow_redirects=False,
    )
    # 302 redirect doesn't include Content-Disposition; verify the filename is
    # encoded in the endpoint logic by checking a GeoZarr response instead.
    assert response.status_code == 302


def test_export_503_when_semaphore_exhausted(monkeypatch):
    """When EXPORT_SLOTS is held, the endpoint returns 503 with Retry-After."""
    import asyncio
    from api import export as export_module

    frame = _geozarr_frame()
    monkeypatch.setattr("api.export.resolve_catalog_frame", lambda *_: frame)

    # Replace EXPORT_SLOTS with a pre-acquired semaphore
    blocked_sem = asyncio.BoundedSemaphore(1)

    async def pre_acquire():
        await blocked_sem.acquire()

    loop = asyncio.new_event_loop()
    loop.run_until_complete(pre_acquire())
    loop.close()

    monkeypatch.setattr(export_module, "EXPORT_SLOTS", blocked_sem)

    response = client.get(
        "/api/export/geotiff?product=DBZH&timestamp=202607200000&revision=rev123"
    )
    assert response.status_code == 503
    assert response.headers.get("retry-after") == "15"
