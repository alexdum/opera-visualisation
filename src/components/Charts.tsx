import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

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

interface ChartsProps {
  data: HourlyRow[];
  parameter: string;
}

// Helper to format date label
const formatDate = (isoString: string) => {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return isoString;
  }
};

export const ClimateChart: React.FC<ChartsProps> = ({ data, parameter }) => {
  const chartData = useMemo(() => {
    return data.map((row) => {
      let value = 0;
      if (parameter === "air_temperature") value = row.temperature ?? 0;
      else if (parameter === "precipitation_amount") value = Math.max(0, row.precipitation ?? 0);
      else if (parameter === "air_pressure_at_mean_sea_level") value = row.pressure ?? 0;
      else if (parameter === "wind_speed") value = row.windSpeed ?? 0;

      return {
        time: formatDate(row.datetime),
        value: Math.round(value * 10) / 10,
      };
    });
  }, [data, parameter]);

  const config = useMemo(() => {
    switch (parameter) {
      case "air_temperature":
        return {
          title: "Temperature Profile",
          color: "#f43f5e",
          fill: "url(#tempGrad)",
          unit: "°C",
        };
      case "precipitation_amount":
        return {
          title: "Precipitation Records",
          color: "#3b82f6",
          fill: "url(#precipGrad)",
          unit: "mm",
        };
      case "wind_speed":
        return {
          title: "Wind Speed History",
          color: "#f59e0b",
          fill: "url(#windGrad)",
          unit: "m/s",
        };
      default:
        return {
          title: "Sea Level Pressure",
          color: "#10b981",
          fill: "url(#pressGrad)",
          unit: "hPa",
        };
    }
  }, [parameter]);

  if (chartData.length === 0) {
    return (
      <div className="w-full h-[320px] glass-card rounded-2xl flex items-center justify-center text-slate-400 font-medium">
        No measurements available for the selected range.
      </div>
    );
  }

  const isPrecip = parameter === "precipitation_amount";

  return (
    <div className="w-full h-[360px] glass-card rounded-2xl p-5 border border-slate-100/50 shadow-sm flex flex-col gap-4">
      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{config.title}</h3>
      <div className="flex-1 w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          {isPrecip ? (
            <BarChart data={chartData}>
              <defs>
                <linearGradient id="precipGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.2} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} />
              <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} unit={` ${config.unit}`} domain={[0, 'auto']} />
              <Tooltip
                contentStyle={{
                  background: "rgba(255, 255, 255, 0.95)",
                  borderRadius: "12px",
                  border: "1px solid #e2e8f0",
                  boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.05)",
                  fontFamily: "Inter, sans-serif",
                }}
              />
              <Bar dataKey="value" fill={config.fill} radius={[4, 4, 0, 0]} />
            </BarChart>
          ) : (
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="windGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="pressGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} />
              <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} unit={` ${config.unit}`} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{
                  background: "rgba(255, 255, 255, 0.95)",
                  borderRadius: "12px",
                  border: "1px solid #e2e8f0",
                  boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.05)",
                  fontFamily: "Inter, sans-serif",
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={config.color}
                strokeWidth={2.5}
                fill={config.fill}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// Hand-crafted high-fidelity SVG Wind Rose Component
