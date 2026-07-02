<!-- BEGIN:meteorological-filtering-rules -->
## Meteorological Data Filtering & Sanity Checks

When implementing data cleaning pipelines, sanity checks, or anomaly detection for meteorological data:
1. **Never assume Northern Hemisphere seasons**: Do not hardcode filters based on the month (e.g., assuming May-September is "summer" and dropping freezing temperatures). European countries operate WIGOS stations globally, including in Antarctica, where those months correspond to deep winter.
2. **Use location-agnostic algorithms**: Prefer dynamic anomaly detection (e.g., rolling local medians, rate-of-change spike filters, or Z-scores) over static, date-based physical bounds to catch sensor glitches like shorted thermistors (-39.6°C, -40°C).
3. **Enforce absolute physical zero bounds**: Always explicitly strip negative values (`< 0`) for strictly non-negative physical parameters, including: precipitation (and rainfall rates), wind speed (and gusts), relative humidity, solar radiation, and sunshine duration. Do not rely on error-code registries alone, as sensors often report slight negative numbers (e.g. `-0.1`) due to calibration drift.
<!-- END:meteorological-filtering-rules -->
