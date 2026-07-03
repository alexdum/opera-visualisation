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
