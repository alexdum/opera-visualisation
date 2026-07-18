<!-- BEGIN:meteorological-filtering-rules -->
## Meteorological Data Filtering & Sanity Checks

When implementing data cleaning pipelines, sanity checks, or anomaly detection for meteorological data:
1. **Never assume Northern Hemisphere seasons**: Do not hardcode filters based on the month (e.g., assuming May-September is "summer" and dropping freezing temperatures). European countries operate WIGOS stations globally, including in Antarctica, where those months correspond to deep winter.
2. **Use location-agnostic algorithms**: Prefer dynamic anomaly detection (e.g., rolling local medians, rate-of-change spike filters, or Z-scores) over static, date-based physical bounds to catch sensor glitches like shorted thermistors (-39.6°C, -40°C). These methods are location-agnostic only when applied **temporally** (within a single station's own time series). Do **not** apply statistical outlier detection (IQR, Z-scores) **spatially** across stations at a single timestamp — when the view spans multiple climate zones (e.g., Europe + Arctic), legitimate readings from one zone will be rejected as outliers by the statistical distribution of another.
3. **Enforce absolute physical zero bounds**: Always explicitly strip negative values (`< 0`) for strictly non-negative physical parameters, including: precipitation (and rainfall rates), wind speed (and gusts), relative humidity, solar radiation, and sunshine duration. Do not rely on error-code registries alone, as sensors often report slight negative numbers (e.g. `-0.1`) due to calibration drift.
4. **Time-Gap Awareness in Spike Filters**: When building rate-of-change or spike filters, always verify that the time delta between consecutive records is sufficiently short (e.g., maximum 3 hours) before classifying a large jump as an anomaly. A 10°C jump might be a sensor glitch if it happens and reverts within 10 minutes or 1 hour, but it could be a legitimate weather front if the station was offline for 6 hours. A fixed, absolute jump threshold (e.g. 10°C) safely catches hardware glitches regardless of whether the sampling rate is sub-hourly or hourly, provided the time-gap is respected.
5. **Cross-reference QC against the visualisation layer**: When adding or updating QC/sanity checks, always cross-reference the list of checked parameters against every parameter key consumed by the UI (charts, tables, summary cards). Missing a visualised parameter means bad data reaches the user unchecked. Audit the consuming components (e.g., `DashboardCharts.tsx`, `ChartCards.tsx`) to ensure complete coverage.
6. **Distinguish station-level from sea-level pressure**: Station-level pressure (`pressureStation`) at high-altitude WIGOS stations can legitimately be far below 800 hPa (e.g., ~650 hPa at 3,500 m). Use a wider lower bound (e.g., 500 hPa) for station-level pressure. Only sea-level reduced pressure (`pressure`) should use the standard 800–1100 hPa range.
<!-- END:meteorological-filtering-rules -->

<!-- BEGIN:ui-ux-tooltips-rule -->
## UI/UX: Custom Tooltips vs Native Title

When implementing tooltips, help text, or informational popovers for small icons and interactive elements:
1. **Never rely solely on the native HTML `title` attribute** (e.g., `<span title="...">`). Native titles have a ~1-second hover delay, disappear quickly, and do not work at all on touch devices (mobile/tablet).
2. **Use custom, CSS-driven tooltips** instead. Implement instant-hover tooltips using CSS/Tailwind (e.g., the `group` and `group-hover` pattern) or a dedicated React Tooltip component to ensure instant feedback and style control.
3. **Ensure sufficient hover targets**. Small icons (e.g., 10px or 12px) should be wrapped in an element with adequate padding or have the tooltip trigger area expanded to increase the hoverable/clickable surface.
4. **Beware of Mobile "Sticky Hover"**: Mobile browsers treat a "tap" as a "hover". Do not wrap entire cards or primary touch targets in CSS tooltips if the tooltip content is redundant. If a tooltip is needed on desktop but obscures content on mobile, disable it for touch devices using `@media (hover: hover)`.
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

### Climate Explorer Integration

The 2024 `climateexplorer` site and this 2026 EuroMeteo app use different country representations by design. Public Climate Explorer URLs are SEO slugs such as `/eurometeo/air-temperature/germany/`, while EuroMeteo app state uses display labels such as `Germany`. Preserve that split: keep public links slug-based, resolve slugs to display labels at the iframe/message boundary, and make the EuroMeteo side tolerant of either form.

When investigating link issues from `/Users/alexandrudumitrescu/Documents/clima/2024/climateexplorer`, check `eurometeo/eurometeo-page.js`, `netlify/edge-functions/rewrite-meta.ts`, and `netlify/edge-functions/eurometeo-seo-metadata.json` before changing the URL contract. SEO metadata can lag behind live `/api/stations` data, so count mismatches are not automatically broken links.

Calling `/api/stations` may rewrite `src/data/meteogate_stations_cache.csv` as a side effect after a successful remote fetch. Do not keep that generated CSV churn in a change unless the user explicitly asked to refresh the cache.

<!-- BEGIN:ui-ux-scroll-snapping-rule -->
## UI/UX: CSS Scroll Snapping Pitfalls

When implementing CSS scroll snapping (`snap-y` / `snap-x`) for tactile scrolling (e.g., dashboards, carousels):
1. **Prefer `snap-proximity` over `snap-mandatory`**: Use `snap-proximity` on the scroll container unless strictly building a full-screen carousel. `snap-mandatory` can aggressively pull users past content if item heights vary.
2. **Assign snap points to ALL major content blocks**: Do not only add `snap-center` or `snap-start` to the main repeatable items (e.g., charts). You MUST also add a snap point (e.g., `snap-start scroll-mt-2`) to metadata headers, summary grids, and banners at the top/bottom of the container. If you leave top-level content without a snap point, the browser will skip over it when the user scrolls, hiding it from view.
<!-- END:ui-ux-scroll-snapping-rule -->

<!-- BEGIN:tailwind-maplibre-conflict-rule -->
## Tailwind CSS + MapLibre GL JS Conflict

When combining Tailwind CSS with MapLibre GL JS, Tailwind's base preflight for `button` elements (`background-image: none; background-color: transparent;`) strips the SVG icons from MapLibre's zoom/navigation controls, rendering them as blank white boxes on mobile WebKit.

Always ensure the following CSS override is present in `globals.css` when using MapLibre with Tailwind:
```css
/* Force MapLibre UI controls over Tailwind resets */
.maplibregl-ctrl-group button { background-color: #ffffff !important; display: block !important; }
.maplibregl-ctrl-icon { display: block !important; opacity: 1 !important; }
```
<!-- END:tailwind-maplibre-conflict-rule -->

<!-- BEGIN:ui-ux-summary-cards-rule -->
## UI/UX: Dashboard Summary Cards

When implementing metric or summary cards for dashboards:
1. **Never hide information behind hover states or tooltips**: Do not use CSS tooltips, hover effects, or interactive reveals to display secondary text (e.g., subtext, definitions, or descriptions) on summary cards.
2. **Display all information visibly**: Ensure all relevant text is permanently visible on the card. Use proper text wrapping (`break-words`, `leading-tight`) instead of truncating text (`truncate`) so users can read the full context at a glance without interaction.
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

<!-- BEGIN:react-maplibre-sync-rule -->
## React MapLibre GL: Loading and Performance Synchronization

When implementing or modifying MapLibre GL map components and layer rendering:
1. **Loader Synchronization**: Never dismiss loading overlays or spinners immediately in the `finally` block of a data fetch query. Instead, synchronize loader dismissal with MapLibre's `'idle'` event (using `map.once('idle', ...)` or checking `map.isIdle()`) to guarantee that all new vector tiles, coordinates, and layers have finished rendering. Ensure appropriate cleanup occurs if the fetch is aborted or the component is unmounted.
2. **Avoid Arbitrary Timers for Style/Source Updates**: Do not use `setTimeout` or other custom timers to coordinate updating a map source after changing the map style (e.g. basemap). Rely on MapLibre's native `'style.load'` event listener to re-add layers and update states.
3. **Synchronous Processing for Small Datasets**: Do not slice or chunk datasets containing under 5,000 items (e.g. station lists) using `setTimeout(..., 0)` yielding loops. Constructing small GeoJSON objects and calculating statistics synchronously is extremely fast (<3ms) and avoids the cumulative latency of event loop ticks. MapLibre processes rendering data on a background worker thread.
4. **Derived Map Statistics**: Calculate map-related statistics (e.g. averages/mins/maxes of visible stations) synchronously using React `useMemo` hooks derived from the current bounds and observations, rather than writing to state variables in a `useEffect` that triggers additional re-renders.
<!-- END:react-maplibre-sync-rule -->

<!-- BEGIN:react-dashboard-loading-rules -->
## React Dashboards: Chart Mounting & State-Sync Cache Seeding

When implementing or refactoring dashboards, data loaders, and chart visualisations:
1. **Persistent Chart Mounting**: Do not conditionally unmount chart components (e.g. components rendering Recharts `<ResponsiveContainer>` or other responsive SVG widgets) when loading observations. Doing so destroys the DOM nodes, forcing them to initialize at size `0x0` and recalculate layout on remount, creating visual double flickering. Keep components mounted and render loading indicators as an absolute-positioned overlay (e.g. `absolute inset-0 z-40 bg-slate-50/70 backdrop-blur-[1px]`) while applying dimming classes (e.g. `opacity-25 pointer-events-none`) to the chart container.
2. **Double-Seeding Adjusted Cache Ranges**: When a fetch hook queries data based on user range selections, but the backend adjusts the parameters to fit physical limits (e.g. returning `effectiveRange.adjusted = true` with a shorter date range), updating state variables triggers the fetch hook to re-run. To prevent a duplicate API call and loading flicker, you MUST seed the cache under both the requested parameters and the adjusted parameters, so the subsequent run results in a synchronous cache hit.
<!-- END:react-dashboard-loading-rules -->

