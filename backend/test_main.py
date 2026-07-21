from fastapi.testclient import TestClient
import numpy as np
import pytest
from affine import Affine
from rasterio.crs import CRS
from rio_tiler.errors import TileOutsideBounds
from rio_tiler.models import ImageData

from api.catalog import CatalogFrame, apply_hot_window, parse_daily_catalog
from api.pixel import _extract_store_frames, _store_metadata, _validate_request
from api.tiles import _render_cog_image, _render_geozarr_image, apply_quality_filter, parse_min_quality
from main import app


client = TestClient(app)


def frame(product: str = "DBZH", minute: str = "00") -> dict:
    return {
        "nominal_time": f"2026-07-20T00:{minute}:00Z",
        "start_time": f"2026-07-19T23:{minute}:00Z" if product == "ACRR" else f"2026-07-20T00:{minute}:00Z",
        "end_time": f"2026-07-20T00:{minute}:00Z",
        "revision": f"{product.lower()}-{minute}",
        "archive_ready": True,
        "hot_cog_ready": True,
        "hot_cog": f"hot-cog/{product}/2026/07/20/00{minute}.tif",
        "quality_variables": [f"{product}_quality_qi_total"],
    }


def daily_catalog() -> dict:
    return {
        "schema_version": 1,
        "date": "2026-07-20",
        "products": {
            product: {
                "geozarr": f"geozarr/{product}/2026/2026-07.zarr",
                "frames": [frame(product)],
            }
            for product in ("DBZH", "RATE", "ACRR")
        },
    }


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert "storage" in response.json()


@pytest.mark.parametrize("product", ["DBZH", "RATE", "ACRR"])
def test_daily_catalog_is_product_specific(product):
    frames = parse_daily_catalog(daily_catalog(), product)
    assert [entry.product for entry in frames] == [product]
    assert frames[0].geozarr.startswith(f"geozarr/{product}/")
    assert frames[0].revision == f"{product.lower()}-00"


def test_uncommitted_frame_is_not_visible():
    document = daily_catalog()
    document["products"]["DBZH"]["frames"].append(
        {**frame("DBZH", "05"), "archive_ready": False}
    )
    assert [entry.timestamp for entry in parse_daily_catalog(document, "DBZH")] == ["202607200000"]


def test_hot_window_routes_expired_cog_to_geozarr():
    parsed = parse_daily_catalog(daily_catalog(), "DBZH")
    adjusted = apply_hot_window(parsed, "2026-07-20T00:01:00Z")
    assert adjusted[0].backend == "geozarr"
    assert adjusted[0].hot_cog_ready is False
    assert adjusted[0].hot_cog is None


def test_catalog_day_uses_requested_product(monkeypatch):
    monkeypatch.setattr("api.catalog.fetch_catalog_json", lambda _path: daily_catalog())
    response = client.get("/api/catalog/day?date=2026-07-20&product=RATE")
    assert response.status_code == 200
    payload = response.json()
    assert payload["product"] == "RATE"
    assert payload["frames"][0]["revision"] == "rate-00"
    assert payload["frames"][0]["backend"] == "geozarr"
    assert payload["frames"][0]["hot_cog_ready"] is False
    assert payload["frames"][0]["hot_cog"] is None


def test_internal_day_resolution_preserves_available_hot_cog(monkeypatch):
    monkeypatch.setattr("api.catalog.fetch_catalog_json", lambda _path: daily_catalog())
    catalog = __import__("api.catalog", fromlist=["load_day"]).load_day(
        "DBZH", "2026-07-20"
    )
    assert catalog.frames[0].backend == "cog"
    assert catalog.frames[0].hot_cog_ready is True


def test_catalog_day_rejects_invalid_date():
    response = client.get("/api/catalog/day?date=invalid&product=DBZH")
    assert response.status_code == 400
    assert response.json()["detail"] == "Date must use YYYY-MM-DD"


@pytest.mark.parametrize("value", ["-0.1", "1.1", "invalid", "nan", "inf"])
def test_invalid_quality_threshold_is_rejected(value):
    with pytest.raises(Exception) as error:
        parse_min_quality("DBZH", value)
    assert error.value.status_code == 422


def test_raw_quality_view_is_supported():
    assert parse_min_quality("DBZH", "off") is None


def test_quality_filter_masks_only_known_values_below_threshold():
    array = np.ma.MaskedArray(
        np.array(
            [
                [[10.0, 20.0, 30.0, 40.0, 50.0]],
                [[0.0, 0.8, -9999000.0, np.nan, 1.2]],
            ],
            dtype=np.float32,
        ),
        mask=np.array(
            [
                [[False, False, False, False, False]],
                [[False, False, True, False, False]],
            ]
        ),
    )
    filtered = apply_quality_filter(ImageData(array, band_names=["DBZH", "quality"]), 0.1)
    assert filtered.count == 1
    assert filtered.array.mask.tolist() == [[[True, False, False, False, False]]]


