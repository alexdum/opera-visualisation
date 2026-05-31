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
  else if (paramName.includes("precipitation_amount") || paramName.includes("rainfall_amount")) row.precipitation = val;
  else if (paramName.includes("air_pressure_at_mean_sea_level")) row.pressure = val;
  else if (paramName.includes("air_pressure") && !paramName.includes("mean_sea_level")) row.pressureStation = val;
  else if (paramName.includes("wind_speed_of_gust")) row.windGust = val;
  else if (paramName.includes("wind_gust")) row.windGustInst = val;
  else if (paramName.includes("wind_speed_2m") || paramName.includes("height_above_ground_2m")) row.windSpeed2m = val;
  else if (paramName.includes("wind_speed")) row.windSpeed = val;
  else if (paramName.includes("wind_from_direction")) row.windDirection = val;
  else if (paramName.includes("relative_humidity")) {
    row.humidity = val > 100 ? val / 100 : val;
  } else if (paramName.includes("dew_point_temperature")) row.dewPoint = val;
  else if (paramName.includes("cloud_cover") || paramName.includes("cloud_area_fraction")) row.cloudCover = val;
  else if (paramName.includes("visibility_in_air") || paramName.includes("horizontal_visibility")) row.visibility = val;
  else if (paramName.includes("surface_downwelling_shortwave_flux_in_air")) row.solarRadiation = val;
  else if (paramName.includes("sunshine_duration")) row.sunshineDuration = val;
  else if (paramName.includes("snow_depth")) row.snowDepth = val;
  else if (paramName.includes("surface_snow_amount") || paramName.includes("fresh_snow")) row.snowFresh = val;
  else if (paramName.includes("soil_temperature")) {
    if (paramName.includes("10cm") || paramName.includes("0_1")) row.soilTemp10cm = val;
    else if (paramName.includes("20cm") || paramName.includes("0_2")) row.soilTemp20cm = val;
    else if (paramName.includes("50cm") || paramName.includes("0_5")) row.soilTemp50cm = val;
  } else if (paramName.includes("water_evaporation_amount")) row.etp = val;
}

const BAD_VALUES = new Set([9999, -9999, -999.9, -999, 999.9]);

function isBadValue(v: number): boolean {
  return v === null || v === undefined || isNaN(v) || BAD_VALUES.has(v);
}

// Pivot long-format raw rows into wide HourlyRow objects
function pivotArchiveRows(rawRows: any[]): any[] {
  // Aggregate duplicates (same timestamp + paramName) by averaging
  const aggMap = new Map<string, { sum: number; count: number }>();

  for (const row of rawRows) {
    const dt = row.datetime;
    const dtStr =
      typeof dt === "string"
        ? dt
        : dt instanceof Date
          ? dt.toISOString()
          : String(dt);
    const param = row.paramName;
    
    // Explicitly reject null or undefined BEFORE Number() coercion (Number(null) === 0!)
    if (row.value === null || row.value === undefined || row.value === "") continue;
    
    const val = Number(row.value);

    if (isNaN(val) || isBadValue(val)) continue;

    const key = `${dtStr}::${param}`;
    const existing = aggMap.get(key);
    if (existing) {
      existing.sum += val;
      existing.count += 1;
    } else {
      aggMap.set(key, { sum: val, count: 1 });
    }
  }

  // Pivot to wide format
  const wideRowsMap = new Map<string, any>();

  for (const [key, agg] of aggMap.entries()) {
    const [dtStr, paramName] = key.split("::");
    const meanVal = agg.sum / agg.count;

    if (isBadValue(meanVal)) continue;

    if (!wideRowsMap.has(dtStr)) {
      wideRowsMap.set(dtStr, { datetime: dtStr });
    }

    mapParamToRow(wideRowsMap.get(dtStr), paramName, meanVal);
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
): Promise<any[]> {
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
    if (coverages.length === 0) return [];

    const parsedRows: any[] = [];

    coverages.forEach((coverage: any) => {
      const timestamps = coverage.domain?.axes?.t?.values || [];
      const ranges = coverage.ranges || {};

      if (timestamps.length === 0) return;

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

    return parsedRows;
  } catch (error) {
    console.error(
      "[api/observations/station-details] Live REST API fetch error:",
      error
    );
    return [];
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
          liveRows = await fetchLiveDetails(stationId, liveStart, endDate, sendProgress);
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

        const mergedRows = Array.from(mergedMap.values());

        // Sort rows by datetime ascending
        mergedRows.sort(
          (a, b) =>
            new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
        );

        sendEvent("complete", { success: true, data: mergedRows });
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
