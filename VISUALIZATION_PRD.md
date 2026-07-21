# OPERA Radar Visualization — Product Requirements Document

**Target repository:** `alexdum/opera-radar-visualization`  
**Target deployment:** Hugging Face Space `alexdum/opera-radar-visualization`  
**Data source:** Hugging Face Storage Bucket `alexdum/opera-radar`  
**Layout reference:** `clima/2026/eurometeo`  
**Document status:** Proposed for implementation  
**Version:** 1.0  
**Date:** 2026-07-20

## 1. Summary

Build a public, read-only European weather-radar visualization application for
the OPERA DBZH, RATE, and ACRR products harvested into
`alexdum/opera-radar`.

The application will reuse the visual language and interaction model of
`eurometeo`: a responsive glass sidebar, a compact top navigation bar, a
MapLibre map, floating legends and controls, and dashboard-style chart cards.
It will add a radar timeline, animation controls, hot/cold storage routing, and
pixel time-series analysis.

```text
Browser
   │
   ├── catalog, frame and pixel requests
   └── revision-keyed Web Mercator tiles
             │
             ▼
OPERA visualization Space — read only
   ├── Eurometeo-derived React/Next.js interface
   ├── catalog and query API
   ├── COG/GeoZarr tile router
   └── bounded disposable cache
             │
             ▼
alexdum/opera-radar Storage Bucket
   ├── rolling 26-hour COG cache
   ├── permanent monthly GeoZarr
   └── latest and daily catalogs
```

The visualization Space must never ingest, modify, repair, or delete radar
data. The OPERA harvester remains the sole bucket writer.

## 2. Background

The OPERA harvester publishes three radar products:

| Product | Meaning | Unit | Time semantics |
|---|---|---|---|
| DBZH | Horizontal radar reflectivity | dBZ | Composite observation with source bounds |
| RATE | Instantaneous precipitation rate | mm/h | Composite observation with source bounds |
| ACRR | One-hour accumulated precipitation | mm | Interval value; exact start and end bounds are required |

Recent source COGs provide efficient map access. Permanent monthly GeoZarr
stores provide the authoritative measurement, quality, observation status,
coordinates, projection, and time history.

The app can be implemented while the harvester completes its production soak.
The app must treat published catalogs, not bucket directory listings, as the
authority for visible frames.

## 3. Goals

### 3.1 Primary goals

- Display the latest OPERA radar frame on a Europe-wide interactive map.
- Animate the most recent 24 hours with play, pause, speed, step, and scrub
  controls.
- Let users select DBZH, RATE, or ACRR without changing the basic workflow.
- Render recent frames from COGs and transparently fall back to GeoZarr.
- Allow selection of older dates and frames from the permanent archive.
- On map click, show the exact pixel value, quality, observation state, and
  coordinates.
- Plot an exact pixel time series across one or more monthly GeoZarr stores.
- Preserve the distinction between detected, undetect, and nodata pixels.
- Present ACRR as an interval accumulation rather than an instantaneous value.
- Match the responsive layout and design quality of `eurometeo`.

### 3.2 Success outcomes

- A first-time user can reach the latest radar map without configuration.
- Recent animation starts within three seconds on a warm application.
- Cached recent tiles have a provisional p95 response below 500 ms.
- A one-month exact pixel series has a provisional p95 response below two
  seconds on the selected production Space tier.
- Recent and historical frames use one stable tile URL and visual behavior.
- Corrected source revisions never reuse stale rendered tiles.
- The application works on desktop, tablet, and mobile layouts.

## 4. Non-goals

- Radar ingestion, source reconciliation, or bucket mutation.
- Editing or republishing OPERA observations.
- Meteorological nowcasting or precipitation forecasts.
- Storm-cell detection, tracking, or warning generation in v1.
- Mosaicking non-OPERA radar sources.
- Reprojecting or duplicating the permanent GeoZarr archive.
- Treating quality data as a destructive filter without explicit user choice.
- Offering arbitrary user-supplied COG, Zarr, or URL access.
- Replacing the harvester operations dashboard.

## 5. Users and user stories

### 5.1 General weather user

- As a user, I want to see the latest radar image so I can understand current
  precipitation conditions.
- As a user, I want to animate recent frames so I can see storm movement.
- As a user, I want a clear legend and timestamp so I can interpret the map.

### 5.2 Scientific and technical user

