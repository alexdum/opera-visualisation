"""Bounded archive lookups and disconnect-aware rendering regressions."""

import asyncio
import gzip
from threading import Event

import numpy as np
import pytest
from fastapi import HTTPException

from api import tiles
from api.catalog import CatalogFrame
from api.render_slots import RenderSlots, check_render_cancelled
from main import app


def published(product="RATE", nominal_time="2026-07-20T00:15:00Z"):
    return CatalogFrame(
        product=product, timestamp="202607200015", nominal_time=nominal_time,
        revision="loading-test", archive_ready=True, hot_cog_ready=True,
        hot_cog="hot-cog/test.tif", geozarr="loading-test.zarr", backend="cog",
    )


@pytest.fixture(autouse=True)
def clear_loading_caches():
    tiles._cached_frame_time_index.cache_clear()
    tiles._open_group.cache_clear()
    tiles._geozarr_metadata.cache_clear()
    with tiles._raw_cache_lock:
        tiles._raw_cache.clear()
        tiles._raw_cache_bytes = 0
    yield
    tiles._cached_frame_time_index.cache_clear()
    tiles._open_group.cache_clear()
    tiles._geozarr_metadata.cache_clear()


class ScalarTimeCoordinate:
    def __init__(self, values):
        self.values = np.array(values, dtype=np.int64)
        self.shape = self.values.shape
        self.reads = []

    def __getitem__(self, item):
        assert isinstance(item, int), "A frame lookup must never scan a coordinate slice"
        self.reads.append(item)
        return self.values[item]


def test_month_lookup_uses_logarithmic_reads_and_reuses_the_result(monkeypatch):
    frame = published()
    epoch = int(tiles.datetime_from_iso(frame.nominal_time).timestamp())
    coordinate = ScalarTimeCoordinate(epoch + (np.arange(1604) - 1200) * 900)
    monkeypatch.setattr(tiles, "_open_geozarr", lambda _: {"time": coordinate})
    monkeypatch.setattr(tiles, "_metadata_cache_bucket", lambda: 1)

    assert tiles._geozarr_frame_time_index(frame) == 1200
    assert len(coordinate.reads) <= 14
    count = len(coordinate.reads)
    assert tiles._geozarr_frame_time_index(frame) == 1200
    assert len(coordinate.reads) == count


def test_time_lookup_rejects_missing_and_duplicate_timestamps():
    frame = published()
    epoch = int(tiles.datetime_from_iso(frame.nominal_time).timestamp())
    for values in ([], [epoch - 900, epoch + 900], [epoch, epoch], [epoch - 900, epoch, epoch]):
        with pytest.raises(HTTPException, match="503"):
            tiles._frame_time_index(ScalarTimeCoordinate(values), frame)


def test_spatial_metadata_never_reads_monthly_time_coordinate(monkeypatch):
    from types import SimpleNamespace

    class SpatialGroup(dict):
        def __getitem__(self, name):
            assert name != "time", "Spatial metadata must not load the monthly coordinate"
            return super().__getitem__(name)

    group = SpatialGroup({
        "x": np.array([0.5, 1.5]), "y": np.array([1.5, 0.5]),
        "crs": SimpleNamespace(attrs={"proj4_params": "EPSG:4326", "GeoTransform": "0 1 0 2 0 -1"}),
    })
    monkeypatch.setattr(tiles, "_open_geozarr", lambda _: group)
    metadata = tiles._geozarr_metadata("metadata-test.zarr", "RATE")
    assert metadata["x"].tolist() == [0.5, 1.5]
    assert "times" not in metadata


def test_growing_month_refreshes_group_and_cached_indexes(tmp_path, monkeypatch):
    import zarr

    frame = published()
    epoch = int(tiles.datetime_from_iso(frame.nominal_time).timestamp())
    path = str(tmp_path / "growing.zarr")
    group = zarr.create_group(store=zarr.storage.LocalStore(path))
    coordinate = group.create_array("time", data=np.array([epoch - 900, epoch]))
    frame = frame.model_copy(update={"geozarr": path})
    monkeypatch.setattr(tiles, "USE_LOCAL_MOUNT", True)
    monkeypatch.setattr(tiles, "resolve_path", lambda path: path)
    bucket = [1]
    monkeypatch.setattr(tiles, "_metadata_cache_bucket", lambda: bucket[0])
    assert tiles._geozarr_frame_time_index(frame) == 1

    coordinate.resize((3,))
    coordinate[2] = epoch + 900
    next_frame = frame.model_copy(update={"nominal_time": "2026-07-20T00:30:00Z"})
    # A freshly committed frame must work even before the metadata TTL ends.
    assert tiles._geozarr_frame_time_index(next_frame) == 2
    bucket[0] = 2
    assert tiles._geozarr_frame_time_index(frame) == 1


