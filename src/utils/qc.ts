export interface HourlyRow {
  datetime: string;
  [key: string]: string | number | undefined | null;
}

// Parameters that must be >= 0
export const NON_NEGATIVE_PARAMS = [
  "precipitation", "precipitation1h", "precipitation3h", "precipitation6h",
  "precipitation12h", "precipitation24h", "lwePrecipitationRate", "rainfallRate",
  "windSpeed", "windSpeed2m", "windGust", "windGustInst",
  "humidity", "solarRadiation",
  "sunshineDuration10m", "sunshineDuration1h", "sunshineDuration3h",
  "sunshineDuration6h", "sunshineDuration12h", "sunshineDuration24h",
  "sunshineDuration",
  "snowDepth", "snowFresh",
  "visibility",
  "cloudCover", "cloudCoverLow",
  "etp"
];

// Parameters that must be bounded
export const BOUNDED_PARAMS: Record<string, { min: number, max: number }> = {
  "temperature": { min: -95, max: 60 },
  "tempMin": { min: -95, max: 60 },
  "tempMax": { min: -95, max: 60 },
  "tempMinGround": { min: -95, max: 60 },
  "tempMin50cm": { min: -95, max: 60 },
  "dewPoint": { min: -95, max: 60 },
  "soilTemp10cm": { min: -50, max: 60 },
  "soilTemp20cm": { min: -50, max: 60 },
  "soilTemp50cm": { min: -50, max: 60 },
  "pressure": { min: 800, max: 1100 },
  "pressureStation": { min: 500, max: 1100 },
  "windDirection": { min: 0, max: 360 },
  "windGustDirection": { min: 0, max: 360 },
  "cloudCover": { min: 0, max: 100 },
  "cloudCoverLow": { min: 0, max: 100 },
  "visibility": { min: 0, max: 100000 }
};

/**
 * Quick single-value bounds check for a given MeteoGate parameter key.
 * Returns true if the value is within the physical bounds.
 * Used by the Map component for area observation filtering where
 * we don't have a full time series for spike detection.
 */
export function isValueInBounds(parameterKey: string, value: number): boolean {
  // Match the parameter key against bounded params
  // The API parameter names (e.g. "air_temperature") differ from the
  // row keys (e.g. "temperature"), so we also match by substring.
  for (const [key, bounds] of Object.entries(BOUNDED_PARAMS)) {
    if (parameterKey === key || parameterKey.includes(key)) {
      return value >= bounds.min && value <= bounds.max;
    }
  }

  // Check non-negative params
  for (const key of NON_NEGATIVE_PARAMS) {
    if (parameterKey === key || parameterKey.includes(key)) {
      return value >= 0;
    }
  }

  return true; // No bounds defined for this parameter
}

/**
 * Filters map area observations using physical bounds only.
 * For the map, we only have one value per station per hour, so we can't use
 * the time-series spike filter. We apply only absolute physical bounds here
 * (location-agnostic). Statistical spatial filters (e.g. IQR) are intentionally
 * avoided because the map may show stations across vastly different climate
 * zones (e.g. Europe + Arctic) simultaneously.
 *
 * Sensor glitches that fall within physical bounds but are still anomalous
 * (e.g. -59.7°C at an Italian station) will be caught by the time-series
 * spike filter when the user opens the station detail view.
 *
 * @param observations Record of stationId -> hourlyValues array
 * @param selectedHour The currently displayed hour index
 * @param parameter The MeteoGate parameter key (e.g. "air_temperature")
 * @returns A new observations record with out-of-bounds values set to NaN
 */
export function filterMapObservations(
  observations: Record<string, number[]>,
  selectedHour: number,
  parameter: string
): Record<string, number[]> {
  const result: Record<string, number[]> = {};

  for (const [id, hourly] of Object.entries(observations)) {
    const copy = [...hourly];
    const val = copy[selectedHour];
    if (Number.isFinite(val) && !isValueInBounds(parameter, val)) {
      copy[selectedHour] = NaN;
    }
    result[id] = copy;
  }

  return result;
}

