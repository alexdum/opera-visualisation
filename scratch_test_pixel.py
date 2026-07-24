import time
import asyncio
from datetime import datetime, timezone, timedelta
import sys
import os

# Add the backend directory to sys.path
backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend')
sys.path.append(backend_dir)

from api.pixel import get_pixel_series

async def main():
    start_time = time.time()
    try:
        end_dt = datetime.now(timezone.utc)
        start_dt = end_dt - timedelta(days=1)
        end_time_str = end_dt.isoformat()
        start_time_str = start_dt.isoformat()
        
        print(f"Fetching DBZH pixel series from {start_time_str} to {end_time_str}...")
        result = await get_pixel_series(
            product="DBZH",
            lat=51.0,
            lon=10.0,
            start=start_time_str,
            end=end_time_str
        )
        duration = time.time() - start_time
        print(f"Success! Fetched {len(result.get('series', []))} frames in {duration:.2f} seconds")
    except Exception as e:
        duration = time.time() - start_time
        print(f"Error after {duration:.2f} seconds: {e}")

if __name__ == "__main__":
    asyncio.run(main())
