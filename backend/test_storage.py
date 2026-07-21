from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import threading
import time

from api import cog_cache
from api.bucket import auth_headers, fsspec_storage_options


def test_bucket_auth_is_server_side_and_optional(monkeypatch):
    monkeypatch.delenv("HF_TOKEN", raising=False)
    assert auth_headers() == {}
    assert fsspec_storage_options() == {}

    monkeypatch.setenv("HF_TOKEN", "test-read-token")
    assert auth_headers() == {"Authorization": "Bearer test-read-token"}
    assert fsspec_storage_options() == {
        "headers": {"Authorization": "Bearer test-read-token"}
    }


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