- As an analyst, I want to select a location and retrieve its exact radar time
  series.
- As an analyst, I want measurement, quality, and observation status shown
  separately.
- As an analyst, I want exported values to retain UTC timestamps, units, and
  ACRR interval bounds.

### 5.3 Mobile user

- As a mobile user, I want map controls and the timeline to remain usable
  without permanent screen obstruction.
- As a mobile user, I want the sidebar to become an accessible drawer.

### 5.4 Visualization operator

- As an operator, I want health, cache, latency, and upstream-freshness metrics
  so I can distinguish rendering problems from harvester or source delay.

## 6. Experience and layout requirements

### 6.1 Eurometeo visual foundation

Reuse these established patterns from `eurometeo`:

- React and Next.js application structure.
- MapLibre GL map rendering.
- Fixed 280 px desktop sidebar with translucent glass treatment.
- Mobile menu button, slide-in sidebar, and backdrop.
- 70 px translucent top navigation bar.
- Slate background and typography with blue primary actions.
- Rounded cards, subtle borders, restrained shadows, and compact controls.
- Lucide icons.
- Floating MapLibre navigation, attribution, legend, and status controls.
- Cached or persistently mounted primary views where this avoids expensive map
  remounts.
- Accessible tooltips, dialogs, keyboard focus, and 44 px minimum touch targets.

The new app may reuse layout code and style tokens, but station-specific data,
controls, and terminology must not be copied into the radar experience.

### 6.2 Desktop shell

```text
┌────────────── 280 px sidebar ─────────────┬──────── top navigation ────────┐
│ OPERA Radar                              │ Map │ Pixel analysis │ About   │
│                                          ├────────────────────────────────┤
│ Product                                  │                                │
│  [DBZH] [RATE] [ACRR]                    │                                │
│                                          │          MapLibre map          │
│ Time range / date                        │                                │
│ Quality and opacity                      │                     Legend     │
│ Basemap and labels                       │                                │
│                                          ├────────────────────────────────┤
│ Current-frame status                     │ Play  ◀  timeline slider  ▶    │
└──────────────────────────────────────────┴────────────────────────────────┘
```

### 6.3 Sidebar

The sidebar contains:

1. Product selector: DBZH, RATE, ACRR.
2. View mode: latest 24 hours or historical date range.
3. UTC date and time controls.
4. Animation length: 1, 3, 6, 12, or 24 hours.
5. Layer opacity.
6. Quality overlay toggle and optional quality threshold.
7. Observation-state controls for detected, undetect, and nodata.
8. Basemap selector and labels toggle.
9. Current frame card with product, nominal time, interval, revision, backend,
   and freshness.

Controls that do not apply to the selected product must be hidden or disabled
with an explanation. ACRR must show its accumulation interval prominently.

### 6.4 Top navigation

The top navigation contains three views:

- **Map:** full radar map and animation.
- **Pixel analysis:** selected-location chart, summary, quality, status, and
  export controls.
- **About:** product definitions, data source, attribution, limitations, and
  current service status.

The map must stay mounted when switching views so map position and loaded tiles
are preserved.

### 6.5 Map view

The map view must provide:

- Latest complete frame by default.
- Smooth pan and zoom across the OPERA coverage.
- Product-specific color legend with units.
- Frame timestamp and, for interval products, start/end times.
- Adjustable radar opacity.
- Optional quality layer or quality mask.
- Click-to-inspect cursor mode.
- A visible degraded/fallback indicator when GeoZarr is used instead of COG.
- Fullscreen control.
- Loading, no-data, upstream-stale, and tile-error states.

Nodata is transparent. Undetect is visually distinct from nodata and must not
be rendered as measured zero precipitation unless the legend explicitly states
that convention.

### 6.6 Timeline and animation

The bottom timeline contains:

- Play/pause.
- Previous and next frame.
- Draggable timestamp slider.
- Playback speeds of 0.5×, 1×, 2×, and 4×.
- Loop toggle.
- Current frame position and UTC timestamp.
- Missing-frame markers.
- Optional dwell on the newest frame.

Animation must preload only a bounded number of adjacent frames. It must stop
when the tab is hidden and honor `prefers-reduced-motion`. A user-visible pause
control is mandatory.

### 6.7 Pixel analysis

Clicking the map selects a WGS84 longitude/latitude and opens a compact summary.
The Pixel analysis view then provides:

