from fastapi import HTTPException
from fastapi.testclient import TestClient
import numpy as np
import pytest
from affine import Affine
from rasterio.crs import CRS
from rio_tiler.errors import TileOutsideBounds
from rio_tiler.models import ImageData

from api.catalog import CatalogFrame, apply_hot_window, parse_daily_catalog
from api.pixel import (
    _clear_pixel_response_cache,
    _extract_store_frames,
    _open_group,
    _read_time_coords,
    _read_time_window,
    _read_time_window_cached,
    _store_metadata,
    _validate_request,
)
from api.tiles import (
    COLORMAPS,
    _apply_geozarr_status,
    _frame_time_index,
    _render_cog_image,
    _render_geozarr_image,
    apply_quality_filter,
    parse_min_quality,
)
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
def test_geozarr_status_shades_undetect_and_masks_nodata(product):
    data = np.array([[20.0, np.nan, 30.0]], dtype=np.float32)
    status = np.array([[0, 1, 2]], dtype=np.uint8)

    rendered = _apply_geozarr_status(data, status)

    assert rendered[0, 0] == pytest.approx(20.0)
    assert rendered[0, 1] == pytest.approx(-10.0)
    assert np.isnan(rendered[0, 2])
    assert any(lower <= -10.0 < upper for (lower, upper), _color in COLORMAPS[product])


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


def test_pixel_time_coordinate_refreshes_after_metadata_ttl(monkeypatch):
    bucket = {"value": 10}
    group = {"time": np.array([100], dtype=np.int64)}
    monkeypatch.setattr("api.pixel._metadata_cache_bucket", lambda: bucket["value"])
    monkeypatch.setattr("api.pixel._open_group", lambda _path: group)
    _read_time_coords.cache_clear()
    try:
        assert _read_time_coords("growing-store").tolist() == [100]
        group["time"] = np.array([100, 200], dtype=np.int64)
        assert _read_time_coords("growing-store").tolist() == [100]
        bucket["value"] += 1
        assert _read_time_coords("growing-store").tolist() == [100, 200]
    finally:
        _read_time_coords.cache_clear()


def test_pixel_reads_only_the_requested_time_coordinate_window(monkeypatch):
    class TrackingTimeArray:
        def __init__(self):
            self.values = np.arange(0, 1_000, 10, dtype=np.int64)
            self.shape = self.values.shape
            self.reads: list[object] = []

        def __getitem__(self, item):
            self.reads.append(item)
            return self.values[item]

    time_array = TrackingTimeArray()
    monkeypatch.setattr("api.pixel._open_group", lambda _path: {"time": time_array})
    monkeypatch.setattr("api.pixel._metadata_cache_bucket", lambda: 5)
    _read_time_window_cached.cache_clear()
    try:
        first_index, values = _read_time_window("windowed-store", 400, 500)
    finally:
        _read_time_window_cached.cache_clear()

    assert first_index == 40
    assert values.tolist() == list(range(400, 501, 10))
    slices = [read for read in time_array.reads if isinstance(read, slice)]
    assert slices == [slice(40, 51)]
    assert len(time_array.reads) < 20


