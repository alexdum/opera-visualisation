<!-- BEGIN:rule-interpretation -->
## Rule Interpretation

The requirements in this file apply according to their stated scope. Treat `MUST`, `NEVER`, and `ALWAYS` as correctness, data-integrity, or accessibility invariants. Treat recommendations such as `prefer`, example thresholds, item counts, and timing estimates as defaults that may be changed when profiling, tests, upstream contracts, or documented product requirements justify an exception.

When a rule records a workaround for a specific library or browser interaction, preserve the tested behavior rather than copying an incomplete historical snippet. Re-verify the workaround when upgrading the affected dependency.
<!-- END:rule-interpretation -->

<!-- BEGIN:meteorological-filtering-rules -->
## Meteorological Data Filtering & Sanity Checks

When implementing data cleaning pipelines, sanity checks, or anomaly detection for meteorological data:
1. **Never assume Northern Hemisphere seasons**: Do not hardcode filters based on the month (e.g., assuming May-September is "summer" and dropping freezing temperatures). European countries operate WIGOS stations globally, including in Antarctica, where those months correspond to deep winter.
2. **Use location-agnostic algorithms**: Prefer dynamic anomaly detection (e.g., rolling local medians or rate-of-change spike filters) over static, date-based physical bounds to catch sensor glitches like shorted thermistors (-39.6°C, -40°C). Statistical methods are location-agnostic only when applied **temporally** within a single station's own time series. Do **not** apply statistical outlier detection (IQR, Z-scores) **spatially** across stations at a single timestamp — when the view spans multiple climate zones (e.g., Europe + Arctic), legitimate readings from one zone can be rejected as outliers by the distribution of another.
3. **Enforce non-negative lower bounds**: Always explicitly strip negative values (`< 0`) for strictly non-negative physical parameters, including precipitation (and rainfall rates), wind speed (and gusts), relative humidity, solar radiation, and sunshine duration. Do not rely on error-code registries alone, as sensors often report slight negative numbers (e.g. `-0.1`) due to calibration drift. Apply appropriate upper bounds separately where the parameter has a finite valid maximum.
4. **Make every temporal filter time-gap aware**: Before applying rate-of-change, spike, or rolling-window filters, sort records chronologically and retain their timestamps. Compare observations only when each relevant interval is within the configured maximum gap (three hours is the current default). Do not construct anomaly windows from a filtered list that silently removes missing records, because adjacent items may then represent observations separated by a long outage. Fixed jump thresholds are initial safeguards, not proof that a value is erroneous; validate them against the parameter, sampling interval, and known extremes.
5. **Cross-reference QC against the visualisation layer**: When adding or updating QC/sanity checks, always cross-reference the list of checked parameters against every parameter key consumed by the UI (charts, tables, summary cards). Missing a visualised parameter means bad data reaches the user unchecked. Audit the consuming components (e.g., `DashboardCharts.tsx`, `ChartCards.tsx`) to ensure complete coverage.
6. **Distinguish station-level from sea-level pressure**: Station-level pressure (`pressureStation`) at high-altitude WIGOS stations can legitimately be far below 800 hPa (e.g., ~650 hPa at 3,500 m). It therefore requires a substantially lower minimum than sea-level reduced pressure (`pressure`). Keep the exact approved limits in the shared QC bounds described below rather than restating different values in multiple pipelines.

### QC Source of Truth

`src/utils/qc.ts` is the canonical source for bounds shared by the map, station details, charts, and tables. API routes may define bounds for additional API-only parameters, but overlapping parameter keys MUST import or reuse the canonical definitions instead of declaring different limits. When a bound changes, audit every filtering layer and add or update tests before considering the change complete.
<!-- END:meteorological-filtering-rules -->

<!-- BEGIN:ui-ux-tooltips-rule -->
## UI/UX: Custom Tooltips vs Native Title

