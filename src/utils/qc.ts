export interface HourlyRow {
  datetime: string;
  [key: string]: string | number | undefined | null;
}

// Parameters that must be >= 0
export const NON_NEGATIVE_PARAMS = [
  "humidity", "windSpeed", "windSpeed2m", "windGust", "windGustInst",
  "precipitation", "precipitation1h", "precipitation3h", "precipitation6h",
  "precipitation12h", "precipitation24h", "lwePrecipitationRate", "rainfallRate",
  "snowDepth", "snowFresh", "cloudCover", "cloudCoverLow", "cloudBaseAltitude",
  "visibility", "solarRadiation", "surfaceDiffuseDownwellingShortwave",
  "surfaceDirectDownwellingShortwave", "surfaceDownwellingLongwaveFluxInAir",
  "surfaceUpwellingLongwaveFluxInAir", "surfaceUpwellingShortwaveFluxInAir",
  "downwellingLongwaveFluxInAir", "surfaceDownwellingPhotosyntheticPhotonFluxInAir",
  "surfaceDownwellingPhotosyntheticRadiativeFluxInAir",
  "integralWrtTimeOfSurfaceDownwellingLongwaveFluxInAir",
  "integralWrtTimeOfSurfaceDownwellingShortwaveFluxInAir",
  "sunshineDuration10m", "sunshineDuration1h", "sunshineDuration3h",
  "sunshineDuration6h", "sunshineDuration12h", "sunshineDuration24h",
  "sunshineDuration", "ultravioletIndex", "etp", "seaWaterSalinity",
  "seaWaterSpeed", "seaWaterElectricalConductivity",
  "seaSurfaceWaveSignificantHeight", "seaSurfaceWaveMaximumHeight",
  "seaSurfaceWaveMaximumPeriod", "seaSurfaceWaveMeanPeriod",
  "seaSurfaceWaveSignificantPeriod", "seaSurfaceWaveFromDirection",
  "seaSurfaceWaveDirectionalSpread", "seaSurfaceWavePeriodOfHighestWave",
  "seaSurfaceWaveEnergyAtVarianceSpectralDensityMaximum",
  "seaSurfaceWaveMeanPeriodFromVarianceSpectralDensityFirstFrequencyMoment",
  "seaSurfaceWaveMeanPeriodFromVarianceSpectralDensitySecondFrequencyMoment",
  "seaSurfaceWavePeriodAtVarianceSpectralDensityMaximum",
  "seaSurfaceSwellWaveSignificantHeight",
  "seaSurfaceSwellWaveMeanPeriodFromVarianceSpectralDensitySecondFrequencyMoment",
  "seaSurfaceWindWaveSignificantHeight",
  "seaSurfaceWindWaveMeanPeriodFromVarianceSpectralDensitySecondFrequencyMoment"
];

