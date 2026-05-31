import React from "react";
import { AreaChartCard, BarChartCard, ComposedChartCard } from "./ChartCards";
import { WindRose } from "./Charts";

interface HourlyRow {
  datetime: string;
  temperature?: number;
  precipitation?: number;
  pressure?: number;
  windSpeed?: number;
  windDirection?: number;
  tempMin?: number;
  tempMax?: number;
  tempMin50cm?: number;
  tempMinGround?: number;
  pressureStation?: number;
  windGust?: number;
  windGustInst?: number;
  windSpeed2m?: number;
  humidity?: number;
  dewPoint?: number;
  cloudCover?: number;
  visibility?: number;
  solarRadiation?: number;
  sunshineDuration?: number;
  snowDepth?: number;
  snowFresh?: number;
  soilTemp10cm?: number;
  soilTemp20cm?: number;
  soilTemp50cm?: number;
  etp?: number;
}

export const DashboardCharts: React.FC<{ data: HourlyRow[] }> = ({ data }) => {
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
      <BarChartCard 
        data={data} 
        title="Precipitation" 
        unit="mm" 
        config={[
          { key: "precipitation", name: "Precipitation", color: "#0277bd" }
        ]} 
      />
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
          { key: "cloudCover", name: "Cloud Cover", color: "#78909C" }
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
