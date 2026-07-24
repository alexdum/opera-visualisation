import React, { useMemo, useRef } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Loader2 } from "lucide-react";
import {
  buildPixelTimeline,
  buildStatusSegments,
  countPixelStatuses,
  type PixelObservation,
  type PixelTimelineEntry,
  type TimelineStatus,
} from "@/utils/pixelTimeline";

export type PixelSeriesEntry = PixelObservation;

interface ChartsProps {
  data: PixelSeriesEntry[];
  product: string;
  isLoading?: boolean;
  windowStart?: string;
  windowEnd?: string;
}

const STATUS_META: Record<TimelineStatus, { label: string; description: string; style: React.CSSProperties }> = {
  detected: { label: "Detected", description: "A numeric radar value is available.", style: { background: "#3b82f6" } },
  undetect: { label: "Undetect (no phenomena occurred)", description: "Observed, but below the radar detection threshold.", style: { background: "repeating-linear-gradient(90deg, #7dd3fc 0 3px, #e0f2fe 3px 6px)" } },
  nodata: { label: "Nodata", description: "The pixel was not observed or usable.", style: { background: "repeating-linear-gradient(90deg, #94a3b8 0 4px, #cbd5e1 4px 8px)" } },
  missing: { label: "Missing frame", description: "The expected catalog timestamp is absent.", style: { background: "repeating-linear-gradient(135deg, #f59e0b 0 3px, #fef3c7 3px 6px)" } },
  unknown: { label: "Unknown", description: "The observation has an unrecognized status.", style: { background: "repeating-linear-gradient(45deg, #a78bfa 0 3px, #ede9fe 3px 6px)" } },
};

const formatDate = (isoString: string) => {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return isoString;
  }
};

export const PixelAnalysisChart = React.memo(({ data, product, isLoading, windowStart, windowEnd }: ChartsProps) => {
  const chartRef = useRef<HTMLDivElement>(null);

  const timeline = useMemo(
    () => isLoading && data.length === 0 ? [] : buildPixelTimeline(data, product, windowStart, windowEnd),
    [data, isLoading, product, windowEnd, windowStart],
  );
  const chartData = useMemo(() => {
    return timeline.map((row) => ({
        rawTime: row.time,
        time: formatDate(row.time),
        value: row.value === null ? null : Math.round(row.value * 10) / 10,
        status: row.status,
        interval: row.start_time && row.end_time ? `${formatDate(row.start_time)} – ${formatDate(row.end_time)}` : null,
      }));
  }, [timeline]);
  const statusCounts = useMemo(() => countPixelStatuses(timeline), [timeline]);
  const statusSegments = useMemo(() => buildStatusSegments(timeline), [timeline]);

  const config = useMemo(() => {
    switch (product) {
      case "DBZH":
        return { title: "Reflectivity", color: "#3b82f6", unit: "dBZ" };
      case "RATE":
        return { title: "Precipitation Rate", color: "#f59e0b", unit: "mm/h" };
      case "ACRR":
        return { title: "Accumulated Precipitation", color: "#10b981", unit: "mm" };
      default:
        return { title: "Value", color: "#94a3b8", unit: "" };
    }
  }, [product]);

  const isInterval = product === "ACRR";

  const tooltipContent = ({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: PixelTimelineEntry & { time?: string; interval?: string | null } }> }) => {
    const row = payload?.[0]?.payload;
    if (!active || !row) return null;
    const status = STATUS_META[row.status];
    return (
      <div className="max-w-xs rounded-xl border border-slate-200 bg-white/95 p-3 text-sm text-slate-700 shadow-lg">
        <p className="font-semibold text-slate-900">{row.time}</p>
        <p className="mt-1"><strong>Status:</strong> {status.label}</p>
        <p className="text-xs text-slate-500">{status.description}</p>
        {row.value !== null && row.value !== undefined && <p className="mt-1 font-semibold text-blue-600">{config.title}: {row.value} {config.unit}</p>}
        {row.interval && <p className="mt-1 text-xs text-slate-500">Interval: {row.interval}</p>}
      </div>
    );
  };

  const chartContent = (
    <ResponsiveContainer width="100%" height="100%">
      {isInterval ? (
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} />
          <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} domain={[0, 'auto']} />
          <Tooltip
            filterNull={false}
            content={tooltipContent}
          />
          <Bar dataKey="value" fill={config.color} radius={[4, 4, 0, 0]} />
        </BarChart>
      ) : (
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} />
          <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} domain={["auto", "auto"]} />
          <Tooltip
            filterNull={false}
            content={tooltipContent}
          />
          <Line
            type="linear"
            dataKey="value"
            stroke={config.color}
            strokeWidth={2.5}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
            connectNulls={false}
          />
        </LineChart>
      )}
    </ResponsiveContainer>
  );

  return (
    <div ref={chartRef} className="relative flex h-[450px] w-full flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{config.title} ({config.unit})</h3>
        {chartData.length > 0 && (
          <p className="text-xs font-medium text-slate-500" aria-label="Pixel observation status summary">
            <strong className="text-blue-700">{statusCounts.detected}</strong> detected · {statusCounts.undetect} undetect · {statusCounts.nodata} nodata · <strong className="text-amber-700">{statusCounts.missing}</strong> missing
            {statusCounts.unknown > 0 && <> · {statusCounts.unknown} unknown</>}
          </p>
        )}
      </div>
      <div className={`min-h-0 w-full flex-1 ${isLoading ? "pointer-events-none opacity-25" : ""}`}>
        {chartData.length > 0 ? chartContent : (
          <div className="flex h-full items-center justify-center text-center font-medium text-slate-500">
          No cataloged measurements are available. Double-click a location on the map.
          </div>
        )}
      </div>
      {chartData.length > 0 && (
        <figure className="space-y-2" aria-labelledby="status-timeline-caption">
          <figcaption id="status-timeline-caption" className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Observation status</figcaption>
          <div className="pl-12 pr-2">
            <div
              className="flex h-3 overflow-hidden rounded-full border border-slate-300 bg-slate-100"
              role="img"
              aria-label={`${statusCounts.detected} detected, ${statusCounts.undetect} undetect, ${statusCounts.nodata} nodata, ${statusCounts.missing} missing frames`}
            >
              {statusSegments.map((segment, index) => (
                <span
                  key={`${segment.startTime}-${segment.status}-${index}`}
                  aria-hidden="true"
                  title={`${STATUS_META[segment.status].label}: ${formatDate(segment.startTime)} – ${formatDate(segment.endTime)}`}
                  style={{ flexGrow: segment.count, flexBasis: 0, ...STATUS_META[segment.status].style }}
                />
              ))}
            </div>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600" role="list">
            {(Object.keys(STATUS_META) as TimelineStatus[]).filter((status) => status !== "unknown" || statusCounts.unknown > 0).map((status) => (
              <li key={status} className="flex items-center gap-1.5" title={STATUS_META[status].description}>
                <span className="h-2.5 w-5 rounded-sm border border-slate-300" style={STATUS_META[status].style} aria-hidden="true" />
                {STATUS_META[status].label}
              </li>
            ))}
          </ul>
        </figure>
      )}
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-slate-50/70 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" aria-hidden="true" />
            <p className="text-xs font-bold text-slate-600">Loading pixel series…</p>
          </div>
        </div>
      )}
    </div>
  );
});
PixelAnalysisChart.displayName = "PixelAnalysisChart";
