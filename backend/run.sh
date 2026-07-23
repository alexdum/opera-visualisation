#!/usr/bin/env bash
# Start the EuroMeteo backend with Uvicorn.
# We use a single worker because the 3 GiB compressed-response cache is
# per-process (3 workers = 9 GiB) and the machine has only 2 CPUs.
# Concurrency is managed by the RENDER_SLOTS semaphore (default=2).
uvicorn main:app --port 7860 --workers 1
