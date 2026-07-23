import rasterio
import numpy as np
import glob

files = glob.glob("hot-cog/RATE/2026/*/*/*.tif")
if files:
    f = sorted(files)[-1]
    print(f"Checking {f}")
    with rasterio.open(f) as src:
        data = src.read(1)
        nodata = src.nodata
        print(f"nodata value: {nodata}")
        print(f"data shape: {data.shape}")
        
        print(f"Total pixels: {data.size}")
        print(f"Nodata count (-9999000.0 or nan): {np.sum(np.isnan(data) | np.isclose(data, -9999000.0))}")
        print(f"Scanning range count (nan): {np.sum(np.isnan(data))}")
        print(f"Nodata count (-9999000.0): {np.sum(np.isclose(data, -9999000.0))}")
        
        print(f"Exact 0.0 count: {np.sum(np.isclose(data, 0.0))}")
        print(f"Values in (0.0, 0.1): {np.sum((data > 0.0) & (data < 0.1))}")
        print(f"Values in (0.1, 0.5): {np.sum((data >= 0.1) & (data < 0.5))}")
