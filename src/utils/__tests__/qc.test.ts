import assert from "node:assert";
import test from "node:test";
import {
  canonicalizeParameterKey,
  isValueInBounds,
  applyQualityControl,
  filterMapObservations
} from "../qc.ts";
import type { HourlyRow } from "../qc.ts";

test("canonicalizeParameterKey normalizes various parameter names", () => {
  // Check exact matches
  assert.strictEqual(canonicalizeParameterKey("temperature"), "temperature");
  assert.strictEqual(canonicalizeParameterKey("tempMin"), "tempMin");

  // Check raw standard names (snake_case)
  assert.strictEqual(canonicalizeParameterKey("air_temperature"), "temperature");
  assert.strictEqual(canonicalizeParameterKey("minimum_air_temperature"), "tempMin");
  assert.strictEqual(canonicalizeParameterKey("maximum_air_temperature"), "tempMax");
  assert.strictEqual(canonicalizeParameterKey("relative_humidity"), "humidity");
  assert.strictEqual(canonicalizeParameterKey("wind_speed"), "windSpeed");
  assert.strictEqual(canonicalizeParameterKey("precipitation_amount"), "precipitation");
  assert.strictEqual(canonicalizeParameterKey("precipitation_amount_1h"), "precipitation1h");
  assert.strictEqual(canonicalizeParameterKey("air_pressure_at_mean_sea_level"), "pressure");
  assert.strictEqual(canonicalizeParameterKey("air_pressure"), "pressureStation");
  assert.strictEqual(canonicalizeParameterKey("dew_point_temperature"), "dewPoint");
  assert.strictEqual(canonicalizeParameterKey("water_evaporation_amount"), "etp");
});

test("isValueInBounds enforces meteorological limits correctly", () => {
  // 1. Antarctic winter temperatures (Rule 1)
  assert.strictEqual(isValueInBounds("temperature", -92), true); // legitimately extremely cold
  assert.strictEqual(isValueInBounds("temperature", -96), false); // too cold
  assert.strictEqual(isValueInBounds("temperature", 59), true);
  assert.strictEqual(isValueInBounds("temperature", 65), false); // too hot

  // 2. High-altitude station pressure vs sea-level pressure (Rule 6)
  assert.strictEqual(isValueInBounds("pressureStation", 650), true); // Valid high-altitude station pressure
  assert.strictEqual(isValueInBounds("pressureStation", 450), false); // Too low
  assert.strictEqual(isValueInBounds("pressure", 650), false); // Sea-level pressure cannot be this low
  assert.strictEqual(isValueInBounds("pressure", 850), true); // Valid sea-level pressure

  // 3. Strictly non-negative parameters (Rule 3)
  assert.strictEqual(isValueInBounds("precipitation", -0.1), false);
  assert.strictEqual(isValueInBounds("precipitation", 0), true);
  assert.strictEqual(isValueInBounds("windSpeed", -2), false);
  assert.strictEqual(isValueInBounds("windSpeed", 10), true);
  assert.strictEqual(isValueInBounds("humidity", -5), false);
  assert.strictEqual(isValueInBounds("humidity", 100), true);
});

test("applyQualityControl sorts rows chronologically", () => {
  const rows: HourlyRow[] = [
    { datetime: "2026-03-05T12:00:00Z", temperature: 15 },
    { datetime: "2026-03-05T10:00:00Z", temperature: 14 },
    { datetime: "2026-03-05T11:00:00Z", temperature: 13 }
  ];

  const result = applyQualityControl(rows);
  assert.strictEqual(result[0].datetime, "2026-03-05T10:00:00Z");
  assert.strictEqual(result[1].datetime, "2026-03-05T11:00:00Z");
  assert.strictEqual(result[2].datetime, "2026-03-05T12:00:00Z");
});

