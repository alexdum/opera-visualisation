import React from "react";
import { AreaChartCard, BarChartCard, ComposedChartCard, DivergingBarChartCard, DualAxisChartCard } from "./ChartCards";
import { WindRose } from "./Charts";

interface HourlyRow {
  datetime: string;
  [key: string]: string | number | undefined;
}

// Precipitation duration keys in order of preference
const PRECIP_KEYS = [
  { key: "precipitation1h", label: "Precipitation (1h)" },
  { key: "precipitation3h", label: "Precipitation (3h)" },
  { key: "precipitation6h", label: "Precipitation (6h)" },
  { key: "precipitation12h", label: "Precipitation (12h)" },
  { key: "precipitation24h", label: "Precipitation (24h)" },
  { key: "precipitation", label: "Precipitation" },
];

// Sunshine duration keys
const SUNSHINE_KEYS = [
  { key: "sunshineDuration10m", label: "Sunshine Duration (10 min)" },
  { key: "sunshineDuration1h", label: "Sunshine Duration (1h)" },
  { key: "sunshineDuration3h", label: "Sunshine Duration (3h)" },
  { key: "sunshineDuration6h", label: "Sunshine Duration (6h)" },
  { key: "sunshineDuration12h", label: "Sunshine Duration (12h)" },
  { key: "sunshineDuration24h", label: "Sunshine Duration (24h)" },
  { key: "sunshineDuration", label: "Sunshine Duration" },
];

// Helper: check if any row has a defined, non-null value for a given key
function hasKey(data: HourlyRow[], key: string): boolean {
  return data.some((d) => d[key] !== undefined && d[key] !== null);
}

// Stricter check for accumulative fields: requires at least one non-zero value
// (all-zero means the station doesn't report this temporal resolution)
function hasNonZeroData(data: HourlyRow[], key: string): boolean {
  return data.some((d) => {
    const v = d[key];
    return v !== undefined && v !== null && typeof v === "number" && v > 0;
  });
}

// Resolve unit for a given key: use API-reported unit if available, otherwise fallback
function u(units: Record<string, string>, key: string, fallback: string): string {
  return units[key] || fallback;
}

