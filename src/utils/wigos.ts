export interface StationCoordinateOverride {
  longitude: number;
  latitude: number;
  elevation: number;
}

export const COORDINATE_OVERRIDES: Record<string, StationCoordinateOverride> = {
  "0-20000-0-15420": { longitude: 26.0782, latitude: 44.5104, elevation: 90 },
  "0-20000-0-15421": { longitude: 26.2128, latitude: 44.5001, elevation: 90 },
};

// Fast issuer-code lookup table matching funs/helpers.R
export const ISSUER_COUNTRY_MAP: Record<string, string> = {
  "008": "Albania", "020": "Andorra", "040": "Austria", "051": "Armenia",
  "031": "Azerbaijan", "112": "Belarus", "056": "Belgium", "070": "Bosnia and Herzegovina",
  "100": "Bulgaria", "191": "Croatia", "196": "Cyprus", "203": "Czechia",
  "208": "Denmark", "233": "Estonia", "246": "Finland", "250": "France",
  "268": "Georgia", "276": "Germany", "300": "Greece", "348": "Hungary",
  "352": "Iceland", "372": "Ireland", "380": "Italy", "398": "Kazakhstan",
  "292": "Gibraltar",
  "417": "Kyrgyzstan", "428": "Latvia", "438": "Liechtenstein", "440": "Lithuania",
  "442": "Luxembourg", "807": "North Macedonia", "498": "Moldova", "492": "Monaco",
  "499": "Montenegro", "528": "Netherlands", "578": "Norway", "616": "Poland",
  "620": "Portugal", "642": "Romania", "643": "Russia", "674": "San Marino",
  "688": "Serbia", "703": "Slovakia", "705": "Slovenia", "724": "Spain",
  "752": "Sweden", "756": "Switzerland", "792": "Turkey", "804": "Ukraine",
  "826": "United Kingdom",
  "012": "Algeria", "504": "Morocco", "788": "Tunisia", "818": "Egypt",
  "434": "Libya", "736": "Sudan", "288": "Ghana", "566": "Nigeria",
  "710": "South Africa", "404": "Kenya", "834": "Tanzania",
  "124": "Canada", "840": "United States", "484": "Mexico",
  "032": "Argentina", "076": "Brazil", "152": "Chile", "170": "Colombia",
  "604": "Peru", "858": "Uruguay", "862": "Venezuela",
  "036": "Australia", "156": "China", "356": "India", "392": "Japan",
  "410": "South Korea", "458": "Malaysia", "554": "New Zealand",
  "702": "Singapore", "764": "Thailand", "704": "Vietnam"
};

/**
 * Normalizes country names for consistency
 */
export function normalizeCountryName(country: string): string {
  if (!country) return "Unknown";
  const c = country.trim();
  if (c === "Czech Republic") return "Czechia";
  if (c === "Moldova, Republic of") return "Moldova";
  if (["United Kingdom of Great Britain and Northern Ireland", "Great Britain", "United Kingdom (the)"].includes(c)) {
    return "United Kingdom";
  }
  if (c === "Netherlands (the)") return "Netherlands";
  return c;
}

/**
 * Checks if a country string represents a generic regional or empty label
 */
export function isGenericRegionLabel(country: string | null | undefined): boolean {
  if (!country) return true;
  return ["Unknown", "Global", "Europe", "Africa", "Antarctica", "North America", "South America", "Pacific Islands/Oceania"].includes(country);
}

/**
 * Resolves country from WMO block code mapping (handles fallback when issuer is generic 0 or 20000)
 */
