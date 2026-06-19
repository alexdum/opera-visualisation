import { NextResponse } from "next/server";
import { fetchBypassSSL } from "@/utils/http";
import { getCountryFromWigosId, applyCoordinateOverrides, isGenericRegionLabel, normalizeCountryName } from "@/utils/wigos";
import { loadOscarCache } from "@/utils/oscar";
import NodeCache from "node-cache";
import fs from "fs";
import path from "path";

// Initialize a 3-hour cache (10800 seconds) for the station list
const cache = new NodeCache({ stdTTL: 10800 });

const FALLBACK_CSV_PATH = path.join(process.cwd(), "src/data/meteogate_stations_cache.csv");
const CSV_HEADER = "id,name,longitude,latitude,elevation,wigos_id,available_params,country,start_date,end_date,detailed_summary,is_hourly,is_daily,is_minutely";

interface StationRecord {
  id: string;
  wigos_id: string;
  name: string;
  longitude: number;
  latitude: number;
  elevation: number | null;
  country: string | null;
  available_params: string;
  is_hourly: string;
  is_daily: string;
  is_minutely: string;
}

interface MeteoGateFeature {
  id: string;
  geometry?: {
    coordinates?: number[];
  };
  properties?: {
    name?: string;
    "parameter-name"?: string[];
  };
}

