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
  ComposedChart,
  Line,
  ReferenceLine,
  Cell,
} from "recharts";

interface HourlyRow {
  datetime: string;
  [key: string]: string | number | undefined;
}

const formatDate = (isoString: string) => {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return isoString;
  }
};

const CustomTooltip = ({ active, payload, label, unit }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-slate-200 shadow-lg p-3 text-sm">
        <p className="font-bold text-slate-700 mb-2">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={`item-${index}`} className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: entry.color }} />
            <span className="text-slate-600 font-medium capitalize">{entry.name}:</span>
            <span className="text-slate-800 font-bold">
              {entry.value !== undefined ? Number(entry.value).toFixed(1) : "-"} {unit}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

// Generic Area Chart Card
export const AreaChartCard = ({ data, title, unit, config }: { data: HourlyRow[], title: string, unit: string, config: { key: string, name: string, color: string }[] }) => {
  const chartData = useMemo(() => data.map(d => {
    const row: any = { time: formatDate(d.datetime) };
    config.forEach(c => row[c.key] = (d as any)[c.key]);
    return row;
  }), [data, config]);

  const hasData = useMemo(() => chartData.some(d => config.some(c => d[c.key] !== undefined && d[c.key] !== null)), [chartData, config]);

  if (!hasData) return null;

  return (
    <div className="w-full h-[360px] glass-card rounded-2xl p-5 border border-slate-100/50 shadow-sm flex flex-col gap-4">
      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{title}</h3>
      <div className="flex-1 w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <AreaChart data={chartData}>
            <defs>
              {config.map((c, i) => (
                <linearGradient key={`grad-${i}`} id={`grad-${c.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={c.color} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={c.color} stopOpacity={0.0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} />
            <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} unit={` ${unit}`} domain={["auto", "auto"]} />
            <Tooltip content={<CustomTooltip unit={unit} />} />
            {config.map((c, i) => {
              const hasKeyData = chartData.some(d => d[c.key] !== undefined && d[c.key] !== null);
              if (!hasKeyData) return null;
              return <Area key={`area-${i}`} type="monotone" dataKey={c.key} name={c.name} stroke={c.color} strokeWidth={2} fill={`url(#grad-${c.key})`} connectNulls />;
            })}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// Generic Bar Chart Card
export const BarChartCard = ({ data, title, unit, config, stacked = false }: { data: HourlyRow[], title: string, unit: string, config: { key: string, name: string, color: string }[], stacked?: boolean }) => {
  const chartData = useMemo(() => data.map(d => {
    const row: any = { time: formatDate(d.datetime) };
    config.forEach(c => {
      let val = (d as any)[c.key];
      // Clamp negative precipitation values to 0
      if (c.key.startsWith("precipitation") && typeof val === "number" && val < 0) {
        val = 0;
      }
      row[c.key] = val;
    });
    return row;
  }), [data, config]);

  const hasData = useMemo(() => chartData.some(d => config.some(c => d[c.key] !== undefined && d[c.key] !== null)), [chartData, config]);

  if (!hasData) return null;

  return (
    <div className="w-full h-[360px] glass-card rounded-2xl p-5 border border-slate-100/50 shadow-sm flex flex-col gap-4">
      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{title}</h3>
      <div className="flex-1 w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} />
            <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} unit={` ${unit}`} domain={[0, 'auto']} />
            <Tooltip content={<CustomTooltip unit={unit} />} />
            {config.map((c, i) => {
              const hasKeyData = chartData.some(d => d[c.key] !== undefined && d[c.key] !== null);
              if (!hasKeyData) return null;
              return <Bar key={`bar-${i}`} dataKey={c.key} name={c.name} fill={c.color} stackId={stacked ? "a" : undefined} radius={stacked ? 0 : [4, 4, 0, 0]} />;
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// Generic Composed Chart Card (Area + Line)
export const ComposedChartCard = ({ data, title, unit, areaConfig, lineConfig }: { data: HourlyRow[], title: string, unit: string, areaConfig: { key: string, name: string, color: string }, lineConfig: { key: string, name: string, color: string } }) => {
  const chartData = useMemo(() => data.map(d => ({
    time: formatDate(d.datetime),
    [areaConfig.key]: (d as any)[areaConfig.key],
    [lineConfig.key]: (d as any)[lineConfig.key],
  })), [data, areaConfig, lineConfig]);

  const hasAreaData = useMemo(() => chartData.some(d => d[areaConfig.key] !== undefined && d[areaConfig.key] !== null), [chartData, areaConfig]);
  const hasLineData = useMemo(() => chartData.some(d => d[lineConfig.key] !== undefined && d[lineConfig.key] !== null), [chartData, lineConfig]);

  if (!hasAreaData && !hasLineData) return null;

  return (
    <div className="w-full h-[360px] glass-card rounded-2xl p-5 border border-slate-100/50 shadow-sm flex flex-col gap-4">
      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{title}</h3>
      <div className="flex-1 w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <ComposedChart data={chartData}>
            <defs>
              <linearGradient id={`grad-${areaConfig.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={areaConfig.color} stopOpacity={0.4} />
                <stop offset="95%" stopColor={areaConfig.color} stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} />
            <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} unit={` ${unit}`} />
            <Tooltip content={<CustomTooltip unit={unit} />} />
            {hasAreaData && (
              <Area type="monotone" dataKey={areaConfig.key} name={areaConfig.name} stroke={areaConfig.color} strokeWidth={2} fill={`url(#grad-${areaConfig.key})`} connectNulls />
            )}
            {hasLineData && (
              <Line type="monotone" dataKey={lineConfig.key} name={lineConfig.name} stroke={lineConfig.color} strokeWidth={0} dot={{ r: 3, fill: lineConfig.color, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// Diverging Bar Chart Card (bars above/below zero, dual-colored)
export const DivergingBarChartCard = ({ data, title, unit, dataKey, name, posColor = "#43a047", negColor = "#e53935" }: {
  data: HourlyRow[], title: string, unit: string, dataKey: string, name: string, posColor?: string, negColor?: string
}) => {
  const chartData = useMemo(() => data.map(d => ({
    time: formatDate(d.datetime),
    [dataKey]: (d as any)[dataKey],
  })), [data, dataKey]);

  const hasData = useMemo(() => chartData.some(d => d[dataKey] !== undefined && d[dataKey] !== null), [chartData, dataKey]);

  if (!hasData) return null;

  return (
    <div className="w-full h-[360px] glass-card rounded-2xl p-5 border border-slate-100/50 shadow-sm flex flex-col gap-4">
      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{title}</h3>
      <div className="flex-1 w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} />
            <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} unit={` ${unit}`} domain={['auto', 'auto']} />
            <Tooltip content={<CustomTooltip unit={unit} />} />
            <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 2" />
            <Bar dataKey={dataKey} name={name} radius={[3, 3, 0, 0]}>
              {chartData.map((entry, index) => {
                const val = entry[dataKey] as number | undefined;
                return <Cell key={`cell-${index}`} fill={val !== undefined && val !== null && val >= 0 ? posColor : negColor} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// Dual-Axis Chart Card (left Y-axis + right Y-axis with different units)
export const DualAxisChartCard = ({ data, title, leftConfig, rightConfig }: {
  data: HourlyRow[],
  title: string,
  leftConfig: { key: string, name: string, color: string, unit: string },
  rightConfig: { key: string, name: string, color: string, unit: string },
}) => {
  const chartData = useMemo(() => data.map(d => ({
    time: formatDate(d.datetime),
    [leftConfig.key]: (d as any)[leftConfig.key],
    [rightConfig.key]: (d as any)[rightConfig.key],
  })), [data, leftConfig, rightConfig]);

  const hasLeftData = useMemo(() => chartData.some(d => d[leftConfig.key] !== undefined && d[leftConfig.key] !== null), [chartData, leftConfig]);
  const hasRightData = useMemo(() => chartData.some(d => d[rightConfig.key] !== undefined && d[rightConfig.key] !== null), [chartData, rightConfig]);

  if (!hasLeftData && !hasRightData) return null;

  // Custom tooltip that shows the correct unit per series
  const DualTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-slate-200 shadow-lg p-3 text-sm">
          <p className="font-bold text-slate-700 mb-2">{label}</p>
          {payload.map((entry: any, index: number) => {
            const u = entry.dataKey === leftConfig.key ? leftConfig.unit : rightConfig.unit;
            return (
              <div key={`item-${index}`} className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: entry.color }} />
                <span className="text-slate-600 font-medium capitalize">{entry.name}:</span>
                <span className="text-slate-800 font-bold">
                  {entry.value !== undefined ? Number(entry.value).toFixed(1) : "-"} {u}
                </span>
              </div>
            );
          })}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full h-[360px] glass-card rounded-2xl p-5 border border-slate-100/50 shadow-sm flex flex-col gap-4">
      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{title}</h3>
      <div className="flex-1 w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <ComposedChart data={chartData}>
            <defs>
              <linearGradient id={`grad-dual-${leftConfig.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={leftConfig.color} stopOpacity={0.4} />
                <stop offset="95%" stopColor={leftConfig.color} stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id={`grad-dual-${rightConfig.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={rightConfig.color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={rightConfig.color} stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} />
            <YAxis
              yAxisId="left"
              stroke={leftConfig.color}
              fontSize={11}
              tickLine={false}
              unit={` ${leftConfig.unit}`}
              domain={[0, 100]}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke={rightConfig.color}
              fontSize={11}
              tickLine={false}
              unit={` ${rightConfig.unit}`}
              domain={["auto", "auto"]}
            />
            <Tooltip content={<DualTooltip />} />
            {hasLeftData && (
              <Area
                yAxisId="left"
                type="monotone"
                dataKey={leftConfig.key}
                name={leftConfig.name}
                stroke={leftConfig.color}
                strokeWidth={2}
                fill={`url(#grad-dual-${leftConfig.key})`}
                connectNulls
              />
            )}
            {hasRightData && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey={rightConfig.key}
                name={rightConfig.name}
                stroke={rightConfig.color}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