export function getCountryFromWmoBlock(locId: string, longitude?: number, latitude?: number): string {
  if (!locId) return "Europe";

  // Geographic Fallback (if coords available)
  if (longitude !== undefined && latitude !== undefined) {
    if (latitude >= 57 && latitude <= 60 && longitude >= 21 && longitude <= 29) {
      return "Estonia";
    }
    if (latitude >= -53 && latitude <= -51 && longitude >= -61 && longitude <= -57) {
      return "Falkland Islands (Malvinas)";
    }
  }

  if (locId.length >= 3) {
    const isNumericId = /^[0-9]+$/.test(locId);
    let fullLocId = locId;

    // Estonia padding logic
    const coordsAvailable = longitude !== undefined && latitude !== undefined && isFinite(longitude) && isFinite(latitude);
    if (!coordsAvailable && locId.length < 5 && isNumericId) {
      const candidate = "26" + locId.padStart(3, "0");
      const wmoCandidate = parseInt(candidate.substring(0, 5), 10);
      if (!isNaN(wmoCandidate) && wmoCandidate >= 26000 && wmoCandidate <= 26499) {
        fullLocId = candidate;
      }
    }

    const wmoIdx = parseInt(fullLocId.substring(0, 5), 10);
    if (!isNaN(wmoIdx)) {
      // Outlier overrides
      if (wmoIdx === 3204) return "Isle of Man";
      if (wmoIdx === 3894) return "Guernsey";
      if ([3895, 3896].includes(wmoIdx)) return "Jersey";
      if (wmoIdx === 6590) return "Luxembourg";
      if (wmoIdx === 13363 || (wmoIdx >= 13457 && wmoIdx <= 13463)) return "Montenegro";
      if (wmoIdx === 60320) return "Spain";
      if ([61901, 61902].includes(wmoIdx)) return "Saint Helena";
      if ([89003, 89011].includes(wmoIdx)) return "Germany";
      if (wmoIdx === 89262) return "United Kingdom";
      if ([99507, 99508, 99509].includes(wmoIdx)) return "Falkland Islands (Malvinas)";

      // Granular WMO Block Mapping
      if (wmoIdx >= 1000 && wmoIdx <= 1999) return "Norway";
      if (wmoIdx >= 2000 && wmoIdx <= 2799) return "Sweden";
      if (wmoIdx >= 2800 && wmoIdx <= 2999) return "Finland";
      if (wmoIdx >= 3000 && wmoIdx <= 3949) return "United Kingdom";
      if (wmoIdx >= 3950 && wmoIdx <= 3999) return "Ireland";
      if (wmoIdx >= 4000 && wmoIdx <= 4199) return "Iceland";
      if (wmoIdx >= 4200 && wmoIdx <= 4299) return "Greenland";
      if (wmoIdx >= 4300 && wmoIdx <= 4999) return "Iceland";
      if (wmoIdx >= 6000 && wmoIdx <= 6019) return "Faroe Islands";
      if (wmoIdx >= 6020 && wmoIdx <= 6199) return "Denmark";
      if (wmoIdx >= 6200 && wmoIdx <= 6399) return "Netherlands";
      if (wmoIdx >= 6400 && wmoIdx <= 6599) return "Belgium";
      if (wmoIdx >= 6600 && wmoIdx <= 6899) return "Switzerland";
      if (wmoIdx >= 7000 && wmoIdx <= 7999) return "France";
      if (wmoIdx >= 8000 && wmoIdx <= 8499) return "Spain";
      if (wmoIdx >= 8500 && wmoIdx <= 8599) return "Portugal";
      if (wmoIdx >= 8600 && wmoIdx <= 8999) return "Spain";
      if (wmoIdx >= 10000 && wmoIdx <= 10999) return "Germany";
      if (wmoIdx >= 11000 && wmoIdx <= 11399) return "Austria";
      if (wmoIdx >= 11400 && wmoIdx <= 11799) return "Czechia";
      if (wmoIdx >= 11800 && wmoIdx <= 11999) return "Slovakia";
      if (wmoIdx >= 12000 && wmoIdx <= 12799) return "Poland";
      if (wmoIdx >= 12800 && wmoIdx <= 12999) return "Hungary";
      if (wmoIdx >= 13000 && wmoIdx <= 13491) return "Serbia";
      if (wmoIdx >= 13493 && wmoIdx <= 13599) return "North Macedonia";
      if (wmoIdx >= 13600 && wmoIdx <= 13699) return "Albania";
      if (wmoIdx >= 14000 && wmoIdx <= 14199) return "Slovenia";
      if (wmoIdx >= 14200 && wmoIdx <= 14499) return "Croatia";
      if (wmoIdx >= 14500 && wmoIdx <= 14799) return "Bosnia and Herzegovina";
      if (wmoIdx >= 15000 && wmoIdx <= 15499) return "Romania";
      if (wmoIdx >= 15500 && wmoIdx <= 15999) return "Bulgaria";
      if (wmoIdx >= 16000 && wmoIdx <= 16589) return "Italy";
      if (wmoIdx >= 16590 && wmoIdx <= 16599) return "Malta";
      if (wmoIdx >= 16600 && wmoIdx <= 16999) return "Greece";
      if (wmoIdx >= 17000 && wmoIdx <= 17999) return "Turkey";
      if (wmoIdx >= 26000 && wmoIdx <= 26499) return "Estonia";
      if (wmoIdx >= 26500 && wmoIdx <= 26999) return "Lithuania";
      if (wmoIdx >= 27000 && wmoIdx <= 27199) return "Lithuania";
      if (wmoIdx >= 27200 && wmoIdx <= 27999) return "Belarus";
      if (wmoIdx >= 33000 && wmoIdx <= 33799) return "Ukraine";
      if (wmoIdx >= 33800 && wmoIdx <= 33899) return "Moldova";
      if (wmoIdx >= 99000 && wmoIdx <= 99499) return "United Kingdom";

      // Region I (Africa) WMO Blocks
      if (wmoIdx >= 60000 && wmoIdx <= 60099) return "Spain"; // Canary Islands
      if (wmoIdx >= 61000 && wmoIdx <= 61099) return "Niger";
      if (wmoIdx >= 60100 && wmoIdx <= 60299) return "Morocco";
      if (wmoIdx >= 60300 && wmoIdx <= 60349) return "Morocco"; // Western Sahara
      if (wmoIdx >= 60350 && wmoIdx <= 60699) return "Algeria";
      if (wmoIdx >= 60700 && wmoIdx <= 60799) return "Tunisia";
      if (wmoIdx >= 61900 && wmoIdx <= 61999) return "France"; // Réunion, etc.
      if (wmoIdx >= 62000 && wmoIdx <= 62299) return "Egypt";

      // Regional prefixes
      const blockPrefix = fullLocId.substring(0, 2);
      if (["60", "61", "62", "63", "64", "65"].includes(blockPrefix)) return "Africa";
      if (["70", "71", "72", "74"].includes(blockPrefix)) return "North America";
      if (["80", "82", "83", "84", "85", "86", "87"].includes(blockPrefix)) return "South America";
      if (["91", "93", "94", "95"].includes(blockPrefix)) return "Pacific Islands/Oceania";
    }
  }

  return "Europe"; // Standard domain fallback
}

