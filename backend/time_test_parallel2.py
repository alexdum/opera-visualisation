import time
import zarr
import numpy as np
from concurrent.futures import ThreadPoolExecutor

store_path = "https://huggingface.co/buckets/alexdum/opera-radar/resolve/zarr/2026/07/2026-07.zarr"
group = zarr.open_group(store_path, mode="r")
array = group["DBZH"]

time_slice = slice(0, 24) # 24 frames
y_index, x_index = 500, 500

t0 = time.time()
res_seq = array[time_slice, y_index, x_index]
t1 = time.time()
print(f"Sequential read (24 steps): {t1-t0:.3f}s")

t2 = time.time()
def read_one(t):
    return array[t, y_index, x_index]

with ThreadPoolExecutor(max_workers=8) as executor:
    res_par = list(executor.map(read_one, range(24)))
res_par = np.array(res_par)
t3 = time.time()
print(f"Parallel read (24 steps, 8 workers): {t3-t2:.3f}s")
