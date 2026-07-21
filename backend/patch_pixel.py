import sys

with open("api/pixel.py", "r") as f:
    content = f.read()

import re
pattern = re.compile(r'def _open_zarr_store\(.*?\n\s+ds\.close\(\)', re.DOTALL)

new_code = """def _extract_pixel_data(product: str, year: int, month: int, lon: float, lat: float, start: str, end: str):
    import zarr
    import pandas as pd
    import numpy as np

    store_url = f"{HF_BUCKET_URL}/geozarr/{product}/{year}/{year}-{month:02d}.zarr"
    try:
        store = zarr.storage.FsspecStore.from_url(store_url, storage_options={"ssl": False})
        arr_x = zarr.open_array(store=store, path="x", mode="r")
        arr_y = zarr.open_array(store=store, path="y", mode="r")
        arr_time = zarr.open_array(store=store, path="time", mode="r")
        arr_data = zarr.open_array(store=store, path=product, mode="r")
    except Exception:
        return [], None, None

    x_coords = arr_x[:]
    y_coords = arr_y[:]
    times = arr_time[:]

    x_laea, y_laea = transformer_to_laea.transform(lon, lat)

    x_min, x_max = float(x_coords.min()), float(x_coords.max())
    y_min, y_max = float(y_coords.min()), float(y_coords.max())

    if x_laea < x_min or x_laea > x_max or y_laea < y_min or y_laea > y_max:
        raise HTTPException(
            status_code=400,
            detail=f"Point ({lon}, {lat}) is outside the OPERA grid bounds.",
        )

    x_idx = int(np.abs(x_coords - x_laea).argmin())
    y_idx = int(np.abs(y_coords - y_laea).argmin())

    px_x = float(x_coords[x_idx])
    px_y = float(y_coords[y_idx])
    center_lon, center_lat = transformer_to_wgs84.transform(px_x, px_y)

    time_idx = pd.to_datetime(times, unit="s")
    start_dt = pd.Timestamp(start)
    end_dt = pd.Timestamp(end) + pd.Timedelta(days=1)

    mask = (time_idx >= start_dt) & (time_idx < end_dt)
    if not mask.any():
        return [], center_lon, center_lat

    start_idx = int(mask.argmax())
    end_idx = start_idx + int(mask.sum())
    filtered_times = time_idx[start_idx:end_idx]

    values = arr_data[start_idx:end_idx, y_idx, x_idx]

    results = []
    for i, t in enumerate(filtered_times):
        val = float(values[i]) if not np.isnan(values[i]) else None
        results.append(
            {
                "time": t.isoformat() + "Z",
                "value": val,
                "product": product,
            }
        )

    return results, center_lon, center_lat


@router.get("")
async def get_pixel_series(
    product: str = Query(..., description="Product: DBZH, RATE, or ACRR"),
    lon: float = Query(..., description="Longitude (WGS84)"),
    lat: float = Query(..., description="Latitude (WGS84)"),
    start: str = Query(..., description="Start date YYYY-MM-DD"),
    end: str = Query(..., description="End date YYYY-MM-DD"),
):
    valid_products = ["DBZH", "RATE", "ACRR"]
    if product.upper() not in valid_products:
        raise HTTPException(status_code=400, detail="Invalid product")

    if not (-180 <= lon <= 180) or not (-90 <= lat <= 90):
        raise HTTPException(status_code=400, detail="Coordinates out of range")

    # Parse dates
    try:
        start_parts = start.split("-")
        end_parts = end.split("-")
        start_year, start_month = int(start_parts[0]), int(start_parts[1])
        end_year, end_month = int(end_parts[0]), int(end_parts[1])
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="Invalid date format")

    # Enforce max 31 days
    from datetime import date

    d_start = date(start_year, start_month, int(start_parts[2]))
    d_end = date(end_year, end_month, int(end_parts[2]))
    if (d_end - d_start).days > 31:
        raise HTTPException(status_code=400, detail="Maximum period is 31 days")
    if d_end < d_start:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    # Collect months to query
    months_to_query = []
    y, m = start_year, start_month
    while (y, m) <= (end_year, end_month):
        months_to_query.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1

    results = []
    center_lon = None
    center_lat = None

    for year, month in months_to_query:
        res, c_lon, c_lat = _extract_pixel_data(product.upper(), year, month, lon, lat, start, end)
        if res:
            results.extend(res)
        if center_lon is None and c_lon is not None:
            center_lon = c_lon
            center_lat = c_lat"""

new_content = pattern.sub(new_code, content)
with open("api/pixel.py", "w") as f:
    f.write(new_content)
print("Patched!")
