"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Clock, Download, Layers, Loader2, Map as MapIcon, MapPin, Maximize, Menu, Minimize, X } from "lucide-react";
import dynamic from "next/dynamic";

import type { PixelSeriesEntry } from "@/components/Charts";
import { MapLegend } from "@/components/MapLegend";
import { Sidebar } from "@/components/Sidebar";
import { Tooltip } from "@/components/Tooltip";
import { useRadarAnimation } from "@/hooks/useRadarAnimation";
import type { CatalogResponse, MapRenderState, RadarFrame, RadarProduct } from "@/types/radar";
import { downloadPixelCsv } from "@/utils/pixelCsv";
import { parseQualityUrlValue } from "@/utils/radar";

interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element;
  mozFullScreenElement?: Element;
  msFullscreenElement?: Element;
  webkitExitFullscreen?: () => void;
  mozCancelFullScreen?: () => void;
  msExitFullscreen?: () => void;
}

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
  mozRequestFullScreen?: () => Promise<void>;
  msRequestFullscreen?: () => Promise<void>;
}

const PRODUCTS: RadarProduct[] = ["DBZH", "RATE", "ACRR"];
const WeatherMap = dynamic(() => import("@/components/Map").then((module) => module.WeatherMap), { ssr: false });
const PixelAnalysisChart = dynamic(
  () => import("@/components/Charts").then((module) => module.PixelAnalysisChart),
  { ssr: false },
);

const apiBase = () => (process.env.NODE_ENV === "development" ? "http://localhost:7860" : "");

const formatUtc = (value?: string | null) => {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
};

