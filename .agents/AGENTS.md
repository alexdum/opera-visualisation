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
1. **Loader Synchronization**: Never dismiss loading overlays or spinners immediately in the `finally` block of a data fetch query. Instead, synchronize loader dismissal with MapLibre's `'idle'` event (using `map.once('idle', ...)` or checking `map.isIdle()`) so newly supplied data has rendered. Register synchronization only after the relevant source/layer update has been applied, so an `'idle'` event from the previous map state cannot dismiss the loader early. Always clean up listeners when the fetch is aborted or the component unmounts. Also handle map errors and provide a bounded fallback for cases where `'idle'` never fires; the fallback must expose a degraded/error state rather than falsely reporting successful rendering.
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

<!-- BEGIN:ui-ux-fullscreen-layout-rule -->
## UI/UX: Fullscreen Layouts

When implementing fullscreen or immersive modes:
1. **Preserve Navigation:** Do not couple destructive layout changes to the browser's native fullscreen event. When a user enters fullscreen mode, the expectation is to remove browser chrome, not to lose the application's primary navigation or filters.
2. **Avoid CSS Overrides:** Never use aggressive CSS layout overrides (like forcing `fixed inset-0 z-50` on a child container) to abruptly hide sidebars or controls during fullscreen.
3. **Dedicated Presentation Toggles:** If a "presentation" or "immersive" mode is required, implement it via an explicit user-controlled UI toggle (e.g., a collapsible sidebar button) that operates independently of the browser's fullscreen state.
<!-- END:ui-ux-fullscreen-layout-rule -->

<!-- BEGIN:verification-rules -->
## Verification Requirements

Match verification effort to the affected rule and report commands that could not be run.

1. For code changes, run `npm run lint` and `npm run build` unless the user explicitly limits verification or the environment prevents it.
2. For meteorological QC changes, add or update focused tests covering the affected parameter and filtering path. Relevant regression cases include high-altitude station pressure, Antarctic winter temperatures, geographically diverse stations at one timestamp, raw MeteoGate parameter names such as `wind_speed`, negative values for non-negative parameters, and spikes separated by both short and long time gaps.
3. Tests added to the repository MUST be executable through a documented package script or the project's configured test runner; a test file that cannot be resolved or run is not considered verification.
4. For country or station normalization changes, test canonical display labels, SEO slugs, URL parameters, and iframe messages. Cold-load at least one non-default parameterized URL and confirm that React reports no hydration error. Test station IDs and station slugs selected before station metadata finishes loading, and confirm that the country filter, generated URL, and iframe state message use the station's canonical country.
5. For tooltip, scroll-snapping, chart-loading, or MapLibre-control changes, verify the affected interaction at desktop and mobile widths. Include keyboard/touch behavior where relevant, and verify MapLibre control icons on mobile WebKit when the control CSS changes.
6. For adjusted date-range caching changes, verify that both requested and effective cache keys are populated and that the state update does not trigger a duplicate request.
<!-- END:verification-rules -->
