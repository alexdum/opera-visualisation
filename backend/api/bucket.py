"""Shared Hugging Face Storage Bucket access configuration."""

from __future__ import annotations

import os


HF_BUCKET_URL = os.getenv(
    "HF_BUCKET_URL",
    "https://huggingface.co/buckets/alexdum/opera-radar/resolve",
).rstrip("/")


def object_url(path: str) -> str:
    return f"{HF_BUCKET_URL}/{path.lstrip('/')}"


def auth_headers() -> dict[str, str]:
    """Return server-side auth without ever exposing it to API consumers."""

    token = os.getenv("HF_TOKEN", "").strip()
    return {"Authorization": f"Bearer {token}"} if token else {}


def fsspec_storage_options() -> dict[str, object]:
    headers = auth_headers()
    return {"headers": headers} if headers else {}