When implementing tooltips, help text, or informational popovers for small icons and interactive elements:
1. **Never rely solely on the native HTML `title` attribute** (e.g., `<span title="...">`). Native titles have a ~1-second hover delay, disappear quickly, and do not work at all on touch devices (mobile/tablet).
2. **Use custom, CSS-driven tooltips** instead. Implement instant-hover tooltips using CSS/Tailwind (e.g., the `group` and `group-hover` pattern) or a dedicated React Tooltip component to ensure instant feedback and style control.
3. **Ensure sufficient hover targets**. Small icons (e.g., 10px or 12px) should be wrapped in an element with adequate padding or have the tooltip trigger area expanded to increase the hoverable/clickable surface.
4. **Beware of Mobile "Sticky Hover"**: Mobile browsers treat a "tap" as a "hover". Do not wrap entire cards or primary touch targets in CSS tooltips if the tooltip content is redundant. If a tooltip is needed on desktop but obscures content on mobile, disable it for touch devices using `@media (hover: hover)`.
5. **Keep essential information outside tooltips**: Custom tooltips may provide optional explanation for dedicated help icons. Values, definitions, and context required to understand a metric MUST remain visible without hover, focus, or tapping, especially on summary cards.
<!-- END:ui-ux-tooltips-rule -->

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## EuroMeteo Station/Country Debugging

When a country or station list appears empty, do not assume MeteoGate is missing data. Verify the layers in order:

1. Check the raw MeteoGate response or `/api/stations` count for the affected country.
2. Check whether station metadata exists but the UI is filtering it out.
3. Check whether current-hour observations are empty separately from station metadata; "stations found" and "showing active stations" are different signals.

Country values can enter the app from dropdowns, URL query params, and parent iframe messages. Treat URL/embed values as external input and normalize them back to canonical station metadata labels before filtering, zooming, or posting state back to the parent page. Avoid exact string equality for country matching unless both sides are known canonical display labels.

Station-to-country synchronization MUST account for asynchronous station metadata. A station selected before `/api/stations` completes must be resolved again when station metadata arrives. Derive the canonical country from both the selected station ID and the loaded stations instead of using a guard that reacts only when the station ID changes.

### Climate Explorer Integration

The 2024 `climateexplorer` site and this 2026 EuroMeteo app use different country representations by design. Public Climate Explorer URLs are SEO slugs such as `/eurometeo/air-temperature/germany/`, while EuroMeteo app state uses display labels such as `Germany`. Preserve that split: keep public links slug-based, resolve slugs to display labels at the iframe/message boundary, and make the EuroMeteo side tolerant of either form.

When investigating link issues from `/Users/alexandrudumitrescu/Documents/clima/2024/climateexplorer`, check `eurometeo/eurometeo-page.js`, `netlify/edge-functions/rewrite-meta.ts`, and `netlify/edge-functions/eurometeo-seo-metadata.json` before changing the URL contract. SEO metadata can lag behind live `/api/stations` data, so count mismatches are not automatically broken links.

URL-derived React state MUST be hydration-safe. Do not read `window.location` inside state initializers when the component is server-rendered. Use the current Next.js `searchParams` or `useSearchParams` API with an appropriate Suspense boundary, or pass server-resolved values into the client component, so the server and client initially render identical state. Preserve the existing query-parameter names, precedence, and iframe message semantics when changing how URL state is initialized.

Calling `/api/stations` may rewrite `src/data/meteogate_stations_cache.csv` as a side effect after a successful remote fetch. Do not keep that generated CSV churn in a change unless the user explicitly asked to refresh the cache.

<!-- BEGIN:ui-ux-scroll-snapping-rule -->
## UI/UX: CSS Scroll Snapping Pitfalls

