import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Calendar,
  Clock,
  CloudRain,
  Download,
  Loader2,
  Pause,
  Play,
  Radar,
  RotateCw,
  SkipBack,
  SkipForward,
  TimerReset,
} from "lucide-react";

import type { MapRenderState, RadarFrame, RadarProduct } from "@/types/radar";
import { formatRadarCadence, inferRadarCadenceMs } from "@/utils/radar";


interface SidebarProps {
  product: RadarProduct;
  setProduct: (product: RadarProduct) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  globalLatestTime: string | null;
  frames: RadarFrame[];
  currentTimeIndex: number;
  setCurrentTimeIndex: (index: number | ((previous: number) => number)) => void;
  opacity: number;
  setOpacity: (opacity: number) => void;
  renderState: MapRenderState;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  speed: number;
  setSpeed: (speed: number) => void;
  loop: boolean;
  setLoop: (loop: boolean) => void;
  stepForward: () => void;
  stepBackward: () => void;
  isLoading?: boolean;
  onCloseMobile?: () => void;
}

const FilterLabel = ({ label, help, htmlFor }: { label: string; help: string; htmlFor?: string }) => (
  <div className="mb-1.5 flex flex-col gap-0.5">
    <label htmlFor={htmlFor} className="text-xs font-bold uppercase tracking-wider text-white lg:text-slate-700">
      {label}
    </label>
    <p className="text-[0.65rem] leading-tight text-slate-400 lg:text-slate-500">{help}</p>
  </div>
);

const formatUtc = (value?: string | null) => {
  if (!value) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
};

