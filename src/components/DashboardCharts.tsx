import React from "react";
import { AreaChartCard, BarChartCard, ComposedChartCard } from "./ChartCards";
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

export const DashboardCharts: React.FC<{ data: HourlyRow[] }> = ({ data }) => {
  // Determine which precipitation columns have data
  const precipCharts = PRECIP_KEYS.filter(({ key }) =>
    data.some((d) => d[key] !== undefined && d[key] !== null)
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 lazy-render">
      <AreaChartCard 
        data={data} 
        title="Temperature Profile" 
        unit="°C" 
        config={[
          { key: "tempMax", name: "Max Temp", color: "#d32f2f" },
          { key: "temperature", name: "Temperature", color: "#b71c1c" },
          { key: "tempMin", name: "Min Temp", color: "#1976d2" }
        ]} 
      />
      <AreaChartCard 
        data={data} 
        title="Humidity" 
        unit="%" 
        config={[
          { key: "humidity", name: "Relative Humidity", color: "#43a047" },
          { key: "dewPoint", name: "Dew Point (°C)", color: "#1e88e5" }
        ]} 
      />
      {/* Dynamic precipitation charts — one per available accumulation period */}
      {precipCharts.map(({ key, label }) => (
        <BarChartCard 
          key={key}
          data={data} 
          title={label} 
          unit="mm" 
          config={[
            { key, name: label, color: "#0277bd" }
          ]} 
        />
      ))}
      <BarChartCard 
        data={data} 
        title="Snow Profile" 
        unit="cm" 
        stacked={true}
        config={[
          { key: "snowDepth", name: "Snow Depth", color: "#90CAF9" },
          { key: "snowFresh", name: "Fresh Snow", color: "#B0BEC5" }
        ]} 
      />
      <AreaChartCard 
        data={data} 
        title="Ground Temperature" 
        unit="°C" 
        config={[
          { key: "tempMinGround", name: "Min Ground Temp", color: "#388E3C" },
          { key: "tempMin50cm", name: "Min Temp at 50cm", color: "#795548" }
        ]} 
      />
      <AreaChartCard 
        data={data} 
        title="Soil Temperature" 
        unit="°C" 
        config={[
          { key: "soilTemp10cm", name: "10cm Depth", color: "#D7CCC8" },
          { key: "soilTemp20cm", name: "20cm Depth", color: "#A1887F" },
          { key: "soilTemp50cm", name: "50cm Depth", color: "#795548" }
        ]} 
      />
      <AreaChartCard 
        data={data} 
        title="Sea Level Pressure" 
        unit="hPa" 
        config={[
          { key: "pressure", name: "Sea Level Pressure", color: "#AB47BC" },
          { key: "pressureStation", name: "Station Pressure", color: "#7B1FA2" }
        ]} 
      />
      <AreaChartCard 
        data={data} 
        title="Cloud Cover" 
        unit="%" 
        config={[
          { key: "cloudCover", name: "Cloud Cover", color: "#78909C" },
          { key: "cloudCoverLow", name: "Low Cloud", color: "#B0BEC5" }
        ]} 
      />
      <ComposedChartCard 
        data={data} 
        title="Wind Speed & Gusts" 
        unit="m/s" 
        areaConfig={{ key: "windSpeed", name: "Wind Speed", color: "#43a047" }}
        lineConfig={{ key: "windGust", name: "Wind Gust", color: "#2e7d32" }}
      />
      <ComposedChartCard 
        data={data} 
        title="Wind 2m & Instant Gust" 
        unit="m/s" 
        areaConfig={{ key: "windSpeed2m", name: "Wind Speed (2m)", color: "#81C784" }}
        lineConfig={{ key: "windGustInst", name: "Instant Gust", color: "#D32F2F" }}
      />
      <AreaChartCard 
        data={data} 
        title="Visibility" 
        unit="m" 
        config={[
          { key: "visibility", name: "Visibility", color: "#5D4037" }
        ]} 
      />
      <AreaChartCard 
        data={data} 
        title="Solar Radiation" 
        unit="W/m²" 
        config={[
          { key: "solarRadiation", name: "Global Solar Radiation", color: "#FFB300" }
        ]} 
      />
      <BarChartCard 
        data={data} 
        title="Sunshine Duration" 
        unit="min" 
        config={[
          { key: "sunshineDuration", name: "Sunshine Duration", color: "#FFD700" }
        ]} 
      />
      <BarChartCard 
        data={data} 
        title="Evapotranspiration (ETP)" 
        unit="mm" 
        config={[
          { key: "etp", name: "ETP", color: "#795548" }
        ]} 
      />
      {data.some(d => d.windSpeed !== undefined && d.windDirection !== undefined) && (
        <WindRose data={data as any} />
      )}
    </div>
  );
};
