import React, { useMemo } from "react";
import {
  Activity,
  Calendar,
  Clock,
  CloudRain,
  Pause,
  Play,
  Radar,
  RotateCw,
  ShieldCheck,
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
  frames: RadarFrame[];
  currentTimeIndex: number;
  setCurrentTimeIndex: (index: number | ((previous: number) => number)) => void;
  opacity: number;
  setOpacity: (opacity: number) => void;
  minQuality: number | null;
  setMinQuality: (quality: number | null) => void;
  renderState: MapRenderState;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  speed: number;
  setSpeed: (speed: number) => void;
  loop: boolean;
  setLoop: (loop: boolean) => void;
  stepForward: () => void;
  stepBackward: () => void;
}

const FilterLabel = ({ label, help, htmlFor }: { label: string; help: string; htmlFor?: string }) => (
  <div className="mb-1.5 flex flex-col gap-0.5">
    <label htmlFor={htmlFor} className="text-xs font-bold uppercase tracking-wider text-slate-700">
      {label}
    </label>
    <p className="text-[0.65rem] leading-tight text-slate-500">{help}</p>
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
  frames,
  currentTimeIndex,
  setCurrentTimeIndex,
  opacity,
  setOpacity,
  minQuality,
  setMinQuality,
  renderState,
  isPlaying,
  setIsPlaying,
  speed,
  setSpeed,
  loop,
  setLoop,
  stepForward,
  stepBackward,
}: SidebarProps) {
  const currentFrame = frames[currentTimeIndex];
  const cadenceMs = useMemo(() => inferRadarCadenceMs(frames, product), [frames, product]);
  const cadenceLabel = formatRadarCadence(cadenceMs);
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
    <aside className="relative z-50 flex h-full flex-col bg-white/90 text-slate-800" aria-label="Radar controls">
      <div className="border-b border-slate-200 p-6">
        <h1 className="flex items-center text-xl font-bold tracking-tight text-slate-800">
          <Activity className="mr-2 h-6 w-6 text-blue-500" aria-hidden="true" /> OPERA Radar
        </h1>
      </div>

      <div className="custom-scrollbar flex-1 space-y-6 overflow-y-auto p-6">
        <section aria-labelledby="product-heading" className="flex flex-col gap-2">
          <div id="product-heading">
            <FilterLabel label="Radar product" help="Choose reflectivity, precipitation rate, or hourly accumulation." />
          </div>
          <div className="flex flex-col gap-1.5">
            {([
              ["DBZH", "DBZH (Reflectivity)", Radar],
              ["RATE", "RATE (Precipitation)", CloudRain],
              ["ACRR", "ACRR (Accumulation)", TimerReset],
            ] as const).map(([id, label, ProductIcon]) => (
              <button
                key={id}
                type="button"
                aria-pressed={product === id}
                onClick={() => setProduct(id)}
                className={`flex min-h-11 w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-sm font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                  product === id
                    ? "border-blue-200 bg-blue-50 text-blue-700 ring-2 ring-blue-500/10"
                    : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <ProductIcon size={18} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2" aria-labelledby="view-mode-heading">
          <div id="view-mode-heading">
            <FilterLabel label="View mode" help="Latest provides a rolling 24-hour catalog; historical selects one UTC day." />
          </div>
          <div className="flex rounded-xl border border-slate-200 bg-slate-50/50 p-1 shadow-sm">
            <button
              type="button"
              aria-pressed={!selectedDate}
              onClick={() => setSelectedDate("")}
              className={`min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-medium ${!selectedDate ? "border border-slate-200 bg-white text-blue-700 shadow" : "text-slate-600"}`}
            >
              Latest
            </button>
            <button
              type="button"
              aria-pressed={Boolean(selectedDate)}
              onClick={() => setSelectedDate(new Date().toISOString().slice(0, 10))}
              className={`min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-medium ${selectedDate ? "border border-slate-200 bg-white text-blue-700 shadow" : "text-slate-600"}`}
            >
              Historical
            </button>
          </div>
        </section>

        {selectedDate && (
          <div>
            <FilterLabel htmlFor="historical-date" label="UTC date" help="Select a published daily catalog." />
            <div className="relative">
              <input
                id="historical-date"
                type="date"
                value={selectedDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-3.5 text-sm font-medium text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={15} aria-hidden="true" />
            </div>
          </div>
        )}

        {frames.length > 0 && currentFrame && (
          <section className="border-t border-slate-100 pt-4" aria-labelledby="timeline-heading">
            <div id="timeline-heading">
              <FilterLabel label="Timeline" help="Only catalog-committed frames are available for playback." />
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="flex items-center text-xs font-bold uppercase tracking-wider text-slate-600">
                  <Clock size={12} className="mr-1" aria-hidden="true" /> Frame {currentTimeIndex + 1}/{frames.length}
                </span>
                <span className="rounded-md bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
                  {formatUtc(currentFrame.nominal_time)} UTC
                </span>
              </div>
              <p className="mb-2 text-[0.65rem] font-medium text-slate-500">
                {product} native step: <span className="font-bold text-slate-700">{cadenceLabel}</span>
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
              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="grid grid-cols-4 gap-1.5">
                  <button type="button" onClick={stepBackward} aria-label="Previous frame" className="min-h-11 min-w-11 rounded-lg border border-slate-300 bg-white p-2 text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
                    <SkipBack size={16} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setIsPlaying(!isPlaying)} aria-label={isPlaying ? "Pause animation" : "Play animation"} className="min-h-11 min-w-11 rounded-lg bg-blue-600 p-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                    {isPlaying ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                  </button>
                  <button type="button" onClick={stepForward} aria-label="Next frame" className="min-h-11 min-w-11 rounded-lg border border-slate-300 bg-white p-2 text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
                    <SkipForward size={16} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setLoop(!loop)} aria-label={loop ? "Disable animation loop" : "Enable animation loop"} aria-pressed={loop} className={`min-h-11 min-w-11 rounded-lg border p-2 ${loop ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-600"}`}>
                    <RotateCw size={16} aria-hidden="true" />
                  </button>
                </div>
                <label className="mt-3 flex min-h-11 items-center justify-between gap-3 text-[0.65rem] font-bold uppercase text-slate-600">
                  Animation speed
                  <select aria-label="Animation speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800">
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

        {product === "DBZH" && (
          <section className="border-t border-slate-100 pt-4" aria-labelledby="quality-heading">
            <div id="quality-heading">
              <FilterLabel
                label="DBZH quality mask"
                help="Masks only pixels with known normalized quality below the threshold. Raw data remains unchanged."
              />
            </div>
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold">
              <span className="flex items-center gap-2">
                <ShieldCheck size={17} className="text-blue-600" aria-hidden="true" />
                Filter low quality
              </span>
              <input
                type="checkbox"
                checked={minQuality !== null}
                onChange={(event) => setMinQuality(event.target.checked ? 0.1 : null)}
                className="h-5 w-5 accent-blue-600"
              />
            </label>
            <label htmlFor="quality-threshold" className="mt-3 block text-xs font-semibold text-slate-700">
              Minimum quality: {minQuality === null ? "Off — original composite" : minQuality.toFixed(2)}
            </label>
            <input
              id="quality-threshold"
              type="range"
              min="0"
              max="1"
              step="0.05"
              disabled={minQuality === null}
              value={minQuality ?? 0.1}
              onChange={(event) => setMinQuality(Number(event.target.value))}
              className="mt-2 h-2 w-full cursor-pointer accent-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </section>
        )}

        <section className="border-t border-slate-100 pt-4">
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
            <output htmlFor="radar-opacity" className="w-10 text-right text-xs font-bold text-slate-700">
              {Math.round(opacity * 100)}%
            </output>
          </div>
        </section>

        <section className="border-t border-slate-100 pt-4">
          <FilterLabel label="Current frame" help="Published storage and rendering state for the selected frame." />
          <dl className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Product</dt><dd className="font-bold">{product}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Backend</dt><dd className="font-bold uppercase">{renderState.backend ?? currentFrame?.backend ?? "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Map state</dt><dd className="font-bold capitalize">{renderState.status}</dd></div>
            {currentFrame?.start_time && <div><dt className="text-slate-500">Interval start</dt><dd className="font-semibold">{formatUtc(currentFrame.start_time)} UTC</dd></div>}
            {currentFrame?.end_time && <div><dt className="text-slate-500">Interval end</dt><dd className="font-semibold">{formatUtc(currentFrame.end_time)} UTC</dd></div>}
            {currentFrame && <div><dt className="text-slate-500">Revision</dt><dd className="break-all font-mono text-[0.6rem]">{currentFrame.revision}</dd></div>}
          </dl>
        </section>

      </div>
    </aside>
  );
}
