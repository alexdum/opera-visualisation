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

Calling `/api/stations` may rewrite `src/data/meteogate_stations_cache.csv` as a side effect after a successful remote fetch. Do not keep that generated CSV churn in a change unless the user explicitly asked to refresh the cache.
