import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import numpy as np
from rasterio.transform import Affine

from main import app
from api.catalog import CatalogFrame
from api.bucket import USE_LOCAL_MOUNT

client = TestClient(app)

@patch("api.export.resolve_catalog_frame")
@patch("api.export.object_url")
def test_export_cog_frame(mock_object_url, mock_resolve_catalog_frame):
    mock_resolve_catalog_frame.return_value = CatalogFrame(
        product="DBZH",
        timestamp="202607291000",
        nominal_time="2026-07-29T10:00:00Z",
        revision="1234",
        archive_ready=False,
        hot_cog_ready=True,
        hot_cog="cogs/test.tif",
        geozarr="test.zarr",
        backend="cog"
    )
    mock_object_url.return_value = "http://bucket/cogs/test.tif"

    response = client.get("/api/export/geotiff?product=DBZH&timestamp=202607291000&revision=1234", follow_redirects=False)
    
    if USE_LOCAL_MOUNT:
        # If running in local mount mode, it expects the file to exist
        pass
    else:
        assert response.status_code == 302
        assert response.headers["location"] == "http://bucket/cogs/test.tif"

def test_export_invalid_product():
    response = client.get("/api/export/geotiff?product=INVALID&timestamp=202607291000&revision=1234", follow_redirects=False)
    assert response.status_code == 400

def test_export_invalid_timestamp():
    response = client.get("/api/export/geotiff?product=DBZH&timestamp=2026-07-29&revision=1234", follow_redirects=False)
    assert response.status_code == 422

@patch("api.export.resolve_catalog_frame")
def test_export_not_found(mock_resolve_catalog_frame):
    mock_resolve_catalog_frame.return_value = None
    response = client.get("/api/export/geotiff?product=DBZH&timestamp=202607291000&revision=1234", follow_redirects=False)
    assert response.status_code == 404

@patch("api.export.resolve_catalog_frame")
@patch("api.export._open_geozarr")
@patch("api.export._geozarr_metadata")
@patch("api.export._frame_time_index")
def test_export_geozarr_frame(
    mock_frame_time_index, mock_geozarr_metadata, mock_open_geozarr, mock_resolve_catalog_frame
):
    mock_resolve_catalog_frame.return_value = CatalogFrame(
        product="DBZH",
        timestamp="202607291000",
        nominal_time="2026-07-29T10:00:00Z",
        revision="1234",
        archive_ready=True,
        hot_cog_ready=False,
        geozarr="test.zarr",
        backend="geozarr"
    )
    
    # Mocking group and metadata
    mock_group = MagicMock()
    mock_group.__contains__.return_value = True
    mock_group.__getitem__.side_effect = lambda k: np.zeros((1, 10, 10)) if k == "DBZH" else np.array([0])
    mock_open_geozarr.return_value = mock_group
    
    mock_geozarr_metadata.return_value = {
        "times": np.array([0]),
        "crs": "EPSG:4326",
        "transform": Affine(1, 0, 0, 0, -1, 0)
    }
    mock_frame_time_index.return_value = 0
    
    response = client.get("/api/export/geotiff?product=DBZH&timestamp=202607291000&revision=1234", follow_redirects=False)
    
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/geo+tiff"
    assert 'filename="OPERA_DBZH_20260729T1000Z_rev1234.tif"' in response.headers["content-disposition"]