export function applyQualityControl(data: HourlyRow[]): HourlyRow[] {
  if (!data || data.length === 0) return [];

  // Create a deep copy to avoid mutating the original data
  const qcData = data.map(row => ({ ...row }));

  // Pass 1: Absolute physical bounds and relational checks
  qcData.forEach((row) => {
    // 1. Non-negative checks
    for (const key of NON_NEGATIVE_PARAMS) {
      if (typeof row[key] === "number" && (row[key] as number) < 0) {
        row[key] = null; // Strip negative values
      }
    }

    // Special handling for humidity (cap at 100 if slightly over, strip if heavily over)
    if (typeof row.humidity === "number") {
      if (row.humidity > 100 && row.humidity <= 110) {
        row.humidity = 100;
      } else if (row.humidity > 110) {
        row.humidity = null;
      }
    }

    // 2. Bounded checks
    for (const [key, bounds] of Object.entries(BOUNDED_PARAMS)) {
      const val = row[key];
      if (typeof val === "number") {
        if (val < bounds.min || val > bounds.max) {
          row[key] = null;
        }
      }
    }

    // 3. Relational checks
    if (typeof row.tempMax === "number" && typeof row.tempMin === "number") {
      if (row.tempMax < row.tempMin) {
        row.tempMax = null;
        row.tempMin = null;
      }
    }

    if (typeof row.windGust === "number" && typeof row.windSpeed === "number") {
      if (row.windGust < row.windSpeed) {
        row.windGust = null;
      }
    }

    if (typeof row.windGustInst === "number" && typeof row.windSpeed2m === "number") {
      if (row.windGustInst < row.windSpeed2m) {
        row.windGustInst = null;
      }
    }

    if (typeof row.dewPoint === "number" && typeof row.temperature === "number") {
      if (row.dewPoint > row.temperature) {
        row.dewPoint = null; // Dew point cannot be higher than air temp
      }
    }
  });

  // Pass 2: Dynamic anomaly detection (Spike filter)
  // Time gap check (in milliseconds) - e.g., max 3 hours between points
  const MAX_TIME_GAP = 3 * 60 * 60 * 1000; 

  const spikeChecks = [
    { key: "temperature", threshold: 10 },
    { key: "dewPoint", threshold: 10 },
    { key: "pressure", threshold: 15 },
    { key: "pressureStation", threshold: 15 },
    { key: "humidity", threshold: 30 },
    { key: "windSpeed", threshold: 15 },
    { key: "windSpeed2m", threshold: 15 }
  ];

  for (let i = 1; i < qcData.length - 1; i++) {
    const prev = qcData[i - 1];
    const curr = qcData[i];
    const next = qcData[i + 1];

    if (!prev.datetime || !curr.datetime || !next.datetime) continue;

    const tPrev = new Date(prev.datetime as string).getTime();
    const tCurr = new Date(curr.datetime as string).getTime();
    const tNext = new Date(next.datetime as string).getTime();

    // Check if points are consecutive in time
    if (isNaN(tPrev) || isNaN(tCurr) || isNaN(tNext)) continue;
    if ((tCurr - tPrev) > MAX_TIME_GAP || (tNext - tCurr) > MAX_TIME_GAP) continue;

    for (const check of spikeChecks) {
      const vPrev = prev[check.key];
      const vCurr = curr[check.key];
      const vNext = next[check.key];

      if (typeof vPrev === "number" && typeof vCurr === "number" && typeof vNext === "number") {
        const diffPrev = vCurr - vPrev;
        const diffNext = vCurr - vNext;

        // A spike is a sharp jump in one direction, followed immediately by a jump back
        if ((diffPrev * diffNext > 0) &&
            Math.abs(diffPrev) > check.threshold &&
            Math.abs(diffNext) > check.threshold) {
          
          // It's a spike! Nullify it.
          curr[check.key] = null;
        }
      }
    }
  }

  return qcData;
}
