---
title: OPERA Radar Visualization
emoji: 📡
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
---
# OPERA Radar Visualization


Read-only MapLibre visualization for the OPERA DBZH, RATE and ACRR products in
the public `alexdum/opera-radar` Hugging Face Storage Bucket.

The application uses the harvester catalogs as its visibility boundary:

- recent frames in Latest mode are rendered from the rolling COG cache;
- Historical mode always renders cataloged frames from permanent GeoZarr, including timestamps still inside the hot COG window;
- expired COGs fall back to permanent monthly GeoZarr;
- pixel series always come from GeoZarr and include observation status,
  quality, revision and interval bounds;
- DBZH quality masking is display-only and defaults to `min_quality=0.10`.

## Local development

The backend requires Python 3.12 because the pinned Zarr release does not
support Python 3.10 or 3.11.

### One-time setup

```bash
cd ~/Documents/clima/2026/opera-visualisation

python3.12 -m venv backend/venv
backend/venv/bin/pip install -r backend/requirements.txt
npm ci
```

Create a Hugging Face read-only user token for the `alexdum` account. The token
is used only by the local backend to read `alexdum/opera-radar`; do not place it
in the repository, frontend environment, URL, or a `NEXT_PUBLIC_*` variable.

### Stop existing local servers

Before restarting, stop only the processes listening on the frontend and
backend development ports:

```bash
for app_port in 3000 7860; do
  app_pids=$(lsof -tiTCP:$app_port -sTCP:LISTEN)
  [ -z "$app_pids" ] || kill $app_pids
done
```

Confirm that neither port still has a listener. Both commands should return no
output:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:7860 -sTCP:LISTEN
```

When a server is running normally in the foreground, `Ctrl+C` in its terminal
is the preferred way to stop it.

### Start the backend

In terminal 1:

```bash
cd ~/Documents/clima/2026/opera-visualisation/backend

read -s -p "HF read token: " HF_TOKEN
echo
export HF_TOKEN

venv/bin/uvicorn main:app \
  --host 127.0.0.1 \
  --port 7860 \
  --reload
```

Nothing is displayed while the token is pasted; press Enter and keep this
terminal running. Use a newly generated read-only token and revoke any token
that has been exposed in logs, source files, screenshots, or chat.

### Start the frontend

In terminal 2:

```bash
cd ~/Documents/clima/2026/opera-visualisation
npm run dev
```

Keep this terminal running as well.

### Verify and open the application

In terminal 3, or before leaving the startup terminals occupied:

```bash
curl -fsS http://127.0.0.1:7860/api/health
curl -I http://localhost:3000
```

The backend health request should return `{"status":"ok"}`, and the frontend
should return an HTTP success response. Open `http://localhost:3000`—not the
raw port-7860 API URL. Development browser requests are sent to FastAPI on port
7860. The production container serves the statically exported frontend and API
from one origin on port 7860.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `HF_BUCKET_URL` | Public `alexdum/opera-radar/resolve` URL | Read-only bucket base URL |
| `HF_TOKEN` | unset | Server-side read token; recommended to avoid anonymous resolver rate limits |
| `COG_CACHE_DIR` | `/tmp/opera-visualisation-cogs` | Ephemeral local hot-frame cache |
| `COG_CACHE_MAX_FILES` | `300` | Maximum cached COG frame count |
| `COG_CACHE_MAX_BYTES` | `3221225472` | Maximum local COG cache size (3 GiB) |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated development origins; production is same-origin |
| `TILE_RENDER_CONCURRENCY` | `4` | Maximum concurrent raster render operations |
| `TILE_RENDER_QUEUE_TIMEOUT_SECONDS` | `30` | Maximum time a tile waits for a bounded renderer slot before returning 503 |
| `GDAL_CACHEMAX` | `256` | Shared GDAL raster block cache, in MiB |
| `GDAL_NUM_THREADS` | `1` | GDAL workers per render; total potential workers are this value × render concurrency |
| `COG_READER_POOL_SIZE` | `8` | Maximum idle, reusable COG readers per backend process |
| `COG_IO_DIAGNOSTICS` | `false` | Log COG path, render time, reader-pool hit, file size, and Linux mount type |
| `PIXEL_METADATA_CACHE_SECONDS` | `30` | Refresh interval for growing GeoZarr group and time metadata |
| `PIXEL_RESPONSE_CACHE_SECONDS` | `300` | Lifetime of server-side pixel-series results |
| `PIXEL_RESPONSE_CACHE_ENTRIES` | `128` | Maximum cached pixel-series results per backend process |
| `NEXT_PUBLIC_API_BASE_URL` | Port 7860 in development; same-origin in production | Optional public API origin override |

A public bucket can be read anonymously, but a server-side read-only
`HF_TOKEN` is recommended because map rendering can otherwise exhaust the
anonymous resolver rate limit. Add it as a backend/Space secret and never
expose it through `NEXT_PUBLIC_*` variables or frontend responses.

The production image defaults to four concurrent renders with one GDAL worker
per render. Increase `GDAL_NUM_THREADS` only together with a reduction in
`TILE_RENDER_CONCURRENCY`, and benchmark both cold and warm reads. For example,
`2 × 2` keeps the same upper bound of four active GDAL workers. Set
`COG_IO_DIAGNOSTICS=true` temporarily to distinguish reader reuse and compare
first-read versus repeated-read latency. These logs identify the filesystem
driver behind `/data/opera-radar`, but object-store GET/cache-hit counts must be
obtained from the mount daemon or storage provider because POSIX file reads do
not expose that information to this application.

## API contract

```text
GET /api/catalog/latest?product=DBZH&hours=24
GET /api/catalog/day?product=RATE&date=2026-07-21
GET /tiles/{product}/{YYYYMMDDHHMM}/{revision}/{z}/{x}/{y}.webp?min_quality=0.10
GET /api/pixel?product=ACRR&lon=26.1&lat=44.4&start=2026-07-01&end=2026-07-21
GET /api/pixel/csv?...same query...
```

The visualization's Export button generates this CSV directly from the pixel
series already cached in the browser, avoiding a second GeoZarr extraction.
The `/api/pixel/csv` endpoint remains available for API clients.

`min_quality=off` selects the authoritative raw DBZH composite. RATE and ACRR
do not receive an automatic DBZH quality threshold.

## Verification

```bash
npm test
npm run typecheck
npm run lint
npm run build

cd backend
venv/bin/python -m pytest -q
```

Build the deployment image with:

```bash
docker build -t opera-visualisation .
docker run --rm -p 7860:7860 opera-visualisation
curl -fsS http://127.0.0.1:7860/api/health
```