def test_pixel_caches_results_for_the_same_snapped_cell(monkeypatch):
    class TrackingArray:
        def __init__(self, values):
            self.values = np.asarray(values)
            self.read_count = 0

        def __getitem__(self, item):
            self.read_count += 1
            return self.values[item]

    base_epoch = 1_773_964_800
    measurement = TrackingArray(
        np.array(
            [[[10.0, 11.0]], [[999.0, 999.0]], [[30.0, 31.0]]],
            dtype=np.float32,
        )
    )
    status = TrackingArray(np.zeros((3, 1, 2), dtype=np.uint8))
    group = {
        "DBZH": measurement,
        "DBZH_status": status,
        "time": np.array(
            [base_epoch, base_epoch + 300, base_epoch + 600], dtype=np.int64
        ),
    }
    metadata = {
        "x": np.array([0.0, 1.0]),
        "y": np.array([0.0]),
        "to_native": type(
            "Forward", (), {"transform": lambda self, lon, lat: (lon, lat)}
        )(),
        "to_wgs84": type(
            "Reverse", (), {"transform": lambda self, x, y: (x, y)}
        )(),
    }
    frames = [
        CatalogFrame(
            product="DBZH",
            timestamp="202603200000",
            nominal_time="2026-03-20T00:00:00Z",
            revision="r0",
            archive_ready=True,
            hot_cog_ready=False,
            geozarr="indexed-store",
            quality_variables=[],
            backend="geozarr",
        ),
        CatalogFrame(
            product="DBZH",
            timestamp="202603200010",
            nominal_time="2026-03-20T00:10:00Z",
            revision="r2",
            archive_ready=True,
            hot_cog_ready=False,
            geozarr="indexed-store",
            quality_variables=[],
            backend="geozarr",
        ),
    ]
    monkeypatch.setattr("api.pixel._open_group", lambda _path: group)
    monkeypatch.setattr("api.pixel._store_metadata", lambda _path: metadata)
    _read_time_coords.cache_clear()
    _clear_pixel_response_cache()
    try:
        first, _ = _extract_store_frames("DBZH", "indexed-store", frames, 0.0, 0.0)
        second, _ = _extract_store_frames("DBZH", "indexed-store", frames, 0.1, 0.0)
    finally:
        _read_time_coords.cache_clear()
        _clear_pixel_response_cache()

    assert [row["value"] for row in first] == [10.0, 30.0]
    assert second == first
    assert measurement.read_count == 1
    assert status.read_count == 1


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


def test_frame_time_index_calculation():
    # 2026-07-20T00:00:00Z -> 1784505600
    # 2026-07-20T00:15:00Z -> 1784506500
    # 2026-07-20T00:30:00Z -> 1784507400
    times = np.array([1784505600, 1784506500, 1784507400], dtype=np.int64)

    # 1. Exact match returns correct index
    catalog_frame = CatalogFrame(
        product="DBZH",
        timestamp="202607200015",
        nominal_time="2026-07-20T00:15:00Z",
        revision="r1",
        archive_ready=True,
        hot_cog_ready=False,
        geozarr="store.zarr",
        quality_variables=[],
        backend="geozarr",
    )
    idx = _frame_time_index(times, catalog_frame)
    assert idx == 1

    # 2. Missing timestamp raises 503 HTTPException
    missing_frame = CatalogFrame(
        product="DBZH",
        timestamp="202607200045",
        nominal_time="2026-07-20T00:45:00Z",
        revision="r1",
        archive_ready=True,
        hot_cog_ready=False,
        geozarr="store.zarr",
        quality_variables=[],
        backend="geozarr",
    )
    with pytest.raises(HTTPException) as exc_info:
        _frame_time_index(times, missing_frame)
    assert exc_info.value.status_code == 503
    assert "not uniquely present" in exc_info.value.detail

    # 3. Duplicate timestamp raises 503 HTTPException
    dup_times = np.array([1784506500, 1784506500], dtype=np.int64)
    with pytest.raises(HTTPException) as exc_info:
        _frame_time_index(dup_times, catalog_frame)
    assert exc_info.value.status_code == 503
    assert "not uniquely present" in exc_info.value.detail


