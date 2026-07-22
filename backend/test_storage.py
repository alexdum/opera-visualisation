from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import threading
import time

from api import cog_cache
from api import bucket
from api.bucket import auth_headers, fsspec_storage_options
from api.raster_runtime import cog_reader


def test_bucket_auth_is_server_side_and_optional(monkeypatch):
    monkeypatch.delenv("HF_TOKEN", raising=False)
    assert auth_headers() == {}
    assert fsspec_storage_options() == {}

    monkeypatch.setenv("HF_TOKEN", "test-read-token")
    assert auth_headers() == {"Authorization": "Bearer test-read-token"}
    assert fsspec_storage_options() == {
        "headers": {"Authorization": "Bearer test-read-token"}
    }


def test_storage_description_reports_mount_without_credentials(monkeypatch):
    monkeypatch.setattr(bucket, "USE_LOCAL_MOUNT", True)
    monkeypatch.setattr(bucket, "BUCKET_MOUNT", "/data/opera")
    assert bucket.storage_mode() == "mount"
    assert bucket.storage_description() == "mounted filesystem (/data/opera)"


def test_cog_reader_opens_and_closes_in_the_calling_thread():
    events: list[tuple[str, int]] = []

    class FakeReader:
        def __init__(self, _path):
            events.append(("init", threading.get_ident()))

        def __enter__(self):
            events.append(("enter", threading.get_ident()))
            return self

        def __exit__(self, *_args):
            events.append(("exit", threading.get_ident()))

    with cog_reader("/data/frame.tif", FakeReader):
        events.append(("use", threading.get_ident()))

    assert [name for name, _thread in events] == ["init", "enter", "use", "exit"]
    assert len({thread for _name, thread in events}) == 1


def test_concurrent_tiles_download_one_revision_once(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(cog_cache, "_CACHE_DIR", tmp_path)
    calls = 0
    calls_lock = threading.Lock()

    class FakeResponse:
        status_code = 200
        headers = {}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def raise_for_status(self):
            return None

        def iter_bytes(self, chunk_size):
            assert chunk_size == 1024 * 1024
            time.sleep(0.02)
            yield b"valid-cog-placeholder"

    def fake_stream(*_args, **_kwargs):
        nonlocal calls
        with calls_lock:
            calls += 1
        return FakeResponse()

    monkeypatch.setattr(cog_cache.httpx, "stream", fake_stream)
    arguments = ("DBZH", "202607210630", "revision", "hot-cog/DBZH/frame.tif")
    with ThreadPoolExecutor(max_workers=4) as executor:
        paths = list(executor.map(lambda _: cog_cache.local_cog(*arguments), range(4)))

    assert calls == 1
    assert len(set(paths)) == 1
    assert paths[0].read_bytes() == b"valid-cog-placeholder"


def test_rate_limit_does_not_publish_partial_cache_file(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(cog_cache, "_CACHE_DIR", tmp_path)

    class RateLimitedResponse:
        status_code = 429
        headers = {"Retry-After": "42"}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(cog_cache.httpx, "stream", lambda *_args, **_kwargs: RateLimitedResponse())

    try:
        cog_cache.local_cog("RATE", "202607210630", "revision", "hot-cog/RATE/frame.tif")
        raise AssertionError("expected rate-limit error")
    except cog_cache.BucketRateLimitError as exc:
        assert exc.retry_after == "42"

    assert list(tmp_path.iterdir()) == []