When implementing CSS scroll snapping (`snap-y` / `snap-x`) for tactile scrolling (e.g., dashboards, carousels):
1. **Prefer `snap-proximity` over `snap-mandatory`**: Use `snap-proximity` on the scroll container unless strictly building a full-screen carousel. `snap-mandatory` can aggressively pull users past content if item heights vary.
2. **Assign snap points to ALL major content blocks**: Do not only add `snap-center` or `snap-start` to the main repeatable items (e.g., charts). You MUST also add a snap point (e.g., `snap-start scroll-mt-2`) to metadata headers, summary grids, and banners at the top/bottom of the container. If you leave top-level content without a snap point, the browser will skip over it when the user scrolls, hiding it from view.
3. **Reset scroll position on visibility toggle**: Always-mounted containers hidden with `display: none` retain their `scrollTop` across visibility changes. When revealing such a container (e.g., tab switch), imperatively reset `scrollTop = 0` via a ref. Without this, `scroll-snap-type` re-engages at the stale position and can land on the wrong (often last) snap point. Do not rely on removing `scroll-behavior: smooth` as a substitute — that only makes the mis-snap instant instead of animated.
4. **Do not use scroll snapping on containers with async-loaded content**: When chart data loads asynchronously (e.g., SSE streaming) and causes large layout shifts (multiple 360px chart cards appearing), the scroll-snap algorithm re-evaluates after each shift and can jump to the last snap point. A `scrollTop` reset on tab switch does not help because the jump happens later when the data arrives. Remove `snap-y`/`snap-x` from such containers entirely.
<!-- END:ui-ux-scroll-snapping-rule -->

<!-- BEGIN:tailwind-maplibre-conflict-rule -->
## Tailwind CSS + MapLibre GL JS Conflict

When combining Tailwind CSS with MapLibre GL JS, Tailwind's base preflight for `button` elements (`background-image: none; background-color: transparent;`) strips the SVG icons from MapLibre's zoom/navigation controls, rendering them as blank white boxes on mobile WebKit.

Preserve the tested MapLibre control overrides in `src/app/globals.css`, including the explicit zoom-control SVG backgrounds required on mobile WebKit. The stylesheet is the canonical implementation; do not replace it with only `background-color`, `display`, and `opacity` declarations, because those declarations alone do not restore a stripped `background-image`. When MapLibre or Tailwind is upgraded, verify the zoom controls on mobile WebKit before altering or removing the workaround.
<!-- END:tailwind-maplibre-conflict-rule -->

<!-- BEGIN:ui-ux-summary-cards-rule -->
## UI/UX: Dashboard Summary Cards

When implementing metric or summary cards for dashboards:
1. **Never hide information behind hover states or tooltips**: Do not use CSS tooltips, hover effects, or interactive reveals to display secondary text (e.g., subtext, definitions, or descriptions) on summary cards.
2. **Display all information visibly**: Ensure all relevant text, including card titles and subtext, is permanently visible on the card. Use proper text wrapping (`break-words`, `leading-tight`) instead of truncating text (`truncate`) so users can read the full context at a glance without interaction.
<!-- END:ui-ux-summary-cards-rule -->

<!-- BEGIN:ui-ux-legend-alignment-rule -->
## UI/UX: Step-based Map Legend Alignment

When implementing or modifying map legends for continuous fields that are binned into intervals (step functions/thresholds):
1. **Align labels to boundaries**: The text labels represent the boundaries between color intervals (e.g., `-40` marks the boundary for the interval `[-40, -38)`). They MUST be aligned exactly on the border lines separating the color blocks.
2. **Avoid vertical centering**: Do not vertically center the labels inside the color blocks.
3. **Implementation**: Use absolute positioning (e.g., `bottom: 0, transform: 'translateY(50%)'`) to position the text label precisely across the dividing border line between intervals.
4. **Ensure Container Padding**: Because absolute positioning takes labels out of the flex/block layout flow, you must apply sufficient padding (e.g., `pr-10`) or minimum width to the legend background card to prevent labels from overflowing or clipping.
5. **Cohesive Overlay Alignment**: Ensure the legend card coordinates match alignment offsets (e.g., `right-2.5` / `right-10px`) of sibling map widgets (like summary cards) so the UI appears visually aligned on the edges.
<!-- END:ui-ux-legend-alignment-rule -->

<!-- BEGIN:ui-ux-chart-axes-rule -->
## UI/UX: Chart Axes and Measurement Units

When implementing time-series or bar charts (e.g., using Recharts) for dashboard visualisations:
1. **Minimise Axis Clutter**: Do not append measurement units (e.g., `°C`, `hPa`, `mm`) to every tick mark on the Y-axis. This causes unnecessary repetition and visual noise.
2. **Contextualize in Titles**: Place the measurement unit in the chart's title or subtitle (e.g., `Temperature Profile (°C)`).
3. **Preserve Exact Units in Tooltips**: While the Y-axis should remain clean (raw numbers), the interactive hover tooltip MUST explicitly format the value with its unit (e.g., `22.4 °C`), ensuring users get precise context when inspecting specific data points.
<!-- END:ui-ux-chart-axes-rule -->

