import { NextResponse } from "next/server";
import { fetchBypassSSL } from "@/utils/http";
import { ensureParquetCached, queryDuckDB } from "@/utils/duckdb";
import NodeCache from "node-cache";

interface Tile {
  lng_min: number;
  lng_max: number;
  lat_min: number;
  lat_max: number;
}

interface StationLocation {
  longitude: number;
  latitude: number;
}

interface AreaObservation {
  stationId: string;
  value: number;
}

interface AreaObservationPayload {
  success: true;
  count: number;
  observations: AreaObservation[];
}

interface CoverageRange {
  values?: unknown[];
}

interface MeteoGateCoverage {
  "metocean:wigosId"?: string;
  domain?: {
    axes?: {
      t?: {
        values?: string[];
      };
    };
  };
  ranges?: Record<string, CoverageRange>;
}

// Maximum populated tiles to fetch in parallel
// With 40°×35° tiles, Europe needs ~6 tiles, so 20 is generous
const MAX_POPULATED_TILES = 20;

// Match MeteoGate R: 40° longitude × 35° latitude tiles
const TILE_LNG_STEP = 40;
const TILE_LAT_STEP = 35;

const observationCache = new NodeCache({ stdTTL: 300, checkperiod: 120, useClones: false });
const inFlightRequests = new Map<string, Promise<AreaObservationPayload>>();

function normalizeTileCoord(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : String(value);
}

