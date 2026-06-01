import { NextResponse } from "next/server";
import { fetchBypassSSL } from "@/utils/http";
import { queryArchiveBatch } from "@/utils/duckdb";

// Build date strings (YYYY-MM-DD) for each day in the range
function buildDateRange(startDate: Date, endDate: Date): string[] {
  const dates: string[] = [];
  const curr = new Date(startDate.getTime());

  // Archive starts on 2026-03-05
  const archiveStart = new Date("2026-03-05T00:00:00Z");
  if (curr < archiveStart) {
    curr.setTime(archiveStart.getTime());
  }

  while (curr <= endDate) {
    const year = curr.getUTCFullYear();
    const month = String(curr.getUTCMonth() + 1).padStart(2, "0");
    const day = String(curr.getUTCDate()).padStart(2, "0");
    dates.push(`${year}-${month}-${day}`);
    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  return dates;
}

// Map a standard_name string to a HourlyRow field
function mapParamToRow(row: any, paramName: string, val: number): void {
  if (paramName.includes("minimum_air_temperature")) row.tempMin = val;
  else if (paramName.includes("maximum_air_temperature")) row.tempMax = val;
  else if (paramName.includes("minimum_temperature_at_height_above_ground_50cm")) row.tempMin50cm = val;
  else if (paramName.includes("minimum_grass_temperature") || paramName.includes("minimum_temperature_at_ground_level")) row.tempMinGround = val;
  else if (paramName.includes("air_temperature")) row.temperature = val;
  // Duration-specific precipitation columns (must come before generic precipitation)
  else if (paramName.includes("precipitation_amount_1h") || paramName.includes("rainfall_amount_1h")) row.precipitation1h = val;
  else if (paramName.includes("precipitation_amount_3h") || paramName.includes("rainfall_amount_3h")) row.precipitation3h = val;
  else if (paramName.includes("precipitation_amount_6h") || paramName.includes("rainfall_amount_6h")) row.precipitation6h = val;
  else if (paramName.includes("precipitation_amount_12h") || paramName.includes("rainfall_amount_12h")) row.precipitation12h = val;
  else if (paramName.includes("precipitation_amount_24h") || paramName.includes("rainfall_amount_24h")) row.precipitation24h = val;
  else if (paramName.includes("precipitation_amount") || paramName.includes("rainfall_amount")) row.precipitation = val;
  else if (paramName.includes("air_pressure_at_mean_sea_level")) row.pressure = val;
  // Pressure tendency must come before generic air_pressure
  else if (paramName.includes("tendency_of_surface_air_pressure")) row.pressureTendency = val;
  else if (paramName.includes("air_pressure") && !paramName.includes("mean_sea_level")) row.pressureStation = val;
  else if (paramName.includes("wind_speed_of_gust")) row.windGust = val;
  else if (paramName.includes("wind_gust_from_direction")) row.windGustDirection = val;
  else if (paramName.includes("wind_gust")) row.windGustInst = val;
  else if (paramName.includes("wind_speed_2m") || paramName.includes("height_above_ground_2m")) row.windSpeed2m = val;
  else if (paramName.includes("wind_speed")) row.windSpeed = val;
  else if (paramName.includes("wind_from_direction")) row.windDirection = val;
  else if (paramName.includes("relative_humidity")) {
    row.humidity = val > 100 ? val / 100 : val;
  } else if (paramName.includes("dew_point_temperature")) row.dewPoint = val;
  // Low cloud cover must come before generic cloud cover
  else if (paramName.includes("low_type_cloud_area_fraction")) row.cloudCoverLow = val;
  else if (paramName.includes("cloud_cover") || paramName.includes("cloud_area_fraction")) row.cloudCover = val;
  else if (paramName.includes("visibility_in_air") || paramName.includes("horizontal_visibility")) row.visibility = val;
  else if (paramName.includes("surface_downwelling_shortwave_flux_in_air")) row.solarRadiation = val;
  // duration_of_sunshine must come before sunshine_duration
  else if (paramName.includes("duration_of_sunshine")) row.sunshineDuration = val;
  else if (paramName.includes("sunshine_duration")) row.sunshineDuration = val;
  // surface_snow_thickness must come before snow_depth
  else if (paramName.includes("surface_snow_thickness")) row.snowDepth = val;
  else if (paramName.includes("snow_depth")) row.snowDepth = val;
  // thickness_of_snowfall_amount must come before surface_snow_amount
  else if (paramName.includes("thickness_of_snowfall_amount")) row.snowFresh = val;
  else if (paramName.includes("surface_snow_amount") || paramName.includes("fresh_snow")) row.snowFresh = val;
  else if (paramName.includes("soil_temperature")) {
    if (paramName.includes("10cm") || paramName.includes("0_1")) row.soilTemp10cm = val;
    else if (paramName.includes("20cm") || paramName.includes("0_2")) row.soilTemp20cm = val;
    else if (paramName.includes("50cm") || paramName.includes("0_5")) row.soilTemp50cm = val;
  } else if (paramName.includes("water_evaporation_amount")) row.etp = val;
  else {
    // Fallback: preserve unmapped standard_name as camelCase key
    const camelKey = paramName.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    row[camelKey] = val;
  }
}

const BAD_VALUES = new Set([9999, -9999, -999.9, -999, 999.9]);

function isBadValue(v: number): boolean {
  return v === null || v === undefined || isNaN(v) || BAD_VALUES.has(v);
}

// ---------------------------------------------------------------------------
// Physical sanity bounds (matching R clean_weather_data())
// ---------------------------------------------------------------------------
function cleanWeatherData(rows: any[]): any[] {
  const bounds: Record<string, [number, number]> = {
    temperature:     [-90, 60],
    tempMin:         [-90, 60],
    tempMax:         [-90, 60],
    tempMin50cm:     [-90, 60],
    tempMinGround:   [-90, 70],
    dewPoint:        [-90, 60],
    humidity:        [0, 100],
    precipitation:   [0, 500],
    pressure:        [800, 1100],
    pressureStation: [500, 1100],
    pressureTendency:[-50, 50],
    cloudCover:      [0, 100],
    cloudCoverLow:   [0, 100],
    solarRadiation:  [0, 3500],
    snowDepth:       [0, 1000],
    snowFresh:       [0, 500],
    etp:             [0, 600],
    sunshineDuration:[0, 1440],
    soilTemp10cm:    [-50, 60],
    soilTemp20cm:    [-50, 60],
    soilTemp50cm:    [-50, 60],
    visibility:      [0, 200000],
    windGustDirection: [0, 360],
    windDirection:   [0, 360],
    precipitation1h: [0, 200],
    precipitation3h: [0, 300],
    precipitation6h: [0, 400],
    precipitation12h:[0, 500],
    precipitation24h:[0, 800],
  };

  for (const row of rows) {
    for (const [key, [lo, hi]] of Object.entries(bounds)) {
      const val = row[key];
      if (val !== undefined && val !== null && (val < lo || val > hi)) {
        delete row[key];
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Dew point synthesis (Magnus formula, matching R calculate_dew_point())
// ---------------------------------------------------------------------------
function calculateDewPoint(temp: number, rh: number): number {
  const a = 17.625;
  const b = 243.04;
  const alpha = Math.log(rh / 100) + (a * temp) / (b + temp);
  return (b * alpha) / (a - alpha);
}

function synthesizeDewPoint(rows: any[]): void {
  for (const row of rows) {
    if (
      row.dewPoint === undefined &&
      row.temperature !== undefined &&
      row.humidity !== undefined &&
      !isNaN(row.temperature) &&
      !isNaN(row.humidity) &&
      row.humidity > 0 && row.humidity <= 100
    ) {
      const dp = calculateDewPoint(row.temperature, row.humidity);
      if (isFinite(dp) && dp >= -90 && dp <= 60) {
        row.dewPoint = Math.round(dp * 10) / 10;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Parse ISO 8601 duration to seconds (e.g., "PT1H" → 3600, "PT3H" → 10800)
// ---------------------------------------------------------------------------
function parseDurationSeconds(dur: string | null | undefined): number {
  if (!dur) return 0;
  const match = dur.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!match) return Infinity; // Unknown format → deprioritize
  const days = parseInt(match[1] || "0");
  const hours = parseInt(match[2] || "0");
  const mins = parseInt(match[3] || "0");
  const secs = parseFloat(match[4] || "0");
  return days * 86400 + hours * 3600 + mins * 60 + secs;
}

// ---------------------------------------------------------------------------
// Check if a standard_name is precipitation-related
// ---------------------------------------------------------------------------
function isPrecipParam(name: string): boolean {
  return /precip|rain/i.test(name);
}

// ---------------------------------------------------------------------------
// Pivot long-format raw rows into wide HourlyRow objects
// With parameter variant selection (matching R select_preferred_param_names)
// ---------------------------------------------------------------------------
function pivotArchiveRows(rawRows: any[]): any[] {
  // Step 1: Group rows by (timestamp, standard_name) and pick best variant
  // For precipitation: prefer method=sum with shortest duration (PT1H > PT3H > PT6H)
  // For other params: prefer method=point with PT0S or no duration

  // Group by timestamp+paramName, keeping the best variant per group
  const bestByKey = new Map<string, { dt: string; paramName: string; value: number }>();

  // For each (timestamp, standard_name), track the best candidate with its rank
  const rankMap = new Map<string, { rank: number; value: number; dt: string; paramName: string }>();

  for (const row of rawRows) {
    const dt = row.datetime;
    const dtStr = typeof dt === "string" ? dt : dt instanceof Date ? dt.toISOString() : String(dt);
    const paramName: string = row.paramName || "";
    const method: string = (row.method || "").toLowerCase();
    const duration: string = row.duration || "";
    const durSeconds = parseDurationSeconds(duration);

    if (row.value === null || row.value === undefined || row.value === "") continue;
    const val = Number(row.value);
    if (isNaN(val) || isBadValue(val)) continue;

    const isPrecip = isPrecipParam(paramName);

    // For precipitation sum variants, create duration-specific param names
    let effectiveParamName = paramName;
    if (isPrecip && method === "sum" && durSeconds > 0) {
      const hours = Math.round(durSeconds / 3600);
      effectiveParamName = `${paramName}_${hours}h`;
    }

    // Compute preference rank (lower = better), matching R logic
    let rank: number;
    if (isPrecip) {
      if (method === "sum" && durSeconds === 3600) rank = 1;       // PT1H sum (best)
      else if (method === "sum" && durSeconds === 600) rank = 2;   // PT10M sum
      else if (method === "sum") rank = 3 + durSeconds / 86400;    // other sum (prefer shorter)
      else rank = 100;                                              // point/counter → reject
    } else {
      if (method === "point" && durSeconds <= 0) rank = 1;
      else if (method === "point") rank = 2 + durSeconds / 86400;
      else rank = 10 + durSeconds / 86400;
    }

    const key = `${dtStr}::${effectiveParamName}`;
    const existing = rankMap.get(key);
    if (!existing || rank < existing.rank) {
      rankMap.set(key, { rank, value: val, dt: dtStr, paramName: effectiveParamName });
    }
  }

  // Step 2: Pivot selected rows to wide format
  const wideRowsMap = new Map<string, any>();

  for (const entry of rankMap.values()) {
    if (isBadValue(entry.value)) continue;

    if (!wideRowsMap.has(entry.dt)) {
      wideRowsMap.set(entry.dt, { datetime: entry.dt });
    }

    mapParamToRow(wideRowsMap.get(entry.dt), entry.paramName, entry.value);
  }

  return Array.from(wideRowsMap.values());
}

// ---------------------------------------------------------------------------
// Archive fetch: download parquet shards via Node.js, query locally via DuckDB
// ---------------------------------------------------------------------------
async function fetchArchiveDetails(
  stationId: string,
  startDate: Date,
  endDate: Date,
  onProgress: (msg: string) => void
): Promise<any[]> {
  const dateStrs = buildDateRange(startDate, endDate);
  if (dateStrs.length === 0) return [];

  onProgress(`Preparing to fetch ${dateStrs.length} days from Hugging Face archive...`);

  const BATCH_SIZE = 10;
  const allRawRows: any[] = [];

  for (let i = 0; i < dateStrs.length; i += BATCH_SIZE) {
    const batch = dateStrs.slice(i, i + BATCH_SIZE);
    onProgress(`Downloading and querying archive batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(dateStrs.length / BATCH_SIZE)} (${batch[0]} to ${batch[batch.length - 1]})...`);

    try {
      const rows = await queryArchiveBatch(batch, stationId);
      allRawRows.push(...rows);
    } catch (error: any) {
      console.warn(
        `[api/observations/station-details]   Batch query error: ${error.message || error}`
      );
    }
  }

  if (allRawRows.length === 0) {
    return [];
  }

  onProgress(`Processing and aggregating ${allRawRows.length} archive observations...`);
  return pivotArchiveRows(allRawRows);
}

// ---------------------------------------------------------------------------
// Live fetch: MeteoGate CoverageJSON REST API
// ---------------------------------------------------------------------------
async function fetchLiveDetails(
  stationId: string,
  startDate: Date,
  endDate: Date,
  onProgress: (msg: string) => void
): Promise<{ rows: any[]; units: Record<string, string> }> {
  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();

  const url = `https://observations.meteogate.eu/collections/observations/locations/${stationId}?datetime=${startIso}/${endIso}&f=CoverageJSON`;

  onProgress(`Fetching live recent data from MeteoGate API...`);
  
  try {
    const rawData = await fetchBypassSSL(url);
    onProgress(`Parsing live data response...`);
    const json = JSON.parse(rawData);

    const coverages =
      json.type === "Coverage" ? [json] : json.coverages || [];
    if (coverages.length === 0) return { rows: [], units: {} };

    const parsedRows: any[] = [];
    const unitMap: Record<string, string> = {};

    coverages.forEach((coverage: any) => {
      const timestamps = coverage.domain?.axes?.t?.values || [];
      const ranges = coverage.ranges || {};

      if (timestamps.length === 0) return;

      // Extract units from CoverageJSON ranges metadata
      Object.keys(ranges).forEach((paramName) => {
        const observedProperty = ranges[paramName]?.observedProperty;
        const unitSymbol = observedProperty?.unit?.symbol?.value
          || observedProperty?.unit?.symbol
          || ranges[paramName]?.unit?.symbol?.value
          || ranges[paramName]?.unit?.symbol;
        if (unitSymbol && typeof unitSymbol === "string") {
          // Map the paramName to a known field key
          const testRow: any = {};
          mapParamToRow(testRow, paramName, 0);
          const mappedKey = Object.keys(testRow)[0];
          if (mappedKey) {
            unitMap[mappedKey] = unitSymbol;
          }
        }
      });

      timestamps.forEach((ts: string, index: number) => {
        const row: any = { datetime: ts };

        Object.keys(ranges).forEach((paramName) => {
          const values = ranges[paramName]?.values || [];
          const val = values[index];

          if (val !== null && val !== undefined && !isBadValue(val)) {
            mapParamToRow(row, paramName, val);
          }
        });

        parsedRows.push(row);
      });
    });

    return { rows: parsedRows, units: unitMap };
  } catch (error) {
    console.error(
      "[api/observations/station-details] Live REST API fetch error:",
      error
    );
    return { rows: [], units: {} };
  }
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const stationId = searchParams.get("stationId");
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!stationId || !start || !end) {
    return NextResponse.json(
      { success: false, message: "Missing required query params" },
      { status: 400 }
    );
  }

  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T23:59:59Z`);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return NextResponse.json(
      { success: false, message: "Invalid date format" },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(event: string, data: any) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }
      
      function sendProgress(msg: string) {
        sendEvent("progress", { message: msg });
      }

      try {
        // Hybrid Cutoff Strategy (rolling 24 hours ago)
        const apiCutoff = new Date();
        apiCutoff.setUTCHours(apiCutoff.getUTCHours() - 24);

        let archiveRows: any[] = [];
        let liveRows: any[] = [];
        let liveUnits: Record<string, string> = {};

        // Fetch Archive if requested range overlaps with past data (before cutoff)
        if (startDate < apiCutoff) {
          const archiveEnd =
            endDate < apiCutoff
              ? endDate
              : new Date(apiCutoff.getTime() - 1000);
          archiveRows = await fetchArchiveDetails(stationId, startDate, archiveEnd, sendProgress);
        }

        // Fetch Live API if requested range overlaps with recent data (after cutoff)
        if (endDate > apiCutoff) {
          const liveStart = startDate > apiCutoff ? startDate : apiCutoff;
          const liveResult = await fetchLiveDetails(stationId, liveStart, endDate, sendProgress);
          liveRows = liveResult.rows;
          liveUnits = liveResult.units;
        }

        sendProgress("Merging and sorting datasets...");

        // Merge both datasets using a map to deduplicate by datetime
        const mergedMap = new Map<string, any>();

        archiveRows.forEach((row) => {
          mergedMap.set(row.datetime, row);
        });

        liveRows.forEach((row) => {
          const existing = mergedMap.get(row.datetime);
          if (existing) {
            mergedMap.set(row.datetime, { ...existing, ...row });
          } else {
            mergedMap.set(row.datetime, row);
          }
        });

        let mergedRows = Array.from(mergedMap.values());

        // Sort rows by datetime ascending
        mergedRows.sort(
          (a, b) =>
            new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
        );

        // Apply physical sanity bounds cleaning (matching R clean_weather_data)
        sendProgress("Applying quality control filters...");
        mergedRows = cleanWeatherData(mergedRows);

        // Synthesize dew point from temperature + humidity where missing
        synthesizeDewPoint(mergedRows);

        // Build hardcoded default units, overridden by live API units
        const defaultUnits: Record<string, string> = {
          temperature: "°C", tempMin: "°C", tempMax: "°C",
          tempMin50cm: "°C", tempMinGround: "°C",
          dewPoint: "°C",
          humidity: "%",
          precipitation: "mm",
          precipitation1h: "mm", precipitation3h: "mm",
          precipitation6h: "mm", precipitation12h: "mm",
          precipitation24h: "mm",
          pressure: "hPa", pressureStation: "hPa",
          pressureTendency: "hPa/3h",
          windSpeed: "m/s", windSpeed2m: "m/s",
          windGust: "m/s", windGustInst: "m/s",
          windGustDirection: "°",
          windDirection: "°",
          cloudCover: "%",
          cloudCoverLow: "%",
          visibility: "m",
          solarRadiation: "W/m²",
          sunshineDuration: "min",
          snowDepth: "cm", snowFresh: "cm",
          soilTemp10cm: "°C", soilTemp20cm: "°C", soilTemp50cm: "°C",
          etp: "mm",
        };
        const units = { ...defaultUnits, ...liveUnits };

        sendEvent("complete", { success: true, data: mergedRows, units });
        controller.close();
      } catch (error: any) {
        console.error("[api/observations/station-details] Error:", error);
        sendEvent("error", { success: false, message: error.message });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