- Selected longitude/latitude and native grid indices.
- Measurement value and unit.
- Detected, undetect, or nodata state.
- Quality value(s) and source task names.
- Product-specific start and end time.
- Line or step chart for a selected period.
- Quality chart or optional secondary axis.
- Missing-state markers rather than interpolated values.
- CSV and JSON export.
- Copyable, shareable URL containing product, location, period, and frame.

For DBZH and RATE, use a line chart. For ACRR, use an interval-aware bar or step
chart and include `start_time` and `end_time` in tooltips and exports.

### 6.8 Responsive behavior

- At widths below the desktop breakpoint, the sidebar becomes a drawer.
- The timeline becomes a two-row control with large touch targets.
- Legends may collapse into an expandable button.
- Pixel charts use full-width cards and avoid horizontal page scrolling.
- Hover-only interactions must have click, focus, or touch equivalents.

## 7. Data contract

### 7.1 Bucket

```text
hf://buckets/alexdum/opera-radar
```

The visualization service has read-only access. A public deployment should not
require an HF token. If the bucket later becomes private, use a read-only Space
secret and never expose it to the browser.

### 7.2 Authoritative paths

```text
catalog/latest.json
catalog/YYYY/MM/YYYY-MM-DD.json
geozarr/{PRODUCT}/{YYYY}/{YYYY-MM}.zarr
hot-cog/{PRODUCT}/{YYYY}/{MM}/{DD}/{HHMM}.tif
```

The app must not infer available frames from object listing. A frame is visible
only when its daily catalog entry has `archive_ready: true`.

### 7.3 Catalog behavior

- Support catalog `schema_version: 1`.
- Reject unknown major schema versions with a clear service error.
- Ignore unknown additive fields.
- Use `latest.json` for low-cost startup discovery.
- Use daily catalogs for timeline construction.
- Include `revision` in all frame, tile, and client-cache identities.
- Never use an earlier COG with a corrected catalog revision.
- Treat `hot_cog_ready` as the COG-routing authority.

### 7.4 GeoZarr behavior

- Monthly store per product.
- Native OPERA Lambert azimuthal equal-area grid is retained.
- Measurement variable is named after the product.
- Status variable is `{PRODUCT}_status`.
- All quality variables listed by the catalog must be discoverable.
- `time_bnds` is required for ACRR and used when present for other products.
- Status codes retain detected, undetect, and nodata semantics.

## 8. Service architecture

### 8.1 Repository and deployment

- GitHub repository `alexdum/opera-radar-visualization` is authoritative.
- Pull requests run linting, tests, a production build, secret scanning, and a
  container smoke test.
- Successful pushes to `main` deploy one-way to the HF Space.
- Do not edit application code directly in the Space repository.
- The runtime reports source repository, Git SHA, and build timestamp.

### 8.2 Recommended v1 runtime

Use one Docker Space with:

- A statically built React/Next.js interface derived from `eurometeo`.
- A same-origin Python FastAPI service on port 7860.
- Server-side COG tile reading and GeoZarr fallback.
- Server-side pixel-series extraction.
- A bounded local tile and metadata cache.

The Next.js build must not depend on server-only Next API routes in this model;
the FastAPI service owns `/api/*` and `/tiles/*` and serves the static frontend.
This keeps one public origin and one Space while allowing mature Python
geospatial readers.

Phase 0 must compare this design with a two-service alternative consisting of a
Next.js UI Space and a separate tile/query API Space. Choose the two-service
model only if independent scaling or the Next.js runtime is materially better
than the operational simplicity of one Space.

### 8.3 Tile routing

Expose one stable endpoint:

```text
GET /tiles/{product}/{timestamp}/{revision}/{z}/{x}/{y}.webp
```

Routing rules:

1. Validate product, timestamp, revision, zoom, and tile coordinates.
2. Read the matching catalog frame.
3. If `hot_cog_ready` is true and the revision matches, render from COG.
4. Otherwise read the matching GeoZarr time slot and spatial window.
5. Reproject only the requested tile to Web Mercator.
6. Apply the product color map and observation-state transparency.
7. Return a revision-keyed cached WebP tile.

The service must never reproject a complete monthly store or full archive in
response to one request.

### 8.4 COG access

