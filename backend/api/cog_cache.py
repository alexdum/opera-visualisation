"""Bounded, revision-safe local cache for hot OPERA COG frames."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import tempfile
import threading

import httpx

from api.bucket import auth_headers, object_url


class BucketRateLimitError(RuntimeError):
    def __init__(self, retry_after: str | None = None) -> None:
        super().__init__("Hugging Face Storage Bucket rate limit reached")
        self.retry_after = retry_after


_CACHE_DIR = Path(os.getenv("COG_CACHE_DIR", "/tmp/opera-visualisation-cogs"))
_MAX_FILES = max(2, int(os.getenv("COG_CACHE_MAX_FILES", "4")))
_MAX_BYTES = max(1, int(os.getenv("COG_CACHE_MAX_BYTES", str(1024**3))))
_locks_guard = threading.Lock()
_download_locks: dict[str, threading.Lock] = {}


def _identity(product: str, timestamp: str, revision: str, hot_cog: str) -> str:
    value = f"{product}\0{timestamp}\0{revision}\0{hot_cog}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _target_path(product: str, timestamp: str, revision: str, hot_cog: str) -> Path:
    return _CACHE_DIR / f"{product}-{timestamp}-{_identity(product, timestamp, revision, hot_cog)[:20]}.tif"


def _lock_for(key: str) -> threading.Lock:
    with _locks_guard:
        return _download_locks.setdefault(key, threading.Lock())


def _evict(keep: Path) -> None:
    files = [path for path in _CACHE_DIR.glob("*.tif") if path.is_file()]
    files.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    total = sum(path.stat().st_size for path in files)
    for index, path in enumerate(files):
        if path == keep:
            continue
        if index < _MAX_FILES and total <= _MAX_BYTES:
            continue
        try:
            size = path.stat().st_size
            path.unlink()
            total -= size
        except FileNotFoundError:
            pass


def local_cog(product: str, timestamp: str, revision: str, hot_cog: str) -> Path:
    """Return a local immutable COG, downloading it once per revision."""

    target = _target_path(product, timestamp, revision, hot_cog)
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if target.is_file() and target.stat().st_size > 0:
        target.touch()
        return target

    lock = _lock_for(target.name)
    with lock:
        if target.is_file() and target.stat().st_size > 0:
            target.touch()
            return target

        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{target.stem}-", suffix=".part", dir=_CACHE_DIR
        )
        os.close(descriptor)
        temporary = Path(temporary_name)
        try:
            timeout = httpx.Timeout(connect=15.0, read=180.0, write=30.0, pool=30.0)
            with httpx.stream(
                "GET",
                object_url(hot_cog),
                headers=auth_headers(),
                follow_redirects=True,
                timeout=timeout,
            ) as response:
                if response.status_code == 429:
                    raise BucketRateLimitError(response.headers.get("Retry-After"))
                response.raise_for_status()
                with temporary.open("wb") as destination:
                    for chunk in response.iter_bytes(chunk_size=1024 * 1024):
                        destination.write(chunk)
            if temporary.stat().st_size == 0:
                raise RuntimeError("Downloaded COG is empty")
            os.replace(temporary, target)
            _evict(target)
            return target
        finally:
            temporary.unlink(missing_ok=True)
