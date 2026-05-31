import { NextResponse } from "next/server";
import { fetchBypassSSL } from "@/utils/http";
import { ensureParquetCached, queryDuckDB } from "@/utils/duckdb";

interface Tile {
  lng_min: number;
  lng_max: number;
  lat_min: number;
  lat_max: number;
}

// Maximum populated tiles to fetch in parallel
// With 40°×35° tiles, Europe needs ~6 tiles, so 20 is generous
const MAX_POPULATED_TILES = 20;

// Match MeteoGate R: 40° longitude × 35° latitude tiles
const TILE_LNG_STEP = 40;
const TILE_LAT_STEP = 35;

export async function POST(request: Request) {
  try {
    const { parameter, datetimeRange, bounds, stations } = await request.json();

    if (!parameter || !datetimeRange || !bounds) {
      return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
    }

    const { lng_min, lng_max, lat_min, lat_max } = bounds;
    const lng_span = Math.abs(lng_max - lng_min);
    const lat_span = Math.abs(lat_max - lat_min);

    // Hybrid logic: If target_time is older than 24 hours, use Archive.
    const startStr = datetimeRange.split("/")[0];
    const targetDate = new Date(startStr);
    const ageHours = (Date.now() - targetDate.getTime()) / (1000 * 60 * 60);

    if (ageHours > 24) {
      console.info(`[api/observations/area] Target time ${startStr} is older than 24h (${ageHours.toFixed(1)}h). Using archive fallback.`);
      const dateStr = targetDate.toISOString().split("T")[0];
      const targetHour = targetDate.getUTCHours();
      
      const localPath = await ensureParquetCached(dateStr);
      if (localPath) {
        const p = localPath.replace(/\\/g, "/");
        // DuckDB query to extract data for the target hour and bounds
        // The bounds check is optional if we want to return all, but adding it limits payload size
        const sql = `
          SELECT station_id, timestamp, value 
          FROM read_parquet('${p}')
          WHERE standard_name = '${parameter}'
          AND extract('hour' FROM timestamp) = ${targetHour}
        `;
        
        console.time("[api/observations/area] DuckDB Query");
        const rows = await queryDuckDB(sql);
        console.timeEnd("[api/observations/area] DuckDB Query");
        
        // Convert rows to faux coverages matching the format Map.tsx expects
        const coverages = rows.map(row => {
          // DuckDB node driver might parse TIMESTAMP as local time.
          // Since we filtered by extract('hour') = targetHour, we know exactly what UTC hour it represents.
          // We manually construct the ISO string to avoid timezone offset bugs.
          let tStr = "";
          if (row.timestamp instanceof Date) {
            // Force the UTC string to represent the original DuckDB time
            const yyyy = targetDate.getUTCFullYear();
            const mm = String(targetDate.getUTCMonth() + 1).padStart(2, "0");
            const dd = String(targetDate.getUTCDate()).padStart(2, "0");
            const hh = String(targetHour).padStart(2, "0");
            tStr = `${yyyy}-${mm}-${dd}T${hh}:00:00Z`;
          } else {
            tStr = String(row.timestamp).replace(" ", "T") + (String(row.timestamp).endsWith("Z") ? "" : "Z");
          }

          return {
            "metocean:wigosId": row.station_id,
            domain: { 
              axes: { 
                t: { values: [tStr] } 
              } 
            },
            ranges: { 
              [`${parameter}:PT0S`]: { values: [row.value] } 
            }
          };
        });

        console.info(`[api/observations/area] Returned ${coverages.length} archive coverages`);
        return NextResponse.json({ success: true, count: coverages.length, coverages });
      } else {
        console.warn(`[api/observations/area] Archive fallback failed to download parquet for ${dateStr}`);
        return NextResponse.json({ success: true, count: 0, coverages: [] });
      }
    }

    let tiles: Tile[] = [];

    // Tile splitting logic matching helpers.R (40°×35° tiles)
    const needsTiling = lng_span > TILE_LNG_STEP || lat_span > TILE_LAT_STEP;

    if (needsTiling) {
      const lng_breaks: number[] = [];
      for (let v = lng_min; v < lng_max; v += TILE_LNG_STEP) {
        lng_breaks.push(v);
      }
      if (lng_breaks[lng_breaks.length - 1] < lng_max) {
        lng_breaks.push(lng_max);
      }

      const lat_breaks: number[] = [];
      for (let v = lat_min; v < lat_max; v += TILE_LAT_STEP) {
        lat_breaks.push(v);
      }
      if (lat_breaks[lat_breaks.length - 1] < lat_max) {
        lat_breaks.push(lat_max);
      }

      for (let i = 0; i < lng_breaks.length - 1; i++) {
        for (let j = 0; j < lat_breaks.length - 1; j++) {
          tiles.push({
            lng_min: lng_breaks[i],
            lng_max: lng_breaks[i + 1],
            lat_min: lat_breaks[j],
            lat_max: lat_breaks[j + 1],
          });
        }
      }

      const totalTiles = tiles.length;

      // Prune empty tiles containing zero stations (skip empty ocean)
      if (stations && Array.isArray(stations) && stations.length > 0) {
        tiles = tiles.filter((tile) => {
          return stations.some((st: any) => {
            const lon = st.longitude;
            const lat = st.latitude;
            return lon >= tile.lng_min && lon <= tile.lng_max && lat >= tile.lat_min && lat <= tile.lat_max;
          });
        });
      }

      console.info(`[api/observations/area] ${lng_span.toFixed(0)}°×${lat_span.toFixed(0)}° → ${totalTiles} tiles total, ${tiles.length} populated`);

      // Cap at MAX_POPULATED_TILES
      if (tiles.length > MAX_POPULATED_TILES) {
        console.warn(`[api/observations/area] Capping populated tiles from ${tiles.length} to ${MAX_POPULATED_TILES}`);
        tiles = tiles.slice(0, MAX_POPULATED_TILES);
      }
    } else {
      tiles = [{ lng_min, lng_max, lat_min, lat_max }];
    }

    console.info(`[api/observations/area] Fetching ${tiles.length} tiles for parameter ${parameter}, datetime=${datetimeRange}`);

    // Build fetch promises for all populated tiles
    const tilePromises = tiles.map(async (tile) => {
      const coords = `POLYGON((${tile.lng_min} ${tile.lat_min},${tile.lng_max} ${tile.lat_min},${tile.lng_max} ${tile.lat_max},${tile.lng_min} ${tile.lat_max},${tile.lng_min} ${tile.lat_min}))`;
      const url = `https://observations.meteogate.eu/collections/observations/area?coords=${encodeURIComponent(coords)}&standard_name=${encodeURIComponent(parameter)}&datetime=${encodeURIComponent(datetimeRange)}`;

      try {
        const rawText = await fetchBypassSSL(url);
        const json = JSON.parse(rawText);
        return json.coverages || [];
      } catch (error: any) {
        if (error.message && error.message.includes("status code 404")) {
          return [];
        }
        console.warn(`[api/observations/area] Tile fetch failed: ${error.message}`);
        return [];
      }
    });

    const results = await Promise.all(tilePromises);

    // Merge coverages into a single map (dedup by wigosId)
    const mergedCoveragesMap = new Map<string, any>();
    
    results.forEach((coverages) => {
      if (Array.isArray(coverages)) {
        coverages.forEach((cov) => {
          const wigosId = cov["metocean:wigosId"];
          if (wigosId) {
            mergedCoveragesMap.set(wigosId, cov);
          }
        });
      }
    });

    const mergedCoverages = Array.from(mergedCoveragesMap.values());
    console.info(`[api/observations/area] Returned ${mergedCoverages.length} station coverages`);

    return NextResponse.json({ success: true, count: mergedCoverages.length, coverages: mergedCoverages });
  } catch (error: any) {
    console.error("[api/observations/area] Error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
