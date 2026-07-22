"""COG read timing and mount diagnostics for the GDAL-backed renderer."""

from __future__ import annotations

from contextlib import contextmanager
import logging
import os
from pathlib import Path
import time
from typing import Any, Callable, Iterator


# Uvicorn does not emit INFO records from arbitrary module loggers by default.
logger = logging.getLogger("uvicorn.error")


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


COG_IO_DIAGNOSTICS = _env_bool("COG_IO_DIAGNOSTICS")


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
def cog_reader(
    path: str | os.PathLike[str], opener: Callable[[str], Any]
) -> Iterator[Any]:
    """Open, use, and close a reader in the same worker thread.

    Rasterio's GDAL environment is thread-local. A Reader must therefore not
    be pooled across FastAPI worker threads.
    """
    path_string = os.fspath(path)
    started = time.perf_counter()
    try:
        with opener(path_string) as reader:
            yield reader
    finally:
        if COG_IO_DIAGNOSTICS:
            try:
                size = os.path.getsize(path_string)
            except OSError:
                size = -1
            mount = mount_details(path_string)
            logger.info(
                "COG read path=%s elapsed_ms=%.1f size_bytes=%d mount=%s fs=%s",
                path_string,
                (time.perf_counter() - started) * 1000.0,
                size,
                mount["mount_point"],
                mount["filesystem"],
            )


def log_raster_runtime(storage_path: str | None) -> None:
    import rasterio

    logger.info(
        "Raster runtime: rasterio=%s gdal=%s GDAL_CACHEMAX=%s "
        "GDAL_NUM_THREADS=%s render_concurrency=%s diagnostics=%s",
        rasterio.__version__,
        rasterio.__gdal_version__,
        os.getenv("GDAL_CACHEMAX", "GDAL default"),
        os.getenv("GDAL_NUM_THREADS", "GDAL default"),
        os.getenv("TILE_RENDER_CONCURRENCY", "4"),
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
