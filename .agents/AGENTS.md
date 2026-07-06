<!-- BEGIN:meteorological-filtering-rules -->
## Meteorological Data Filtering & Sanity Checks

When implementing data cleaning pipelines, sanity checks, or anomaly detection for meteorological data:
1. **Never assume Northern Hemisphere seasons**: Do not hardcode filters based on the month (e.g., assuming May-September is "summer" and dropping freezing temperatures). European countries operate WIGOS stations globally, including in Antarctica, where those months correspond to deep winter.
2. **Use location-agnostic algorithms**: Prefer dynamic anomaly detection (e.g., rolling local medians, rate-of-change spike filters, or Z-scores) over static, date-based physical bounds to catch sensor glitches like shorted thermistors (-39.6°C, -40°C).
3. **Enforce absolute physical zero bounds**: Always explicitly strip negative values (`< 0`) for strictly non-negative physical parameters, including: precipitation (and rainfall rates), wind speed (and gusts), relative humidity, solar radiation, and sunshine duration. Do not rely on error-code registries alone, as sensors often report slight negative numbers (e.g. `-0.1`) due to calibration drift.
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