/**
 * Resolves country dynamically from WIGOS ID
 */
export function getCountryFromWigosId(wigosId: string, longitude?: number, latitude?: number): string {
  if (!wigosId) return "Europe";

  const parts = wigosId.split("-");
  if (parts.length < 4) return "Europe";

  const issuerRaw = parts[1];
  const locId = parts[3];

  // Try parsing the issuer ID first
  const isNumericIssuer = /^[0-9]+$/.test(issuerRaw);
  const issuerPadded = isNumericIssuer ? issuerRaw.padStart(3, "0") : issuerRaw;

  if (issuerRaw !== "0" && issuerRaw !== "20000") {
    const country = ISSUER_COUNTRY_MAP[issuerPadded];
    if (country) {
      return normalizeCountryName(country);
    }
  }

  // Fallback to WMO block mapping
  const blockCountry = getCountryFromWmoBlock(locId, longitude, latitude);
  return normalizeCountryName(blockCountry);
}

/**
 * Reconciles coordinates and applies overrides
 */
export function applyCoordinateOverrides(
  wigosId: string,
  currentLon: number,
  currentLat: number,
  currentElev: number | null
) {
  const override = COORDINATE_OVERRIDES[wigosId];
  if (override) {
    return {
      longitude: override.longitude,
      latitude: override.latitude,
      elevation: override.elevation,
    };
  }
  return {
    longitude: currentLon,
    latitude: currentLat,
    elevation: currentElev,
  };
}