<!-- BEGIN:ui-ux-meteorological-chart-rendering-rule -->
## UI/UX: Meteorological Chart Rendering

When refactoring or updating charting components (e.g., Recharts), preserve the specific geometric rendering of discrete meteorological phenomena:
1. **Discrete vs. Continuous Data**: Secondary, sparse, or instantaneous events (such as Wind Gusts) MUST be rendered as disconnected scatter points (e.g., `strokeWidth={0}`, `dot={...}`) rather than solid, continuous lines. 
2. **Physical Accuracy**: Interpolating a continuous line between isolated, sudden gust events is physically misleading. Do not blindly apply a uniform `strokeWidth={2}` or `dot={false}` across all chart lines when applying global UI updates.
<!-- END:ui-ux-meteorological-chart-rendering-rule -->

<!-- BEGIN:react-maplibre-sync-rule -->
## React MapLibre GL: Loading and Performance Synchronization

When implementing or modifying MapLibre GL map components and layer rendering:
1. **Loader Synchronization**: Never dismiss loading overlays or spinners immediately in the `finally` block of a data fetch query. For OPERA raster frames, determine readiness from the visible radar source with `map.isSourceLoaded(activeSourceId)` and source-specific events after the relevant source/layer update has been applied. Do **not** require global map `'idle'` or `areTilesLoaded()` for the ready state: the basemap and the hidden adjacent preloaded frame may still be loading and must not block the visible frame. A global `'idle'` listener may be used only as an additional opportunity to re-check the active source. Always clean up source, idle, style, and error listeners when an effect is superseded or the component unmounts. Also provide a bounded fallback for cases where the active source never finishes; the fallback must expose a degraded/error state rather than falsely reporting successful rendering.
2. **Avoid Arbitrary Timers for Style/Source Updates**: Do not use `setTimeout` or other custom timers to coordinate updating a map source after changing the map style (e.g. basemap). Rely on MapLibre's native `'style.load'` event listener to re-add layers and update states.
3. **Synchronous Processing for Small Datasets**: Prefer synchronous construction of GeoJSON and statistics for the project's current station datasets (normally under 5,000 items) instead of `setTimeout(..., 0)` yielding loops. Treat the item count as a current default, not a universal performance guarantee. Re-profile when dataset size, geometry complexity, target devices, or processing work changes, and use measured evidence to justify chunking or worker-based processing.
4. **Derived Map Statistics**: Calculate map-related statistics (e.g. averages/mins/maxes of visible stations) synchronously using React `useMemo` hooks derived from the current bounds and observations, rather than writing to state variables in a `useEffect` that triggers additional re-renders.
<!-- END:react-maplibre-sync-rule -->

<!-- BEGIN:react-dashboard-loading-rules -->
## React Dashboards: Chart Mounting & State-Sync Cache Seeding

When implementing or refactoring dashboards, data loaders, and chart visualisations:
1. **Persistent Chart Mounting**: Do not conditionally unmount chart components (e.g. components rendering Recharts `<ResponsiveContainer>` or other responsive SVG widgets) when loading observations. Doing so destroys the DOM nodes, forcing them to initialize at size `0x0` and recalculate layout on remount, creating visual double flickering. Keep components mounted and render loading indicators as an absolute-positioned overlay (e.g. `absolute inset-0 z-40 bg-slate-50/70 backdrop-blur-[1px]`) while applying dimming classes (e.g. `opacity-25 pointer-events-none`) to the chart container.
2. **Double-Seeding Adjusted Cache Ranges**: When a fetch hook queries data based on user range selections, but the backend adjusts the parameters to fit physical limits (e.g. returning `effectiveRange.adjusted = true` with a shorter date range), updating state variables triggers the fetch hook to re-run. To prevent a duplicate API call and loading flicker, you MUST seed the cache under both the requested parameters and the adjusted parameters, so the subsequent run results in a synchronous cache hit.
<!-- END:react-dashboard-loading-rules -->

