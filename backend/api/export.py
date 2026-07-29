from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse, RedirectResponse
import asyncio
from starlette.concurrency import run_in_threadpool
import numpy as np
from rasterio.io import MemoryFile
import re

from api.catalog import resolve_catalog_frame, normalize_product
from api.tiles import _open_group as _open_geozarr, _geozarr_metadata, _frame_time_index
from api.bucket import object_url, resolve_path, USE_LOCAL_MOUNT

router = APIRouter()
EXPORT_SLOTS = asyncio.BoundedSemaphore(1)

@router.get("/geotiff")
async def export_geotiff(product: str, timestamp: str, revision: str):
    product = normalize_product(product)
    
    if not re.match(r"^\d{12}$", timestamp):
        raise HTTPException(status_code=422, detail="Invalid timestamp format")
        
    frame = resolve_catalog_frame(product, timestamp, revision)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame not found in catalog")
        
    filename = f"OPERA_{product}_{timestamp[:8]}T{timestamp[8:]}Z_rev{revision}.tif"
    
    if frame.hot_cog_ready and frame.hot_cog:
        if USE_LOCAL_MOUNT:
            local_path = resolve_path(frame.hot_cog)
            return FileResponse(
                path=local_path,
                media_type="application/geo+tiff",
                filename=filename,
            )
        
        return RedirectResponse(
            url=object_url(frame.hot_cog),
            status_code=302
        )
        
    if frame.archive_ready:
        try:
            async with asyncio.timeout(15):
                await EXPORT_SLOTS.acquire()
        except asyncio.TimeoutError:
            return Response(status_code=503, headers={"Retry-After": "15"})
            
        try:
            def generate_geotiff():
                group = _open_geozarr(frame.geozarr)
                metadata = _geozarr_metadata(frame.geozarr, frame.product)
                
                times = np.asarray(group["time"][:], dtype=np.int64) if "time" in group else metadata.get("times", np.array([], dtype=np.int64))
                time_index = _frame_time_index(times, frame)
                
                # read full extent
                slab = np.asarray(group[frame.product][time_index, :, :], dtype=np.float32)
                
                crs = metadata["crs"]
                transform = metadata["transform"]
                
                with MemoryFile() as memfile:
                    with memfile.open(
                        driver="GTiff",
                        height=slab.shape[0],
                        width=slab.shape[1],
                        count=1,
                        dtype=str(slab.dtype),
                        crs=crs,
                        transform=transform,
                        nodata=np.nan,
                        compress="deflate",
                    ) as dataset:
                        dataset.write(slab, 1)
                    memfile.seek(0)
                    return memfile.read()
                
            tiff_bytes = await run_in_threadpool(generate_geotiff)
            return Response(
                content=tiff_bytes,
                media_type="application/geo+tiff",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'}
            )
        finally:
            EXPORT_SLOTS.release()
            
    raise HTTPException(status_code=404, detail="Frame data not available")