export function Sidebar({
  product,
  setProduct,
  selectedDate,
  setSelectedDate,
  globalLatestTime,
  frames,
  currentTimeIndex,
  setCurrentTimeIndex,
  opacity,
  setOpacity,
  renderState,
  isPlaying,
  setIsPlaying,
  speed,
  setSpeed,
  loop,
  setLoop,
  stepForward,
  stepBackward,
  isLoading,
  onCloseMobile,
}: SidebarProps) {
  const currentFrame = frames[currentTimeIndex];

  const cadenceMs = useMemo(() => inferRadarCadenceMs(frames, product), [frames, product]);
  const cadenceLabel = formatRadarCadence(cadenceMs);

  /* ── GeoTIFF export ── */
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Clear stale export errors when the frame changes.
  useEffect(() => setExportError(null), [currentFrame?.timestamp]);

  const exportUrl = useMemo(() => {
    if (!currentFrame) return null;
    const params = new URLSearchParams({
      product,
      timestamp: currentFrame.timestamp,
      revision: currentFrame.revision,
    });
    return `/api/export/geotiff?${params.toString()}`;
  }, [product, currentFrame]);

  const handleExportGeotiff = useCallback(async () => {
    if (!exportUrl || isExporting) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const response = await fetch(exportUrl);
      if (response.status === 503) {
        setExportError("Server busy, try again shortly.");
        return;
      }
      if (!response.ok) {
        setExportError(`Export failed (${response.status})`);
        return;
      }
      const blob = await response.blob();
      const ts = currentFrame!.timestamp;
      const filename = `OPERA_${product}_${ts.slice(0, 8)}T${ts.slice(8)}Z_rev${currentFrame!.revision}.tif`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch {
      setExportError("Export failed");
    } finally {
      setIsExporting(false);
    }
  }, [exportUrl, isExporting, product, currentFrame]);

  const gapPercentages = useMemo(() => {
    if (frames.length < 2) return [];
    const gaps: number[] = [];
    for (let index = 1; index < frames.length; index += 1) {
      const previous = new Date(frames[index - 1].nominal_time).getTime();
      const current = new Date(frames[index].nominal_time).getTime();
      if (current - previous > cadenceMs * 1.5) {
        gaps.push((index / (frames.length - 1)) * 100);
      }
    }
    return gaps;
  }, [cadenceMs, frames]);

  return (
    <aside className="relative z-50 flex h-full flex-col bg-slate-900/50 text-white backdrop-blur-md lg:bg-white/90 lg:text-slate-800 lg:backdrop-blur-none" aria-label="Radar controls">
      <div className="border-b border-white/20 lg:border-slate-200 p-6">
        <h1 className="flex items-center text-xl font-bold tracking-tight text-white lg:text-slate-800">
          <Activity className="mr-2 h-6 w-6 text-blue-500" aria-hidden="true" /> OPERA Radar
        </h1>
      </div>

      <div className="custom-scrollbar flex-1 space-y-6 overflow-y-auto p-6">
        <section aria-labelledby="product-heading" className="flex flex-col gap-2">
          <div id="product-heading">
            <FilterLabel label="Radar product" help="Choose reflectivity, precipitation rate, or hourly accumulation." />
          </div>
          <div className="flex flex-col gap-2">
            {([
              ["DBZH", "DBZH (Reflectivity)", "Raw radar echo intensity (dBZ)", Radar],
              ["RATE", "RATE (Precipitation)", "How hard it is raining right now (mm/h)", CloudRain],
              ["ACRR", "ACRR (Accumulation)", "Total rain fallen over the past hour (mm)", TimerReset],
            ] as const).map(([id, label, description, ProductIcon]) => (
              <button
                key={id}
                type="button"
                aria-pressed={product === id}
                onClick={() => {
                  setProduct(id);
                  onCloseMobile?.();
                }}
                className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                  product === id
                    ? "border-blue-400 bg-blue-500/20 text-white ring-2 ring-blue-500/30 lg:border-blue-200 lg:bg-blue-50 lg:text-blue-700 lg:ring-blue-500/10"
                    : "border-white/20 text-slate-300 hover:border-white/40 hover:bg-white/10 lg:border-slate-200 lg:text-slate-600 lg:hover:border-slate-300 lg:hover:bg-slate-50"
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  <ProductIcon size={18} aria-hidden="true" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{label}</span>
                  <span className={`text-xs ${product === id ? "text-blue-200 lg:text-blue-600/80" : "text-slate-400 lg:text-slate-500"}`}>
                    {description}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2" aria-labelledby="view-mode-heading">
          <div id="view-mode-heading">
            <FilterLabel label="View mode" help="Latest provides a rolling 24-hour catalog; historical selects one UTC day." />
          </div>
          <div className="flex rounded-xl border border-white/20 bg-white/5 p-1 shadow-sm lg:border-slate-200 lg:bg-slate-50/50">
            <button
              type="button"
              aria-pressed={!selectedDate}
              onClick={() => setSelectedDate("")}
              className={`min-h-12 flex-1 rounded-lg px-3 py-2 text-sm font-medium ${!selectedDate ? "border border-white/20 bg-white/20 text-white shadow lg:border-slate-200 lg:bg-white lg:text-blue-700" : "text-slate-300 hover:text-white hover:bg-white/10 lg:text-slate-600 lg:hover:text-slate-800 lg:hover:bg-transparent"}`}
            >
              Latest
            </button>
            <button
              type="button"
              aria-pressed={Boolean(selectedDate)}
              onClick={() => setSelectedDate(new Date().toISOString().slice(0, 10))}
              className={`min-h-12 flex-1 rounded-lg px-3 py-2 text-sm font-medium ${selectedDate ? "border border-white/20 bg-white/20 text-white shadow lg:border-slate-200 lg:bg-white lg:text-blue-700" : "text-slate-300 hover:text-white hover:bg-white/10 lg:text-slate-600 lg:hover:text-slate-800 lg:hover:bg-transparent"}`}
            >
              Historical
            </button>
          </div>
        </section>

        {selectedDate && (
          <div>
            <FilterLabel htmlFor="historical-date" label="UTC date" help="Select a published daily catalog. Data is available starting with 21 July 2026." />
            <div className="relative">
              <input
                id="historical-date"
                type="date"
                value={selectedDate}
                min="2026-07-21"
                max={globalLatestTime ? globalLatestTime.slice(0, 10) : new Date().toISOString().slice(0, 10)}
                onChange={(event) => {
                  setSelectedDate(event.target.value);
                  onCloseMobile?.();
                }}
                className="min-h-12 w-full rounded-xl border border-white/20 bg-white/10 py-2.5 pl-9 pr-3.5 text-sm font-medium text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 lg:border-slate-300 lg:bg-white lg:text-slate-700 lg:focus:border-blue-500 lg:focus:ring-blue-500/20"
              />
              <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 lg:text-slate-400 lg:text-slate-500" size={15} aria-hidden="true" />
            </div>
          </div>
        )}

        {frames.length > 0 && currentFrame && (
          <section className={`border-t border-white/20 lg:border-slate-100 pt-4 ${isLoading ? "pointer-events-none opacity-40 transition-opacity" : "transition-opacity"}`} aria-labelledby="timeline-heading">
            <div id="timeline-heading">
              <FilterLabel label="Timeline" help="Only catalog-committed frames are available for playback." />
            </div>
            <div className="rounded-xl border border-white/20 bg-white/5 lg:border-slate-200 lg:bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="flex items-center text-xs font-bold uppercase tracking-wider text-slate-300 lg:text-slate-600">
                  <Clock size={12} className="mr-1" aria-hidden="true" /> Frame {currentTimeIndex + 1}/{frames.length}
                </span>
                <span className="rounded-md bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
                  {formatUtc(currentFrame.nominal_time)} UTC
                </span>
              </div>
              <p className="mb-2 text-[0.65rem] font-medium text-slate-400 lg:text-slate-500">
                {product} native step: <span className="font-bold text-white lg:text-slate-700">{cadenceLabel}</span>
              </p>
              <label htmlFor="timeline-slider" className="sr-only">Selected radar frame</label>
              <input
                id="timeline-slider"
                type="range"
                min="0"
                max={frames.length - 1}
                step="1"
                value={currentTimeIndex}
                aria-valuetext={`${formatUtc(currentFrame.nominal_time)} UTC; one ${cadenceLabel} ${product} step`}
                onChange={(event) => {
                  setIsPlaying(false);
                  setCurrentTimeIndex(Number(event.target.value));
                }}
                className="h-2 w-full cursor-pointer accent-blue-600"
              />
              <div className="relative mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
                {gapPercentages.map((percentage) => (
                  <div key={percentage} className="absolute h-full w-1 -translate-x-1/2 bg-rose-500" style={{ left: `${percentage}%` }} />
                ))}
              </div>
              {gapPercentages.length > 0 && (
                <p className="mt-2 text-[0.65rem] font-medium text-rose-700">{gapPercentages.length} catalog gap(s) in this range</p>
              )}
              <div className="mt-4 border-t border-white/20 lg:border-slate-200 pt-4">
                <div className="grid grid-cols-4 gap-1.5">
                  <button type="button" onClick={stepBackward} aria-label="Previous frame" className="min-h-12 min-w-12 rounded-lg border border-white/20 bg-white/10 p-2 text-white hover:bg-white/20 lg:border-slate-300 lg:bg-white lg:text-slate-700 lg:hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
                    <SkipBack size={16} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setIsPlaying(!isPlaying)} aria-label={isPlaying ? "Pause animation" : "Play animation"} className="min-h-12 min-w-12 rounded-lg bg-blue-600 p-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                    {isPlaying ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                  </button>
                  <button type="button" onClick={stepForward} aria-label="Next frame" className="min-h-12 min-w-12 rounded-lg border border-white/20 bg-white/10 p-2 text-white hover:bg-white/20 lg:border-slate-300 lg:bg-white lg:text-slate-700 lg:hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
                    <SkipForward size={16} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setLoop(!loop)} aria-label={loop ? "Disable animation loop" : "Enable animation loop"} aria-pressed={loop} className={`min-h-12 min-w-12 rounded-lg border p-2 ${loop ? "border-blue-400 bg-blue-500/20 text-white lg:border-blue-300 lg:bg-blue-50 lg:text-blue-700" : "border-white/20 bg-white/10 text-white hover:bg-white/20 lg:border-slate-300 lg:bg-white lg:text-slate-600 lg:hover:bg-slate-50"}`}>
                    <RotateCw size={16} aria-hidden="true" />
                  </button>
                </div>
                <label className="mt-3 flex min-h-12 items-center justify-between gap-3 text-[0.65rem] font-bold uppercase text-slate-300 lg:text-slate-600">
                  Animation speed
                  <select aria-label="Animation speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="w-24 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white lg:border-slate-300 lg:bg-white lg:text-slate-800">
                    <option value="0.5">0.5×</option>
                    <option value="1">1×</option>
                    <option value="2">2×</option>
                    <option value="4">4×</option>
                  </select>
                </label>
              </div>
            </div>
          </section>
        )}

        <section className="border-t border-white/20 lg:border-slate-100 pt-4">
          <FilterLabel htmlFor="radar-opacity" label="Radar opacity" help="Adjust the map overlay without modifying source data." />
          <div className="flex items-center gap-3">
            <input
              id="radar-opacity"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(event) => setOpacity(Number(event.target.value))}
              className="h-2 flex-1 cursor-pointer accent-blue-600"
            />
            <output htmlFor="radar-opacity" className="w-10 text-right text-xs font-bold text-white lg:text-slate-700">
              {Math.round(opacity * 100)}%
            </output>
          </div>
        </section>

        <section className="border-t border-white/20 lg:border-slate-100 pt-4">
          <FilterLabel label="Current frame" help="Published storage and rendering state for the selected frame." />
          <dl className="space-y-2 rounded-xl border border-white/20 bg-white/5 p-3 text-xs lg:border-slate-200 lg:bg-white">
            <div className="flex justify-between gap-3"><dt className="text-slate-400 lg:text-slate-500">Product</dt><dd className="font-bold">{product}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400 lg:text-slate-500">Backend</dt><dd className="font-bold uppercase">{renderState.backend ?? currentFrame?.backend ?? "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400 lg:text-slate-500">Map state</dt><dd className="font-bold capitalize">{renderState.status}</dd></div>
            {currentFrame?.start_time && <div><dt className="text-slate-400 lg:text-slate-500">Interval start</dt><dd className="font-semibold">{formatUtc(currentFrame.start_time)} UTC</dd></div>}
            {currentFrame?.end_time && <div><dt className="text-slate-400 lg:text-slate-500">Interval end</dt><dd className="font-semibold">{formatUtc(currentFrame.end_time)} UTC</dd></div>}
            {currentFrame && <div><dt className="text-slate-400 lg:text-slate-500">Revision</dt><dd className="break-all font-mono text-[0.6rem]">{currentFrame.revision}</dd></div>}
          </dl>
          {currentFrame && exportUrl && (
            <div className="mt-3">
              {currentFrame.backend === "cog" ? (
                <a
                  href={exportUrl}
                  download
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/20 lg:border-slate-200 lg:bg-slate-100 lg:text-slate-700 lg:hover:bg-slate-200"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Download GeoTIFF
                </a>
              ) : (
                <button
                  type="button"
                  onClick={handleExportGeotiff}
                  disabled={isExporting}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-50 lg:border-slate-200 lg:bg-slate-100 lg:text-slate-700 lg:hover:bg-slate-200"
                >
                  {isExporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="h-4 w-4" aria-hidden="true" />
                  )}
                  {isExporting ? "Generating…" : "Download GeoTIFF"}
                </button>
              )}
              {exportError && (
                <p className="mt-1.5 text-[0.65rem] text-red-400 lg:text-red-500">{exportError}</p>
              )}
            </div>
          )}
        </section>

      </div>
    </aside>
  );
}