The Phase 0 spike must verify that the production reader performs efficient
range reads against the HF bucket/CDN. If the chosen library or bucket URL
causes full-object downloads, add a bounded on-Space COG cache or change the
read path before production. A browser must not download complete COGs merely
to display ordinary map tiles.

### 8.5 GeoZarr tile access

- Open the monthly store with consolidated metadata disabled unless the
  harvester later publishes validated consolidated metadata.
- Cache root and array metadata separately from pixel chunks.
- Resolve the exact time index from the catalog timestamp.
- Compute the native-grid window intersecting the requested Web Mercator tile.
- Fetch only required chunks or shards.
- Reproject and colorize only the requested output tile.
- Cap concurrent remote reads and memory per request.

### 8.6 Pixel coordinate mapping

1. Receive WGS84 longitude and latitude.
2. Validate that the point is finite and geographically plausible.
3. Transform WGS84 to the native OPERA CRS using the store grid mapping.
4. Resolve the nearest containing pixel from the `x` and `y` coordinates.
5. Return grid indices and pixel-center coordinates.
6. Reject points outside the OPERA grid without clamping them to an edge.

### 8.7 Pixel time-series access

- Group the requested interval by calendar month.
- Open only required product stores.
- Read the selected pixel across catalog-published timestamps.
- Return measurement, status, quality, nominal time, start time, end time, and
  revision.
- Do not return unpublished Zarr slots.
- Do not interpolate missing frames.
- Enforce an initial maximum request period of 31 days.
- Decide from benchmarks whether longer ranges need hourly/daily aggregates.

### 8.8 Caching

| Cache | Key | Initial policy |
|---|---|---|
| Latest catalog | Catalog URL/schema | Revalidate every 30 seconds |
| Daily catalog | Date plus schema version | Five minutes for current day; one hour for completed days |
| Rendered tile | Product/time/revision/z/x/y/style | Immutable for revision; bounded local LRU |
| Pixel series | Product/grid cell/start/end/catalog revision | Five minutes, bounded LRU |
| Zarr metadata | Product/month/store identity | One hour with explicit invalidation on open failure |

Cache limits must be configurable and local caches must remain disposable.
Corrections are isolated by revision-keyed URLs.

## 9. API contract

### 9.1 Public endpoints

```text
GET /api/health
GET /api/catalog/latest
GET /api/catalog/day?date=YYYY-MM-DD
GET /api/frames?product=DBZH&start=...&end=...
GET /api/frame/{product}/{timestamp}/{revision}
GET /api/pixel?product=DBZH&lon=...&lat=...&start=...&end=...
GET /tiles/{product}/{timestamp}/{revision}/{z}/{x}/{y}.webp
```

Optional later endpoints:

```text
GET /api/pixel.csv?...same query...
GET /api/legend/{product}.json
GET /metrics
```

### 9.2 Error model

Use structured errors:

```json
{
  "error": {
    "code": "FRAME_NOT_PUBLISHED",
    "message": "The requested frame is not present in the published catalog.",
    "request_id": "..."
  }
}
```

Required error classes include invalid input, unsupported schema, unpublished
frame, unavailable source object, tile render failure, point outside coverage,
period too long, upstream timeout, and rate limit.

## 10. Product rendering requirements

### 10.1 Color maps

- Define versioned, product-specific color maps.
- Include units and labeled thresholds.
- Never silently change a color map without changing its style version.
- Use a scientifically reviewed DBZH scale.
- Use perceptually ordered RATE and ACRR precipitation scales.
- Make nodata transparent and undetect explicit.
- Ensure legends remain interpretable for common color-vision deficiencies.

Final palettes require meteorological review and visual regression snapshots.

### 10.2 Quality

- Quality is visible in pixel inspection by default.
- A quality overlay may be enabled independently from the measurement layer.
- Quality thresholds are user-selected display filters, not data deletion.
- Unknown future quality variables are listed by task metadata instead of
  crashing the interface.

### 10.3 Corrections

If OPERA republishes a corrected revision:

- The timeline points to the new revision.
- The new tile URL has a different revision component.
- Old cached tiles remain harmless and unreachable from the current catalog.
- Share links containing an old revision return an explicit superseded status
  or render that revision only if it remains safely addressable.

## 11. Configuration

Initial runtime variables:

