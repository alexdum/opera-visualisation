import React, { useMemo, useRef, useState } from "react";
import { Download, Maximize2 } from "lucide-react";
import { exportChartAsPng } from "@/utils/chartExport";
import { ChartModal } from "./ChartModal";
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
import { HourlyRow, NON_NEGATIVE_PARAMS } from "@/utils/qc";

const formatDate = (isoString: string) => {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return isoString;
  }
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    color?: string;
    name: string;
    value?: number | string;
  }>;
  label?: string;
  unit?: string;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label, unit }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-slate-200 shadow-lg p-3 text-sm">
        <p className="font-bold text-slate-700 mb-2">{label}</p>
        {payload.map((entry, index) => (
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

interface ChartConfig {
  key: string;
  name: string;
  color: string;
}

// Generic Area Chart Card
export const AreaChartCard = React.memo(({ data, title, unit, config, stationName, country }: { data: HourlyRow[], title: string, unit: string, config: ChartConfig[], stationName?: string, country?: string }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const chartData = useMemo(() => data.map(d => {
    const row: Record<string, string | number | undefined | null> = { time: formatDate(d.datetime) };
    config.forEach(c => {
      let val = d[c.key];
      if (typeof val === "number" && val < 0 && NON_NEGATIVE_PARAMS.some(p => c.key === p || c.key.startsWith(p))) {
        val = 0;
      }
      row[c.key] = val;
    });
    return row;
  }), [data, config]);

  const hasData = useMemo(() => chartData.some(d => config.some(c => d[c.key] !== undefined && d[c.key] !== null)), [chartData, config]);

  if (!hasData) return null;

  const chartContent = (
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
  );

  return (
    <>
      <div ref={chartRef} className="w-full h-[360px] glass-card heavy-chart snap-center rounded-2xl p-5 border border-slate-100/50 shadow-sm flex flex-col gap-4" role="figure" aria-label={`${title} chart`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{title}</h3>
          <div className="flex items-center gap-1">
            <button
              className="hidden md:flex p-2 min-w-[44px] min-h-[44px] items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label={`Expand ${title}`}
              onClick={() => setIsExpanded(true)}
            >
              <Maximize2 size={16} />
            </button>
            <button
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label={`Download ${title} as image`}
              onClick={() => { if (chartRef.current) exportChartAsPng(chartRef.current, { title, stationName, country }); }}
            >
              <Download size={16} />
            </button>
          </div>
        </div>
        <span className="sr-only">Data visualization for {title}. Contains {chartData.length} observation points.</span>
        <div className="flex-1 w-full min-h-0">
          {chartContent}
        </div>
      </div>
      <ChartModal title={title} isOpen={isExpanded} onClose={() => setIsExpanded(false)} stationName={stationName} country={country}>
        {chartContent}
      </ChartModal>
    </>
  );
});
AreaChartCard.displayName = "AreaChartCard";

// Generic Bar Chart Card
export const BarChartCard = React.memo(({ data, title, unit, config, stacked = false, stationName, country }: { data: HourlyRow[], title: string, unit: string, config: ChartConfig[], stacked?: boolean, stationName?: string, country?: string }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const chartData = useMemo(() => data.map(d => {
    const row: Record<string, string | number | undefined | null> = { time: formatDate(d.datetime) };
    config.forEach(c => {
      let val = d[c.key];
      if (typeof val === "number" && val < 0 && NON_NEGATIVE_PARAMS.some(p => c.key === p || c.key.startsWith(p))) {
        val = 0;
      }
      row[c.key] = val;
    });
    return row;
  }), [data, config]);

  const hasData = useMemo(() => chartData.some(d => config.some(c => d[c.key] !== undefined && d[c.key] !== null)), [chartData, config]);

  if (!hasData) return null;

  const chartContent = (
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
  );

  return (
    <>
      <div ref={chartRef} className="w-full h-[360px] glass-card heavy-chart snap-center rounded-2xl p-5 border border-slate-100/50 shadow-sm flex flex-col gap-4" role="figure" aria-label={`${title} chart`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{title}</h3>
          <div className="flex items-center gap-1">
            <button
              className="hidden md:flex p-2 min-w-[44px] min-h-[44px] items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label={`Expand ${title}`}
              onClick={() => setIsExpanded(true)}
            >
              <Maximize2 size={16} />
            </button>
            <button
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label={`Download ${title} as image`}
              onClick={() => { if (chartRef.current) exportChartAsPng(chartRef.current, { title, stationName, country }); }}
            >
              <Download size={16} />
            </button>
          </div>
        </div>
        <span className="sr-only">Data visualization for {title}. Contains {chartData.length} observation points.</span>
        <div className="flex-1 w-full min-h-0">
          {chartContent}
        </div>
      </div>
      <ChartModal title={title} isOpen={isExpanded} onClose={() => setIsExpanded(false)} stationName={stationName} country={country}>
        {chartContent}
      </ChartModal>
    </>
  );
});
BarChartCard.displayName = "BarChartCard";

// Generic Composed Chart Card (Area + Line)
export const ComposedChartCard = React.memo(({ data, title, unit, areaConfig, lineConfig, stationName, country }: { data: HourlyRow[], title: string, unit: string, areaConfig: ChartConfig, lineConfig: ChartConfig, stationName?: string, country?: string }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const chartData = useMemo(() => data.map(d => {
    let areaVal = d[areaConfig.key];
    if (typeof areaVal === "number" && areaVal < 0 && NON_NEGATIVE_PARAMS.some(p => areaConfig.key === p || areaConfig.key.startsWith(p))) {
      areaVal = 0;
    }
    let lineVal = d[lineConfig.key];
    if (typeof lineVal === "number" && lineVal < 0 && NON_NEGATIVE_PARAMS.some(p => lineConfig.key === p || lineConfig.key.startsWith(p))) {
      lineVal = 0;
    }
    return {
      time: formatDate(d.datetime),
      [areaConfig.key]: areaVal,
      [lineConfig.key]: lineVal,
    };
  }), [data, areaConfig, lineConfig]);

  const hasAreaData = useMemo(() => chartData.some(d => d[areaConfig.key] !== undefined && d[areaConfig.key] !== null), [chartData, areaConfig]);
  const hasLineData = useMemo(() => chartData.some(d => d[lineConfig.key] !== undefined && d[lineConfig.key] !== null), [chartData, lineConfig]);

  if (!hasAreaData && !hasLineData) return null;

  const chartContent = (
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
  );

  return (
    <>
      <div ref={chartRef} className="w-full h-[360px] glass-card heavy-chart snap-center rounded-2xl p-5 border border-slate-100/50 shadow-sm flex flex-col gap-4" role="figure" aria-label={`${title} chart`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{title}</h3>
          <div className="flex items-center gap-1">
            <button
              className="hidden md:flex p-2 min-w-[44px] min-h-[44px] items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label={`Expand ${title}`}
              onClick={() => setIsExpanded(true)}
            >
              <Maximize2 size={16} />
            </button>
            <button
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label={`Download ${title} as image`}
              onClick={() => { if (chartRef.current) exportChartAsPng(chartRef.current, { title, stationName, country }); }}
            >
              <Download size={16} />
            </button>
          </div>
        </div>
        <span className="sr-only">Data visualization for {title}. Contains {chartData.length} observation points.</span>
        <div className="flex-1 w-full min-h-0">
          {chartContent}
        </div>
      </div>
      <ChartModal title={title} isOpen={isExpanded} onClose={() => setIsExpanded(false)} stationName={stationName} country={country}>
        {chartContent}
      </ChartModal>
    </>
  );
});
ComposedChartCard.displayName = "ComposedChartCard";

// Diverging Bar Chart Card (bars above/below zero, dual-colored)
export const DivergingBarChartCard = React.memo(({ data, title, unit, dataKey, name, posColor = "#43a047", negColor = "#e53935", stationName, country }: {
  data: HourlyRow[], title: string, unit: string, dataKey: string, name: string, posColor?: string, negColor?: string, stationName?: string, country?: string
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const chartData = useMemo(() => data.map(d => ({
    time: formatDate(d.datetime),
    [dataKey]: d[dataKey],
  })), [data, dataKey]);

  const hasData = useMemo(() => chartData.some(d => d[dataKey] !== undefined && d[dataKey] !== null), [chartData, dataKey]);

  if (!hasData) return null;

  const chartContent = (
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
  );

  return (
    <>
      <div ref={chartRef} className="w-full h-[360px] glass-card heavy-chart snap-center rounded-2xl p-5 border border-slate-100/50 shadow-sm flex flex-col gap-4" role="figure" aria-label={`${title} chart`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{title}</h3>
          <div className="flex items-center gap-1">
            <button
              className="hidden md:flex p-2 min-w-[44px] min-h-[44px] items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label={`Expand ${title}`}
              onClick={() => setIsExpanded(true)}
            >
              <Maximize2 size={16} />
            </button>
            <button
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label={`Download ${title} as image`}
              onClick={() => { if (chartRef.current) exportChartAsPng(chartRef.current, { title, stationName, country }); }}
            >
              <Download size={16} />
            </button>
          </div>
        </div>
        <span className="sr-only">Data visualization for {title}. Contains {chartData.length} observation points.</span>
        <div className="flex-1 w-full min-h-0">
          {chartContent}
        </div>
      </div>
      <ChartModal title={title} isOpen={isExpanded} onClose={() => setIsExpanded(false)} stationName={stationName} country={country}>
        {chartContent}
      </ChartModal>
    </>
  );
});
DivergingBarChartCard.displayName = "DivergingBarChartCard";

interface DualTooltipProps {
  active?: boolean;
  payload?: Array<{
    dataKey?: string | number;
    color?: string;
    name: string;
    value?: number | string;
  }>;
  label?: string;
  leftKey: string;
  leftUnit: string;
  rightUnit: string;
}

const DualTooltip: React.FC<DualTooltipProps> = ({
  active,
  payload,
  label,
  leftKey,
  leftUnit,
  rightUnit,
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-slate-200 shadow-lg p-3 text-sm">
        <p className="font-bold text-slate-700 mb-2">{label}</p>
        {payload.map((entry, index) => {
          const u = entry.dataKey === leftKey ? leftUnit : rightUnit;
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

// Dual-Axis Chart Card (left Y-axis + right Y-axis with different units)
export const DualAxisChartCard = React.memo(({ data, title, leftConfig, rightConfig, stationName, country }: {
  data: HourlyRow[],
  title: string,
  leftConfig: { key: string, name: string, color: string, unit: string },
  rightConfig: { key: string, name: string, color: string, unit: string },
  stationName?: string,
  country?: string,
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const chartData = useMemo(() => data.map(d => {
    let leftVal = d[leftConfig.key];
    if (typeof leftVal === "number" && leftVal < 0 && NON_NEGATIVE_PARAMS.some(p => leftConfig.key === p || leftConfig.key.startsWith(p))) {
      leftVal = 0;
    }
    let rightVal = d[rightConfig.key];
    if (typeof rightVal === "number" && rightVal < 0 && NON_NEGATIVE_PARAMS.some(p => rightConfig.key === p || rightConfig.key.startsWith(p))) {
      rightVal = 0;
    }
    return {
      time: formatDate(d.datetime),
      [leftConfig.key]: leftVal,
      [rightConfig.key]: rightVal,
    };
  }), [data, leftConfig, rightConfig]);

  const hasLeftData = useMemo(() => chartData.some(d => d[leftConfig.key] !== undefined && d[leftConfig.key] !== null), [chartData, leftConfig]);
  const hasRightData = useMemo(() => chartData.some(d => d[rightConfig.key] !== undefined && d[rightConfig.key] !== null), [chartData, rightConfig]);

  if (!hasLeftData && !hasRightData) return null;

  const chartContent = (
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
        <Tooltip
          content={
            <DualTooltip
              leftKey={leftConfig.key}
              leftUnit={leftConfig.unit}
              rightUnit={rightConfig.unit}
            />
          }
        />
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
  );

  return (
    <>
      <div ref={chartRef} className="w-full h-[360px] glass-card heavy-chart snap-center rounded-2xl p-5 border border-slate-100/50 shadow-sm flex flex-col gap-4" role="figure" aria-label={`${title} chart`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{title}</h3>
          <div className="flex items-center gap-1">
            <button
              className="hidden md:flex p-2 min-w-[44px] min-h-[44px] items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label={`Expand ${title}`}
              onClick={() => setIsExpanded(true)}
            >
              <Maximize2 size={16} />
            </button>
            <button
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label={`Download ${title} as image`}
              onClick={() => { if (chartRef.current) exportChartAsPng(chartRef.current, { title, stationName, country }); }}
            >
              <Download size={16} />
            </button>
          </div>
        </div>
        <span className="sr-only">Data visualization for {title}. Contains {chartData.length} observation points.</span>
        <div className="flex-1 w-full min-h-0">
          {chartContent}
        </div>
      </div>
      <ChartModal title={title} isOpen={isExpanded} onClose={() => setIsExpanded(false)} stationName={stationName} country={country}>
        {chartContent}
      </ChartModal>
    </>
  );
});
DualAxisChartCard.displayName = "DualAxisChartCard";