export default function OperaRadarPage() {
  const [isOpen, setIsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState<"map" | "analysis" | "about">("map");
  const [urlHydrated, setUrlHydrated] = useState(false);
  const [product, setProduct] = useState<RadarProduct>("DBZH");
  const [selectedDate, setSelectedDate] = useState("");
  const [basemap, setBasemap] = useState("positron");
  const [showLabels, setShowLabels] = useState(true);
  const [mapStylesOpen, setMapStylesOpen] = useState(false);
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [currentTimeIndex, setCurrentTimeIndex] = useState(0);
  const [opacity, setOpacity] = useState(0.7);
  // Low-known-quality DBZH pixels can be masked by the user.
  // Default is off to show the authoritative raw composite.
  const [minQuality, setMinQuality] = useState<number | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [renderState, setRenderState] = useState<MapRenderState>({ status: "idle" });
  const [selectedPixel, setSelectedPixel] = useState<{ lon: number; lat: number } | null>(null);
  const [pixelSeries, setPixelSeries] = useState<PixelSeriesEntry[]>([]);
  const [pixelLoading, setPixelLoading] = useState(false);
  const [pixelError, setPixelError] = useState<string | null>(null);
  const [globalLatestTime, setGlobalLatestTime] = useState<string | null>(null);
  const initialTimeRef = useRef("");
  const lastPixelRequestKeyRef = useRef<string | null>(null);

  const currentFrame = frames[currentTimeIndex];
  const animation = useRadarAnimation({
    frameCount: frames.length,
    currentTimeIndex,
    setCurrentTimeIndex,
    canAdvance: renderState.status === "ready" || renderState.status === "degraded",
  });

  useEffect(() => {
    const handleFullscreenChange = () => {
      const doc = document as FullscreenDocument;
      setIsFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement));
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "radar-fullscreen-changed") {
        setIsFullscreen(!!event.data.isFullscreen);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);
    window.addEventListener("message", handleMessage);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange);
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const toggleFullscreen = () => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: "radar-toggle-fullscreen" }, "*");
      return;
    }

    const doc = document as FullscreenDocument;
    const docEl = document.documentElement as FullscreenElement;

    const isFull = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);
    const requestFullScreen = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.mozRequestFullScreen || docEl.msRequestFullscreen;
    const exitFullScreen = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;

    if (!isFull) {
      if (requestFullScreen) {
        const promise = requestFullScreen.call(docEl);
        if (promise !== undefined) {
          promise.catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`Fullscreen error: ${message}`);
          });
        }
      }
    } else {
      if (exitFullScreen) {
        exitFullScreen.call(doc);
      }
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedProduct = params.get("product")?.toUpperCase();
    if (requestedProduct && PRODUCTS.includes(requestedProduct as RadarProduct)) {
      setProduct(requestedProduct as RadarProduct);
    }
    setSelectedDate(params.get("date") ?? "");
    const requestedBasemap = params.get("basemap");
    setBasemap(["positron", "bright", "satellite"].includes(requestedBasemap ?? "") ? requestedBasemap! : "positron");
    initialTimeRef.current = params.get("time") ?? "";
    const requestedQuality = parseQualityUrlValue(params.get("min_quality"));
    if (requestedQuality !== undefined) setMinQuality(requestedQuality);
    const lonParam = params.get("lon");
    const latParam = params.get("lat");
    if (lonParam !== null && latParam !== null) {
      const lon = Number(lonParam);
      const lat = Number(latParam);
      if (Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90) {
        setSelectedPixel({ lon, lat });
      }
    }
    setUrlHydrated(true);
  }, []);

  useEffect(() => {
    if (!urlHydrated) return;
    const params = new URLSearchParams(window.location.search);
    params.set("product", product);
    if (selectedDate) params.set("date", selectedDate);
    else params.delete("date");
    params.set("basemap", basemap);
    params.set("min_quality", product === "DBZH" ? (minQuality === null ? "off" : minQuality.toFixed(2)) : "off");
    if (currentFrame) params.set("time", currentFrame.timestamp);
    else params.delete("time");
    if (selectedPixel) {
      params.set("lon", selectedPixel.lon.toString());
      params.set("lat", selectedPixel.lat.toString());
    } else {
      params.delete("lon");
      params.delete("lat");
    }
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    if (window.parent !== window) {
      window.parent.postMessage({
        type: "radar-state-update",
        product,
        date: selectedDate || null,
        time: currentFrame?.timestamp || null,
        basemap,
        min_quality: product === "DBZH" ? (minQuality === null ? "off" : minQuality.toFixed(2)) : "off",
        lon: selectedPixel?.lon.toString() || null,
        lat: selectedPixel?.lat.toString() || null,
      }, "*");
    }
  }, [basemap, currentFrame, minQuality, product, selectedDate, selectedPixel, urlHydrated]);

  useEffect(() => {
    if (!urlHydrated) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ product });
    const endpoint = selectedDate ? "/api/catalog/day" : "/api/catalog/latest";
    if (selectedDate) query.set("date", selectedDate);
    else query.set("hours", "24");
    setCatalogLoading(true);
    setCatalogError(null);
    setRenderState({ status: "loading", message: "Loading the published frame catalog…" });
    fetch(`${apiBase()}${endpoint}?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.detail ?? `Catalog request failed (${response.status})`);
        }
        return response.json() as Promise<CatalogResponse>;
      })
      .then((catalog) => {
        setFrames(catalog.frames);
        const requestedTime = initialTimeRef.current;
        const requestedIndex = requestedTime
          ? catalog.frames.findIndex((frame) => frame.timestamp === requestedTime)
          : -1;
        setCurrentTimeIndex(requestedIndex >= 0 ? requestedIndex : Math.max(0, catalog.frames.length - 1));
        initialTimeRef.current = "";
        if (catalog.frames.length === 0) {
          setRenderState({ status: "idle", message: `No published ${product} frames are available.` });
        }
        if (catalog.global_latest_time) {
          setGlobalLatestTime(catalog.global_latest_time);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const message = error instanceof Error ? error.message : "Catalog request failed";
        setFrames([]);
        setCatalogError(message);
        setRenderState({ status: "error", message });
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });
    return () => controller.abort();
  }, [product, selectedDate, urlHydrated]);

  const handleMapClick = useCallback((point: { lon: number; lat: number }) => {
    lastPixelRequestKeyRef.current = null;
    setPixelSeries([]);
    setPixelError(null);
    setSelectedPixel({ lon: point.lon, lat: point.lat });
    setActiveTab("analysis");
  }, []);

  const closePixelAnalysis = useCallback(() => {
    lastPixelRequestKeyRef.current = null;
    setSelectedPixel(null);
    setPixelSeries([]);
    setPixelError(null);
    setPixelLoading(false);
    setActiveTab("map");
  }, []);

  const pixelWindow = useMemo(() => {
    if (!currentFrame) return null;
    const end = new Date(currentFrame.nominal_time);
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [currentFrame]);

  useEffect(() => {
    // Pixel data is expensive remote GeoZarr work. Hiding the Analysis tab
    // preserves its successful result; returning to the same product, point,
    // and time window must not repeat the request.
    if (activeTab !== "analysis" || !selectedPixel || !pixelWindow) {
      setPixelLoading(false);
      return;
    }
    const query = new URLSearchParams({
      product,
      lon: selectedPixel.lon.toString(),
      lat: selectedPixel.lat.toString(),
      start: pixelWindow.start,
      end: pixelWindow.end,
    });
    const requestKey = query.toString();
    if (lastPixelRequestKeyRef.current === requestKey) {
      setPixelLoading(false);
      return;
    }
    const controller = new AbortController();
    setPixelSeries([]);
    setPixelLoading(true);
    setPixelError(null);
    fetch(`${apiBase()}/api/pixel?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.detail ?? `Pixel request failed (${response.status})`);
        }
        return response.json();
      })
      .then((data) => {
        lastPixelRequestKeyRef.current = requestKey;
        setPixelSeries(data.series ?? []);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPixelSeries([]);
        setPixelError(error instanceof Error ? error.message : "Pixel request failed");
      })
      .finally(() => {
        if (!controller.signal.aborted) setPixelLoading(false);
      });
    return () => controller.abort();
  }, [activeTab, pixelWindow, product, selectedPixel]);

  useEffect(() => {
    if (renderState.status !== "loading" || !renderState.frameKey) return;
    const expectedFrameKey = renderState.frameKey;
    const watchdog = window.setTimeout(() => {
      setRenderState((current) => {
        if (current.status !== "loading" || current.frameKey !== expectedFrameKey) {
          return current;
        }
        return {
          status: "degraded",
          frameKey: expectedFrameKey,
          message: "Radar tiles are still loading; the visible map may be incomplete.",
          backend: current.backend,
        };
      });
    }, 15_000);
    return () => window.clearTimeout(watchdog);
  }, [renderState.frameKey, renderState.status]);

  const handleExportCsv = () => {
    if (pixelSeries.length === 0) return;
    const timestamp = currentFrame?.timestamp ?? "series";
    downloadPixelCsv(pixelSeries, product, `opera-${product.toLowerCase()}-pixel-${timestamp}`);
  };

  const showLoader = catalogLoading || renderState.status === "loading";

  return (
    <main className="relative flex h-[100dvh] w-full overflow-hidden bg-slate-50 text-slate-900">
      {isOpen && (
        <button
          type="button"
          aria-label="Close radar controls"
          className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <div className={`glass-sidebar fixed z-50 flex h-full w-[280px] flex-shrink-0 flex-col border-r border-slate-200 transition-transform duration-300 lg:relative lg:translate-x-0 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex-1 overflow-hidden">
          <Sidebar
            product={product}
            setProduct={setProduct}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            globalLatestTime={globalLatestTime}
            frames={frames}
            currentTimeIndex={currentTimeIndex}
            setCurrentTimeIndex={setCurrentTimeIndex}
            opacity={opacity}
            setOpacity={setOpacity}
            renderState={renderState}
            isPlaying={animation.isPlaying}
            setIsPlaying={animation.setIsPlaying}
            speed={animation.speed}
            setSpeed={animation.setSpeed}
            loop={animation.loop}
            setLoop={animation.setLoop}
            stepForward={animation.stepForward}
            stepBackward={animation.stepBackward}
            isLoading={catalogLoading}
          />
        </div>
      </div>

      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="relative h-full w-full overflow-hidden">
          <div className="absolute left-1/2 top-3 z-30 flex w-[calc(100%-16px)] max-w-fit -translate-x-1/2 flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={() => setIsOpen(!isOpen)} aria-label={isOpen ? "Close radar controls" : "Open radar controls"} className="min-h-12 min-w-12 rounded-xl border border-slate-200 bg-white/95 p-2 text-slate-700 shadow-lg backdrop-blur-md lg:hidden">
              {isOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            </button>
            <nav aria-label="Visualization views" className="flex space-x-2 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur-md">
            {([
              ["map", "Map", MapIcon],
              ["analysis", "Pixel analysis", BarChart3],
            ] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" onClick={() => { setActiveTab(id); setMapStylesOpen(false); }} aria-label={label} aria-pressed={activeTab === id} className={`flex min-h-12 items-center rounded-lg px-3 text-sm font-semibold ${activeTab === id ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}>
                <Icon size={16} className="mr-2" aria-hidden="true" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
            </nav>

            {activeTab === "map" && currentFrame && (
              <div className="pointer-events-none flex min-h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-4 text-xs font-bold tracking-wide text-slate-700 shadow-lg backdrop-blur-md sm:text-sm">
                <Clock size={16} className="text-blue-600" aria-hidden="true" />
                {(() => {
                  if (currentFrame.start_time && currentFrame.end_time) {
                    const startFull = formatUtc(currentFrame.start_time);
                    const endTime = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(currentFrame.end_time));
                    return `${startFull} - ${endTime} UTC`;
                  }
                  return `${formatUtc(currentFrame.nominal_time)} UTC`;
                })()}
              </div>
            )}

            <Tooltip content="Toggle Fullscreen" position="bottom">
              <button type="button" onClick={toggleFullscreen} aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} className="flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-slate-700 shadow-lg backdrop-blur-md transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                {isFullscreen ? <Minimize size={20} aria-hidden="true" /> : <Maximize size={20} aria-hidden="true" />}
              </button>
            </Tooltip>
          </div>

          {activeTab === "map" && <div className="absolute left-2.5 top-[130px] z-30">
            <button
              type="button"
              aria-label="Choose map style"
              aria-expanded={mapStylesOpen}
              aria-controls="map-styles-menu"
              onClick={() => setMapStylesOpen((open) => !open)}
              className="flex min-h-12 min-w-12 items-center justify-center rounded-md border border-slate-200 bg-white/95 text-slate-600 shadow-sm backdrop-blur-md transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              <Layers size={20} aria-hidden="true" />
            </button>
            {mapStylesOpen && (
              <div id="map-styles-menu" className="absolute left-[54px] top-0 w-52 rounded-xl border border-slate-200 bg-white/95 p-3.5 shadow-xl backdrop-blur-md">
                <h2 className="mb-2 flex items-center gap-1.5 border-b border-slate-100 pb-2 text-xs font-bold uppercase tracking-wider text-slate-700">
                  <Layers size={14} aria-hidden="true" /> Map styles
                </h2>
                <div className="flex flex-col gap-2">
                  {[
                    ["positron", "OpenFreeMap Positron"],
                    ["bright", "OpenFreeMap Bright"],
                    ["satellite", "Satellite imagery"],
                  ].map(([id, label]) => (
                    <label key={id} className="flex min-h-12 cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900">
                      <input
                        type="radio"
                        name="basemap"
                        checked={basemap === id}
                        onChange={() => {
                          setBasemap(id);
                          setMapStylesOpen(false);
                        }}
                        className="h-4 w-4 accent-blue-600"
                      />
                      {label}
                    </label>
                  ))}
                  <div className="mt-1 border-t border-slate-100 pt-2">
                    <label className="flex min-h-12 cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900">
                      <input
                        type="checkbox"
                        checked={showLabels}
                        onChange={(event) => setShowLabels(event.target.checked)}
                        className="h-4 w-4 rounded accent-blue-600"
                      />
                      Show labels
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>}

          <WeatherMap
            product={product}
            basemap={basemap}
            showLabels={showLabels}
            currentTimeIndex={currentTimeIndex}
            frames={frames}
            opacity={opacity}
            minQuality={minQuality}
            onRenderState={setRenderState}
            onMapClick={handleMapClick}
            selectedPixel={selectedPixel}
          />
          {activeTab === "map" && <MapLegend product={product} />}

          {showLoader && activeTab === "map" && (
            <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-slate-50/40 backdrop-blur-[2px]">
              <div className="rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-xl">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" aria-hidden="true" />
                <p className="mt-3 text-xs font-bold text-slate-700">Rendering radar…</p>
              </div>
            </div>
          )}

          {(catalogError || renderState.status === "error" || renderState.status === "degraded") && activeTab === "map" && (
            <div role="status" className={`absolute bottom-4 left-4 z-30 max-w-sm rounded-xl border px-4 py-3 text-sm shadow-lg ${renderState.status === "error" || catalogError ? "border-rose-300 bg-rose-50 text-rose-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
              {catalogError ?? renderState.message}
            </div>
          )}

          {activeTab === "analysis" && (
            <section className="pointer-events-none absolute inset-x-0 bottom-0 top-[66px] z-20 flex items-start justify-center p-4" aria-labelledby="pixel-heading">
              <div className="pointer-events-auto max-h-full w-full max-w-4xl overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
                <header className="mb-2 flex items-start justify-between gap-4">
                  <h2 id="pixel-heading" className="flex items-center text-xl font-bold text-slate-800"><BarChart3 className="mr-2 text-blue-600" aria-hidden="true" /> Pixel analysis</h2>
                  <button type="button" onClick={closePixelAnalysis} aria-label="Close pixel analysis and clear selected point" className="flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                    <X size={20} aria-hidden="true" />
                  </button>
                </header>
                {selectedPixel ? (
                  <div className="mb-4 space-y-1 text-sm font-medium text-slate-600">
                    <p className="flex items-center gap-1.5">
                      <MapPin size={14} className="text-blue-600" aria-hidden="true" />
                      Selected location: <strong>{selectedPixel.lat}°, {selectedPixel.lon}°</strong>
                    </p>
                    <p className="text-xs text-slate-500">Showing the 24 hours ending at the selected radar frame. Generation of the plot will take approx 1 minute.</p>
                  </div>
                ) : (
                  <p className="mb-6 text-slate-600">Return to the map and double-click a location to retrieve its cataloged GeoZarr series.</p>
                )}
                {pixelError && <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm font-medium text-rose-800">{pixelError}</p>}
                <PixelAnalysisChart data={pixelSeries} product={product} isLoading={pixelLoading} windowStart={pixelWindow?.start} windowEnd={pixelWindow?.end} />
                {selectedPixel && pixelSeries.length > 0 && (
                  <button type="button" onClick={handleExportCsv} className="mt-4 flex min-h-12 items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 font-bold text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                    <Download size={16} aria-hidden="true" /> Export cataloged CSV
                  </button>
                )}
              </div>
            </section>
          )}


        </div>
      </div>
    </main>
  );
}