def test_tile_route_validates_catalog_and_reports_backend(monkeypatch):
    published = CatalogFrame(
        product="DBZH",
        timestamp="202607200000",
        nominal_time="2026-07-20T00:00:00Z",
        revision="revision-1",
        archive_ready=True,
        hot_cog_ready=True,
        hot_cog="hot-cog/DBZH/2026/07/20/0000.tif",
        geozarr="geozarr/DBZH/2026/2026-07.zarr",
        quality_variables=["DBZH_quality_qi_total"],
        backend="cog",
    )
    monkeypatch.setattr("api.tiles.resolve_catalog_frame", lambda *_args: published)
    monkeypatch.setattr("api.tiles._render_tile_cached", lambda *_args: (b"webp", "cog"))
    response = client.get(
        "/tiles/DBZH/202607200000/revision-1/0/0/0.webp?min_quality=0.10"
    )
    assert response.status_code == 200
    assert response.content == b"webp"
    assert response.headers["x-opera-backend"] == "cog"


def test_tile_route_honors_explicit_geozarr_source(monkeypatch):
    published = CatalogFrame(
        product="DBZH",
        timestamp="202607200000",
        nominal_time="2026-07-20T00:00:00Z",
        revision="revision-1",
        archive_ready=True,
        hot_cog_ready=True,
        hot_cog="hot-cog/DBZH/frame.tif",
        geozarr="geozarr/DBZH/2026/2026-07.zarr",
        quality_variables=["DBZH_quality_qi_total"],
        backend="cog",
    )
    captured = {}
    monkeypatch.setattr("api.tiles.resolve_catalog_frame", lambda *_args: published)

    def render(*args):
        captured["hot_cog"] = args[7]
        captured["hot_cog_ready"] = args[9]
        return b"webp", "geozarr"

    monkeypatch.setattr("api.tiles._render_tile_cached", render)
    response = client.get(
        "/tiles/DBZH/202607200000/revision-1/0/0/0.webp?min_quality=off&source=geozarr"
    )
    assert response.status_code == 200
    assert response.headers["x-opera-backend"] == "geozarr"
    assert captured == {"hot_cog": None, "hot_cog_ready": False}


def test_cog_tile_outside_opera_footprint_is_transparent(monkeypatch):
    class FakeDataset:
        count = 2

    class FakeReader:
        dataset = FakeDataset()

        def __init__(self, _path):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def tile(self, *_args, **_kwargs):
            raise TileOutsideBounds("outside OPERA footprint")

    published = CatalogFrame(
        product="DBZH",
        timestamp="202607210700",
        nominal_time="2026-07-21T07:00:00Z",
        revision="revision",
        archive_ready=True,
        hot_cog_ready=True,
        hot_cog="hot-cog/DBZH/frame.tif",
        geozarr="geozarr/DBZH/2026/2026-07.zarr",
        quality_variables=["DBZH_quality_qi_total"],
        backend="cog",
    )
    monkeypatch.setattr("api.tiles.local_cog", lambda *_args: "/tmp/cached.tif")
    monkeypatch.setattr("api.tiles.Reader", FakeReader)

    image = _render_cog_image(published, 4, 8, 7, 0.10)

    assert image.count == 1
    assert np.ma.count(image.array) == 0


def test_tile_rejects_bad_timestamp_before_storage():
    response = client.get("/tiles/DBZH/123/revision/0/0/0.webp?min_quality=0.10")
    assert response.status_code == 400


def test_pixel_validation_does_not_touch_storage():
    response = client.get(
        "/api/pixel?product=DBZH&lon=181&lat=45&start=2026-07-20&end=2026-07-20"
    )
    assert response.status_code == 400


def test_pixel_validation_accepts_exact_24_hour_timestamp_window():
    _, start, end = _validate_request(
        "DBZH", 26.1, 44.43, "2026-07-20T12:00:00Z", "2026-07-21T12:00:00Z"
    )
    assert end - start == __import__("datetime").timedelta(hours=24)


def test_pixel_validation_rejects_more_than_24_hours():
    with pytest.raises(Exception) as error:
        _validate_request(
            "DBZH", 26.1, 44.43, "2026-07-20T11:59:59Z", "2026-07-21T12:00:00Z"
        )
    assert getattr(error.value, "status_code", None) == 400
    assert "24 hours" in str(getattr(error.value, "detail", ""))