export const DashboardCharts: React.FC<{ data: HourlyRow[]; units?: Record<string, string> }> = ({ data, units = {} }) => {
  // Determine which precipitation columns have actual non-zero data
  const precipCharts = PRECIP_KEYS.filter(({ key }) => hasNonZeroData(data, key));
  const sunshineCharts = SUNSHINE_KEYS.filter(({ key }) => hasNonZeroData(data, key));

  // Detect available data categories for conditional rendering
  const hasSeaTemp = hasKey(data, "seaSurfaceTemperature");
  const hasWaveHeight = hasKey(data, "seaSurfaceWaveSignificantHeight");
  const hasWavePeriod = hasKey(data, "seaSurfaceWaveMeanPeriod");
  const hasPressureTendency = hasKey(data, "pressureTendency");
  const hasUV = hasKey(data, "ultravioletIndex");
  const hasPrecipRate = hasKey(data, "lwePrecipitationRate") || hasKey(data, "rainfallRate");

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 lazy-render">
      {/* ─── Core Meteorological Charts ─── */}
      <AreaChartCard 
        data={data} 
        title="Temperature Profile" 
        unit={u(units, "temperature", "°C")} 
        config={[
          { key: "tempMax", name: "Max Temp", color: "#d32f2f" },
          { key: "temperature", name: "Temperature", color: "#b71c1c" },
          { key: "tempMin", name: "Min Temp", color: "#1976d2" }
        ]} 
      />
      <DualAxisChartCard 
        data={data} 
        title="Humidity & Dew Point" 
        leftConfig={{ key: "humidity", name: "Relative Humidity", color: "#43a047", unit: u(units, "humidity", "%") }}
        rightConfig={{ key: "dewPoint", name: "Dew Point", color: "#1e88e5", unit: u(units, "dewPoint", "°C") }}
      />

      {/* ─── Dynamic Precipitation Charts (one per accumulation period) ─── */}
      {precipCharts.map(({ key, label }) => (
        <BarChartCard 
          key={key}
          data={data} 
          title={label} 
          unit={u(units, key, "mm")} 
          config={[
            { key, name: label, color: "#0277bd" }
          ]} 
        />
      ))}

      {/* ─── Precipitation Rate (instantaneous mm/h) ─── */}
      {hasPrecipRate && (
        <AreaChartCard
          data={data}
          title="Precipitation Rate"
          unit={u(units, "lwePrecipitationRate", "mm/h")}
          config={[
            ...(hasKey(data, "lwePrecipitationRate")
              ? [{ key: "lwePrecipitationRate", name: "Precip Rate", color: "#0288D1" }]
              : []),
            ...(hasKey(data, "rainfallRate")
              ? [{ key: "rainfallRate", name: "Rainfall Rate", color: "#4FC3F7" }]
              : []),
          ]}
        />
      )}

      <BarChartCard 
        data={data} 
        title="Snow Profile" 
        unit={u(units, "snowDepth", "cm")} 
        stacked={true}
        config={[
          { key: "snowDepth", name: "Snow Depth", color: "#90CAF9" },
          { key: "snowFresh", name: "Fresh Snow", color: "#B0BEC5" }
        ]} 
      />
      <AreaChartCard 
        data={data} 
        title="Ground Temperature" 
        unit={u(units, "tempMinGround", "°C")} 
        config={[
          { key: "tempMinGround", name: "Min Ground Temp", color: "#388E3C" },
          { key: "tempMin50cm", name: "Min Temp at 50cm", color: "#795548" }
        ]} 
      />
      <AreaChartCard 
        data={data} 
        title="Soil Temperature" 
        unit={u(units, "soilTemp10cm", "°C")} 
        config={[
          { key: "soilTemp10cm", name: "10cm Depth", color: "#D7CCC8" },
          { key: "soilTemp20cm", name: "20cm Depth", color: "#A1887F" },
          { key: "soilTemp50cm", name: "50cm Depth", color: "#795548" }
        ]} 
      />
      <AreaChartCard 
        data={data} 
        title="Sea Level Pressure" 
        unit={u(units, "pressure", "hPa")} 
        config={[
          { key: "pressure", name: "Sea Level Pressure", color: "#AB47BC" },
          { key: "pressureStation", name: "Station Pressure", color: "#7B1FA2" }
        ]} 
      />

      {/* ─── Pressure Tendency (diverging bar: green = rising, red = falling) ─── */}
      {hasPressureTendency && (
        <DivergingBarChartCard
          data={data}
          title="Pressure Tendency"
          unit={u(units, "pressureTendency", "hPa/3h")}
          dataKey="pressureTendency"
          name="Pressure Tendency"
          posColor="#43a047"
          negColor="#e53935"
        />
      )}

      <AreaChartCard 
        data={data} 
        title="Cloud Cover" 
        unit={u(units, "cloudCover", "%")} 
        config={[
          { key: "cloudCover", name: "Cloud Cover", color: "#78909C" },
          { key: "cloudCoverLow", name: "Low Cloud", color: "#B0BEC5" }
        ]} 
      />
      <ComposedChartCard 
        data={data} 
        title="Wind Speed & Gusts" 
        unit={u(units, "windSpeed", "m/s")} 
        areaConfig={{ key: "windSpeed", name: "Wind Speed", color: "#43a047" }}
        lineConfig={{ key: "windGust", name: "Wind Gust", color: "#2e7d32" }}
      />
      <ComposedChartCard 
        data={data} 
        title="Wind 2m & Instant Gust" 
        unit={u(units, "windSpeed2m", "m/s")} 
        areaConfig={{ key: "windSpeed2m", name: "Wind Speed (2m)", color: "#81C784" }}
        lineConfig={{ key: "windGustInst", name: "Instant Gust", color: "#D32F2F" }}
      />
      <AreaChartCard 
        data={data} 
        title="Visibility" 
        unit={u(units, "visibility", "m")} 
        config={[
          { key: "visibility", name: "Visibility", color: "#5D4037" }
        ]} 
      />
      <AreaChartCard 
        data={data} 
        title="Solar Radiation" 
        unit={u(units, "solarRadiation", "W/m²")} 
        config={[
          { key: "solarRadiation", name: "Global Solar Radiation", color: "#FFB300" }
        ]} 
      />
      {sunshineCharts.map(({ key, label }) => (
        <BarChartCard 
          key={key}
          data={data} 
          title={label} 
          unit={u(units, key, "min")} 
          config={[
            { key, name: label, color: "#FFD700" }
          ]} 
        />
      ))} 
      {/* ─── UV Index ─── */}
      {hasUV && (
        <AreaChartCard
          data={data}
          title="UV Index"
          unit={u(units, "ultravioletIndex", "")}
          config={[
            { key: "ultravioletIndex", name: "UV Index", color: "#9C27B0" }
          ]}
        />
      )}

      <BarChartCard 
        data={data} 
        title="Evapotranspiration (ETP)" 
        unit={u(units, "etp", "mm")} 
        config={[
          { key: "etp", name: "ETP", color: "#795548" }
        ]} 
      />
      {data.some(d => d.windSpeed !== undefined && d.windDirection !== undefined) && (
        <WindRose data={data as any} />
      )}

      {/* ─── Marine / Ocean Charts (only render for coastal/buoy stations) ─── */}
      {hasSeaTemp && (
        <ComposedChartCard
          data={data}
          title="Air vs. Sea Surface Temperature"
          unit={u(units, "seaSurfaceTemperature", "°C")}
          areaConfig={{ key: "seaSurfaceTemperature", name: "SST", color: "#0097A7" }}
          lineConfig={{ key: "temperature", name: "Air Temp", color: "#FF7043" }}
        />
      )}

      {hasWaveHeight && (
        <ComposedChartCard
          data={data}
          title="Wave Height"
          unit={u(units, "seaSurfaceWaveSignificantHeight", "m")}
          areaConfig={{ key: "seaSurfaceWaveSignificantHeight", name: "Sig. Wave Ht", color: "#0277BD" }}
          lineConfig={{ key: "seaSurfaceWaveMaximumHeight", name: "Max Wave Ht", color: "#E53935" }}
        />
      )}

      {hasWavePeriod && (
        <AreaChartCard
          data={data}
          title="Wave Period"
          unit={u(units, "seaSurfaceWaveMeanPeriod", "s")}
          config={[
            { key: "seaSurfaceWaveMeanPeriod", name: "Mean Period", color: "#00838F" },
            { key: "seaSurfaceWaveSignificantPeriod", name: "Sig. Period", color: "#4DB6AC" },
          ]}
        />
      )}
    </div>
  );
};