test("applyQualityControl rolling-median filter is time-gap aware", () => {
  // Case A: 1-hour intervals (consecutive), spike is removed
  const rowsWithSpike: HourlyRow[] = [
    { datetime: "2026-03-05T10:00:00Z", temperature: 15 },
    { datetime: "2026-03-05T11:00:00Z", temperature: 16 },
    { datetime: "2026-03-05T12:00:00Z", temperature: 40 }, // Spike!
    { datetime: "2026-03-05T13:00:00Z", temperature: 16 },
    { datetime: "2026-03-05T14:00:00Z", temperature: 15 }
  ];

  const resultA = applyQualityControl(rowsWithSpike);
  assert.strictEqual(resultA[2].temperature, null); // Spiked temperature should be nullified

  // Case B: Time gap > 3 hours, spike should NOT be removed because neighbors are not temporally contiguous
  const rowsWithGap: HourlyRow[] = [
    { datetime: "2026-03-05T10:00:00Z", temperature: 15 },
    { datetime: "2026-03-05T11:00:00Z", temperature: 16 },
    { datetime: "2026-03-05T16:00:00Z", temperature: 40 }, // Spike but 5 hours after!
    { datetime: "2026-03-05T21:00:00Z", temperature: 16 }, // 5 hours after!
    { datetime: "2026-03-05T22:00:00Z", temperature: 15 }
  ];

  const resultB = applyQualityControl(rowsWithGap);
  assert.strictEqual(resultB[2].temperature, 40); // Spiked temperature should NOT be nullified due to time gap
});

test("filterMapObservations nullifies out of bounds values and handles diverse zones", () => {
  const obs: Record<string, number[]> = {
    "stationA": [15, 20, 25],
    "stationB": [-999, 10, 20], // Out of bounds temperature
  };
  const filtered = filterMapObservations(obs, 0, "air_temperature");
  assert.ok(isNaN(filtered.stationB[0]));
  assert.strictEqual(filtered.stationA[0], 15);
  assert.strictEqual(filtered.stationB[1], 10);
});

test("filterMapObservations does not spatially filter diverse stations at one timestamp", () => {
  const obs: Record<string, number[]> = {
    "stationItaly": [25],
    "stationArctic": [-35],
    "stationAntarctic": [-85]
  };
  const filtered = filterMapObservations(obs, 0, "air_temperature");
  assert.strictEqual(filtered.stationItaly[0], 25);
  assert.strictEqual(filtered.stationArctic[0], -35);
  assert.strictEqual(filtered.stationAntarctic[0], -85);
});

test("raw parameter names map and filter correctly in applyQualityControl", () => {
  const rows: HourlyRow[] = [
    { datetime: "2026-03-05T12:00:00Z", wind_speed: 15, wind_speed_of_gust: -5 }
  ];
  const result = applyQualityControl(rows);
  assert.strictEqual(result[0].wind_speed, 15);
  assert.strictEqual(result[0].wind_speed_of_gust, null);
});

test("strictly non-negative parameters strip negative values", () => {
  const rows: HourlyRow[] = [
    { datetime: "2026-03-05T12:00:00Z", solarRadiation: -10, sunshineDuration: -1 }
  ];
  const result = applyQualityControl(rows);
  assert.strictEqual(result[0].solarRadiation, null);
  assert.strictEqual(result[0].sunshineDuration, null);
});

test("marine QC enforces swell wave bounds and normalizes raw names", () => {
  // 1. Raw name normalizations
  assert.strictEqual(
    canonicalizeParameterKey("sea_surface_swell_wave_significant_height"),
    "seaSurfaceSwellWaveSignificantHeight"
  );
  assert.strictEqual(
    canonicalizeParameterKey("sea_surface_swell_wave_from_direction"),
    "seaSurfaceSwellWaveFromDirection"
  );
  assert.strictEqual(
    canonicalizeParameterKey("sea_surface_swell_wave_mean_period_from_variance_spectral_density_second_frequency_moment"),
    "seaSurfaceSwellWaveMeanPeriodFromVarianceSpectralDensitySecondFrequencyMoment"
  );

  // 2. CamelCase UI/API names checking
  assert.strictEqual(canonicalizeParameterKey("seaSurfaceSwellWaveSignificantHeight"), "seaSurfaceSwellWaveSignificantHeight");

  // 3. Valid 20 m significant swell accepted, 30 m rejected
  assert.strictEqual(isValueInBounds("seaSurfaceSwellWaveSignificantHeight", 20), true);
  assert.strictEqual(isValueInBounds("seaSurfaceSwellWaveSignificantHeight", 30), false);

  // 4. Direction and period bounds
  assert.strictEqual(isValueInBounds("seaSurfaceSwellWaveFromDirection", 180), true);
  assert.strictEqual(isValueInBounds("seaSurfaceSwellWaveFromDirection", 370), false); // direction out of 360 bounds
  assert.strictEqual(isValueInBounds("seaSurfaceSwellWaveMeanPeriodFromVarianceSpectralDensitySecondFrequencyMoment", 15), true);
  assert.strictEqual(isValueInBounds("seaSurfaceSwellWaveMeanPeriodFromVarianceSpectralDensitySecondFrequencyMoment", 35), false); // period out of 30 bounds
});