<!-- BEGIN:opera-dbzh-quality-filter-rule -->
## OPERA DBZH Quality Filtering

The rectangular or tail-like echoes visible around Romania in some OPERA DBZH
frames are present in the upstream EUMETNET COG. They are not introduced by the
harvester, Hugging Face upload, MapLibre, Web Mercator reprojection, or tile
boundaries. Do not attempt to correct them with geographic masks, Romania-only
rules, image morphology, or modifications to the archived source data.

The DBZH COG uses band 1 for reflectivity and band 2 for its quality indicator.
Apply the following visualization policy:

1. **Default DBZH threshold:** The map MUST enable quality filtering by default
   with `min_quality=0.10`, applied uniformly across the full DBZH coverage.
2. **Preserve the authoritative view:** Users MUST be able to disable the
   filter and view the original OPERA composite. Filtering is a display mask;
   it MUST NOT rewrite source COGs, GeoZarr measurements, pixel-analysis values,
   or exported data.
3. **Known versus unknown quality:** Mask a DBZH pixel only when its quality is
   known, lies in the normalized `[0, 1]` range, and is strictly below the
   selected threshold. Preserve pixels with masked, nodata, non-finite, or
   out-of-range quality as **unknown quality** rather than treating them as
   quality zero.
4. **Product scope:** Do not automatically apply the DBZH threshold to RATE or
   ACRR. Their quality distributions and product semantics must be evaluated
   separately before introducing a default filter.
5. **Cache and URL identity:** Include the selected threshold in the tile URL
   (`min_quality`) and in every frontend/backend tile cache or MapLibre source
   identity. Raw and differently filtered tiles MUST never share a cache key.
   Validate public thresholds server-side as finite values from `0` through
   `1`.
6. **Visible state:** Keep the active threshold and filtered/unfiltered state
   visible and accessible in the DBZH sidebar. Preserve shareable URL state;
   use `min_quality=off` for the raw view.
7. **Regression verification:** Tests MUST cover low known quality, accepted
   quality, quality nodata/unknown, invalid thresholds, and at least one real
   DBZH tile comparison demonstrating that filtering removes pixels while
   retaining valid coverage.

The current implementation is in `backend/api/tiles.py`,
`src/components/Map.tsx`, `src/components/Sidebar.tsx`, and
`src/app/page.tsx`. Preserve these semantics if the implementation is moved or
refactored.
<!-- END:opera-dbzh-quality-filter-rule -->

<!-- BEGIN:opera-visualization-architecture-rules -->
## OPERA Visualization Architecture

### Catalog authority and product isolation

- Treat daily catalogs as the sole authority for consumer-visible frames. A
  GeoZarr time slot is not visible merely because its chunks exist.
- Never use DBZH as a shared timeline for RATE or ACRR. Each product has its
  own cadence, revisions, interval semantics, and available frames.
- Key catalog caches by both UTC date and product.
- Every frame identity MUST include `(product, nominal_time, revision)`.
- Reject tile requests whose timestamp and revision do not appear in the
  authoritative catalog for the requested product.
- Catalog tests MUST use deterministic fixtures. Live bucket checks belong in
  explicitly identified integration or smoke tests.

### Hot COG and GeoZarr routing

- In Latest mode, use a COG only when its catalog entry has
  `hot_cog_ready: true` and its timestamp is inside the current
  `hot_window_start` boundary.
- Historical mode MUST explicitly request the permanent GeoZarr backend, even
  when the selected timestamp remains inside the hot COG window. Historical
  catalog responses must advertise `backend: geozarr`, clear the consumer-side
  hot COG pointer, and leave internal authoritative frame resolution intact for
  Latest-mode requests.
- Include the catalog-selected backend in revision-safe tile URLs. The tile
  server MUST honor an explicit `source=geozarr` request and MUST NOT silently
  switch an explicitly historical request back to COG.
- A catalog may retain `hot_cog_ready: true` after rolling retention removes
  the object. `hot_window_start` therefore determines current Latest-mode COG
  eligibility; `hot_cog_ready` alone is insufficient.
