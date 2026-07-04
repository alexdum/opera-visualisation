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