function getTileKey(tiles: Tile[]): string {
  return tiles
    .map((tile) => [
      normalizeTileCoord(tile.lng_min),
      normalizeTileCoord(tile.lng_max),
      normalizeTileCoord(tile.lat_min),
      normalizeTileCoord(tile.lat_max),
    ].join(","))
    .join("|");
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isValidObservationValue(value: number, parameter: string): boolean {
  if (!Number.isFinite(value)) return false;
  if (parameter.includes("temperature") && (value < -60 || value > 60)) return false;
  return true;
}

function extractCoverageObservation(
  coverage: MeteoGateCoverage,
  parameter: string,
  targetHour: number
): AreaObservation | null {
  const stationId = coverage?.["metocean:wigosId"];
  if (!stationId) return null;

  const ranges = coverage.ranges || {};
  const rangeKeys = Object.keys(ranges);
  if (rangeKeys.length === 0) return null;

  let bestKey = rangeKeys[0];
  if (!parameter.includes("precipitation")) {
    const pt0s = rangeKeys.find((key) => key.includes("PT0S"));
    if (pt0s) bestKey = pt0s;
  }

  const values: unknown[] = ranges[bestKey]?.values || [];
  if (values.length === 0) return null;

  const timestamps: string[] = coverage.domain?.axes?.t?.values || [];
  let rawValue: unknown = undefined;

  for (let i = 0; i < values.length; i++) {
    if (values[i] === null || values[i] === undefined) continue;

    const timestamp = timestamps[i];
    if (!timestamp) {
      rawValue = values[i];
      break;
    }

    const date = new Date(timestamp);
    if (!isNaN(date.getTime()) && date.getUTCHours() === targetHour) {
      rawValue = values[i];
      break;
    }
  }

  if (rawValue === undefined) {
    rawValue = values.find((value) => value !== null && value !== undefined);
  }

  const value = Number(rawValue);
  if (!isValidObservationValue(value, parameter)) return null;

  return { stationId, value };
}

function buildTiles(
  bounds: Tile,
  stations: StationLocation[] | undefined
): { tiles: Tile[]; totalTiles: number; lngSpan: number; latSpan: number } {
  const { lng_min, lng_max, lat_min, lat_max } = bounds;
  const lngSpan = Math.abs(lng_max - lng_min);
  const latSpan = Math.abs(lat_max - lat_min);

  let tiles: Tile[] = [];
  const needsTiling = lngSpan > TILE_LNG_STEP || latSpan > TILE_LAT_STEP;

  if (needsTiling) {
    const lngBreaks: number[] = [];
    for (let v = lng_min; v < lng_max; v += TILE_LNG_STEP) {
      lngBreaks.push(v);
    }
    if (lngBreaks[lngBreaks.length - 1] < lng_max) {
      lngBreaks.push(lng_max);
    }

    const latBreaks: number[] = [];
    for (let v = lat_min; v < lat_max; v += TILE_LAT_STEP) {
      latBreaks.push(v);
    }
    if (latBreaks[latBreaks.length - 1] < lat_max) {
      latBreaks.push(lat_max);
    }

    for (let i = 0; i < lngBreaks.length - 1; i++) {
      for (let j = 0; j < latBreaks.length - 1; j++) {
        tiles.push({
          lng_min: lngBreaks[i],
          lng_max: lngBreaks[i + 1],
          lat_min: latBreaks[j],
          lat_max: latBreaks[j + 1],
        });
      }
    }

    const totalTiles = tiles.length;

    if (stations && Array.isArray(stations) && stations.length > 0) {
      tiles = tiles.filter((tile) => {
        return stations.some((st) => {
          const lon = st.longitude;
          const lat = st.latitude;
          return lon >= tile.lng_min && lon <= tile.lng_max && lat >= tile.lat_min && lat <= tile.lat_max;
        });
      });
    }

    if (tiles.length > MAX_POPULATED_TILES) {
      console.warn(`[api/observations/area] Capping populated tiles from ${tiles.length} to ${MAX_POPULATED_TILES}`);
      tiles = tiles.slice(0, MAX_POPULATED_TILES);
    }

    return { tiles, totalTiles, lngSpan, latSpan };
  }

  tiles = [{ lng_min, lng_max, lat_min, lat_max }];
  return { tiles, totalTiles: tiles.length, lngSpan, latSpan };
}

async function getArchiveObservations(
  parameter: string,
  targetDate: Date,
  targetHour: number
): Promise<AreaObservationPayload> {
  const dateStr = targetDate.toISOString().split("T")[0];
  const localPath = await ensureParquetCached(dateStr);

  if (!localPath) {
    console.warn(`[api/observations/area] Archive fallback failed to download parquet for ${dateStr}`);
    return { success: true, count: 0, observations: [] };
  }

  const p = localPath.replace(/\\/g, "/");
  const sql = `
    SELECT station_id, value
    FROM read_parquet('${p}')
    WHERE standard_name = '${escapeSqlString(parameter)}'
    AND extract('hour' FROM timestamp) = ${targetHour}
  `;

  console.time("[api/observations/area] DuckDB Query");
  const rows = await queryDuckDB(sql);
  console.timeEnd("[api/observations/area] DuckDB Query");

  const observationsByStation = new Map<string, AreaObservation>();
  for (const row of rows) {
    const stationId = String(row.station_id || "");
    const value = Number(row.value);
    if (!stationId || !isValidObservationValue(value, parameter)) continue;
    observationsByStation.set(stationId, { stationId, value });
  }

  const observations = Array.from(observationsByStation.values());
  console.info(`[api/observations/area] Returned ${observations.length} compact archive observations`);
  return { success: true, count: observations.length, observations };
}

async function getLiveObservations(
  parameter: string,
  datetimeRange: string,
  targetHour: number,
  tiles: Tile[]
): Promise<AreaObservationPayload> {
  console.info(`[api/observations/area] Fetching ${tiles.length} tiles for parameter ${parameter}, datetime=${datetimeRange}`);

  const tilePromises = tiles.map(async (tile) => {
    const coords = `POLYGON((${tile.lng_min} ${tile.lat_min},${tile.lng_max} ${tile.lat_min},${tile.lng_max} ${tile.lat_max},${tile.lng_min} ${tile.lat_max},${tile.lng_min} ${tile.lat_min}))`;
    const url = `https://observations.meteogate.eu/collections/observations/area?coords=${encodeURIComponent(coords)}&standard_name=${encodeURIComponent(parameter)}&datetime=${encodeURIComponent(datetimeRange)}`;

    try {
      const rawText = await fetchBypassSSL(url);
      const json = JSON.parse(rawText);
      return json.coverages || [];
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (message.includes("status code 404")) {
        return [];
      }
      console.warn(`[api/observations/area] Tile fetch failed: ${message}`);
      return [];
    }
  });

  const results = await Promise.all(tilePromises);
  const observationsByStation = new Map<string, AreaObservation>();

  results.forEach((coverages) => {
    if (!Array.isArray(coverages)) return;

    coverages.forEach((coverage) => {
      const observation = extractCoverageObservation(coverage, parameter, targetHour);
      if (observation) {
        observationsByStation.set(observation.stationId, observation);
      }
    });
  });

  const observations = Array.from(observationsByStation.values());
  console.info(`[api/observations/area] Returned ${observations.length} compact live observations`);
  return { success: true, count: observations.length, observations };
}

export async function POST(request: Request) {
  try {
    const { parameter, datetimeRange, bounds, stations } = await request.json();

    if (!parameter || !datetimeRange || !bounds) {
      return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
    }

    // Hybrid logic: If target_time is older than 24 hours, use Archive.
    const startStr = datetimeRange.split("/")[0];
    const targetDate = new Date(startStr);
    const targetHour = targetDate.getUTCHours();
    const ageHours = (Date.now() - targetDate.getTime()) / (1000 * 60 * 60);

    if (ageHours > 24) {
      console.info(`[api/observations/area] Target time ${startStr} is older than 24h (${ageHours.toFixed(1)}h). Using archive fallback.`);
      const dateStr = targetDate.toISOString().split("T")[0];
      const cacheKey = `archive:${parameter}:${dateStr}:${targetHour}`;
      const cached = observationCache.get<AreaObservationPayload>(cacheKey);
      if (cached) {
        return NextResponse.json({ ...cached, fromCache: true });
      }

      const inFlight = inFlightRequests.get(cacheKey);
      if (inFlight) {
        const payload = await inFlight;
        return NextResponse.json({ ...payload, fromCache: true, deduped: true });
      }

      const promise = getArchiveObservations(parameter, targetDate, targetHour);
      inFlightRequests.set(cacheKey, promise);

      try {
        const payload = await promise;
        observationCache.set(cacheKey, payload, 21_600);
        return NextResponse.json({ ...payload, fromCache: false });
      } finally {
        inFlightRequests.delete(cacheKey);
      }
    }

    const { tiles, totalTiles, lngSpan, latSpan } = buildTiles(bounds, stations);
    console.info(`[api/observations/area] ${lngSpan.toFixed(0)}°×${latSpan.toFixed(0)}° → ${totalTiles} tiles total, ${tiles.length} populated`);

    const cacheKey = `live:${parameter}:${datetimeRange}:${getTileKey(tiles)}`;
    const cached = observationCache.get<AreaObservationPayload>(cacheKey);
    if (cached) {
      return NextResponse.json({ ...cached, fromCache: true });
    }

    const inFlight = inFlightRequests.get(cacheKey);
    if (inFlight) {
      const payload = await inFlight;
      return NextResponse.json({ ...payload, fromCache: true, deduped: true });
    }

    const promise = getLiveObservations(parameter, datetimeRange, targetHour, tiles);
    inFlightRequests.set(cacheKey, promise);

    try {
      const payload = await promise;
      const ttlSeconds = ageHours < 2 ? 120 : 900;
      observationCache.set(cacheKey, payload, ttlSeconds);
      return NextResponse.json({ ...payload, fromCache: false });
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  } catch (error: unknown) {
    console.error("[api/observations/area] Error:", error);
    return NextResponse.json({ success: false, message: getErrorMessage(error) }, { status: 500 });
  }
}