- When an eligible COG cannot be opened and `archive_ready: true`, fall back to
  the catalog-referenced GeoZarr store.
- Return or display the selected backend (`cog` or `geozarr`) so archive
  rendering and degraded fallback are distinguishable from failure.
- Do not infer COG or GeoZarr paths by listing bucket objects when the catalog
  supplies those paths.
- A valid Web Mercator tile outside the finite OPERA raster footprint is a
  successful transparent tile. Return an empty image with `200`, and never
  treat `TileOutsideBounds` as a storage failure or trigger GeoZarr fallback.
- Do not issue remote COG range requests independently for every MapLibre tile.
  Download each immutable `(product, nominal_time, revision)` COG once into a
  bounded local cache, use a per-frame lock so concurrent tiles share that
  download, publish cache files atomically, and evict by explicit file/byte
  limits.
- Send Hugging Face credentials only from the server. Use a server-side
  read-only `HF_TOKEN` for catalog, COG, and GeoZarr access to avoid anonymous
  resolver limits; never expose it through `NEXT_PUBLIC_*`, URLs, responses, or
  logs.
- Treat an isolated tile `503` as a symptom, not proof that a cataloged frame is
  missing. Re-request the exact product, timestamp, revision, zoom, x, y,
  quality, and source URL and distinguish renderer saturation from catalog,
  storage, or schema failure before changing data routing.
- Bound tile-render concurrency and queue wait time. If the queue remains full,
  return a retryable response such as `503` with `Retry-After`; never publish a
  transient failure as an immutable successful tile.
- Give GeoZarr archive rendering a longer user-visible loading allowance than
  hot COG rendering because it requires remote chunk reads and reprojection.

### MapLibre animation constraints

- Keep at most the current frame and one adjacent preloaded frame in the
  MapLibre style. Never create one source and layer for every timestamp in a
  24-hour animation.
- Preload the adjacent frame only when both the visible and adjacent frames use
  COG. Never preload a hidden GeoZarr archive frame: doing so doubles remote
  reads and renderer pressure without improving the visible frame.
- Include product, timestamp, revision, rendering options, and quality
  threshold in MapLibre source and tile-cache identities.
- Advance playback only after the current frame reaches MapLibre `idle` or an
  explicitly reported degraded state. For OPERA raster sources, "reaches
  idle" means the **active source** is loaded; it does not require the entire
  style or hidden preloaded source to become idle.
- Stop playback when the document is hidden and honor
  `prefers-reduced-motion`.
- On every product or date transition, abort the superseded catalog request,
  clear frames and the selected index from the previous catalog, and enter a
  loading state before requesting the replacement catalog. Never temporarily
  render DBZH frames under RATE/ACRR state, or frames from the prior date under
  a new historical selection.
- A stale async response or MapLibre event must not overwrite the state of a
  newer transition. Guard render callbacks by a generation/identity and ignore
  callbacks after their effect has been cleaned up.

### Coordinate contracts

- Use `lon` and `lat` consistently at React component and API boundaries.
- A map-click callback accepts either one documented object or two positional
  values. Never mix those contracts.
- Do not suppress TypeScript errors to hide coordinate or component-contract
  mismatches.
- Missing query parameters are not numeric zero. Check that both `lon` and
  `lat` are present before converting them; `Number(null) === 0` must never
  silently select `(0, 0)` or start a pixel request.

### Pixel-analysis semantics

- Pixel queries MUST read only catalog-committed timestamps.
- Return measurement, observation status, quality variables, and source
  revision separately.
- Preserve `detected`, `undetect`, and `nodata`; never collapse all three into
  `null` or measured zero.
- ACRR responses, charts, and exports MUST include `start_time` and `end_time`.
- Remote GeoZarr reads are blocking operations and MUST NOT run directly on the
  asynchronous FastAPI event loop.
- Pixel-series GeoZarr reads are expensive foreground work. Start them only
  when Pixel Analysis is visible and a valid location is selected. Abort or
  ignore superseded in-flight requests when the product, date, location, or
  analysis window changes; never compete with user-visible map transitions
  through unnecessary background pixel queries.