def test_open_group_consolidated_metadata_fallback(tmp_path, monkeypatch):
    import zarr

    # Create a zarr store with consolidated metadata
    consolidated_dir = tmp_path / "consolidated.zarr"
    store_cons = zarr.storage.LocalStore(str(consolidated_dir))
    group_cons = zarr.create_group(store=store_cons)
    group_cons.create_array("x", data=np.array([1.0, 2.0]))
    group_cons.create_array("y", data=np.array([3.0, 4.0]))
    zarr.consolidate_metadata(store=store_cons)

    # Create a zarr store WITHOUT consolidated metadata
    unconsolidated_dir = tmp_path / "unconsolidated.zarr"
    store_uncons = zarr.storage.LocalStore(str(unconsolidated_dir))
    group_uncons = zarr.create_group(store=store_uncons)
    group_uncons.create_array("x", data=np.array([10.0, 20.0]))
    group_uncons.create_array("y", data=np.array([30.0, 40.0]))

    monkeypatch.setattr("api.pixel.USE_LOCAL_MOUNT", True)
    monkeypatch.setattr("api.pixel.resolve_path", lambda p: str(p))

    _open_group.cache_clear()

    # 1. Store with consolidated metadata opens cleanly
    g1 = _open_group(str(consolidated_dir))
    assert "x" in g1
    assert "y" in g1
    assert np.array_equal(g1["x"][:], [1.0, 2.0])

    _open_group.cache_clear()

    # 2. Store without consolidated metadata falls back to zarr.open_group and opens cleanly
    g2 = _open_group(str(unconsolidated_dir))
    assert "x" in g2
    assert "y" in g2
    assert np.array_equal(g2["x"][:], [10.0, 20.0])


def test_geozarr_frame_rendering_timestamp_alignment(monkeypatch):
    class FakeArray:
        def __init__(self, data, attrs=None):
            self.data = np.asarray(data)
            self.attrs = attrs or {}

        def __getitem__(self, item):
            return self.data[item]

    limit = 20_037_508.342789244
    time_0 = int(__import__("datetime").datetime.fromisoformat("2026-03-20T00:00:00+00:00").timestamp())
    time_1 = int(__import__("datetime").datetime.fromisoformat("2026-03-20T00:15:00+00:00").timestamp())

    data_3d = np.zeros((2, 4, 4), dtype=np.float32)
    data_3d[0, :, :] = 10.0
    data_3d[1, :, :] = 50.0

    group = {
        "DBZH": FakeArray(data_3d, {"undetect_value": -8_888_000.0}),
    }
    metadata = {
        "x": np.linspace(-limit * 0.75, limit * 0.75, 4),
        "y": np.linspace(limit * 0.75, -limit * 0.75, 4),
        "times": np.array([time_0, time_1]),
        "crs": CRS.from_epsg(3857),
        "transform": Affine.translation(-limit, limit) * Affine.scale(limit / 2, -limit / 2),
    }

    monkeypatch.setattr("api.tiles._open_geozarr", lambda _path: group)
    monkeypatch.setattr("api.tiles._geozarr_metadata", lambda _path, _product: metadata)

    frame_time_1 = CatalogFrame(
        product="DBZH",
        timestamp="202603200015",
        nominal_time="2026-03-20T00:15:00Z",
        revision="revision",
        archive_ready=True,
        hot_cog_ready=False,
        geozarr="store",
        quality_variables=[],
        backend="geozarr",
    )

    image = _render_geozarr_image(frame_time_1, 0, 0, 0, None)
    valid_pixels = image.array[~image.array.mask]
    assert len(valid_pixels) > 0
    assert np.allclose(valid_pixels, 50.0)


