export interface HourlyRow {
  datetime: string;
  [key: string]: string | number | undefined | null;
}

// Parameters that must be >= 0
const NON_NEGATIVE_PARAMS = [
  "precipitation", "precipitation1h", "precipitation3h", "precipitation6h",
  "precipitation12h", "precipitation24h", "lwePrecipitationRate", "rainfallRate",
  "windSpeed", "windSpeed2m", "windGust", "windGustInst",
  "humidity", "solarRadiation",
  "sunshineDuration10m", "sunshineDuration1h", "sunshineDuration3h",
  "sunshineDuration6h", "sunshineDuration12h", "sunshineDuration24h",
  "sunshineDuration"
];

// Parameters that must be bounded
const BOUNDED_PARAMS: Record<string, { min: number, max: number }> = {
  "temperature": { min: -95, max: 60 },
  "tempMin": { min: -95, max: 60 },
  "tempMax": { min: -95, max: 60 },
  "dewPoint": { min: -95, max: 60 },
  "pressure": { min: 800, max: 1100 },
  "pressureStation": { min: 800, max: 1100 },
  "windDirection": { min: 0, max: 360 },
  "windGustDirection": { min: 0, max: 360 }
};

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
    { key: "pressure", threshold: 15 },
    { key: "pressureStation", threshold: 15 }
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
