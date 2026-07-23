from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import logging
import os
import uvicorn
from fastapi.staticfiles import StaticFiles

from api.catalog import router as catalog_router
from api.tiles import router as tiles_router
from api.pixel import router as pixel_router
from api.bucket import BUCKET_MOUNT, USE_LOCAL_MOUNT, storage_description
from api.raster_runtime import log_raster_runtime


startup_logger = logging.getLogger("uvicorn.error")


class RedactAccessQueryFilter(logging.Filter):
    """Remove complete query strings from Uvicorn access-log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and len(record.args) >= 3:
            request_target = record.args[2]
            if isinstance(request_target, str) and "?" in request_target:
                path, _, _query = request_target.partition("?")
                args = list(record.args)
                args[2] = f"{path}?query=REDACTED"
                record.args = tuple(args)
        return True


def _install_access_log_redaction() -> None:
    access_logger = logging.getLogger("uvicorn.access")
    if not any(
        isinstance(log_filter, RedactAccessQueryFilter)
        for log_filter in access_logger.filters
    ):
        access_logger.addFilter(RedactAccessQueryFilter())


_install_access_log_redaction()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # uvicorn.run() can configure logging after this module is imported.
    _install_access_log_redaction()
    startup_logger.info("OPERA data storage source: %s", storage_description())
    log_raster_runtime(BUCKET_MOUNT if USE_LOCAL_MOUNT else None)
    yield


app = FastAPI(title="OPERA Radar API", lifespan=lifespan)

allowed_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
if allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Accept", "Content-Type"],
    )



@app.get("/api/health")
async def health():
    storage = f"local:{BUCKET_MOUNT}" if USE_LOCAL_MOUNT else "http"
    return {"status": "ok", "storage": storage}

app.include_router(catalog_router, prefix="/api/catalog")
app.include_router(tiles_router, prefix="/tiles")
app.include_router(pixel_router, prefix="/api/pixel")

# Serve Next.js frontend
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "out")
if os.path.isdir(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=7860, reload=True)