interface MeteoGateResponse {
  features?: MeteoGateFeature[];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Escape a value for CSV: wrap in quotes if it contains commas, quotes, or newlines */
function csvEscape(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "NA";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Write enriched stations back to the fallback CSV (async, fire-and-forget) */
function writeFallbackCSV(stations: StationRecord[]): void {
  const tmpPath = FALLBACK_CSV_PATH + ".tmp";
  try {
    const today = new Date().toISOString().split("T")[0];
    const lines = [CSV_HEADER];
    for (const st of stations) {
      // Build a one-line summary matching the existing format
      const summary = `Country: ${st.country || "Unknown"} | Parameters: ${st.available_params || "N/A"}`;
      lines.push([
        csvEscape(st.id),
        csvEscape(st.name),
        csvEscape(st.longitude),
        csvEscape(st.latitude),
        st.elevation !== null && st.elevation !== undefined ? csvEscape(st.elevation) : "NA",
        csvEscape(st.wigos_id || st.id),
        csvEscape(st.available_params),
        csvEscape(st.country),
        csvEscape("2020-01-01"),   // start_date placeholder
        csvEscape(today),           // end_date = today
        csvEscape(summary),
        csvEscape(st.is_hourly || "true"),
        csvEscape(st.is_daily || "true"),
        csvEscape(st.is_minutely || "false"),
      ].join(","));
    }
    // Atomic write: write to tmp file then rename to avoid corruption
    fs.writeFileSync(tmpPath, lines.join("\n") + "\n", "utf-8");
    fs.renameSync(tmpPath, FALLBACK_CSV_PATH);
    console.info(`[api/stations] Fallback CSV updated with ${stations.length} stations.`);
  } catch (err) {
    console.warn("[api/stations] Failed to write fallback CSV:", err);
    // Clean up temp file if rename failed
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

function loadFallbackStations(): StationRecord[] {
  try {
    const csvPath = path.join(process.cwd(), "src/data/meteogate_stations_cache.csv");
    if (!fs.existsSync(csvPath)) {
      console.warn("[stations fallback] Fallback file not found at:", csvPath);
      return [];
    }

    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.split("\n");
    const stations: StationRecord[] = [];

    // Header: id,name,longitude,latitude,elevation,wigos_id,available_params,country,start_date,end_date,detailed_summary,is_hourly,is_daily,is_minutely
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts: string[] = [];
      let current = "";
      let inQuotes = false;

      for (let charIndex = 0; charIndex < line.length; charIndex++) {
        const char = line[charIndex];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
          parts.push(current);
          current = "";
        } else {
          current += char;
        }
      }
      parts.push(current);

      if (parts.length >= 8) {
        const id = parts[0].trim();
        const name = parts[1].trim();
        const lonRaw = parts[2].trim();
        const latRaw = parts[3].trim();
        const elevRaw = parts[4].trim();
        const wigosId = parts[5].trim();
        const availableParams = parts[6].trim();
        const country = parts[7].trim();

        const elevation = elevRaw === "NA" || elevRaw === "" ? null : parseFloat(elevRaw);
        const longitude = parseFloat(lonRaw);
        const latitude = parseFloat(latRaw);

        stations.push({
          id,
          wigos_id: wigosId,
          name,
          longitude,
          latitude,
          elevation,
          country,
          available_params: availableParams,
          is_hourly: "true",
          is_daily: "true",
          is_minutely: "false"
        });
      }
    }
    console.info(`[stations fallback] Successfully loaded ${stations.length} stations from fallback CSV.`);
    return stations;
  } catch (error) {
    console.error("[stations fallback] Error parsing fallback CSV:", error);
    return [];
  }
}

export async function GET() {
  try {
    const cached = cache.get("stations");
    if (cached) {
      return NextResponse.json({ success: true, fromCache: true, data: cached });
    }

    let stations: StationRecord[] = [];
    let fetchedFromRemote = false;
    
    try {
      // Fetch raw stations list from MeteoGate with a 15-second timeout (matches R app)
      const rawData = await fetchBypassSSL(
        "https://observations.meteogate.eu/collections/observations/locations?f=json",
        15000
      );
      
      const json = JSON.parse(rawData) as MeteoGateResponse;
      if (!json.features) {
        throw new Error("Invalid MeteoGate response format");
      }

      stations = json.features.map((feature) => {
        const wigosId = feature.id;
        const coords = feature.geometry?.coordinates || [];
        const currentLon = coords[0] ?? 0;
        const currentLat = coords[1] ?? 0;
        const currentElev = coords[2] ?? null;
        
        const paramsList: string[] = feature.properties?.["parameter-name"] || [];

        return {
          id: wigosId,
          wigos_id: wigosId,
          name: feature.properties?.name || wigosId,
          longitude: currentLon,
          latitude: currentLat,
          elevation: currentElev,
          country: null,
          available_params: paramsList.join(", "),
          is_hourly: "true",
          is_daily: "true",
          is_minutely: "false"
        };
      });

      console.info(`[api/stations] Fetched and processed ${stations.length} raw stations from MeteoGate.`);
      fetchedFromRemote = true;
    } catch (fetchError: unknown) {
      console.warn(
        `[api/stations] Remote fetch failed or timed out (${getErrorMessage(fetchError)}). Using local backup CSV fallback...`
      );
      stations = loadFallbackStations();
    }

    if (stations.length === 0) {
      throw new Error("No stations available from remote fetch or local fallback");
    }

    // Load WMO OSCAR CSV metadata to fill in missing elevations and metadata
    const oscarMap = loadOscarCache();

    stations = stations.map(st => {
      // Apply coordinates overrides
      const reconciledCoords = applyCoordinateOverrides(st.wigos_id, st.longitude, st.latitude, st.elevation);

      // Check WMO OSCAR cache for elevation, country, name overrides
      const oscarInfo = oscarMap.get(st.wigos_id);
      
      const elevation = oscarInfo?.elevation ?? reconciledCoords.elevation;
      const name = oscarInfo?.name || st.name;
      const oscarCountry = oscarInfo?.country && !isGenericRegionLabel(oscarInfo.country)
        ? normalizeCountryName(oscarInfo.country)
        : null;
      const cachedCountry = st.country && !isGenericRegionLabel(st.country)
        ? normalizeCountryName(st.country)
        : null;
      const country = oscarCountry || cachedCountry || getCountryFromWigosId(st.wigos_id, reconciledCoords.longitude, reconciledCoords.latitude);

      return {
        ...st,
        name,
        longitude: reconciledCoords.longitude,
        latitude: reconciledCoords.latitude,
        elevation,
        country
      };
    });

    if (stations.length === 0) {
      throw new Error("No stations available from remote fetch or local fallback");
    }

    // Save to cache
    cache.set("stations", stations);

    // Write back to fallback CSV if we got fresh data from MeteoGate
    if (fetchedFromRemote) {
      // Fire-and-forget: don't block the response
      setImmediate(() => writeFallbackCSV(stations));
    }

    return NextResponse.json({ success: true, fromCache: false, data: stations });
  } catch (error: unknown) {
    console.error("[api/stations] Error:", error);
    return NextResponse.json({ success: false, message: getErrorMessage(error) }, { status: 500 });
  }
}