// Parameters that must be bounded
export const BOUNDED_PARAMS: Record<string, { min: number, max: number }> = {
  // ── Temperature (°C) ──
  "temperature": { min: -95, max: 60 },
  "tempMin": { min: -95, max: 60 },
  "tempMax": { min: -95, max: 60 },
  "tempMinGround": { min: -95, max: 60 },
  "tempMin50cm": { min: -95, max: 60 },
  "dewPoint": { min: -95, max: 60 },
  "virtualTemperature": { min: -95, max: 70 },
  "surfaceTemperature": { min: -95, max: 85 },
  "soilTemp10cm": { min: -50, max: 60 },
  "soilTemp20cm": { min: -50, max: 60 },
  "soilTemp50cm": { min: -50, max: 60 },

  // ── Humidity (%) ──
  "humidity": { min: 0, max: 100 },

  // ── Wind ──
  "windSpeed": { min: 0, max: 120 },
  "windSpeed2m": { min: 0, max: 120 },
  "windGust": { min: 0, max: 150 },
  "windGustInst": { min: 0, max: 150 },
  "windDirection": { min: 0, max: 360 },
  "windGustDirection": { min: 0, max: 360 },

  // ── Pressure (hPa) ──
  "pressure": { min: 800, max: 1100 },
  "pressureStation": { min: 500, max: 1100 },
  "pressureTendency": { min: -50, max: 50 },

  // ── Precipitation (mm) ──
  "precipitation": { min: 0, max: 500 },
  "precipitation1h": { min: 0, max: 200 },
  "precipitation3h": { min: 0, max: 400 },
  "precipitation6h": { min: 0, max: 600 },
  "precipitation12h": { min: 0, max: 800 },
  "precipitation24h": { min: 0, max: 1200 },
  "lwePrecipitationRate": { min: 0, max: 500 },
  "rainfallRate": { min: 0, max: 500 },

  // ── Snow (cm) ──
  "snowDepth": { min: 0, max: 2500 },
  "snowFresh": { min: 0, max: 500 },

  // ── Cloud & Visibility ──
  "cloudCover": { min: 0, max: 100 },
  "cloudCoverLow": { min: 0, max: 100 },
  "cloudBaseAltitude": { min: 0, max: 20000 },
  "visibility": { min: 0, max: 200000 },

  // ── Radiation (W/m²) ──
  "solarRadiation": { min: 0, max: 1600 },
  "surfaceDiffuseDownwellingShortwave": { min: 0, max: 1000 },
  "surfaceDirectDownwellingShortwave": { min: 0, max: 1600 },
  "surfaceDownwellingLongwaveFluxInAir": { min: 0, max: 600 },
  "surfaceUpwellingLongwaveFluxInAir": { min: 0, max: 800 },
  "surfaceUpwellingShortwaveFluxInAir": { min: 0, max: 1400 },
  "surfaceNetDownwardRadiativeFlux": { min: -500, max: 1600 },
  "downwellingLongwaveFluxInAir": { min: 0, max: 600 },
  "surfaceDownwellingPhotosyntheticPhotonFluxInAir": { min: 0, max: 3000 },
  "surfaceDownwellingPhotosyntheticRadiativeFluxInAir": { min: 0, max: 700 },
  "integralWrtTimeOfSurfaceDownwellingLongwaveFluxInAir": { min: 0, max: 5e7 },
  "integralWrtTimeOfSurfaceDownwellingShortwaveFluxInAir": { min: 0, max: 5e7 },

  // ── Sunshine & UV ──
  "sunshineDuration10m": { min: 0, max: 10 },
  "sunshineDuration1h": { min: 0, max: 60 },
  "sunshineDuration3h": { min: 0, max: 180 },
  "sunshineDuration6h": { min: 0, max: 360 },
  "sunshineDuration12h": { min: 0, max: 720 },
  "sunshineDuration24h": { min: 0, max: 1440 },
  "sunshineDuration": { min: 0, max: 1440 },
  "ultravioletIndex": { min: 0, max: 20 },

  // ── Evapotranspiration ──
  "etp": { min: 0, max: 600 },

  // ── Radar ──
  "equivalentReflectivityFactor": { min: -30, max: 80 },

  // ── Ocean / Marine ──
  "seaSurfaceTemperature": { min: -2, max: 40 },
  "seaWaterTemperature": { min: -2, max: 40 },
  "seaWaterSalinity": { min: 0, max: 45 },
  "seaWaterSpeed": { min: 0, max: 10 },
  "seaWaterElectricalConductivity": { min: 0, max: 70 },
  "seaSurfaceWaveSignificantHeight": { min: 0, max: 25 },
  "seaSurfaceWaveMaximumHeight": { min: 0, max: 40 },
  "seaSurfaceWaveMaximumPeriod": { min: 0, max: 30 },
  "seaSurfaceWaveMeanPeriod": { min: 0, max: 30 },
  "seaSurfaceWaveSignificantPeriod": { min: 0, max: 30 },
  "seaSurfaceWaveFromDirection": { min: 0, max: 360 },
  "seaSurfaceWaveDirectionalSpread": { min: 0, max: 360 },
  "seaSurfaceWavePeriodOfHighestWave": { min: 0, max: 30 },
  "seaSurfaceWaveEnergyAtVarianceSpectralDensityMaximum": { min: 0, max: 200 },
  "seaSurfaceWaveFromDirectionAtVarianceSpectralDensityMaximum": { min: 0, max: 360 },
  "seaSurfaceWaveMeanPeriodFromVarianceSpectralDensityFirstFrequencyMoment": { min: 0, max: 30 },
  "seaSurfaceWaveMeanPeriodFromVarianceSpectralDensitySecondFrequencyMoment": { min: 0, max: 30 },
  "seaSurfaceWavePeriodAtVarianceSpectralDensityMaximum": { min: 0, max: 30 },
  "seaSurfaceSwellWaveFromDirection": { min: 0, max: 360 },
  "seaSurfaceSwellWaveSignificantHeight": { min: 0, max: 20 },
  "seaSurfaceSwellWaveMeanPeriodFromVarianceSpectralDensitySecondFrequencyMoment": { min: 0, max: 30 },
  "seaSurfaceWindWaveFromDirection": { min: 0, max: 360 },
  "seaSurfaceWindWaveSignificantHeight": { min: 0, max: 20 },
  "seaSurfaceWindWaveMeanPeriodFromVarianceSpectralDensitySecondFrequencyMoment": { min: 0, max: 30 },
};

