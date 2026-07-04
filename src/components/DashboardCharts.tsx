import React, { useMemo } from "react";
import { AreaChartCard, BarChartCard, ComposedChartCard, DivergingBarChartCard, DualAxisChartCard } from "./ChartCards";
import { WindRose } from "./Charts";
import { Tooltip } from "./Tooltip";
import { Thermometer, CloudRain, Wind, Droplets, Gauge, Snowflake, Sun, Waves, Cloud, Eye } from "lucide-react";

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

function hasAnyKey(data: HourlyRow[], keys: string[]): boolean {
  return keys.some((key) => hasKey(data, key));
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
  const hasTemperature = hasAnyKey(data, ["tempMax", "temperature", "tempMin"]);
  const hasHumidityDewPoint = hasAnyKey(data, ["humidity", "dewPoint"]);
  const hasSnow = hasAnyKey(data, ["snowDepth", "snowFresh"]);
  const hasGroundTemp = hasAnyKey(data, ["tempMinGround", "tempMin50cm"]);
  const hasSoilTemp = hasAnyKey(data, ["soilTemp10cm", "soilTemp20cm", "soilTemp50cm"]);
  const hasPressure = hasAnyKey(data, ["pressure", "pressureStation"]);
  const hasCloudCover = hasAnyKey(data, ["cloudCover", "cloudCoverLow"]);
  const hasWindSpeed = hasAnyKey(data, ["windSpeed", "windGust"]);
  const hasWind2m = hasAnyKey(data, ["windSpeed2m", "windGustInst"]);
  const hasVisibility = hasKey(data, "visibility");
  const hasSolarRadiation = hasKey(data, "solarRadiation");
  const hasEtp = hasKey(data, "etp");
  const hasWindRose = data.some(d => d.windSpeed !== undefined && d.windDirection !== undefined);
  const hasSeaTemp = hasKey(data, "seaSurfaceTemperature");
  const hasWaveHeight = hasKey(data, "seaSurfaceWaveSignificantHeight");
  const hasWavePeriod = hasKey(data, "seaSurfaceWaveMeanPeriod");
  const hasPressureTendency = hasKey(data, "pressureTendency");
  const hasUV = hasKey(data, "ultravioletIndex");
  const hasPrecipRate = hasKey(data, "lwePrecipitationRate") || hasKey(data, "rainfallRate");
  const hasRenderableCharts = [
    hasTemperature, hasHumidityDewPoint, precipCharts.length > 0, hasPrecipRate,
    hasSnow, hasGroundTemp, hasSoilTemp, hasPressure, hasPressureTendency,
    hasCloudCover, hasWindSpeed, hasWind2m, hasVisibility, hasSolarRadiation,
    sunshineCharts.length > 0, hasUV, hasEtp, hasWindRose, hasSeaTemp,
    hasWaveHeight, hasWavePeriod,
  ].some(Boolean);

  if (!hasRenderableCharts) {
    return (
      <div className="min-h-[260px] w-full flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/70 px-6 text-center">
        <p className="text-sm font-bold text-slate-500">
          No data available for the station and period selected.
        </p>
      </div>
    );
  }

  // Helper to extract numbers for a specific key
  const vals = (key: string) => data.map(d => d[key]).filter((v): v is number => typeof v === 'number' && !isNaN(v));

  // Safe Math Helpers to protect against empty arrays yielding ±Infinity
  const safeMax = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : null;
  const safeMin = (arr: number[]) => arr.length > 0 ? Math.min(...arr) : null;
  const safeMean = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  // Helper to find extreme value and its timestamp
  const getExtreme = (key: string, type: 'max' | 'min') => {
    let extremeVal = type === 'max' ? -Infinity : Infinity;
    let extremeTime = "";
    
    for (const d of data) {
      const v = d[key];
      if (typeof v === 'number' && !isNaN(v)) {
        if (type === 'max' && v > extremeVal) {
          extremeVal = v;
          extremeTime = d.datetime;
        } else if (type === 'min' && v < extremeVal) {
          extremeVal = v;
          extremeTime = d.datetime;
        }
      }
    }
    
    return extremeVal === -Infinity || extremeVal === Infinity 
      ? null 
      : { val: extremeVal, time: extremeTime };
  };

  // Helper to format extreme time to a readable string (e.g. "29 Mar 12:00")
  const formatExtremeTime = (isoString: string) => {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      const day = d.getUTCDate();
      const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      const hours = String(d.getUTCHours()).padStart(2, '0');
      const minutes = String(d.getUTCMinutes()).padStart(2, '0');
      return `${day} ${month} ${hours}:${minutes}`;
    } catch {
      return "";
    }
  };

  // Caching variables to avoid repetitive array iteration
  const tempVals = vals("temperature");
  const tempMaxVals = vals("tempMax");
  const tempMinVals = vals("tempMin");
  
  const humidityVals = vals("humidity");
  const dewPointVals = vals("dewPoint");
  
  const windSpeedVals = vals("windSpeed");
  const windGustVals = vals("windGust");
  const windSpeed2mVals = vals("windSpeed2m");
  const windGustInstVals = vals("windGustInst");
  
  const pressureVals = vals("pressure");
  const pressureStationVals = vals("pressureStation");
  
  const snowDepthVals = vals("snowDepth");
  const snowFreshVals = vals("snowFresh");
  
  const groundVals = vals("tempMinGround");
  const ground50Vals = vals("tempMin50cm");
  
  const soil10Vals = vals("soilTemp10cm");
  const soil20Vals = vals("soilTemp20cm");
  const soil50Vals = vals("soilTemp50cm");
  const allSoilVals = [...soil10Vals, ...soil20Vals, ...soil50Vals];
  
  const solarVals = vals("solarRadiation");
  const visibilityVals = vals("visibility");
  const cloudCoverVals = vals("cloudCover");
  const cloudCoverLowVals = vals("cloudCoverLow");
  
  const sstVals = vals("seaSurfaceTemperature");
  const waveHeightVals = vals("seaSurfaceWaveSignificantHeight");

  // 1. Temperature Statistics
  let tempStats = null;
  if (hasTemperature) {
    const avg = safeMean(tempVals);
    const maxExt = getExtreme("tempMax", "max") || getExtreme("temperature", "max");
    const minExt = getExtreme("tempMin", "min") || getExtreme("temperature", "min");
    if (avg !== null && maxExt && minExt) {
      tempStats = { avg, max: maxExt, min: minExt };
    }
  }

  // 2. Precipitation Statistics
  let precipStats = null;
  if (precipCharts.length > 0) {
    const primaryPrecipKey = precipCharts.find(c => c.key === "precipitation1h")?.key || precipCharts[0].key;
    const precipVals = vals(primaryPrecipKey).map(v => Math.max(0, v));
    const total = precipVals.length > 0 ? precipVals.reduce((a, b) => a + b, 0) : null;
    const maxRateExt = hasPrecipRate 
      ? (getExtreme("lwePrecipitationRate", "max") || getExtreme("rainfallRate", "max")) 
      : getExtreme(primaryPrecipKey, "max");
    
    if (total !== null && maxRateExt) {
      precipStats = { total, maxRate: maxRateExt };
    }
  }

  // 3. Wind Statistics
  let windStats = null;
  if (hasWindSpeed || hasWind2m) {
    const speeds = windSpeedVals.length > 0 ? windSpeedVals : windSpeed2mVals;
    const avg = safeMean(speeds);
    const maxGustExt = getExtreme("windGust", "max") || getExtreme("windGustInst", "max") || getExtreme("windSpeed", "max") || getExtreme("windSpeed2m", "max");
    if (avg !== null && maxGustExt) {
      windStats = { avg, maxGust: maxGustExt };
    }
  }

  // 4. Humidity & Dew Point Statistics (Fix: no * 100 multiplier)
  let humidityStats = null;
  if (hasHumidityDewPoint && humidityVals.length > 0) {
    const avg = safeMean(humidityVals);
    const minExt = getExtreme("humidity", "min");
    const avgDew = safeMean(dewPointVals);
    if (avg !== null && minExt) {
      humidityStats = { avg, min: minExt, avgDew };
    }
  }

  // 5. Pressure Statistics (Fix: prefer sea-level pressure, do not pool)
  let pressureStats = null;
  if (hasPressure) {
    const primaryPresVals = pressureVals.length > 0 ? pressureVals : pressureStationVals;
    const primaryPresKey = pressureVals.length > 0 ? "pressure" : "pressureStation";
    const avg = safeMean(primaryPresVals);
    const minExt = getExtreme(primaryPresKey, "min");
    const maxExt = getExtreme(primaryPresKey, "max");
    if (avg !== null && minExt && maxExt) {
      pressureStats = { avg, min: minExt, max: maxExt, isSeaLevel: pressureVals.length > 0 };
    }
  }

  // 6. Snow Statistics
  let snowStats = null;
  if (hasSnow) {
    const maxDepthExt = getExtreme("snowDepth", "max");
    const totalFresh = snowFreshVals.length > 0 ? snowFreshVals.reduce((a, b) => a + b, 0) : 0;
    if (maxDepthExt) {
      snowStats = { maxDepth: maxDepthExt, totalFresh };
    }
  }

  // 7. Ground / Soil Temp Statistics
  let soilStats = null;
  if (hasGroundTemp || hasSoilTemp) {
    const groundMinExt = getExtreme("tempMinGround", "min") || getExtreme("tempMin50cm", "min");
    const avgSoil = safeMean(allSoilVals);
    if (groundMinExt || avgSoil !== null) {
      soilStats = { minGround: groundMinExt, avgSoil };
    }
  }

  // 8. Solar / Radiation & Sunshine Statistics
  let solarStats = null;
  if (hasSolarRadiation || sunshineCharts.length > 0) {
    const avgRad = safeMean(solarVals);
    const primarySunshineKey = sunshineCharts.find(c => c.key === "sunshineDuration1h")?.key || sunshineCharts[0]?.key;
    const suns = primarySunshineKey ? vals(primarySunshineKey) : [];
    const totalSunshineHrs = suns.length > 0 ? suns.reduce((a, b) => a + b, 0) / 60 : null;
    if (avgRad !== null || totalSunshineHrs !== null) {
      solarStats = { avgRad, totalSunshineHrs };
    }
  }

  // 9. Visibility Statistics
  let visibilityStats = null;
  if (hasVisibility && visibilityVals.length > 0) {
    const avg = safeMean(visibilityVals);
    const minExt = getExtreme("visibility", "min");
    if (avg !== null && minExt) {
      visibilityStats = { avg, min: minExt };
    }
  }

  // 10. Cloud Cover Statistics
  let cloudStats = null;
  if (hasCloudCover) {
    const primaryCloudVals = cloudCoverVals.length > 0 ? cloudCoverVals : cloudCoverLowVals;
    const avg = safeMean(primaryCloudVals);
    if (avg !== null) {
      cloudStats = { avg };
    }
  }

  // 11. Marine / Waves Statistics
  let marineStats = null;
  if (hasSeaTemp || hasWaveHeight || hasWavePeriod) {
    const avgSst = safeMean(sstVals);
    const maxWaveExt = getExtreme("seaSurfaceWaveSignificantHeight", "max");
    if (avgSst !== null || maxWaveExt) {
      marineStats = { avgSst, maxWave: maxWaveExt };
    }
  }

  // Helper to get the most recent non-null value for a given key
  const getLatestValue = (key: string) => {
    for (let i = data.length - 1; i >= 0; i--) {
      const v = data[i][key];
      if (v !== undefined && v !== null && typeof v === 'number' && !isNaN(v)) {
        return v;
      }
    }
    return null;
  };

  const getLatestValueFormatted = (key: string, suffix: string, divisor = 1, precision = 1) => {
    const val = getLatestValue(key);
    return val !== null ? `${(val / divisor).toFixed(precision)}${suffix}` : "—";
  };

  const latestRow = data.length > 0 ? data[data.length - 1] : null;

  const statCards = [
    tempStats && {
      title: "Temperature",
      value: getLatestValueFormatted("temperature", "°C"),
      subtext: `Avg: ${tempStats.avg.toFixed(1)}°C | Min: ${tempStats.min.val.toFixed(1)}°C (${formatExtremeTime(tempStats.min.time)}) | Max: ${tempStats.max.val.toFixed(1)}°C (${formatExtremeTime(tempStats.max.time)})`,
      icon: <Thermometer className="text-red-500" size={20} />,
      bgClass: "bg-red-50/50 border-red-100/50"
    },
    precipStats && {
      title: "Precipitation",
      value: getLatestValueFormatted(precipCharts.find(c => c.key === "precipitation1h")?.key || precipCharts[0].key, " mm"),
      subtext: `Total: ${precipStats.total.toFixed(1)} mm | Peak: ${precipStats.maxRate.val.toFixed(1)} mm/h (${formatExtremeTime(precipStats.maxRate.time)})`,
      icon: <CloudRain className="text-blue-500" size={20} />,
      bgClass: "bg-blue-50/50 border-blue-100/50"
    },
    windStats && {
      title: "Wind Speed",
      value: getLatestValueFormatted(windSpeedVals.length > 0 ? "windSpeed" : "windSpeed2m", " m/s"),
      subtext: `Avg: ${windStats.avg.toFixed(1)} m/s | Max Gust: ${windStats.maxGust.val.toFixed(1)} m/s (${formatExtremeTime(windStats.maxGust.time)})`,
      icon: <Wind className="text-emerald-500" size={20} />,
      bgClass: "bg-emerald-50/50 border-emerald-100/50"
    },
    humidityStats && {
      title: "Relative Humidity",
      value: getLatestValueFormatted("humidity", "%", 1, 0),
      subtext: `Avg: ${humidityStats.avg.toFixed(0)}% | Min: ${humidityStats.min.val.toFixed(0)}% (${formatExtremeTime(humidityStats.min.time)})`,
      icon: <Droplets className="text-cyan-500" size={20} />,
      bgClass: "bg-cyan-50/50 border-cyan-100/50"
    },
    pressureStats && {
      title: pressureStats.isSeaLevel ? "Atm. Pressure" : "Station Pressure",
      value: getLatestValueFormatted(pressureVals.length > 0 ? "pressure" : "pressureStation", " hPa", 1, 0),
      subtext: `Avg: ${pressureStats.avg.toFixed(0)} hPa | Range: ${pressureStats.min.val.toFixed(0)} (${formatExtremeTime(pressureStats.min.time)}) - ${pressureStats.max.val.toFixed(0)} (${formatExtremeTime(pressureStats.max.time)}) hPa`,
      icon: <Gauge className="text-purple-500" size={20} />,
      bgClass: "bg-purple-50/50 border-purple-100/50"
    },
    snowStats && {
      title: "Snow Cover",
      value: getLatestValueFormatted("snowDepth", " cm", 1, 0),
      subtext: `Peak: ${snowStats.maxDepth.val.toFixed(0)} cm (${formatExtremeTime(snowStats.maxDepth.time)}) | Fresh: ${snowStats.totalFresh.toFixed(0)} cm`,
      icon: <Snowflake className="text-sky-400" size={20} />,
      bgClass: "bg-sky-50/50 border-sky-100/50"
    },
    soilStats && {
      title: "Ground & Soil Temp",
      value: getLatestValueFormatted("tempMinGround", "°C"),
      subtext: `Min ground: ${soilStats.minGround ? soilStats.minGround.val.toFixed(1) + "°C (" + formatExtremeTime(soilStats.minGround.time) + ")" : "—"}${soilStats.avgSoil !== null ? ` | Avg Soil: ${soilStats.avgSoil.toFixed(1)}°C` : ""}`,
      icon: <Thermometer className="text-amber-700" size={20} />,
      bgClass: "bg-amber-50/30 border-amber-100/30"
    },
    solarStats && {
      title: "Solar & Sunshine",
      value: getLatestValueFormatted("solarRadiation", " W/m²", 1, 0),
      subtext: `Avg Rad: ${solarStats.avgRad ? solarStats.avgRad.toFixed(0) + " W/m²" : "—"}${solarStats.totalSunshineHrs !== null ? ` | Sunshine: ${solarStats.totalSunshineHrs.toFixed(1)} hrs` : ""}`,
      icon: <Sun className="text-amber-500" size={20} />,
      bgClass: "bg-amber-50/50 border-amber-100/50"
    },
    visibilityStats && {
      title: "Visibility",
      value: getLatestValueFormatted("visibility", " km", 1000, 1),
      subtext: `Avg: ${(visibilityStats.avg / 1000).toFixed(1)} km | Min: ${(visibilityStats.min.val / 1000).toFixed(1)} km (${formatExtremeTime(visibilityStats.min.time)})`,
      icon: <Eye className="text-pink-500" size={20} />,
      bgClass: "bg-pink-50/50 border-pink-100/50"
    },
    cloudStats && {
      title: "Cloud Cover",
      value: getLatestValueFormatted("cloudCover", "%", 1, 0),
      subtext: `Avg: ${cloudStats.avg.toFixed(0)}%`,
      icon: <Cloud className="text-slate-500" size={20} />,
      bgClass: "bg-slate-50/50 border-slate-100/50"
    },
    marineStats && {
      title: "Marine & Waves",
      value: getLatestValueFormatted("seaSurfaceTemperature", "°C SST"),
      subtext: `Avg SST: ${marineStats.avgSst ? marineStats.avgSst.toFixed(1) + "°C" : "—"}${marineStats.maxWave ? ` | Max Wave: ${marineStats.maxWave.val.toFixed(1)} m (${formatExtremeTime(marineStats.maxWave.time)})` : ""}`,
      icon: <Waves className="text-teal-500" size={20} />,
      bgClass: "bg-teal-50/50 border-teal-100/50"
    }
  ].filter(Boolean) as { title: string; value: string; subtext: string; icon: React.ReactNode; bgClass: string }[];

  const dateRangeString = useMemo(() => {
    const datesOnly = data.map(d => d.datetime).filter(Boolean);
    if (datesOnly.length === 0) return "";
    const minDateStr = datesOnly.reduce((a, b) => a < b ? a : b, datesOnly[0]);
    const maxDateStr = datesOnly.reduce((a, b) => a > b ? a : b, datesOnly[0]);
    try {
      const start = new Date(minDateStr);
      const end = new Date(maxDateStr);
      const startDay = start.getUTCDate();
      const startMonth = start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      const endDay = end.getUTCDate();
      const endMonth = end.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      const endYear = end.getUTCFullYear();
      const endHour = end.getUTCHours().toString().padStart(2, '0');
      const endMinute = end.getUTCMinutes().toString().padStart(2, '0');
      return `${startDay} ${startMonth} – ${endDay} ${endMonth} ${endYear}, latest at ${endHour}:${endMinute} UTC`;
    } catch {
      return "";
    }
  }, [data]);

  return (
    <div className="flex flex-col gap-6 w-full">
      {statCards.length > 0 && (
        <div className="w-full flex flex-col gap-3 snap-start scroll-mt-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider pl-1">
            Station Observations Summary {dateRangeString && `(${dateRangeString})`}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {statCards.map((card, i) => (
              <div 
                key={i} 
                className={`glass-card flex items-start gap-3 p-4 rounded-2xl shadow-xs border ${card.bgClass} hover:translate-y-[-2px] transition-transform duration-200`}
              >
                <div className="p-2 rounded-xl bg-white/40 dark:bg-slate-900/20 border border-white/40 dark:border-slate-800/30">
                  {card.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">
                    {card.title}
                  </div>
                  <div 
                    className="text-lg font-black tracking-tight mt-0.5 animate-fade-in"
                    style={{ color: 'var(--foreground)' }}
                  >
                    {card.value}
                  </div>
                  <Tooltip content={card.subtext} position="bottom" className="mt-1">
                    <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 truncate cursor-help max-w-[120px]">
                      {card.subtext}
                    </div>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 lazy-render">
      {/* ─── Core Meteorological Charts ─── */}
      {hasTemperature && (
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
      )}
      {hasHumidityDewPoint && (
        <DualAxisChartCard 
          data={data} 
          title="Humidity & Dew Point" 
          leftConfig={{ key: "humidity", name: "Relative Humidity", color: "#43a047", unit: u(units, "humidity", "%") }}
          rightConfig={{ key: "dewPoint", name: "Dew Point", color: "#1e88e5", unit: u(units, "dewPoint", "°C") }}
        />
      )}

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

      {hasSnow && (
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
      )}
      {hasGroundTemp && (
        <AreaChartCard 
          data={data} 
          title="Ground Temperature" 
          unit={u(units, "tempMinGround", "°C")} 
          config={[
            { key: "tempMinGround", name: "Min Ground Temp", color: "#388E3C" },
            { key: "tempMin50cm", name: "Min Temp at 50cm", color: "#795548" }
          ]} 
        />
      )}
      {hasSoilTemp && (
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
      )}
      {hasPressure && (
        <AreaChartCard 
          data={data} 
          title="Sea Level Pressure" 
          unit={u(units, "pressure", "hPa")} 
          config={[
            { key: "pressure", name: "Sea Level Pressure", color: "#AB47BC" },
            { key: "pressureStation", name: "Station Pressure", color: "#7B1FA2" }
          ]} 
        />
      )}

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

      {hasCloudCover && (
        <AreaChartCard 
          data={data} 
          title="Cloud Cover" 
          unit={u(units, "cloudCover", "%")} 
          config={[
            { key: "cloudCover", name: "Cloud Cover", color: "#78909C" },
            { key: "cloudCoverLow", name: "Low Cloud", color: "#B0BEC5" }
          ]} 
        />
      )}
      {hasWindSpeed && (
        <ComposedChartCard 
          data={data} 
          title="Wind Speed & Gusts" 
          unit={u(units, "windSpeed", "m/s")} 
          areaConfig={{ key: "windSpeed", name: "Wind Speed", color: "#43a047" }}
          lineConfig={{ key: "windGust", name: "Wind Gust", color: "#2e7d32" }}
        />
      )}
      {hasWind2m && (
        <ComposedChartCard 
          data={data} 
          title="Wind 2m & Instant Gust" 
          unit={u(units, "windSpeed2m", "m/s")} 
          areaConfig={{ key: "windSpeed2m", name: "Wind Speed (2m)", color: "#81C784" }}
          lineConfig={{ key: "windGustInst", name: "Instant Gust", color: "#D32F2F" }}
        />
      )}
      {hasVisibility && (
        <AreaChartCard 
          data={data} 
          title="Visibility" 
          unit={u(units, "visibility", "m")} 
          config={[
            { key: "visibility", name: "Visibility", color: "#5D4037" }
          ]} 
        />
      )}
      {hasSolarRadiation && (
        <AreaChartCard 
          data={data} 
          title="Solar Radiation" 
          unit={u(units, "solarRadiation", "W/m²")} 
          config={[
            { key: "solarRadiation", name: "Global Solar Radiation", color: "#FFB300" }
          ]} 
        />
      )}
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

      {hasEtp && (
        <BarChartCard 
          data={data} 
          title="Evapotranspiration (ETP)" 
          unit={u(units, "etp", "mm")} 
          config={[
            { key: "etp", name: "ETP", color: "#795548" }
          ]} 
        />
      )}
      {hasWindRose && (
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
    </div>
  );
};
