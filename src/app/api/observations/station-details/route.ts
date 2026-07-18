import { NextResponse } from "next/server";
import { fetchBypassSSL } from "@/utils/http";
import { queryArchiveBatch } from "@/utils/duckdb";
import NodeCache from "node-cache";
import { applyQualityControl, HourlyRow } from "@/utils/qc";

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

interface RawArchiveRow {
  datetime: string | Date;
  paramName?: string;
  value?: number | string | null;
  method?: string;
  duration?: string;
}

// Map a standard_name string to a HourlyRow field
function mapParamToRow(row: HourlyRow, paramName: string, val: number, unit?: string): void {
  // Determine conversion factor for sunshine duration to always store in minutes.
  // WMO CF standard implies seconds (divisor=60), but providers might explicitly send 'min' or 'h'.
  let sunshineDivisor = 60;
  if (unit) {
    const u = unit.toLowerCase();
    if (u === "min" || u === "minutes" || u === "minute") sunshineDivisor = 1;
    else if (u === "h" || u === "hour" || u === "hours" || u === "hr") sunshineDivisor = 1 / 60; // 1 hr / (1/60) = 60 min
    else if (u === "s" || u === "sec" || u === "seconds") sunshineDivisor = 60;
  }

  if (paramName.includes("minimum_air_temperature")) row.tempMin = val;
  else if (paramName.includes("maximum_air_temperature")) row.tempMax = val;
  else if (paramName.includes("minimum_temperature_at_height_above_ground_50cm")) row.tempMin50cm = val;
  else if (paramName.includes("minimum_grass_temperature") || paramName.includes("minimum_temperature_at_ground_level")) row.tempMinGround = val;
  else if (paramName.includes("air_temperature")) row.temperature = val;
  // Duration-specific precipitation columns (must come before generic precipitation)
  else if (paramName.includes("precipitation_amount_1h") || paramName.includes("rainfall_amount_1h") || ((paramName.includes("precipitation") || paramName.includes("rain")) && paramName.includes("PT1H"))) row.precipitation1h = val;
  else if (paramName.includes("precipitation_amount_3h") || paramName.includes("rainfall_amount_3h") || ((paramName.includes("precipitation") || paramName.includes("rain")) && paramName.includes("PT3H"))) row.precipitation3h = val;
  else if (paramName.includes("precipitation_amount_6h") || paramName.includes("rainfall_amount_6h") || ((paramName.includes("precipitation") || paramName.includes("rain")) && paramName.includes("PT6H"))) row.precipitation6h = val;
  else if (paramName.includes("precipitation_amount_12h") || paramName.includes("rainfall_amount_12h") || ((paramName.includes("precipitation") || paramName.includes("rain")) && paramName.includes("PT12H"))) row.precipitation12h = val;
  else if (paramName.includes("precipitation_amount_24h") || paramName.includes("rainfall_amount_24h") || ((paramName.includes("precipitation") || paramName.includes("rain")) && paramName.includes("PT24H"))) row.precipitation24h = val;
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
  // duration_of_sunshine must come before sunshine_duration. Values are usually in seconds (WMO standard), so we convert to minutes (/60).
  else if (paramName.includes("duration_of_sunshine_10m") || paramName.includes("sunshine_duration_10m") || ((paramName.includes("sunshine") || paramName.includes("duration")) && paramName.includes("PT10M"))) row.sunshineDuration10m = val / sunshineDivisor;
  else if (paramName.includes("duration_of_sunshine_1h") || paramName.includes("sunshine_duration_1h") || ((paramName.includes("sunshine") || paramName.includes("duration")) && paramName.includes("PT1H"))) row.sunshineDuration1h = val / sunshineDivisor;
  else if (paramName.includes("duration_of_sunshine_3h") || paramName.includes("sunshine_duration_3h") || ((paramName.includes("sunshine") || paramName.includes("duration")) && paramName.includes("PT3H"))) row.sunshineDuration3h = val / sunshineDivisor;
  else if (paramName.includes("duration_of_sunshine_6h") || paramName.includes("sunshine_duration_6h") || ((paramName.includes("sunshine") || paramName.includes("duration")) && paramName.includes("PT6H"))) row.sunshineDuration6h = val / sunshineDivisor;
  else if (paramName.includes("duration_of_sunshine_12h") || paramName.includes("sunshine_duration_12h") || ((paramName.includes("sunshine") || paramName.includes("duration")) && paramName.includes("PT12H"))) row.sunshineDuration12h = val / sunshineDivisor;
  else if (paramName.includes("duration_of_sunshine_24h") || paramName.includes("sunshine_duration_24h") || ((paramName.includes("sunshine") || paramName.includes("duration")) && paramName.includes("PT24H"))) row.sunshineDuration24h = val / sunshineDivisor;
  else if (paramName.includes("duration_of_sunshine") || paramName.includes("sunshine_duration")) row.sunshineDuration = val / sunshineDivisor;
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

const BAD_VALUES = new Set([9999, -9999, -999.9, -999, 999.9, 32767, -32767, -32768, -32766, 65535, 9999.9, -9999.9]);
const SUB_HOURLY_TIMESTAMP_THRESHOLD = 26;
const MAX_HOURLY_WINDOW_DAYS = 31;
const MIN_RECURRING_INTERVAL_COUNT = 2;

type TimestampResolution = {
  isSubHourly: boolean;
  intervalMinutes: number | null;
  label: string | null;
  maxTimestampsPerDay: number;
};

function getRangeLimitDays(intervalMinutes: number | null): number | null {
  if (intervalMinutes === null) return MAX_HOURLY_WINDOW_DAYS;
  if (intervalMinutes <= 1) return 3;
  if (intervalMinutes <= 5) return 10;
  if (intervalMinutes <= 10) return 15;
  if (intervalMinutes <= 30) return 20;
  return MAX_HOURLY_WINDOW_DAYS;
}

function isBadValue(v: number): boolean {
  return v === null || v === undefined || isNaN(v) || BAD_VALUES.has(v);
}

function formatUtcDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLimitedWindowStart(endDate: Date, limitDays: number): Date {
  const start = new Date(Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate()
  ));
  start.setUTCDate(start.getUTCDate() - (limitDays - 1));
  return start;
}

