#!/usr/bin/env bash
# Start the EuroMeteo backend with multiple Uvicorn workers for concurrent raster processing

# We use 3 independent workers to parallelize CPU-heavy tile generation
uvicorn main:app --port 7860 --workers 3