@pytest.mark.parametrize("product", ["DBZH", "RATE", "ACRR"])
def test_raw_archive_uses_exact_nonzero_index_and_preserves_status(monkeypatch, product):
    from affine import Affine
    from rasterio.crs import CRS

    frame = published(product)
    epoch = int(tiles.datetime_from_iso(frame.nominal_time).timestamp())

    class Measurement:
        attrs = {}

        def __getitem__(self, item):
            assert item[0] == 1
            return np.array([[20.0, np.nan, 40.0]], dtype=np.float32)

    class Status:
        def __getitem__(self, item):
            assert item[0] == 1
            return np.array([[0, 1, 2]], dtype=np.uint8)

    group = {
        "time": ScalarTimeCoordinate([epoch - 900, epoch]),
        product: Measurement(), f"{product}_status": Status(),
    }
    monkeypatch.setattr(tiles, "_open_geozarr", lambda _: group)
    monkeypatch.setattr(tiles, "_geozarr_metadata", lambda *_: {
        "x": np.array([0.5, 1.5, 2.5]), "y": np.array([0.5]),
        "crs": CRS.from_epsg(4326), "transform": Affine.identity(),
    })
    sources = []

    def reproject(source, destination, **_):
        sources.append(source.copy())
        destination[:] = source

    monkeypatch.setattr(tiles, "reproject", reproject)
    monkeypatch.setattr(tiles, "_destination_grid", lambda *_: ((0, 0, 3, 1), 3, 1, Affine.identity()))
    tiles._get_raw_geozarr_frame(frame, bounds=(0, 0, 3, 1))
    assert sources[0][0, 0, 0] == 20
    assert sources[0][0, 0, 1] == -10
    assert np.isnan(sources[0][0, 0, 2])


async def wait_until(predicate):
    async with asyncio.timeout(3):
        while not predicate():
            await asyncio.sleep(0.005)


class FrameRequest:
    """An actual ASGI connection, with controllable browser disconnect."""

    def __init__(self, revision, *, prefetch=False):
        self.messages = asyncio.Queue()
        self.messages.put_nowait({"type": "http.request", "body": b"", "more_body": False})
        self.responses = []
        scope = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
            "method": "GET", "scheme": "http", "root_path": "",
            "path": f"/tiles/raw/RATE/202607200015/{revision}.bin",
            "query_string": b"source=cog&prefetch=true" if prefetch else b"source=cog",
            "headers": [], "server": ("test", 80), "client": ("test", 1234),
        }

        async def send(message):
            self.responses.append(message)

        self.task = asyncio.create_task(app(scope, self.messages.get, send))

    def disconnect(self):
        self.messages.put_nowait({"type": "http.disconnect"})

    @property
    def status(self):
        return next(message["status"] for message in self.responses if message["type"] == "http.response.start")


def test_disconnected_queued_view_does_not_read_or_hold_up_current_selection(monkeypatch):
    slots = RenderSlots(1)
    assert slots.acquire(timeout=0)
    monkeypatch.setattr(tiles, "RENDER_SLOTS", slots)
    monkeypatch.setattr(tiles, "resolve_catalog_frame", lambda *_: published())
    reads = []
    monkeypatch.setattr(tiles, "_get_raw_cog_frame", lambda *_: reads.append(True) or b"raw")

    async def scenario():
        obsolete = FrameRequest("obsolete")
        await wait_until(lambda: slots.waiting == 1)
        current = FrameRequest("current")
        await wait_until(lambda: slots.waiting == 2)
        obsolete.disconnect()
        await asyncio.wait_for(obsolete.task, 3)
        assert obsolete.status == 499
        assert slots.waiting == 1
        assert reads == []
        slots.release()
        await asyncio.wait_for(current.task, 3)
        assert current.status == 200
        assert reads == [True]
        assert slots.available == 1
        assert not tiles._inflight

    asyncio.run(scenario())


@pytest.mark.parametrize("leader_prefetch", [False, True])
def test_shared_render_survives_original_viewer_disconnect(monkeypatch, leader_prefetch):
    started = Event()
    finish = Event()
    renders = []

    def render(*_, **__):
        renders.append(True)
        started.set()
        assert finish.wait(3)
        check_render_cancelled()
        return gzip.compress(b"shared"), "cog"

    monkeypatch.setattr(tiles, "_render_and_compress", render)

    async def scenario():
        leader = FrameRequest("shared", prefetch=leader_prefetch)
        await wait_until(started.is_set)
        follower = FrameRequest("shared")
        await wait_until(lambda: any(len(job.consumers) == 2 for job in tiles._inflight.values()))
        leader.disconnect()
        await asyncio.sleep(0.06)
        finish.set()
        await asyncio.wait_for(asyncio.gather(leader.task, follower.task), 3)
        assert follower.status == 200
        assert renders == [True]
        assert not tiles._inflight

    asyncio.run(scenario())


def test_cancelled_native_read_stops_at_next_boundary_without_archive_fallback(monkeypatch):
    started, finish = Event(), Event()
    slots = RenderSlots(1)
    monkeypatch.setattr(tiles, "RENDER_SLOTS", slots)
    monkeypatch.setattr(tiles, "resolve_catalog_frame", lambda *_: published())
    archive_reads = []
    monkeypatch.setattr(tiles, "_get_raw_geozarr_frame", lambda *_: archive_reads.append(True))

    def read(*_):
        started.set()
        assert finish.wait(3)
        check_render_cancelled()
        return b"raw"

    monkeypatch.setattr(tiles, "_get_raw_cog_frame", read)

    async def scenario():
        request = FrameRequest("cancel-during-read")
        await wait_until(started.is_set)
        request.disconnect()
        await wait_until(lambda: all(job.cancelled() for job in tiles._inflight.values()))
        finish.set()
        await asyncio.wait_for(request.task, 3)
        assert request.status == 499
        assert slots.available == 1
        assert archive_reads == []
        assert tiles._raw_cache == {}

    asyncio.run(scenario())
