import fs from "fs";
import path from "path";

export interface OscarStationMetadata {
  wigosId: string;
  elevation: number | null;
  country: string | null;
  region: string | null;
  name: string | null;
}

let oscarCacheMap: Map<string, OscarStationMetadata> | null = null;

export function loadOscarCache(): Map<string, OscarStationMetadata> {
  if (oscarCacheMap) return oscarCacheMap;

  oscarCacheMap = new Map();
  try {
    const csvPath = path.join(process.cwd(), "src/data/oscar_elevation_cache.csv");
    if (!fs.existsSync(csvPath)) {
      console.warn("[oscar] Cache file not found at:", csvPath);
      return oscarCacheMap;
    }

    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.split("\n");

    // Skip header line (wigos_id,elevation,country,region,name)
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

      if (parts.length >= 5) {
        const wigosId = parts[0].trim();
        const elevRaw = parts[1].trim();
        const countryRaw = parts[2].trim();
        const regionRaw = parts[3].trim();
        const nameRaw = parts[4].trim();

        const elevation = elevRaw === "NA" || elevRaw === "" ? null : parseFloat(elevRaw);
        const country = countryRaw === "NA" || countryRaw === "" ? null : countryRaw;
        const region = regionRaw === "NA" || regionRaw === "" ? null : regionRaw;
        const name = nameRaw === "NA" || nameRaw === "" ? null : nameRaw;

        oscarCacheMap.set(wigosId, {
          wigosId,
          elevation,
          country,
          region,
          name,
        });
      }
    }
    console.info(`[oscar] Pre-loaded ${oscarCacheMap.size} station entries from CSV cache.`);
  } catch (error) {
    console.error("[oscar] Failed to load CSV cache:", error);
  }

  return oscarCacheMap;
}

/**
 * Fetch metadata dynamically from WMO OSCAR API
 */
export async function fetchOscarMetadataFromApi(wigosId: string): Promise<OscarStationMetadata | null> {
  if (!wigosId) return null;
  const url = `https://oscar.wmo.int/surface/rest/api/search/station?wigosId=${encodeURIComponent(wigosId)}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;

    const payload = await res.json();
    const results = payload.stationSearchResults;
    if (!results || results.length === 0) return null;

    const result = results[0];
    const elevation = result.elevation !== undefined && result.elevation !== null ? parseFloat(result.elevation) : null;
    const country = result.territory || null;
    const region = result.region || null;
    const name = result.name || null;

    return {
      wigosId,
      elevation,
      country,
      region,
      name,
    };
  } catch (error) {
    console.error(`[oscar] WMO API fetch error for ${wigosId}:`, error);
    return null;
  }
}
