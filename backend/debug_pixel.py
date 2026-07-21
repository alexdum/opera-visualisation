import sys
import traceback
import json

sys.path.insert(0, ".")
from api.pixel import _open_zarr_store, _resolve_pixel
import urllib.request
from fastapi.testclient import TestClient
from main import app

try:
    print("Direct import testing:")
    import xarray as xr
    import zarr
    store_url = "https://huggingface.co/buckets/alexdum/opera-radar/resolve/geozarr/DBZH/2026/2026-07.zarr"
    
    # Try using zarr directly first to see what's there
    print("\n--- Zarr API ---")
    group = zarr.open(store_url, mode='r')
    print("Group info:")
    print(group.info)
    print("Group keys:", list(group.keys()))
    
    print("\n--- Xarray API ---")
    ds = xr.open_zarr(
        store_url, 
        consolidated=False, 
        zarr_format=3, 
        storage_options={"ssl": False, "client_kwargs": {"trust_env": True}}
    )
    print("Dataset variables:", list(ds.variables))
    print(ds)
    
    # Test through FastAPI
    print("\nAPI Testing:")
    client = TestClient(app)
    response = client.get("/api/pixel?product=DBZH&lon=21.0144&lat=44.1901&start=2026-07-20&end=2026-07-20")
    print(f"Status: {response.status_code}")
    print(json.dumps(response.json(), indent=2))
except Exception as e:
    traceback.print_exc()