export function canonicalizeParameterKey(paramName: string): string {
  const p = paramName.toLowerCase();

  if (p === "tempmin" || p.includes("minimum_air_temperature")) return "tempMin";
  if (p === "tempmax" || p.includes("maximum_air_temperature")) return "tempMax";
  if (p === "tempmin50cm" || p.includes("minimum_temperature_at_height_above_ground_50cm")) return "tempMin50cm";
  if (p === "tempminground" || p.includes("minimum_grass_temperature") || p.includes("minimum_temperature_at_ground_level")) return "tempMinGround";
  if (p === "temperature" || p.includes("air_temperature")) return "temperature";

  if (p === "precipitation1h" || p.includes("precipitation_amount_1h") || p.includes("rainfall_amount_1h") || ((p.includes("precipitation") || p.includes("rain")) && p.includes("pt1h"))) return "precipitation1h";
  if (p === "precipitation3h" || p.includes("precipitation_amount_3h") || p.includes("rainfall_amount_3h") || ((p.includes("precipitation") || p.includes("rain")) && p.includes("pt3h"))) return "precipitation3h";
  if (p === "precipitation6h" || p.includes("precipitation_amount_6h") || p.includes("rainfall_amount_6h") || ((p.includes("precipitation") || p.includes("rain")) && p.includes("pt6h"))) return "precipitation6h";
  if (p === "precipitation12h" || p.includes("precipitation_amount_12h") || p.includes("rainfall_amount_12h") || ((p.includes("precipitation") || p.includes("rain")) && p.includes("pt12h"))) return "precipitation12h";
  if (p === "precipitation24h" || p.includes("precipitation_amount_24h") || p.includes("rainfall_amount_24h") || ((p.includes("precipitation") || p.includes("rain")) && p.includes("pt24h"))) return "precipitation24h";
  if (p === "precipitation" || p.includes("precipitation_amount") || p.includes("rainfall_amount")) return "precipitation";

  if (p === "pressure" || p.includes("air_pressure_at_mean_sea_level")) return "pressure";
  if (p === "pressuretendency" || p.includes("tendency_of_surface_air_pressure")) return "pressureTendency";
  if (p === "pressurestation" || (p.includes("air_pressure") && !p.includes("mean_sea_level"))) return "pressureStation";

  if (p === "windgust" || p.includes("wind_speed_of_gust")) return "windGust";
  if (p === "windgustdirection" || p.includes("wind_gust_from_direction")) return "windGustDirection";
  if (p === "windgustinst" || p.includes("wind_gust")) return "windGustInst";
  if (p === "windspeed2m" || p.includes("wind_speed_2m") || p.includes("height_above_ground_2m")) return "windSpeed2m";
  if (p === "windspeed" || p.includes("wind_speed")) return "windSpeed";
  if (p === "winddirection" || p.includes("wind_from_direction")) return "windDirection";

  if (p === "humidity" || p.includes("relative_humidity")) return "humidity";
  if (p === "dewpoint" || p.includes("dew_point_temperature")) return "dewPoint";
  if (p === "cloudcoverlow" || p.includes("low_type_cloud_area_fraction")) return "cloudCoverLow";
  if (p === "cloudcover" || p.includes("cloud_cover") || p.includes("cloud_area_fraction")) return "cloudCover";
  if (p === "visibility" || p.includes("visibility_in_air") || p.includes("horizontal_visibility")) return "visibility";
  if (p === "solarradiation" || p.includes("surface_downwelling_shortwave_flux_in_air")) return "solarRadiation";

  if (p === "sunshineduration10m" || p.includes("duration_of_sunshine_10m") || p.includes("sunshine_duration_10m") || ((p.includes("sunshine") || p.includes("duration")) && p.includes("pt10m"))) return "sunshineDuration10m";
  if (p === "sunshineduration1h" || p.includes("duration_of_sunshine_1h") || p.includes("sunshine_duration_1h") || ((p.includes("sunshine") || p.includes("duration")) && p.includes("pt1h"))) return "sunshineDuration1h";
  if (p === "sunshineduration3h" || p.includes("duration_of_sunshine_3h") || p.includes("sunshine_duration_3h") || ((p.includes("sunshine") || p.includes("duration")) && p.includes("pt3h"))) return "sunshineDuration3h";
  if (p === "sunshineduration6h" || p.includes("duration_of_sunshine_6h") || p.includes("sunshine_duration_6h") || ((p.includes("sunshine") || p.includes("duration")) && p.includes("pt6h"))) return "sunshineDuration6h";
  if (p === "sunshineduration12h" || p.includes("duration_of_sunshine_12h") || p.includes("sunshine_duration_12h") || ((p.includes("sunshine") || p.includes("duration")) && p.includes("pt12h"))) return "sunshineDuration12h";
  if (p === "sunshineduration24h" || p.includes("duration_of_sunshine_24h") || p.includes("sunshine_duration_24h") || ((p.includes("sunshine") || p.includes("duration")) && p.includes("pt24h"))) return "sunshineDuration24h";
  if (p === "sunshineduration" || p.includes("duration_of_sunshine") || p.includes("sunshine_duration")) return "sunshineDuration";

  if (p === "snowdepth" || p.includes("surface_snow_thickness") || p.includes("snow_depth")) return "snowDepth";
  if (p === "snowfresh" || p.includes("thickness_of_snowfall_amount") || p.includes("surface_snow_amount") || p.includes("fresh_snow")) return "snowFresh";

  if (p.includes("soil_temperature") || p.includes("soiltemp")) {
    if (p.includes("10cm") || p.includes("0_1")) return "soilTemp10cm";
    if (p.includes("20cm") || p.includes("0_2")) return "soilTemp20cm";
    if (p.includes("50cm") || p.includes("0_5")) return "soilTemp50cm";
  }

  if (p === "etp" || p.includes("water_evaporation_amount")) return "etp";

  const camelKeys = [
    "virtualTemperature", "surfaceTemperature", "pressureTendency", "cloudBaseAltitude",
    "surfaceDiffuseDownwellingShortwave", "surfaceDirectDownwellingShortwave",
    "surfaceDownwellingLongwaveFluxInAir", "surfaceUpwellingLongwaveFluxInAir",
    "surfaceUpwellingShortwaveFluxInAir", "surfaceNetDownwardRadiativeFlux",
    "downwellingLongwaveFluxInAir", "surfaceDownwellingPhotosyntheticPhotonFluxInAir",
    "surfaceDownwellingPhotosyntheticRadiativeFluxInAir",
    "integralWrtTimeOfSurfaceDownwellingLongwaveFluxInAir",
    "integralWrtTimeOfSurfaceDownwellingShortwaveFluxInAir", "ultravioletIndex",
    "equivalentReflectivityFactor", "seaSurfaceTemperature", "seaWaterTemperature",
    "seaWaterSalinity", "seaWaterSpeed", "seaWaterElectricalConductivity",
    "seaSurfaceWaveSignificantHeight", "seaSurfaceWaveMaximumHeight",
    "seaSurfaceWaveMaximumPeriod", "seaSurfaceWaveMeanPeriod",
    "seaSurfaceWaveSignificantPeriod", "seaSurfaceWaveFromDirection",
    "seaSurfaceWaveDirectionalSpread", "seaSurfaceWavePeriodOfHighestWave",
    "seaSurfaceWaveEnergyAtVarianceSpectralDensityMaximum",
    "seaSurfaceWaveFromDirectionAtVarianceSpectralDensityMaximum",
    "seaSurfaceWaveMeanPeriodFromVarianceSpectralDensityFirstFrequencyMoment",
    "seaSurfaceWaveMeanPeriodFromVarianceSpectralDensitySecondFrequencyMoment",
    "seaSurfaceWavePeriodAtVarianceSpectralDensityMaximum",
    "seaSurfaceSwellWaveFromDirection", "seaSurfaceSwellWaveSignificantHeight",
    "seaSurfaceSwellWaveMeanPeriodFromVarianceSpectralDensitySecondFrequencyMoment",
    "seaSurfaceWindWaveFromDirection", "seaSurfaceWindWaveSignificantHeight",
    "seaSurfaceWindWaveMeanPeriodFromVarianceSpectralDensitySecondFrequencyMoment"
  ];

  for (const ck of camelKeys) {
    if (p === ck.toLowerCase()) return ck;
  }

  return paramName.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function inferBounds(key: string): { min: number, max: number } | null {
  const k = key.toLowerCase();
  if (k.includes("temperature") || k.includes("temp"))     return { min: -95, max: 75 };
  if (k.includes("direction") || k.includes("spread"))     return { min: 0, max: 360 };
  if (k.includes("speed") || k.includes("gust"))           return { min: 0, max: 150 };
  if (k.includes("humidity") || k.includes("fraction") || k.includes("cover")) return { min: 0, max: 100 };
  if (k.includes("pressure"))                               return { min: 400, max: 1100 };
  if (k.includes("precipitation") || k.includes("rain"))   return { min: 0, max: 1200 };
  if (k.includes("salinity"))                               return { min: 0, max: 50 };
  if (k.includes("period"))                                 return { min: 0, max: 30 };
  if (k.includes("height") && k.includes("wave"))          return { min: 0, max: 40 };
  if (k.includes("visibility"))                             return { min: 0, max: 200000 };
  if (k.includes("radiation") || k.includes("flux"))       return { min: -500, max: 5000 };
  if (k.includes("snow"))                                   return { min: 0, max: 2500 };
  return null;
}

/**
 * Quick single-value bounds check for a given MeteoGate parameter key.
 * Returns true if the value is within the physical bounds.
 */
export function isValueInBounds(parameterKey: string, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const canonKey = canonicalizeParameterKey(parameterKey);

  const bounds = BOUNDED_PARAMS[canonKey] || inferBounds(canonKey);
  if (bounds) {
    return value >= bounds.min && value <= bounds.max;
  }

  if (NON_NEGATIVE_PARAMS.includes(canonKey)) {
    return value >= 0;
  }

  const k = canonKey.toLowerCase();
  if (
    k.includes("precipitation") || k.includes("rain") || k.includes("speed") || k.includes("gust") ||
    k.includes("humidity") || k.includes("radiation") || k.includes("sunshine") || k.includes("snow")
  ) {
    return value >= 0;
  }

  return true;
}

/**
 * Filters map area observations using physical bounds only.
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

  // Sort rows chronologically by datetime ascending to ensure order-dependent checks are correct
  const qcData = data.map(row => ({ ...row })).sort((a, b) => {
    const tA = new Date(a.datetime).getTime();
    const tB = new Date(b.datetime).getTime();
    return (isNaN(tA) ? 0 : tA) - (isNaN(tB) ? 0 : tB);
  });

  // Pass 1: Absolute physical bounds and relational checks
  qcData.forEach((row) => {
    // 1. Physical bounds checks using our centralized isValueInBounds logic
    for (const key of Object.keys(row)) {
      if (key === "datetime") continue;
      const val = row[key];
      if (typeof val === "number") {
        if (!isValueInBounds(key, val)) {
          row[key] = null;
        }
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

    // 2. Relational checks
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

  // Pass 2: Time-gap-aware Rolling Median Despiking for temperatures
  const MAX_TIME_GAP = 3 * 60 * 60 * 1000; // 3 hours in ms
  const tempKeys = ["temperature", "tempMin", "tempMax"];

  for (const tKey of tempKeys) {
    for (let i = 0; i < qcData.length; i++) {
      const vCurr = qcData[i][tKey];
      if (typeof vCurr !== "number") continue;

      const datetimeCurr = qcData[i].datetime;
      if (!datetimeCurr) continue;
      const tCurr = new Date(datetimeCurr as string).getTime();
      if (isNaN(tCurr)) continue;

      const windowValues: number[] = [vCurr];

      // Check left neighbors (i - 1, i - 2) checking contiguous intervals
      let lastTime = tCurr;
      for (let k = 1; k <= 2; k++) {
        const idx = i - k;
        if (idx < 0) break;
        const neighbor = qcData[idx];
        const tNeighbor = new Date(neighbor.datetime as string).getTime();
        if (isNaN(tNeighbor)) break;
        if (Math.abs(lastTime - tNeighbor) > MAX_TIME_GAP) {
          break; // Gap detected: stop looking further left
        }
        const vNeighbor = neighbor[tKey];
        if (typeof vNeighbor === "number") {
          windowValues.push(vNeighbor);
        }
        lastTime = tNeighbor;
      }

      // Check right neighbors (i + 1, i + 2) checking contiguous intervals
      lastTime = tCurr;
      for (let k = 1; k <= 2; k++) {
        const idx = i + k;
        if (idx >= qcData.length) break;
        const neighbor = qcData[idx];
        const tNeighbor = new Date(neighbor.datetime as string).getTime();
        if (isNaN(tNeighbor)) break;
        if (Math.abs(tNeighbor - lastTime) > MAX_TIME_GAP) {
          break; // Gap detected: stop looking further right
        }
        const vNeighbor = neighbor[tKey];
        if (typeof vNeighbor === "number") {
          windowValues.push(vNeighbor);
        }
        lastTime = tNeighbor;
      }

      // If we have enough points in the window, check for outliers/spikes
      if (windowValues.length >= 3) {
        windowValues.sort((a, b) => a - b);
        const median = windowValues[Math.floor(windowValues.length / 2)];
        if (Math.abs(vCurr - median) > 20) {
          qcData[i][tKey] = null;
        }
      }
    }
  }

  // Pass 3: Dynamic anomaly detection (Spike filter for other parameters)
  const spikeChecks = [
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

          curr[check.key] = null;
        }
      }
    }
  }

  return qcData;
}
