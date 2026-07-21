"""Shared Hugging Face Storage Bucket access configuration."""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

BUCKET_MOUNT = os.getenv("BUCKET_MOUNT", "").strip()
USE_LOCAL_MOUNT = bool(BUCKET_MOUNT) and os.path.isdir(BUCKET_MOUNT)

if USE_LOCAL_MOUNT:
    logger.info("Storage: LOCAL MOUNT at %s", BUCKET_MOUNT)
else:
    logger.info("Storage: HTTP (%s)", os.getenv("HF_BUCKET_URL", "default"))


HF_BUCKET_URL = os.getenv(
    "HF_BUCKET_URL",
    "https://huggingface.co/buckets/alexdum/opera-radar/resolve",
).rstrip("/")


def resolve_path(path: str) -> str:
    if USE_LOCAL_MOUNT:
        return os.path.join(BUCKET_MOUNT, path.lstrip('/'))
    return object_url(path)


def object_url(path: str) -> str:
    return f"{HF_BUCKET_URL}/{path.lstrip('/')}"


def auth_headers() -> dict[str, str]:
    """Return server-side auth without ever exposing it to API consumers."""

    token = os.getenv("HF_TOKEN", "").strip()
    return {"Authorization": f"Bearer {token}"} if token else {}


def fsspec_storage_options() -> dict[str, object]:
    headers = auth_headers()
    return {"headers": headers} if headers else {}
