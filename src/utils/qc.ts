export interface PixelSeriesRow {
  datetime: string;
  [key: string]: string | number | undefined | null;
}

// BOUNDED_PARAMS: Only DBZH, RATE, ACRR
export const BOUNDED_PARAMS: Record<string, { min: number, max: number }> = {
  "DBZH": { min: -32, max: 95 },
  "RATE": { min: 0, max: 400 },
  "ACRR": { min: 0, max: 800 }
};

export function canonicalizeParameterKey(paramName: string): string {
  const p = paramName.toUpperCase();
  if (p === "DBZH" || p.includes("REFLECTIVITY")) return "DBZH";
  if (p === "RATE" || p.includes("PRECIPITATION_RATE")) return "RATE";
  if (p === "ACRR" || p.includes("ACCUMULATION")) return "ACRR";
  return p;
}

export function isValueInBounds(parameterKey: string, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const canonKey = canonicalizeParameterKey(parameterKey);

  const bounds = BOUNDED_PARAMS[canonKey];
  if (bounds) {
    return value >= bounds.min && value <= bounds.max;
  }
  return true;
}

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

export function applyQualityControl(data: PixelSeriesRow[]): PixelSeriesRow[] {
  if (!data || data.length === 0) return [];

  const qcData = data.map(row => ({ ...row })).sort((a, b) => {
    const tA = new Date(a.datetime).getTime();
    const tB = new Date(b.datetime).getTime();
    return (isNaN(tA) ? 0 : tA) - (isNaN(tB) ? 0 : tB);
  });

  // Pass 1: Absolute physical bounds checks
  qcData.forEach((row) => {
    for (const key of Object.keys(row)) {
      if (key === "datetime" || key === "quality" || key === "status") continue;
      const val = row[key];
      if (typeof val === "number") {
        if (!isValueInBounds(key, val)) {
          row[key] = null;
        }
      }
    }
  });

  // Optional: additional despiking for DBZH/RATE if required
  // Not strictly specified by PRD, but can be added later if needed.

  return qcData;
}