- Treat ordinary tab navigation and explicit dismissal as different actions.
  Switching between Map, Pixel Analysis, and About MUST preserve the selected
  point, map marker, and successfully completed pixel-series result.
- Cache a successful pixel-series result by product, longitude, latitude,
  start time, and end time. Returning to Pixel Analysis with the same request
  key MUST reuse that result without repeating the GeoZarr extraction.
- Closing Pixel Analysis with its X button MUST clear the selected point, map
  marker, cached series, loading state, and errors. Selecting another point or
  changing the product or analysis window MUST invalidate the prior request
  key and retrieve the correct series.
- UI exports MUST serialize data already loaded in the browser rather than
  calling the GeoZarr extraction endpoint again merely to convert JSON into
  CSV. Keep the server CSV endpoint available for API consumers and fallback
  workflows, not as the default UI export path.
- CSV and JSON exports MUST preserve the same scientific semantics as the API,
  including time bounds, values, units, observation status, status codes,
  quality JSON, and source revision. CSV generation must correctly quote
  commas, quotes, and newlines, neutralize spreadsheet formulas in string
  cells, include an Excel-compatible UTF-8 encoding, and revoke temporary
  object URLs after starting the download.

### Product-aware timeline rules

- The timeline range represents indexes into catalog-committed frames, not a
  generated sequence of timestamps. A slider position MUST never select an
  uncommitted or synthetic map frame.
- Infer the native update cadence independently for each selected product from
  its catalog timestamps. Use documented per-product defaults only for empty
  or single-frame catalogs.
- Missing frames produce multiples of the native cadence; cadence inference,
  labels, accessible slider text, and gap detection must remain correct across
  those gaps.
- Do not confuse ACRR's accumulation interval with its publication cadence.
  Preserve and display `start_time` and `end_time` separately from the slider's
  update step.

### Build, deployment, and security gates

- The backend requires Python 3.12 with the current pinned Zarr stack.
- Never disable TypeScript or ESLint validation in the production build.
- Docker build contexts MUST exclude local virtual environments, caches, test
  rasters, and debugging artifacts through `.dockerignore`.
- Run the production container as a non-root user and provide a health check.
- Do not combine wildcard CORS origins with credentialed requests.
- Never disable TLS certificate verification for public bucket access.

### Performance and dependency rules

- Dynamically load MapLibre and chart libraries when practical and monitor the
  initial JavaScript payload after dependency changes.
- Bound tile-rendering concurrency and tile caches.
- Treat GeoZarr fallback as a slower archive path and expose that state to the
  user.
- Do not add a dependency unless production code imports it or an executable
  test requires it.
<!-- END:opera-visualization-architecture-rules -->

<!-- BEGIN:ui-ux-fullscreen-layout-rule -->
## UI/UX: Fullscreen Layouts

When implementing fullscreen or immersive modes:
1. **Preserve Navigation:** Do not couple destructive layout changes to the browser's native fullscreen event. When a user enters fullscreen mode, the expectation is to remove browser chrome, not to lose the application's primary navigation or filters.
2. **Avoid CSS Overrides:** Never use aggressive CSS layout overrides (like forcing `fixed inset-0 z-50` on a child container) to abruptly hide sidebars or controls during fullscreen.
3. **Dedicated Presentation Toggles:** If a "presentation" or "immersive" mode is required, implement it via an explicit user-controlled UI toggle (e.g., a collapsible sidebar button) that operates independently of the browser's fullscreen state.
<!-- END:ui-ux-fullscreen-layout-rule -->

<!-- BEGIN:off-canvas-controls-rule -->
## UI/UX: Off-canvas Controls

When a responsive sidebar, drawer, or control panel is translated off-screen:

1. Its controls MUST also be removed from keyboard, pointer, and accessibility
   interaction until the panel is opened. Visual translation alone is not a
   closed state.
2. Prefer the platform `inert` attribute on the closed panel, paired with the
   appropriate `aria-hidden`/dialog semantics for the component. Do not leave
   invisible product buttons, inputs, or links focusable behind the map.
3. Verify mobile interactions against the visible UI. A test or automation
   action targeting a hidden sidebar control can otherwise pass through to the
   MapLibre canvas and be misdiagnosed as a map-coordinate selection.