```text
HF_BUCKET=alexdum/opera-radar
HF_TOKEN=<optional read-only secret for a private bucket>
SUPPORTED_PRODUCTS=DBZH,RATE,ACRR
CATALOG_REFRESH_SECONDS=30
MAX_PIXEL_SERIES_DAYS=31
MAX_TILE_CONCURRENCY=<measured value>
TILE_CACHE_MAX_BYTES=<measured value>
TILE_CACHE_TTL_SECONDS=86400
METADATA_CACHE_TTL_SECONDS=3600
LOG_LEVEL=INFO
```

Validate configuration at startup. Never expose token values through public
configuration, page source, logs, status responses, or client bundles.

## 12. Security and privacy

- Visualization is read-only.
- Never provide bucket write credentials to the Space or browser.
- Allowlist only the configured HF bucket and required basemap hosts.
- Do not accept arbitrary upstream URLs, paths, bucket IDs, variable names, or
  Zarr group names from users.
- Validate product enum, ISO timestamp, revision syntax, tile bounds, zoom,
  coordinate ranges, and period length.
- Prevent path traversal and unsafe local cache keys.
- Apply request timeouts, bounded concurrency, response-size limits, and rate
  limits to expensive endpoints.
- Use a restrictive Content Security Policy compatible with HF embedding,
  MapLibre workers, the selected basemap, and same-origin APIs.
- Do not log full IP addresses or introduce user tracking in v1.
- Redact secrets and signed URLs from errors.
- Run dependency and secret scans in CI.

## 13. Accessibility

- Target WCAG 2.2 AA for application controls and content.
- Provide a skip link and semantic header, navigation, aside, main, and footer.
- All controls are keyboard-operable with visible focus.
- Animation has an obvious pause control and honors reduced-motion settings.
- Color is not the only representation of state.
- Legends include text labels and units.
- Map selection results are announced through an accessible status region.
- Charts include concise summaries and downloadable tabular data.
- Dialog focus is trapped and restored correctly.
- Touch targets are at least 44 by 44 CSS pixels.

## 14. Observability

### 14.1 Health response

`/api/health` exposes:

- Status and build SHA.
- Catalog reachability and age.
- Latest timestamp by product.
- Cache size and hit ratio.
- Tile and pixel-query error counts.
- Backend routing counts for COG and GeoZarr.
- No credentials or sensitive URLs.

### 14.2 Metrics

Track at least:

```text
visualization_requests_total{route,status}
visualization_tile_latency_seconds{backend,product}
visualization_tile_cache_hits_total{product}
visualization_tile_cache_misses_total{product}
visualization_pixel_latency_seconds{product}
visualization_backend_failures_total{backend,product}
visualization_catalog_age_seconds{product}
visualization_active_tile_requests
```

### 14.3 Alerts

- Catalog unavailable or unsupported.
- Product freshness exceeds twice its expected cadence after accounting for
  source delay.
- Tile error rate exceeds five percent over ten minutes.
- Pixel-query p95 exceeds the agreed production target.
- Cache storage exceeds 80 percent of its configured maximum.
- Repeated COG-to-GeoZarr fallback caused by missing recent COGs.

## 15. Performance and capacity requirements

| Operation | Provisional target |
|---|---|
| Cached recent tile | p95 below 500 ms |
| Uncached recent COG tile | Measure p50/p95 in Phase 0 |
| Uncached historical GeoZarr tile | Measure and set target in Phase 0 |
| Latest catalog load | p95 below 300 ms |
| One-month exact pixel series | p95 below 2 seconds |
| Warm recent animation startup | below 3 seconds |
| Adjacent animation frames | No unbounded prefetch; visible transition without UI blocking |

The Phase 0 spike must record remote requests, bytes transferred, peak RSS,
CPU time, and cache behavior for all three products. If targets are missed,
record a decision on chunks, aggregates, cache policy, pre-generation, or Space
sizing rather than weakening the target silently.

## 16. Reliability requirements

- The app remains usable when one product is stale or unavailable.
- COG failure falls back to GeoZarr without changing the public tile URL.
- Catalog failure serves a bounded stale cache with a visible warning; it must
  not invent new timestamps.
- A failed tile does not stop animation or other requests.
- All remote reads have timeouts and bounded retries with jitter.
- Requests are cancelable when users scrub quickly or change product.
- Client prefetch is bounded and old requests are aborted.
- Local cache loss after Space restart affects performance only.
- The application never exposes a GeoZarr slot absent from the daily catalog.

