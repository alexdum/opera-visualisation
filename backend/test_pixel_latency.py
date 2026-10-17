"""Regression coverage for pixel read reduction, reuse, and cancellation."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Event
import time

from fastapi import HTTPException
import numpy as np
import pytest
import zarr

from api import pixel
from api.catalog import CatalogFrame
from api.pixel_work import PixelBlockCache, PixelCancelled, SharedPixelWork


class TrackingArray:
    def __init__(self, data, hook=None):
        self.data = np.asarray(data)
        self.shape = self.data.shape
        self.chunks = (1, *self.shape[1:])
        self.reads = []
        self.hook = hook

    def __getitem__(self, item):
        self.reads.append(item)
        if self.hook:
            self.hook()
        return self.data[item]


@pytest.fixture(autouse=True)
def clean_caches():
    pixel._clear_pixel_response_cache()
    pixel._pixel_blocks.clear()
    pixel._read_time_window_cached.cache_clear()
    pixel._open_group.cache_clear()
    pixel._store_metadata.cache_clear()
    yield
    assert not pixel._pixel_work.flights
    pixel._clear_pixel_response_cache()
    pixel._pixel_blocks.clear()
    pixel._read_time_window_cached.cache_clear()
    pixel._open_group.cache_clear()
    pixel._store_metadata.cache_clear()


def setup_frames(monkeypatch, product="DBZH", count=4):
    first = datetime(2026, 10, 17, tzinfo=timezone.utc)
    frames = [CatalogFrame(
        product=product, timestamp=(first + timedelta(minutes=5*i)).strftime("%Y%m%d%H%M"),
        nominal_time=(first + timedelta(minutes=5*i)).isoformat().replace("+00:00", "Z"),
        start_time=(first + timedelta(minutes=5*i - 60)).isoformat().replace("+00:00", "Z"),
        end_time=(first + timedelta(minutes=5*i)).isoformat().replace("+00:00", "Z"),
        revision=f"r{i}", archive_ready=True, hot_cog_ready=False, geozarr="archive",
        quality_variables=[f"{product}_quality_qi_total"], backend="geozarr",
    ) for i in range(count)]
    epochs = np.array([int(datetime.fromisoformat(f.nominal_time.replace("Z", "+00:00")).timestamp()) for f in frames])
    values = np.arange(count*3*5, dtype=np.float32).reshape(count, 3, 5) + 10
    status = np.zeros_like(values, dtype=np.uint8)
    status[1, 0, 0] = 1
    status[2, 0, 0] = 2
    quality = np.full_like(values, 0.8)
    quality[2, 0, 0] = np.nan
    group = {
        product: TrackingArray(values), f"{product}_status": TrackingArray(status),
        f"{product}_quality_qi_total": TrackingArray(quality), "time": epochs,
        "time_bnds": TrackingArray(np.stack([epochs-300, epochs], axis=1)),
    }
    identity = type("Identity", (), {"transform": lambda self, x, y: (x, y)})()
    monkeypatch.setattr(pixel, "_open_group", lambda path: group)
    monkeypatch.setattr(pixel, "_store_metadata", lambda path: {
        "x": np.arange(5), "y": np.arange(3), "to_native": identity, "to_wgs84": identity,
    })
    return frames, group


@pytest.mark.parametrize("product", ["DBZH", "RATE", "ACRR"])
def test_nearby_cells_reuse_exact_blocks_and_skip_complete_bounds(monkeypatch, product):
    frames, group = setup_frames(monkeypatch, product)
    first, _ = pixel._extract_store_frames(product, "archive", frames, 0, 0)
    nearby, _ = pixel._extract_store_frames(product, "archive", frames, 1, 0)
    assert [r["status"] for r in first] == ["detected", "undetect", "nodata", "detected"]
    assert [r["value"] for r in first] == [10.0, None, None, 55.0]
    assert [r["value"] for r in nearby] == [11.0, 26.0, 41.0, 56.0]
    assert first[2]["quality"][f"{product}_quality_qi_total"] is None
    assert nearby[2]["quality"][f"{product}_quality_qi_total"] == pytest.approx(0.8)
    assert [(r["start_time"], r["end_time"], r["revision"]) for r in first] == [
        (f.start_time, f.end_time, f.revision) for f in frames]
    assert group["time_bnds"].reads == []
    assert all(len(group[name].reads) == 1 for name in [product, f"{product}_status", f"{product}_quality_qi_total"])
    # A corrected catalog revision must not reuse the old block or response.
    frames[0] = frames[0].model_copy(update={"revision": "corrected"})
    group[product].data[0, 0, 0] = 99
    corrected, _ = pixel._extract_store_frames(product, "archive", frames, 0, 0)
    assert corrected[0]["value"] == 99
    assert len(group[product].reads) == 2


def test_only_missing_bounds_are_read_and_catalog_fields_win(monkeypatch):
    frames, group = setup_frames(monkeypatch, "ACRR")
    frames[1] = frames[1].model_copy(update={"start_time": None})
    frames[3] = frames[3].model_copy(update={"end_time": None})
    rows, _ = pixel._extract_store_frames("ACRR", "archive", frames, 0, 0)
    assert group["time_bnds"].reads == [slice(1, 2), slice(3, 4)]
    assert rows[1]["start_time"] == frames[0].nominal_time
    assert rows[1]["end_time"] == frames[1].end_time
    assert rows[3]["start_time"] == frames[3].start_time
    assert rows[3]["end_time"] == frames[3].nominal_time


def wait_until(predicate):
    deadline = time.monotonic() + 3
    while not predicate():
        assert time.monotonic() < deadline, "worker did not reach synchronization point"
        time.sleep(0.005)


@pytest.mark.parametrize("other_x, shared_kind", [(0.1, "cell"), (1, "block")])
def test_same_or_nearby_cells_share_work_when_owner_disconnects(monkeypatch, other_x, shared_kind):
    frames, group = setup_frames(monkeypatch)
    entered, release, disconnected = Event(), Event(), Event()
    def slow_read():
        entered.set()
        assert release.wait(3)
    group["DBZH"].hook = slow_read
    with ThreadPoolExecutor(max_workers=2) as executor:
        owner = executor.submit(pixel._extract_store_frames, "DBZH", "archive", frames, 0, 0, disconnected.is_set)
        assert entered.wait(3)
        other = executor.submit(pixel._extract_store_frames, "DBZH", "archive", frames, other_x, 0)
        try:
            wait_until(lambda: any(len(f.consumers) == 2 for k, f in pixel._pixel_work.flights.items() if k[0] == shared_kind))
            disconnected.set()
        finally:
            release.set()
        with pytest.raises(PixelCancelled):
            owner.result(timeout=3)
        rows, _ = other.result(timeout=3)
    assert rows[0]["value"] == (10 if other_x < 0.5 else 11)
    assert len(group["DBZH"].reads) == 1


def test_disconnected_extraction_stops_after_active_batch_and_can_retry(monkeypatch):
    frames, group = setup_frames(monkeypatch, count=96)
    disconnected = Event()
    group["DBZH"].hook = disconnected.set
    with pytest.raises(PixelCancelled):
        pixel._extract_store_frames("DBZH", "archive", frames, 0, 0, disconnected.is_set)
    assert len(group["DBZH"].reads) == 1
    assert not pixel._pixel_response_cache
    group["DBZH"].hook = None
    rows, _ = pixel._extract_store_frames("DBZH", "archive", frames, 0, 0)
    assert len(rows) == 96


def test_failed_work_is_not_cached_and_releases_waiters():
    shared = SharedPixelWork()
    entered, release = Event(), Event()
    def broken(cancelled):
        entered.set()
        assert release.wait(3)
        raise RuntimeError("storage failure")
    with ThreadPoolExecutor(max_workers=2) as executor:
        owner = executor.submit(shared.run, ("same",), broken, lambda: False)
        assert entered.wait(3)
        waiter = executor.submit(shared.run, ("same",), broken, lambda: False)
        try:
            wait_until(lambda: len(shared.flights[("same",)].consumers) == 2)
        finally:
            release.set()
        for future in (owner, waiter):
            with pytest.raises(RuntimeError, match="storage failure"):
                future.result(timeout=3)
    assert not shared.flights
    assert shared.run(("same",), lambda c: "recovered", lambda: False) == "recovered"


def test_waiter_cancellation_does_not_cancel_owner():
    shared = SharedPixelWork()
    entered, release, cancelled = Event(), Event(), Event()
    def work(is_cancelled):
        entered.set()
        assert release.wait(3)
        assert not is_cancelled()
        return 42
    with ThreadPoolExecutor(max_workers=2) as executor:
        owner = executor.submit(shared.run, ("key",), work, lambda: False)
        assert entered.wait(3)
        waiter = executor.submit(shared.run, ("key",), work, cancelled.is_set)
        try:
            wait_until(lambda: len(shared.flights[("key",)].consumers) == 2)
            cancelled.set()
            with pytest.raises(PixelCancelled):
                waiter.result(timeout=3)
        finally:
            release.set()
        assert owner.result(timeout=3) == 42
    assert not shared.flights


def test_block_cache_bounds_memory_entries_and_lifetime(monkeypatch):
    now = [0.0]
    monkeypatch.setattr("api.pixel_work.time.monotonic", lambda: now[0])
    cache = PixelBlockCache(16, 2, 10)
    cache.put((1,), np.ones(8, dtype=np.uint8))
    cache.put((2,), np.ones(8, dtype=np.uint8))
    assert not cache.get((1,)).flags.writeable
    cache.put((3,), np.ones(8, dtype=np.uint8))
    assert cache.get((2,)) is None
    assert cache.nbytes == 16 and len(cache.entries) == 2
    cache.put((4,), np.ones(17, dtype=np.uint8))
    assert cache.get((4,)) is None
    now[0] = 11
    assert cache.get((1,)) is None
    assert cache.get((3,)) is None
    assert cache.nbytes == 0


@pytest.mark.parametrize("backend", ["mount", "memory"])
def test_real_sharded_zarr_nearby_reads_preserve_native_values(tmp_path, monkeypatch, backend):
    if backend == "mount":
        store = zarr.storage.LocalStore(tmp_path / "archive")
        monkeypatch.setattr(pixel, "USE_LOCAL_MOUNT", True)
        monkeypatch.setattr(pixel, "resolve_path", lambda path: str(tmp_path / path))
    else:
        root = f"memory://pixel-latency-{tmp_path.name}"
        store = zarr.storage.FsspecStore.from_url(root + "/archive")
        monkeypatch.setattr(pixel, "USE_LOCAL_MOUNT", False)
        monkeypatch.setattr(pixel, "HF_BUCKET_URL", root)
        monkeypatch.setattr(pixel, "fsspec_storage_options", lambda: {})
    group = zarr.open_group(store=store, mode="w")
    epochs = np.array([1792195200 + i*300 for i in range(4)], dtype=np.int64)
    data = np.arange(4*40*40, dtype=np.float32).reshape(4, 40, 40)
    for name, values in {"DBZH": data, "DBZH_status": np.zeros_like(data, dtype=np.uint8)}.items():
        group.create_array(name, data=values, chunks=(1, 16, 16), shards=(1, 48, 48))
    group.create_array("time", data=epochs, chunks=(1,))
    group.create_array("x", data=np.arange(40, dtype=np.float64))
    group.create_array("y", data=np.arange(40, dtype=np.float64))
    group.create_array("crs", data=np.array(0, dtype=np.int32))
    group["crs"].attrs["proj4_params"] = "EPSG:4326"
    frames = [CatalogFrame(product="DBZH", timestamp=datetime.fromtimestamp(int(t), timezone.utc).strftime("%Y%m%d%H%M"),
        nominal_time=datetime.fromtimestamp(int(t), timezone.utc).isoformat(), revision=str(t),
        archive_ready=True, hot_cog_ready=False, geozarr="archive", quality_variables=[], backend="geozarr") for t in epochs]
    for x, y in [(14, 14), (15, 14), (16, 14), (39, 39)]:
        rows, loc = pixel._extract_store_frames("DBZH", "archive", frames, x, y)
        assert [r["value"] for r in rows] == data[:, y, x].tolist()
        assert (loc["x_index"], loc["y_index"]) == (x, y)


def test_route_observes_disconnect(monkeypatch):
    class DisconnectedRequest:
        async def is_disconnected(self):
            return True
    def extract(product, lon, lat, start, end, cancelled):
        wait_until(cancelled)
        raise PixelCancelled()
    monkeypatch.setattr(pixel, "extract_pixel_series", extract)
    with pytest.raises(HTTPException) as error:
        asyncio.run(pixel.get_pixel_series(DisconnectedRequest(), "DBZH", 0, 0, "2026-10-17", "2026-10-17"))
    assert error.value.status_code == 499


def test_api_json_and_csv_keep_the_same_exact_rows(monkeypatch):
    import csv
    import io
    from fastapi.testclient import TestClient
    from main import app
    frames, _ = setup_frames(monkeypatch, "ACRR")
    monkeypatch.setattr(pixel, "cataloged_frames_between", lambda *args: frames)
    params = {"product": "ACRR", "lon": 0, "lat": 0, "start": "2026-10-17", "end": "2026-10-17"}
    with TestClient(app) as client:
        response = client.get("/api/pixel", params=params)
        assert response.status_code == 200
        rows = response.json()["series"]
        exported = client.get("/api/pixel/csv", params=params)
        assert exported.status_code == 200
    csv_rows = list(csv.DictReader(io.StringIO(exported.text)))
    assert len(rows) == len(csv_rows) == 4
    assert [r["status"] for r in rows] == [r["status"] for r in csv_rows]
    assert [r["revision"] for r in rows] == [r["revision"] for r in csv_rows]
    assert [r["start_time"] for r in rows] == [r["start_time_utc"] for r in csv_rows]
    assert rows[1]["value"] is None and csv_rows[1]["value"] == ""


def test_abandoned_flight_cannot_remove_a_replacement():
    shared = SharedPixelWork()
    entered, abandoned, release, disconnect = Event(), Event(), Event(), Event()
    def old_work(cancelled):
        entered.set()
        assert disconnect.wait(3)
        assert cancelled()
        abandoned.set()
        assert release.wait(3)
        raise PixelCancelled()
    with ThreadPoolExecutor(max_workers=2) as executor:
        old = executor.submit(shared.run, ("same",), old_work, disconnect.is_set)
        assert entered.wait(3)
        disconnect.set()
        assert abandoned.wait(3)
        assert shared.run(("same",), lambda c: "fresh", lambda: False) == "fresh"
        release.set()
        with pytest.raises(PixelCancelled):
            old.result(timeout=3)
    assert not shared.flights


def test_point_cache_can_be_disabled_without_changing_results(monkeypatch):
    frames, group = setup_frames(monkeypatch)
    monkeypatch.setattr(pixel._pixel_blocks, "max_bytes", 0)
    rows, _ = pixel._extract_store_frames("DBZH", "archive", frames, 1, 0)
    assert [r["value"] for r in rows] == [11.0, 26.0, 41.0, 56.0]
    assert group["DBZH"].reads == [(slice(0, 4), 0, 1)]
    assert pixel._pixel_blocks.nbytes == 0


def test_catalog_gaps_and_appends_do_not_reuse_the_wrong_window(monkeypatch):
    frames, group = setup_frames(monkeypatch)
    selected = [frames[0], frames[2], frames[3]]
    rows, _ = pixel._extract_store_frames("DBZH", "archive", selected, 1, 0)
    assert [r["time"] for r in rows] == [f.nominal_time for f in selected]
    assert [r["value"] for r in rows] == [11.0, 41.0, 56.0]
    epoch = group["time"][-1] + 300
    group["time"] = np.append(group["time"], epoch)
    for name in ["DBZH", "DBZH_status", "DBZH_quality_qi_total"]:
        array = group[name]
        array.data = np.concatenate([array.data, array.data[-1:]], axis=0)
        array.shape = array.data.shape
    group["DBZH"].data[-1, 0, 1] = 99
    new_time = datetime.fromtimestamp(int(epoch), timezone.utc).isoformat()
    selected.append(frames[-1].model_copy(update={"nominal_time": new_time, "revision": "append"}))
    extended, _ = pixel._extract_store_frames("DBZH", "archive", selected, 1, 0)
    assert len(extended) == 4 and extended[-1]["value"] == 99
    assert extended[-1]["revision"] == "append"


@pytest.mark.parametrize("kind", ["missing", "duplicate"])
def test_bad_archive_times_fail_without_caching_a_response(monkeypatch, kind):
    frames, group = setup_frames(monkeypatch)
    group["time"][1] = group["time"][0] if kind == "duplicate" else group["time"][1] + 1
    with pytest.raises(HTTPException) as error:
        pixel._extract_store_frames("DBZH", "archive", frames, 0, 0)
    assert error.value.status_code == 503
    assert not pixel._pixel_response_cache