<!-- END:off-canvas-controls-rule -->

<!-- BEGIN:docker-deployment-rule -->
## Docker Deployments & Geospatial Dependencies

1. **Python Slim Images**: When writing or updating a `Dockerfile` that uses a `python:slim` base image (e.g., `python:3.12-slim`) and installs `rasterio` or other GDAL-based packages, you MUST explicitly install `libexpat1` via `apt-get` (e.g., `RUN apt-get update && apt-get install -y libexpat1`). Pre-compiled wheels depend on this system library, and its absence causes a runtime `ImportError: libexpat.so.1` crash.
2. **Hugging Face Spaces Secrets**: When deploying an application to Hugging Face Spaces that fetches data from the Hugging Face Hub (like COG map tiles), always explicitly remind the user to configure a read-only `HF_TOKEN` in the Space's Settings > Variables and secrets. The Space container does not automatically inherit the user's credentials, and failure to provide the token will result in anonymous rate limits.
<!-- END:docker-deployment-rule -->

<!-- BEGIN:verification-rules -->
## Verification Requirements

Match verification effort to the affected rule and report commands that could not be run.

1. For code changes, run `npm test`, `npm run typecheck`, `npm run lint`, and
   `npm run build` unless the user explicitly limits verification or the
   environment prevents it. For backend changes, also run
   `backend/venv/bin/python -m pytest -q backend` from the repository root.
2. For meteorological QC changes, add or update focused tests covering the affected parameter and filtering path. Relevant regression cases include high-altitude station pressure, Antarctic winter temperatures, geographically diverse stations at one timestamp, raw MeteoGate parameter names such as `wind_speed`, negative values for non-negative parameters, and spikes separated by both short and long time gaps.
3. Tests added to the repository MUST be executable through a documented package script or the project's configured test runner; a test file that cannot be resolved or run is not considered verification.
4. For country or station normalization changes, test canonical display labels, SEO slugs, URL parameters, and iframe messages. Cold-load at least one non-default parameterized URL and confirm that React reports no hydration error. Test station IDs and station slugs selected before station metadata finishes loading, and confirm that the country filter, generated URL, and iframe state message use the station's canonical country.
5. For tooltip, scroll-snapping, chart-loading, or MapLibre-control changes, verify the affected interaction at desktop and mobile widths. Include keyboard/touch behavior where relevant, and verify MapLibre control icons on mobile WebKit when the control CSS changes.
6. For OPERA product/date transition changes, verify at minimum latest DBZH →
   historical RATE → historical DBZH. Confirm the final visible source reaches
   `ready`, the rendering overlay clears, no old-product frame is displayed,
   and Pixel Analysis does not issue GeoZarr requests while its view is closed.
   Also request a map tile outside the OPERA footprint and confirm it returns a
   transparent `200` response.
7. For OPERA storage-routing changes, verify Latest and Historical catalog
   responses independently. Latest should retain an eligible COG; Historical
   must advertise only GeoZarr, including for a timestamp inside the last 24
   hours. Confirm the revision-safe tile URL carries the selected source.
8. For pixel-analysis state changes, test Analysis → About → Map → Analysis and
   confirm the marker and completed graph are preserved without a duplicate
   request. Then close Analysis with X and confirm the marker, selected point,
   series, error, and loading state are cleared.
9. For browser-side export changes, verify the exported rows and headers against
   the API schema and assert that clicking Export does not call the pixel CSV or
   GeoZarr extraction endpoint again. Include regression cases for null values,
   quality JSON containing CSV metacharacters, and formula-like strings.
10. For timeline changes, test every product's cadence, a missing catalog frame,
    a single-frame fallback, keyboard-accessible slider text, and the rule that
    only cataloged frame indexes can be selected.
11. For adjusted date-range caching changes, verify that both requested and effective cache keys are populated and that the state update does not trigger a duplicate request.
12. Before handoff, run `git diff --check`. For deployment changes, resolve the
   Python 3.12 requirements and run the Docker build and health smoke test when
   a Docker daemon is available; explicitly report when it is not.
<!-- END:verification-rules -->