## 17. Testing and verification

### 17.1 Unit tests

- Catalog schema parsing and unsupported-version rejection.
- Frame ordering, deduplication, and correction handling.
- Hot/cold routing decisions.
- Product/time/revision URL validation.
- WGS84-to-native-grid mapping and boundary rejection.
- Status-code interpretation.
- ACRR interval handling.
- Cache-key construction and traversal protection.

### 17.2 Data integration tests

- Render one recent COG tile for each product.
- Render the same geographic tile from GeoZarr.
- Compare COG and GeoZarr rendering within defined tolerances.
- Verify nodata, undetect, and detected samples.
- Query exact pixels across a month boundary.
- Verify every quality variable returned matches its GeoZarr source.
- Verify a corrected revision produces a different tile cache identity.
- Verify an unpublished Zarr tail is never queryable.

### 17.3 UI tests

- Latest map loads on desktop and mobile.
- Product selection updates layer, legend, timestamp, and units.
- Play, pause, step, scrub, speed, and loop controls work.
- Reduced-motion behavior disables automatic animation.
- Sidebar drawer and backdrop work on mobile.
- Map click opens pixel analysis at the correct coordinates.
- Charts show missing and observation states correctly.
- Keyboard navigation and focus behavior pass automated and manual checks.
- Share URLs restore the selected view.

### 17.4 End-to-end acceptance tests

- Recent tile router selects COG.
- Old frame router selects GeoZarr.
- Missing recent COG falls back to GeoZarr.
- Recent 24-hour animation plays across missing frames.
- Pixel graph returns measurement, quality, and state matching source data.
- ACRR chart and export include exact accumulation bounds.
- Space restart retains correctness with an empty local cache.
- Application remains read-only under all tested endpoints.

## 18. Delivery phases

### 18.1 Phase 0 — Contract and rendering spike

- Create the separate repository and Docker Space foundation.
- Copy only reusable `eurometeo` shell, map, theme, tooltip, and modal patterns.
- Fetch and validate `latest.json` and one daily catalog.
- Render representative DBZH, RATE, and ACRR COG tiles.
- Render matching tiles from GeoZarr.
- Benchmark HF bucket/CDN range reads.
- Benchmark a one-month pixel query.
- Choose single-Space versus two-service architecture.
- Record color-map candidates and scientific review owner.

**Exit:** one tile and one pixel query for every product match authoritative
source values, with measured latency and memory.

### 18.2 Phase 1 — DBZH recent map

- Implement the Eurometeo-derived responsive shell.
- Implement catalog proxy and validation.
- Implement DBZH recent COG tiles.
- Add DBZH legend, opacity, timestamp, and latest-frame status.
- Add product-safe tile caching.
- Deploy the first read-only Space.

**Exit:** latest DBZH renders correctly on desktop and mobile.

### 18.3 Phase 2 — Timeline and animation

- Build the recent 24-hour timeline from daily catalogs.
- Add playback, pause, step, scrub, speed, loop, and bounded prefetch.
- Add missing-frame and stale-source states.
- Add shareable map URLs.

**Exit:** the recent DBZH animation is responsive and remains bounded during a
two-hour browser soak.

### 18.4 Phase 3 — Historical fallback and pixel analysis

- Implement GeoZarr tile fallback.
- Implement WGS84-to-grid mapping.
- Implement exact pixel-series endpoint and chart.
- Add status and quality display.
- Add CSV and JSON export.
- Validate month-boundary queries.

**Exit:** an old frame and a one-month pixel graph work without direct browser
access to full source objects.

### 18.5 Phase 4 — RATE, ACRR, and complete quality

- Add RATE and ACRR product controls and color maps.
- Add ACRR interval-aware timeline, tooltips, chart, and export.
- Display arbitrary quality variables safely.
- Add product-specific performance and visual tests.

**Exit:** all three products pass functional, scientific, and responsive UI
tests.

### 18.6 Phase 5 — Production hardening

- Complete accessibility and security reviews.
- Configure metrics and alert delivery.
- Validate caches and rate limits under load.
- Run a 48-hour visualization soak across a UTC midnight and Space restart.
- Document operational runbooks and ownership.
- Record final capacity and cost estimates.

**Exit:** recent animation, historical fallback, and pixel analysis meet the
production acceptance criteria.

## 19. Risks and mitigations