function maxDate(a: Date, b: Date): Date {
  return a > b ? a : b;
}

function getTimestampParts(
  value: unknown
): { dayKey: string; timestampKey: string; timestampMs: number | null } | null {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const iso = value.toISOString();
    return { dayKey: iso.slice(0, 10), timestampKey: iso, timestampMs: value.getTime() };
  }

  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const parsed = new Date(value);
  const timestampMs = isNaN(parsed.getTime()) ? null : parsed.getTime();

  const dayMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dayMatch) {
    return { dayKey: dayMatch[1], timestampKey: value, timestampMs };
  }

  if (timestampMs === null) return null;

  const iso = parsed.toISOString();
  return { dayKey: iso.slice(0, 10), timestampKey: iso, timestampMs };
}

function formatIntervalLabel(intervalMinutes: number | null): string | null {
  if (intervalMinutes === null) return null;
  if (intervalMinutes === 60) return "hourly";
  if (intervalMinutes % 60 === 0) {
    const hours = intervalMinutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${intervalMinutes} min`;
}

function preferHigherFrequencyResolution(
  current: TimestampResolution,
  candidate: TimestampResolution
): TimestampResolution {
  const maxTimestampsPerDay = Math.max(
    current.maxTimestampsPerDay,
    candidate.maxTimestampsPerDay
  );
  const isSubHourly =
    current.isSubHourly ||
    candidate.isSubHourly ||
    maxTimestampsPerDay > SUB_HOURLY_TIMESTAMP_THRESHOLD;
  const shouldUseCandidate =
    current.intervalMinutes === null ||
    (
      candidate.intervalMinutes !== null &&
      candidate.intervalMinutes < current.intervalMinutes
    ) ||
    (
      candidate.intervalMinutes === current.intervalMinutes &&
      candidate.maxTimestampsPerDay > current.maxTimestampsPerDay
    );
  const chosen = shouldUseCandidate ? candidate : current;

  return {
    isSubHourly,
    intervalMinutes: chosen.intervalMinutes,
    label: formatIntervalLabel(chosen.intervalMinutes),
    maxTimestampsPerDay,
  };
}

function analyzeTimestampResolution(rows: Array<{ datetime?: unknown }>): TimestampResolution {
  const timestampsByDay = new Map<string, Map<string, number | null>>();

  for (const row of rows) {
    const timestampParts = getTimestampParts(row?.datetime);
    if (!timestampParts) continue;

    let timestamps = timestampsByDay.get(timestampParts.dayKey);
    if (!timestamps) {
      timestamps = new Map<string, number | null>();
      timestampsByDay.set(timestampParts.dayKey, timestamps);
    }

    if (!timestamps.has(timestampParts.timestampKey)) {
      timestamps.set(timestampParts.timestampKey, timestampParts.timestampMs);
    }
  }

  let maxTimestampsPerDay = 0;
  const intervalCounts = new Map<number, number>();

  for (const timestamps of timestampsByDay.values()) {
    maxTimestampsPerDay = Math.max(maxTimestampsPerDay, timestamps.size);

    const timestampValues = Array.from(timestamps.values())
      .filter((timestampMs): timestampMs is number => typeof timestampMs === "number")
      .sort((a, b) => a - b);

    for (let i = 1; i < timestampValues.length; i++) {
      const diffMinutes = Math.round((timestampValues[i] - timestampValues[i - 1]) / 60000);
      if (diffMinutes <= 0 || diffMinutes > 24 * 60) continue;
      intervalCounts.set(diffMinutes, (intervalCounts.get(diffMinutes) || 0) + 1);
    }
  }

  let intervalMinutes: number | null = null;
  for (const [minutes, frequency] of intervalCounts) {
    if (frequency < MIN_RECURRING_INTERVAL_COUNT) continue;
    if (intervalMinutes === null || minutes < intervalMinutes) {
      intervalMinutes = minutes;
    }
  }

  if (intervalMinutes === null) {
    for (const minutes of intervalCounts.keys()) {
      if (intervalMinutes === null || minutes < intervalMinutes) {
        intervalMinutes = minutes;
      }
    }
  }

  return {
    isSubHourly: maxTimestampsPerDay > SUB_HOURLY_TIMESTAMP_THRESHOLD,
    intervalMinutes,
    label: formatIntervalLabel(intervalMinutes),
    maxTimestampsPerDay,
  };
}

function filterRowsFromDate<T extends { datetime?: unknown }>(
  rows: T[],
  minDateKey: string
): T[] {
  return rows.filter((row) => {
    const timestampParts = getTimestampParts(row?.datetime);
    return timestampParts ? timestampParts.dayKey >= minDateKey : true;
  });
}

// cleanWeatherData was removed in favor of canonical applyQualityControl from @/utils/qc

// ---------------------------------------------------------------------------
// Dew point synthesis (Magnus formula, matching R calculate_dew_point())
// ---------------------------------------------------------------------------
function calculateDewPoint(temp: number, rh: number): number {
  const a = 17.625;
  const b = 243.04;
  const alpha = Math.log(rh / 100) + (a * temp) / (b + temp);
  return (b * alpha) / (a - alpha);
}

function synthesizeDewPoint(rows: HourlyRow[]): void {
  for (const row of rows) {
    if (
      row.dewPoint === undefined &&
      row.temperature !== undefined &&
      row.temperature !== null &&
      row.humidity !== undefined &&
      row.humidity !== null &&
      typeof row.temperature === "number" &&
      typeof row.humidity === "number" &&
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
function pivotArchiveRows(rawRows: RawArchiveRow[]): HourlyRow[] {
  // Step 1: Group rows by (timestamp, standard_name) and pick best variant
  // For precipitation: prefer method=sum with shortest duration (PT1H > PT3H > PT6H)
  // For other params: prefer method=point with PT0S or no duration

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
  const wideRowsMap = new Map<string, HourlyRow>();

  for (const entry of rankMap.values()) {
    if (isBadValue(entry.value)) continue;

    if (!wideRowsMap.has(entry.dt)) {
      wideRowsMap.set(entry.dt, { datetime: entry.dt });
    }

    mapParamToRow(wideRowsMap.get(entry.dt)!, entry.paramName, entry.value);
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
  onProgress: (msg: string) => void,
  options: { detectSubHourly?: boolean; rangeLimitDays?: number; limitWindowStart?: Date; rangeAnchorDate?: Date } = {}
): Promise<{ rows: HourlyRow[]; resolution: TimestampResolution; rangeLimitDays: number | null }> {
  const dateStrs = buildDateRange(startDate, endDate);
  const emptyResolution = analyzeTimestampResolution([]);
  if (dateStrs.length === 0) {
    return { rows: [], resolution: emptyResolution, rangeLimitDays: null };
  }

  onProgress(`Preparing to fetch ${dateStrs.length} days from Hugging Face archive...`);

  const BATCH_SIZE = 10;
  const allRawRows: RawArchiveRow[] = [];
  const batches: string[][] = [];
  const shouldDetectSubHourly = options.detectSubHourly ?? true;
  let rangeLimitDays = options.rangeLimitDays ?? MAX_HOURLY_WINDOW_DAYS;
  const rangeAnchorDate = options.rangeAnchorDate ?? endDate;
  let limitWindowStartKey = formatUtcDateKey(
    options.limitWindowStart ?? getLimitedWindowStart(rangeAnchorDate, rangeLimitDays)
  );
  let archiveIsSubHourly = false;
  let archiveResolution = emptyResolution;

  for (let end = dateStrs.length; end > 0; end -= BATCH_SIZE) {
    const start = Math.max(0, end - BATCH_SIZE);
    batches.push(dateStrs.slice(start, end));
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = archiveIsSubHourly
      ? batches[i].filter((dateStr) => dateStr >= limitWindowStartKey)
      : batches[i];

    if (batch.length === 0) {
      onProgress(`Reached ${rangeLimitDays}-day ${archiveResolution.label || "sub-hourly"} archive limit; stopping older archive fetches.`);
      break;
    }

    onProgress(`Downloading and querying archive batch ${i + 1} of ${batches.length} (${batch[0]} to ${batch[batch.length - 1]})...`);

    try {
      const rows = await queryArchiveBatch<RawArchiveRow>(batch, stationId);
      allRawRows.push(...(archiveIsSubHourly ? filterRowsFromDate(rows, limitWindowStartKey) : rows));

      const batchResolution = analyzeTimestampResolution(rows);
      archiveResolution = preferHigherFrequencyResolution(
        archiveResolution,
        batchResolution
      );

      if (shouldDetectSubHourly && !archiveIsSubHourly && batchResolution.isSubHourly) {
        archiveIsSubHourly = true;
        rangeLimitDays = getRangeLimitDays(batchResolution.intervalMinutes) ?? MAX_HOURLY_WINDOW_DAYS;
        limitWindowStartKey = formatUtcDateKey(getLimitedWindowStart(rangeAnchorDate, rangeLimitDays));
        onProgress(`Detected ${batchResolution.label || "sub-hourly"} archive data; limiting archive history to ${rangeLimitDays} days.`);

        const clampedRows = filterRowsFromDate(allRawRows, limitWindowStartKey);
        allRawRows.length = 0;
        allRawRows.push(...clampedRows);
      }
    } catch (error) {
      const err = error as Error;
      console.warn(
        `[api/observations/station-details]   Batch query error: ${err.message || err}`
      );
    }
  }

  if (allRawRows.length === 0) {
    return {
      rows: [],
      resolution: { ...archiveResolution, isSubHourly: archiveIsSubHourly },
      rangeLimitDays: archiveIsSubHourly ? rangeLimitDays : null,
    };
  }

  onProgress(`Processing and aggregating ${allRawRows.length} archive observations...`);
  return {
    rows: pivotArchiveRows(allRawRows),
    resolution: { ...archiveResolution, isSubHourly: archiveIsSubHourly },
    rangeLimitDays: archiveIsSubHourly ? rangeLimitDays : null,
  };
}

const liveDataCache = new NodeCache({ stdTTL: 300, checkperiod: 120, useClones: false });
interface CoverageRange {
  observedProperty?: {
    unit?: {
      symbol?: unknown;
    };
  };
  unit?: {
    symbol?: unknown;
  };
  values?: Array<number | string | null>;
}

function getSymbolString(symbol: unknown): string | undefined {
  if (typeof symbol === "string") return symbol;
  if (symbol && typeof symbol === "object" && "value" in symbol) {
    const val = (symbol as { value?: unknown }).value;
    if (typeof val === "string") return val;
  }
  return undefined;
}

interface MeteoGateCoverage {
  domain?: {
    axes?: {
      t?: {
        values?: string[];
      };
    };
  };
  ranges?: Record<string, CoverageRange>;
}

const liveInFlight = new Map<string, Promise<{ rows: HourlyRow[]; units: Record<string, string> }>>();

// ---------------------------------------------------------------------------
// Live fetch: MeteoGate CoverageJSON REST API
// ---------------------------------------------------------------------------
async function fetchLiveDetails(
  stationId: string,
  startDate: Date,
  endDate: Date,
  onProgress: (msg: string) => void
): Promise<{ rows: HourlyRow[]; units: Record<string, string> }> {
  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();
  const cacheKey = `live:${stationId}:${startIso}:${endIso}`;

  const cached = liveDataCache.get<{ rows: HourlyRow[]; units: Record<string, string> }>(cacheKey);
  if (cached) {
    onProgress(`Loaded live data from cache...`);
    return cached;
  }

  const inFlight = liveInFlight.get(cacheKey);
  if (inFlight) {
    onProgress(`Waiting for in-flight live data request...`);
    return inFlight;
  }

  const fetchAndCache = async (): Promise<{ rows: HourlyRow[]; units: Record<string, string> }> => {
    const url = `https://observations.meteogate.eu/collections/observations/locations/${stationId}?datetime=${startIso}/${endIso}&f=CoverageJSON`;

    onProgress(`Fetching live recent data from MeteoGate API...`);

    try {
      const rawData = await fetchBypassSSL(url);
      onProgress(`Parsing live data response...`);
      const json = JSON.parse(rawData);

      const coverages =
        json.type === "Coverage" ? [json] : json.coverages || [];
      if (coverages.length === 0) return { rows: [], units: {} };

      const parsedRows: HourlyRow[] = [];
      const unitMap: Record<string, string> = {};

      coverages.forEach((coverage: MeteoGateCoverage) => {
        const timestamps = coverage.domain?.axes?.t?.values || [];
        const ranges = coverage.ranges || {};

        if (timestamps.length === 0) return;

        // Extract units from CoverageJSON ranges metadata
        Object.keys(ranges).forEach((paramName) => {
          const observedProperty = ranges[paramName]?.observedProperty;
          const unitSymbol = getSymbolString(observedProperty?.unit?.symbol)
            || getSymbolString(ranges[paramName]?.unit?.symbol);
          if (unitSymbol && typeof unitSymbol === "string") {
            // Map the paramName to a known field key
            const testRow: HourlyRow = { datetime: "" };
            mapParamToRow(testRow, paramName, 0);
            const mappedKey = Object.keys(testRow).filter(k => k !== "datetime")[0];
            if (mappedKey) {
              // Sunshine values are always converted to minutes internally,
              // so force the display unit to "min" regardless of the raw API unit
              if (mappedKey.startsWith("sunshineDuration")) {
                unitMap[mappedKey] = "min";
              } else {
                unitMap[mappedKey] = unitSymbol;
              }
            }
          }
        });

        timestamps.forEach((ts: string, index: number) => {
          const row: HourlyRow = { datetime: ts };

          Object.keys(ranges).forEach((paramName) => {
            const values = ranges[paramName]?.values || [];
            const val = values[index];

            const observedProperty = ranges[paramName]?.observedProperty;
            const unitSymbol = getSymbolString(observedProperty?.unit?.symbol)
              || getSymbolString(ranges[paramName]?.unit?.symbol);

            if (val !== null && val !== undefined && typeof val === "number" && !isBadValue(val)) {
              mapParamToRow(row, paramName, val, unitSymbol);
            }
          });

          parsedRows.push(row);
        });
      });

      const result = { rows: parsedRows, units: unitMap };
      liveDataCache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error(
        "[api/observations/station-details] Live REST API fetch error:",
        error
      );
      return { rows: [], units: {} };
    }
  };

  // Register the in-flight promise BEFORE starting execution to prevent
  // concurrent requests from firing duplicate HTTP calls.
  const promise = fetchAndCache();
  liveInFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    liveInFlight.delete(cacheKey);
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
      let streamClosed = false;

      function closeStream() {
        if (streamClosed) return;
        streamClosed = true;
        try {
          controller.close();
        } catch {
          // The client may have already closed the SSE connection.
        }
      }

      function sendEvent(event: string, data: unknown): boolean {
        if (streamClosed || request.signal.aborted) {
          streamClosed = true;
          return false;
        }

        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          return true;
        } catch {
          streamClosed = true;
          return false;
        }
      }

      function sendProgress(msg: string) {
        sendEvent("progress", { message: msg });
      }

      try {
        // Hybrid Cutoff Strategy (rolling 24 hours ago)
        const apiCutoff = new Date();
        apiCutoff.setUTCHours(apiCutoff.getUTCHours() - 24);

        let archiveRows: HourlyRow[] = [];
        let liveRows: HourlyRow[] = [];
        let liveUnits: Record<string, string> = {};
        let stationIsSubHourly = false;
        let rangeLimitDays = MAX_HOURLY_WINDOW_DAYS;
        let limitWindowStart = getLimitedWindowStart(endDate, rangeLimitDays);
        let effectiveStart = start;
        let rangeAdjusted = startDate < limitWindowStart;
        if (rangeAdjusted) {
          effectiveStart = formatUtcDateKey(limitWindowStart);
        }
        let stationResolution = analyzeTimestampResolution([]);

        // Fetch Live API first so dense recent data can clamp archive history.
        if (endDate > apiCutoff) {
          const liveStart = startDate > apiCutoff ? startDate : apiCutoff;
          const liveResult = await fetchLiveDetails(stationId, liveStart, endDate, sendProgress);
          liveRows = liveResult.rows;
          liveUnits = liveResult.units;
          const liveResolution = analyzeTimestampResolution(liveRows);

          stationResolution = preferHigherFrequencyResolution(
            stationResolution,
            liveResolution
          );

          if (liveResolution.isSubHourly) {
            stationIsSubHourly = true;
            rangeLimitDays = getRangeLimitDays(liveResolution.intervalMinutes) ?? MAX_HOURLY_WINDOW_DAYS;
            limitWindowStart = getLimitedWindowStart(endDate, rangeLimitDays);
            sendProgress(`Detected ${liveResolution.label || "sub-hourly"} live data; limiting archive history to ${rangeLimitDays} days.`);
            if (startDate < limitWindowStart) {
              effectiveStart = formatUtcDateKey(limitWindowStart);
              rangeAdjusted = true;
            }
            liveRows = filterRowsFromDate(liveRows, formatUtcDateKey(limitWindowStart));
          }
        }

        // Fetch Archive if requested range overlaps with past data (before cutoff)
        if (startDate < apiCutoff) {
          const archiveEnd =
            endDate < apiCutoff
              ? endDate
              : new Date(apiCutoff.getTime() - 1000);
          const archiveStart = maxDate(startDate, limitWindowStart);

          if (archiveStart <= archiveEnd) {
            const archiveResult = await fetchArchiveDetails(
              stationId,
              archiveStart,
              archiveEnd,
              sendProgress,
              {
                detectSubHourly: !stationIsSubHourly,
                rangeLimitDays,
                limitWindowStart,
                rangeAnchorDate: endDate,
              }
            );
            archiveRows = archiveResult.rows;
            const archiveResolution = archiveResult.resolution;

            stationResolution = preferHigherFrequencyResolution(
              stationResolution,
              archiveResolution
            );

            if (archiveResolution.isSubHourly) {
              stationIsSubHourly = true;
              rangeLimitDays = archiveResult.rangeLimitDays
                ?? getRangeLimitDays(archiveResolution.intervalMinutes)
                ?? MAX_HOURLY_WINDOW_DAYS;
              limitWindowStart = getLimitedWindowStart(endDate, rangeLimitDays);
              if (startDate < limitWindowStart) {
                effectiveStart = formatUtcDateKey(limitWindowStart);
                rangeAdjusted = true;
              }
            }
          }
        }

        sendProgress("Merging and sorting datasets...");

        // Merge both datasets using a map to deduplicate by datetime
        const mergedMap = new Map<string, HourlyRow>();

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

        // Apply physical sanity bounds cleaning (canonical bounds check and despiking)
        sendProgress("Applying quality control filters...");
        mergedRows = applyQualityControl(mergedRows);

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
          lwePrecipitationRate: "mm/h", rainfallRate: "mm/h",
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
          sunshineDuration10m: "min", sunshineDuration1h: "min",
          sunshineDuration3h: "min", sunshineDuration6h: "min",
          sunshineDuration12h: "min", sunshineDuration24h: "min",
          sunshineDuration: "min",
          ultravioletIndex: "",
          snowDepth: "cm", snowFresh: "cm",
          soilTemp10cm: "°C", soilTemp20cm: "°C", soilTemp50cm: "°C",
          etp: "mm",
          seaSurfaceTemperature: "°C",
          seaSurfaceWaveSignificantHeight: "m",
          seaSurfaceWaveMaximumHeight: "m",
          seaSurfaceWaveMeanPeriod: "s",
          seaSurfaceWaveSignificantPeriod: "s",
        };
        const units = { ...defaultUnits, ...liveUnits };

        sendEvent("complete", {
          success: true,
          data: mergedRows,
          units,
          sampling: {
            isSubHourly: stationIsSubHourly,
            intervalMinutes: stationResolution.intervalMinutes,
            intervalLabel: stationResolution.label,
            rangeLimitDays,
            maxTimestampsPerDay: stationResolution.maxTimestampsPerDay,
          },
          effectiveRange: {
            start: effectiveStart,
            end,
            adjusted: rangeAdjusted,
            reason: rangeAdjusted ? "frequency-window-limit" : null,
            limitDays: rangeLimitDays,
          },
        });
        closeStream();
      } catch (error) {
        const err = error as Error;
        console.error("[api/observations/station-details] Error:", err);
        sendEvent("error", { success: false, message: err.message });
        closeStream();
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