def test_frame_parity_cog_vs_geozarr(monkeypatch):
    class FakeDataset:
        count = 1

    class FakeReader:
        dataset = FakeDataset()

        def __init__(self, _path):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def tile(self, *_args, **_kwargs):
            arr = np.ma.masked_invalid(np.full((1, 256, 256), 25.0, dtype=np.float32))
            return ImageData(arr, crs=CRS.from_epsg(3857), band_names=["DBZH"])

    published = CatalogFrame(
        product="DBZH",
        timestamp="202603200000",
        nominal_time="2026-03-20T00:00:00Z",
        revision="revision",
        archive_ready=True,
        hot_cog_ready=True,
        hot_cog="hot-cog/DBZH/frame.tif",
        geozarr="geozarr/DBZH/2026/2026-03.zarr",
        quality_variables=[],
        backend="cog",
    )

    monkeypatch.setattr("api.tiles.local_cog", lambda *_args: "/tmp/cached.tif")
    monkeypatch.setattr("api.tiles.Reader", FakeReader)

    cog_image = _render_cog_image(published, 0, 0, 0, None)

    class FakeArray:
        def __init__(self, data, attrs=None):
            self.data = np.asarray(data)
            self.attrs = attrs or {}

        def __getitem__(self, item):
            return self.data[item]

    limit = 20_037_508.342789244
    epoch = int(__import__("datetime").datetime.fromisoformat("2026-03-20T00:00:00+00:00").timestamp())
    group = {
        "DBZH": FakeArray(np.full((1, 4, 4), 25.0, dtype=np.float32)),
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

    geozarr_image = _render_geozarr_image(published, 0, 0, 0, None)

    assert cog_image.count == geozarr_image.count
    assert cog_image.width == geozarr_image.width
    assert cog_image.height == geozarr_image.height
    assert cog_image.crs == geozarr_image.crs

    cog_valid = cog_image.array[~cog_image.array.mask]
    geozarr_valid = geozarr_image.array[~geozarr_image.array.mask]
    assert len(cog_valid) > 0
    assert len(geozarr_valid) > 0
    assert np.allclose(cog_valid[0], geozarr_valid[0])


def test_tiles_open_group_consolidated_metadata_fallback(tmp_path, monkeypatch):
    import zarr
    from api.tiles import _open_group as tiles_open_group

    unconsolidated_dir = tmp_path / "unconsolidated_tiles.zarr"
    store_uncons = zarr.storage.LocalStore(str(unconsolidated_dir))
    group_uncons = zarr.create_group(store=store_uncons)
    group_uncons.create_array("x", data=np.array([10.0, 20.0]))

    monkeypatch.setattr("api.tiles.USE_LOCAL_MOUNT", True)
    monkeypatch.setattr("api.tiles.resolve_path", lambda p: str(p))

    tiles_open_group.cache_clear()

    g = tiles_open_group(str(unconsolidated_dir))
    assert "x" in g
    assert np.array_equal(g["x"][:], [10.0, 20.0])


def test_time_coords_caching():
    from api.pixel import _read_time_coords as pixel_read_time
    from api.tiles import _read_time_coords as tiles_read_time

    assert hasattr(pixel_read_time, "cache_info")
    assert hasattr(tiles_read_time, "cache_info")


def test_frame_rendering_cog_and_geozarr_alignment(monkeypatch):
    from api.tiles import _render_cog_frame, _render_geozarr_frame, COLORMAPS, OPERA_WGS84_BOUNDS
    from rasterio.transform import from_bounds
    from rasterio.warp import transform_bounds

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

        def part(self, bounds, **_kwargs):
            cog_data = np.array([
                [[20.0, 15.0, np.nan, -9999000.0]],
                [[0.8,  0.02, np.nan, -9999000.0]],
            ], dtype=np.float32)
            cog_data = np.tile(cog_data, (1, 3, 1))
            return ImageData(cog_data, bounds=bounds, crs=CRS.from_epsg(3857), band_names=["DBZH", "quality"])

    monkeypatch.setattr("api.tiles.local_cog", lambda *_args: "/tmp/cached.tif")
    monkeypatch.setattr("api.tiles.Reader", FakeReader)

    class FakeArray:
        def __init__(self, data, attrs=None):
            self.data = np.asarray(data)
            self.attrs = attrs or {}
            self.shape = self.data.shape

        def __getitem__(self, item):
            return self.data[item]

    from rasterio.warp import transform_bounds
    from rasterio.transform import from_bounds

    epoch = int(__import__("datetime").datetime.fromisoformat("2026-03-20T00:00:00+00:00").timestamp())
    bounds = OPERA_WGS84_BOUNDS
    merc_bounds = transform_bounds("EPSG:4326", "EPSG:3857", *bounds)

    gz_dbzh = np.tile(np.array([[[[20.0, 15.0, -8888000.0, np.nan]]]], dtype=np.float32), (1, 1, 3, 1))
    gz_qual = np.tile(np.array([[[[0.8, 0.02, np.nan, np.nan]]]], dtype=np.float32), (1, 1, 3, 1))
    gz_time = np.array([epoch], dtype=np.int64)

    group = {
        "DBZH": FakeArray(gz_dbzh[0], {"undetect_value": -8_888_000.0}),
        "DBZH_quality_qi_total": FakeArray(gz_qual[0]),
        "time": gz_time,
    }
    metadata = {
        "x": np.linspace(merc_bounds[0], merc_bounds[2], 4),
        "y": np.linspace(merc_bounds[3], merc_bounds[1], 3),
        "times": gz_time,
        "crs": CRS.from_epsg(3857),
        "transform": from_bounds(*merc_bounds, 4, 3),
    }

    monkeypatch.setattr("api.tiles._open_geozarr", lambda _path: group)
    monkeypatch.setattr("api.tiles._geozarr_metadata", lambda _path, _product: metadata)

    published = CatalogFrame(
        product="DBZH",
        timestamp="202603200000",
        nominal_time="2026-03-20T00:00:00Z",
        revision="r1",
        archive_ready=True,
        hot_cog_ready=True,
        hot_cog="hot-cog/DBZH/frame.tif",
        geozarr="geozarr/DBZH/2026/2026-03.zarr",
        quality_variables=["DBZH_quality_qi_total"],
        backend="cog",
    )

    cog_frame = _render_cog_frame(published, 0.10, max_size=4, bounds=bounds)
    geozarr_frame = _render_geozarr_frame(published, 0.10, max_size=4, bounds=bounds)

    assert cog_frame.band_names == ["DBZH"]
    assert geozarr_frame.band_names == ["DBZH"]

    cog_data = cog_frame.array[0, 0]
    geozarr_data = geozarr_frame.array[0, 0]

    # Pixel 0: High quality echo (20.0 dBZ)
    assert cog_data[0] == pytest.approx(20.0)
    assert geozarr_data[0] == pytest.approx(20.0)

    # Pixel 1: Low quality echo (< min_quality=0.10 -> masked / NaN)
    assert np.ma.is_masked(cog_data[1]) or np.isnan(float(cog_data[1]))
    assert np.ma.is_masked(geozarr_data[1]) or np.isnan(float(geozarr_data[1]))

    # Pixel 2: Scanning area (sentinel -10.0)
    assert cog_data[2] == pytest.approx(-10.0)
    assert geozarr_data[2] == pytest.approx(-10.0)

    # Pixel 3: True nodata (masked / NaN)
    assert np.ma.is_masked(cog_data[3]) or np.isnan(float(cog_data[3]))
    assert np.ma.is_masked(geozarr_data[3]) or np.isnan(float(geozarr_data[3]))

    # Rendered WebP image bytes match
    cog_bytes = cog_frame.render(img_format="WEBP", colormap=COLORMAPS["DBZH"])
    geozarr_bytes = geozarr_frame.render(img_format="WEBP", colormap=COLORMAPS["DBZH"])
    assert cog_bytes == geozarr_bytes


def test_raw_route_returns_binary_header_and_data(monkeypatch):
    import struct
    
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
    
    def fake_render(*args):
        # W=2, H=2, min=10, max=20, nodata=-9999
        header = struct.pack('<HHfff', 2, 2, 10.0, 20.0, -9999.0)
        payload = b'\x00' * 8 # 4 pixels * 2 channels = 8 bytes
        return header + payload
        
    monkeypatch.setattr("api.tiles._get_raw_frame_cached", fake_render)
    response = client.get("/tiles/raw/DBZH/202607200000/revision-1.bin")
    
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/octet-stream"
    assert len(response.content) == 16 + 8