def test_pixel_static_metadata_does_not_cache_growing_time_coordinate(monkeypatch):
    class TimeMustRemainLive:
        def __getitem__(self, _item):
            raise AssertionError("the growing time coordinate must not be read by the static metadata cache")

    group = {
        "crs": type("CRSVariable", (), {"attrs": {"proj4_params": "EPSG:4326"}})(),
        "x": np.array([0.0, 1.0]),
        "y": np.array([0.0, 1.0]),
        "time": TimeMustRemainLive(),
    }
    monkeypatch.setattr("api.pixel._open_group", lambda _path: group)
    _store_metadata.cache_clear()
    try:
        metadata = _store_metadata("growing-store")
    finally:
        _store_metadata.cache_clear()
    assert "time" not in metadata


def test_pixel_extract_preserves_status_quality_and_interval(monkeypatch):
    epoch = 1_774_204_800  # 2026-03-20T00:00:00Z; exact date is immaterial here.
    arrays = {
        "DBZH": np.array([[[12.5, -8_888_000.0, np.nan]]], dtype=np.float32),
        "DBZH_status": np.array([[[0, 1, 2]]], dtype=np.uint8),
        "DBZH_quality_qi_total": np.array([[[0.8, 0.2, np.nan]]], dtype=np.float32),
        "time": np.array([epoch], dtype=np.int64),
        "time_bnds": np.array([[epoch - 300, epoch]], dtype=np.int64),
    }
    metadata = {
        "x": np.array([0.0, 1.0, 2.0]),
        "y": np.array([0.0]),
        "to_native": type("Forward", (), {"transform": lambda self, lon, lat: (lon, lat)})(),
        "to_wgs84": type("Reverse", (), {"transform": lambda self, x, y: (x, y)})(),
    }
    monkeypatch.setattr("api.pixel._open_group", lambda _path: arrays)
    monkeypatch.setattr("api.pixel._store_metadata", lambda _path: metadata)
    published = CatalogFrame(
        product="DBZH",
        timestamp="202603200000",
        nominal_time="2026-03-20T00:00:00Z",
        start_time="2026-03-19T23:55:00Z",
        end_time="2026-03-20T00:00:00Z",
        revision="revision",
        archive_ready=True,
        hot_cog_ready=False,
        geozarr="store",
        quality_variables=["DBZH_quality_qi_total"],
        backend="geozarr",
    )
    # Align the synthetic epoch to the catalog time lookup.
    arrays["time"][0] = int(
        __import__("datetime").datetime.fromisoformat("2026-03-20T00:00:00+00:00").timestamp()
    )
    rows, location = _extract_store_frames("DBZH", "store", [published], 0.0, 0.0)
    assert location["x_index"] == 0
    assert rows[0]["value"] == 12.5
    assert rows[0]["status"] == "detected"
    assert rows[0]["quality"]["DBZH_quality_qi_total"] == pytest.approx(0.8)
    assert rows[0]["start_time"] == "2026-03-19T23:55:00Z"


def test_geozarr_fallback_renders_cataloged_frame(monkeypatch):
    class FakeArray:
        def __init__(self, values, attrs=None):
            self.values = np.asarray(values)
            self.attrs = attrs or {}

        def __getitem__(self, item):
            return self.values[item]

    limit = 20_037_508.342789244
    epoch = int(__import__("datetime").datetime.fromisoformat("2026-03-20T00:00:00+00:00").timestamp())
    group = {
        "DBZH": FakeArray(
            np.full((1, 4, 4), 20.0, dtype=np.float32),
            {"undetect_value": -8_888_000.0},
        ),
        "DBZH_quality_qi_total": FakeArray(np.full((1, 4, 4), 0.8, dtype=np.float32)),
    }
    metadata = {
        "x": np.linspace(-limit * 0.75, limit * 0.75, 4),
        "y": np.linspace(limit * 0.75, -limit * 0.75, 4),
        "times": np.array([epoch]),
        "crs": CRS.from_epsg(3857),
        "transform": Affine.translation(-limit, limit) * Affine.scale(limit / 2, -limit / 2),
    }
    monkeypatch.setattr("api.tiles._open_geozarr", lambda _path: group)
    monkeypatch.setattr("api.tiles._geozarr_metadata", lambda _path, _product: metadata)
    published = CatalogFrame(
        product="DBZH",
        timestamp="202603200000",
        nominal_time="2026-03-20T00:00:00Z",
        revision="revision",
        archive_ready=True,
        hot_cog_ready=False,
        geozarr="store",
        quality_variables=["DBZH_quality_qi_total"],
        backend="geozarr",
    )
    image = _render_geozarr_image(published, 0, 0, 0, 0.1)
    assert image.count == 1
    assert image.width == 256
    assert image.height == 256
    assert np.ma.count(image.array) > 0
