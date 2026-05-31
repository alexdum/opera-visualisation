import { NextResponse } from "next/server";
import { fetchBypassSSL } from "@/utils/http";
import { getCountryFromWigosId, applyCoordinateOverrides } from "@/utils/wigos";
import { loadOscarCache } from "@/utils/oscar";
import NodeCache from "node-cache";
import fs from "fs";
import path from "path";

// Initialize a 3-hour cache (10800 seconds) for the station list
const cache = new NodeCache({ stdTTL: 10800 });

function loadFallbackStations(): any[] {
  try {
    const csvPath = path.join(process.cwd(), "src/data/meteogate_stations_cache.csv");
    if (!fs.existsSync(csvPath)) {
      console.warn("[stations fallback] Fallback file not found at:", csvPath);
      return [];
    }

    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.split("\n");
    const stations: any[] = [];

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

    let stations: any[] = [];
    
    try {
      // Fetch raw stations list from MeteoGate with a 15-second timeout (matches R app)
      const rawData = await fetchBypassSSL(
        "https://observations.meteogate.eu/collections/observations/locations?f=json",
        15000
      );
      
      const json = JSON.parse(rawData);
      if (!json.features) {
        throw new Error("Invalid MeteoGate response format");
      }

      stations = json.features.map((feature: any) => {
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
    } catch (fetchError: any) {
      console.warn(
        `[api/stations] Remote fetch failed or timed out (${fetchError.message}). Using local backup CSV fallback...`
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
      const country = oscarInfo?.country || st.country || getCountryFromWigosId(st.wigos_id, reconciledCoords.longitude, reconciledCoords.latitude);

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

    return NextResponse.json({ success: true, fromCache: false, data: stations });
  } catch (error: any) {
    console.error("[api/stations] Error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
