"""Bounded COG reader reuse and diagnostics for the GDAL-backed renderer."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import logging
import os
from pathlib import Path
import threading
import time
from typing import Any, Callable, Iterator


# Uvicorn does not emit INFO records from arbitrary module loggers by default.
# Use its configured error logger so diagnostics appear in Space container logs.
logger = logging.getLogger("uvicorn.error")


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


COG_IO_DIAGNOSTICS = _env_bool("COG_IO_DIAGNOSTICS")


@dataclass
class _IdleReader:
    reader: Any
    path: str
    opener: Callable[[str], Any]
    idle_since: float


class CogReaderPool:
    """Keep a bounded number of idle readers; never share an active reader."""

    def __init__(self, max_idle: int) -> None:
        self.max_idle = max(0, max_idle)
        self._idle: list[_IdleReader] = []
        self._lock = threading.Lock()
        self._hits = 0
        self._misses = 0
        self._active = 0

    @staticmethod
    def _close(reader: Any) -> None:
        close = getattr(reader, "close", None)
        if callable(close):
            close()
            return
        exit_context = getattr(reader, "__exit__", None)
        if callable(exit_context):
            exit_context(None, None, None)

    def acquire(self, path: str, opener: Callable[[str], Any]) -> tuple[Any, bool]:
        with self._lock:
            for index in range(len(self._idle) - 1, -1, -1):
                item = self._idle[index]
                # Including the opener in the key keeps monkeypatched/test readers
                # and future reader configurations isolated from existing handles.
                if item.path == path and item.opener is opener:
                    self._idle.pop(index)
                    self._hits += 1
                    self._active += 1
                    return item.reader, True
            self._misses += 1
            self._active += 1
        try:
            return opener(path), False
        except Exception:
            with self._lock:
                self._active -= 1
            raise

    def release(self, path: str, opener: Callable[[str], Any], reader: Any) -> None:
        evicted: list[Any] = []
        with self._lock:
            self._active -= 1
            if self.max_idle == 0:
                evicted.append(reader)
            else:
                self._idle.append(_IdleReader(reader, path, opener, time.monotonic()))
                while len(self._idle) > self.max_idle:
                    oldest = min(range(len(self._idle)), key=lambda index: self._idle[index].idle_since)
                    evicted.append(self._idle.pop(oldest).reader)
        for old_reader in evicted:
            self._close(old_reader)

    def discard(self, reader: Any) -> None:
        """Close a checked-out reader that failed during use."""
        with self._lock:
            self._active -= 1
        self._close(reader)

    def close(self) -> None:
        with self._lock:
            readers = [item.reader for item in self._idle]
            self._idle.clear()
        for reader in readers:
            self._close(reader)

    def stats(self) -> dict[str, int]:
        with self._lock:
            return {
                "hits": self._hits,
                "misses": self._misses,
                "active": self._active,
                "idle": len(self._idle),
                "max_idle": self.max_idle,
            }


COG_READER_POOL = CogReaderPool(
    max_idle=max(0, int(os.getenv("COG_READER_POOL_SIZE", "8")))
)


def mount_details(path: str | os.PathLike[str]) -> dict[str, str]:
    """Describe the Linux mount serving path without claiming cache behavior."""
    mountinfo = Path("/proc/self/mountinfo")
    if not mountinfo.is_file():
        return {"mount_point": "unknown", "filesystem": "unknown", "source": "unknown"}

    resolved = os.path.realpath(path)
    best: tuple[int, dict[str, str]] | None = None
    try:
        lines = mountinfo.read_text(encoding="utf-8").splitlines()
    except OSError:
        return {"mount_point": "unknown", "filesystem": "unknown", "source": "unknown"}
    for line in lines:
        left, separator, right = line.partition(" - ")
        if not separator:
            continue
        left_fields = left.split()
        right_fields = right.split()
        if len(left_fields) < 5 or len(right_fields) < 2:
            continue
        mount_point = left_fields[4].replace("\\040", " ")
        if resolved != mount_point and not resolved.startswith(mount_point.rstrip("/") + "/"):
            continue
        details = {
            "mount_point": mount_point,
            "filesystem": right_fields[0],
            "source": right_fields[1],
        }
        candidate = (len(mount_point), details)
        if best is None or candidate[0] > best[0]:
            best = candidate
    return best[1] if best else {
        "mount_point": "unknown", "filesystem": "unknown", "source": "unknown"
    }


@contextmanager
def pooled_cog_reader(
    path: str | os.PathLike[str], opener: Callable[[str], Any]
) -> Iterator[Any]:
    path_string = os.fspath(path)
    started = time.perf_counter()
    reader, pool_hit = COG_READER_POOL.acquire(path_string, opener)
    try:
        yield reader
    except BaseException:
        # A GDAL read/warp failure can leave a dataset handle in an unknown
        # state. Do not let a later request inherit that handle.
        COG_READER_POOL.discard(reader)
        raise
    else:
        COG_READER_POOL.release(path_string, opener, reader)
    finally:
        if COG_IO_DIAGNOSTICS:
            try:
                size = os.path.getsize(path_string)
            except OSError:
                size = -1
            mount = mount_details(path_string)
            logger.info(
                "COG read path=%s elapsed_ms=%.1f pool_hit=%s size_bytes=%d "
                "mount=%s fs=%s pool=%s",
                path_string,
                (time.perf_counter() - started) * 1000.0,
                pool_hit,
                size,
                mount["mount_point"],
                mount["filesystem"],
                COG_READER_POOL.stats(),
            )


def log_raster_runtime(storage_path: str | None) -> None:
    import rasterio

    logger.info(
        "Raster runtime: rasterio=%s gdal=%s GDAL_CACHEMAX=%s "
        "GDAL_NUM_THREADS=%s render_concurrency=%s reader_pool_size=%d diagnostics=%s",
        rasterio.__version__,
        rasterio.__gdal_version__,
        os.getenv("GDAL_CACHEMAX", "GDAL default"),
        os.getenv("GDAL_NUM_THREADS", "GDAL default"),
        os.getenv("TILE_RENDER_CONCURRENCY", "4"),
        COG_READER_POOL.max_idle,
        COG_IO_DIAGNOSTICS,
    )
    if storage_path:
        details = mount_details(storage_path)
        logger.info(
            "OPERA mount details: path=%s mount=%s filesystem=%s source=%s",
            storage_path,
            details["mount_point"],
            details["filesystem"],
            details["source"],
        )
