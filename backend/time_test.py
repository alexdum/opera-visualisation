import asyncio
import time
from datetime import datetime, timezone
import json
from api.pixel import extract_pixel_series
import logging

logging.basicConfig(level=logging.INFO)

async def run():
    print("Starting test...")
    start_dt = datetime.fromisoformat("2026-07-20T00:00:00Z")
    end_dt = datetime.fromisoformat("2026-07-21T00:00:00Z")
    
    t0 = time.time()
    try:
        # Note: BUCKET_MOUNT should be set for the container, but here we just test whatever mode is active.
        result = extract_pixel_series("DBZH", 10.0, 50.0, start_dt, end_dt)
        print(f"Data points extracted: {result['count']}")
    except Exception as e:
        print(f"Error: {e}")
    t1 = time.time()
    print(f"Total time: {t1-t0:.3f}s")

if __name__ == "__main__":
    asyncio.run(run())