| Risk | Mitigation |
|---|---|
| HF object access downloads full COGs | Validate range reads; use bounded local COG cache or alternate safe read path |
| GeoZarr chunks are slow for long pixel series | Benchmark exact reads; add scientifically defined aggregates only if required |
| Dynamic reprojection exceeds Space CPU | Cache revision-keyed tiles; cap concurrency; benchmark higher tier or split tile service |
| Public endpoint is heavily hotlinked | Rate-limit expensive misses, use cache headers, monitor cost, retain private-bucket option |
| Corrected frames show stale tiles | Include revision and style version in every cache key |
| Browser memory grows during animation | Abort obsolete requests and bound adjacent-frame prefetch |
| Colors imply unsupported precision | Version palettes and require meteorological review |
| Map-only UI excludes users | Provide keyboard controls, textual values, chart summaries, and exports |
| Harvester schema evolves | Validate schema versions and run consumer contract tests in both repositories |

## 20. Decisions

| ID | Decision | Rationale |
|---|---|---|
| V-001 | Separate visualization repository and Space | Isolate ingestion and public-serving failure domains |
| V-002 | Use the Eurometeo visual shell | Reuse an established responsive map/dashboard interaction model |
| V-003 | Keep permanent data in native OPERA projection | Preserve source fidelity and avoid a duplicate permanent archive |
| V-004 | Reproject requested tiles dynamically | Match Web Mercator maps without reprojecting whole stores |
| V-005 | Use catalog-gated visibility | Never expose partial or unpublished slots |
| V-006 | Use revision-keyed tile URLs | Make corrections cache-safe |
| V-007 | Use COG for recent data and GeoZarr fallback | Balance animation speed and permanent exact access |
| V-008 | Keep the browser free of bucket credentials | Reduce credential and object-access risk |
| V-009 | Preserve map state across view changes | Avoid expensive map remounts and improve continuity |

## 21. Open decisions

- Final application and Space name.
- Single combined Space versus separate UI and tile/query Spaces after Phase 0.
- Final DBZH, RATE, ACRR, and quality color maps.
- Exact HF Space hardware tier and cache budget.
- Basemap provider and attribution policy.
- Whether completed daily catalogs can use longer HTTP cache lifetimes.
- Whether pixel ranges beyond 31 days require aggregates.
- Whether quality should be a raster overlay, threshold mask, chart, or all
  three.
- Whether old corrected revisions remain publicly addressable.
- Production rate limits for tile and pixel endpoints.

## 22. Implementation checklist

### Repository foundation

- [ ] Create `alexdum/opera-radar-visualization` on GitHub.
- [ ] Create the matching Docker HF Space.
- [ ] Configure GitHub-to-Space one-way deployment.
- [ ] Add CI, secret scan, lint, tests, build, and container smoke test.
- [ ] Add build SHA and health response.

### Data contract

- [ ] Validate public read-only bucket access from the target Space.
- [ ] Parse catalog schema version 1.
- [ ] Validate hot COG range reads.
- [ ] Validate GeoZarr metadata and selected-chunk reads.
- [ ] Validate all three grids, products, statuses, quality arrays, and bounds.

### User experience

- [ ] Port Eurometeo shell and responsive sidebar patterns.
- [ ] Implement MapLibre raster layer and legend.
- [ ] Implement timeline and accessible animation controls.
- [ ] Implement pixel inspection and chart cards.
- [ ] Implement loading, stale, missing, fallback, and error states.
- [ ] Complete mobile and keyboard testing.

### Production gate

- [ ] Recent COG and historical GeoZarr tiles pass comparison tests.
- [ ] Pixel-series values match GeoZarr source samples.
- [ ] Performance targets are measured and accepted.
- [ ] Security and accessibility reviews pass.
- [ ] Metrics, alerts, ownership, and runbooks are configured.
- [ ] The 48-hour visualization soak passes.

## 23. References

- OPERA harvester requirements: `opera-harvester/PRD.md`
- Phase 3 product design: `opera-harvester/PHASE3_DESIGN.md`
- UI/layout reference: `clima/2026/eurometeo`
- Bucket: `https://huggingface.co/buckets/alexdum/opera-radar`
- Harvester Space: `https://huggingface.co/spaces/alexdum/opera-harvester`
- Harvester status: `https://alexdum-opera-harvester.hf.space/`