export const WindRose: React.FC<{ data: HourlyRow[] }> = ({ data }) => {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  
  // Calculate frequencies by direction & speed classes
  const roseData = useMemo(() => {
    const counts = directions.reduce((acc, dir) => {
      acc[dir] = { c1: 0, c2: 0, c3: 0, c4: 0 }; // c1: 0-2 m/s, c2: 2-5, c3: 5-8, c4: >8
      return acc;
    }, {} as Record<string, { c1: number; c2: number; c3: number; c4: number }>);

    let validRowsCount = 0;

    data.forEach((row) => {
      const speed = row.windSpeed;
      const dir = row.windDirection;
      if (speed === undefined || dir === undefined || isNaN(speed) || isNaN(dir)) return;

      validRowsCount++;

      // Ensure dir is strictly positive before modulo
      const normalizedDir = ((dir % 360) + 360) % 360;
      const sectorIndex = Math.floor(((normalizedDir + 22.5) % 360) / 45);
      const sector = directions[sectorIndex];

      if (!sector || !counts[sector]) return; // Safety check

      if (speed <= 2) counts[sector].c1++;
      else if (speed <= 5) counts[sector].c2++;
      else if (speed <= 8) counts[sector].c3++;
      else counts[sector].c4++;
    });

    // Normalize counts to percentages
    const result = directions.map((dir) => {
      const item = counts[dir];
      const total = validRowsCount || 1;
      return {
        dir,
        c1: (item.c1 / total) * 100,
        c2: (item.c2 / total) * 100,
        c3: (item.c3 / total) * 100,
        c4: (item.c4 / total) * 100,
      };
    });

    return { dataPoints: result, totalValid: validRowsCount };
  }, [data]);

  const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
    const angleRad = ((angleDeg - 90) * Math.PI) / 180.0;
    return {
      x: cx + r * Math.cos(angleRad),
      y: cx + r * Math.sin(angleRad),
    };
  };

  const getWedgePath = (cx: number, cy: number, startR: number, endR: number, angleCenter: number) => {
    // Width of wedges in degrees
    const halfWidth = 15;
    const startAngle = angleCenter - halfWidth;
    const endAngle = angleCenter + halfWidth;

    const p0 = polarToCartesian(cx, cy, startR, startAngle);
    const p1 = polarToCartesian(cx, cy, endR, startAngle);
    const p2 = polarToCartesian(cx, cy, endR, endAngle);
    const p3 = polarToCartesian(cx, cy, startR, endAngle);

    return `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y} A ${endR} ${endR} 0 0 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${startR} ${startR} 0 0 0 ${p0.x} ${p0.y} Z`;
  };

  if (roseData.totalValid === 0) {
    return (
      <div className="w-full h-[360px] glass-card rounded-2xl flex items-center justify-center text-slate-400 font-medium">
        No wind metrics found for this period.
      </div>
    );
  }

  const cx = 150;
  const cy = 150;
  const maxRadius = 110;

  // Find max stack size to scale the circles appropriately
  const maxStack = Math.max(
    ...roseData.dataPoints.map(d => d.c1 + d.c2 + d.c3 + d.c4),
    5 // minimum scale ceiling
  );

  const getRadius = (percentage: number) => {
    return (percentage / maxStack) * maxRadius;
  };

  return (
    <div className="w-full h-[360px] glass-card rounded-2xl p-5 border border-slate-100/50 shadow-sm flex flex-col gap-4">
      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Wind Rose Distribution</h3>
      <div className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-6 pr-2">
        {/* SVG Circle Canvas */}
        <svg width="260" height="260" viewBox="0 0 300 300" className="drop-shadow-sm">
          {/* Background grid concentric circles */}
          {[0.25, 0.5, 0.75, 1.0].map((ratio) => (
            <circle
              key={ratio}
              cx={cx}
              cy={cy}
              r={maxRadius * ratio}
              className="fill-none stroke-slate-200 stroke-1 stroke-dasharray-[2,2]"
              strokeDasharray="3 3"
            />
          ))}

          {/* Compass grid axis lines */}
          {directions.map((_, i) => {
            const angle = i * 45;
            const p = polarToCartesian(cx, cy, maxRadius, angle);
            return (
              <line
                key={angle}
                x1={cx}
                y1={cy}
                x2={p.x}
                y2={p.y}
                className="stroke-slate-200 stroke-1"
              />
            );
          })}

          {/* Compass labels */}
          {directions.map((dir, i) => {
            const angle = i * 45;
            const p = polarToCartesian(cx, cy, maxRadius + 18, angle);
            return (
              <text
                key={dir}
                x={p.x}
                y={p.y + 4}
                className="text-[11px] font-bold fill-slate-500 text-anchor-middle"
                textAnchor="middle"
              >
                {dir}
              </text>
            );
          })}

          {/* Stacked Wedges */}
          {roseData.dataPoints.map((item, i) => {
            const angle = i * 45;
            
            // Stack coordinates
            const r1 = getRadius(item.c1);
            const r2 = getRadius(item.c1 + item.c2);
            const r3 = getRadius(item.c1 + item.c2 + item.c3);
            const r4 = getRadius(item.c1 + item.c2 + item.c3 + item.c4);

            return (
              <g key={item.dir} className="hover:opacity-90 transition-opacity">
                {/* 0-2 m/s: Emerald */}
                {item.c1 > 0 && (
                  <path
                    d={getWedgePath(cx, cy, 0, r1, angle)}
                    className="fill-emerald-400 stroke-emerald-500/20 stroke-[0.5]"
                  />
                )}
                {/* 2-5 m/s: Amber */}
                {item.c2 > 0 && (
                  <path
                    d={getWedgePath(cx, cy, r1, r2, angle)}
                    className="fill-amber-400 stroke-amber-500/20 stroke-[0.5]"
                  />
                )}
                {/* 5-8 m/s: Orange */}
                {item.c3 > 0 && (
                  <path
                    d={getWedgePath(cx, cy, r2, r3, angle)}
                    className="fill-orange-400 stroke-orange-500/20 stroke-[0.5]"
                  />
                )}
                {/* >8 m/s: Rose */}
                {item.c4 > 0 && (
                  <path
                    d={getWedgePath(cx, cy, r3, r4, angle)}
                    className="fill-rose-400 stroke-rose-500/20 stroke-[0.5]"
                  />
                )}
              </g>
            );
          })}
        </svg>

        {/* Legend Panel */}
        <div className="flex flex-col gap-2.5 font-sans">
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Wind Speed Class</h4>
          <div className="flex flex-col gap-2">
            {[
              { label: "Calm (0 - 2 m/s)", color: "bg-emerald-400" },
              { label: "Gentle (2 - 5 m/s)", color: "bg-amber-400" },
              { label: "Moderate (5 - 8 m/s)", color: "bg-orange-400" },
              { label: "Gale ( > 8 m/s)", color: "bg-rose-400" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2.5 text-xs text-slate-600 font-medium">
                <span className={`w-3.5 h-3.5 rounded ${item.color} shadow-sm border border-black/5`} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
