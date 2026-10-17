"use client";

import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Home } from "lucide-react";

import type { MapRenderState, RadarFrame, RadarProduct } from "@/types/radar";
import {
  buildTileUrl,
  buildRawFrameUrl,
  continentalFrameIdentity,
  frameIdentity,
  getEuropeanScalePyramid,
  isAdministrativeBoundaryLayer,
  isFrameIdentityVariant,
  isPlaceLabelLayer,
  OPERA_IMAGE_COORDINATES,
  radarOverlayBeforeId,
  selectAnimationFrames,
  tileLoadTimeoutMs,
} from "@/utils/radar";
import { isWebGLSupported, RadarWebGLLayer } from "./RadarWebGLLayer";
import { fetchRadarFrame } from "@/utils/radarRequests";

const STYLE_URLS: Record<string, string> = {
  positron: "https://tiles.openfreemap.org/styles/positron",
  bright: "https://tiles.openfreemap.org/styles/bright",
  // Satellite is a hybrid style: Positron supplies boundaries and labels,
  // while a Sentinel raster is inserted beneath them after style.load.
  satellite: "https://tiles.openfreemap.org/styles/positron",
};
const TILE_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  (process.env.NODE_ENV === "development" ? "http://localhost:7860" : "");
const SINGLE_WEBGL_LAYER_ID = "radar-layer-webgl";
const MAX_RAW_BUFFER_CACHE_SIZE = 32;

interface RawRadarBuffer {
  data: Uint8Array;
  width: number;
  height: number;
  minVal: number;
  maxVal: number;
  backend: "cog" | "geozarr";
  bounds: { west: number; south: number; east: number; north: number };
}

const boundsFromCoordinates = (
  coordinates: [[number, number], [number, number], [number, number], [number, number]],
) => ({
  west: Math.min(...coordinates.map(([lon]) => lon)),
  south: Math.min(...coordinates.map(([, lat]) => lat)),
  east: Math.max(...coordinates.map(([lon]) => lon)),
  north: Math.max(...coordinates.map(([, lat]) => lat)),
});

const parseRawRadarResponse = async (response: Response) => {
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(detail.detail ?? `Radar frame request failed (${response.status})`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < 16) throw new Error("Radar frame response header is incomplete");
  const view = new DataView(buffer);
  const width = view.getUint16(0, true);
  const height = view.getUint16(2, true);
  const expectedBytes = 16 + width * height * 2;
  if (width === 0 || height === 0 || buffer.byteLength !== expectedBytes) {
    throw new Error("Radar frame response dimensions do not match its payload");
  }
  const backendHeader = response.headers.get("X-OPERA-Backend")?.toLowerCase();
  return {
    data: new Uint8Array(buffer, 16, width * height * 2),
    width,
    height,
    minVal: view.getFloat32(4, true),
    maxVal: view.getFloat32(8, true),
    backend: backendHeader === "geozarr" ? "geozarr" as const : "cog" as const,
  };
};

// WGS84 envelope of the authoritative OPERA composite grid, derived from the
// harvested 3800 × 4400 LAEA COG. RATE and ACRR use the same footprint at a
// coarser resolution, so this is the correct home extent for every product.
export const OPERA_RADAR_BOUNDS: maplibregl.LngLatBoundsLike = [
  [-39.552438, 31.749398],
  [57.81137, 73.931257],
];

export const OPERA_MAX_BOUNDS: maplibregl.LngLatBoundsLike = [
  [-47.1, 25.0],
  [65.4, 75.8],
];



const fitRadarExtent = (instance: maplibregl.Map, duration: number) => {
  const compact = instance.getContainer().clientWidth < 640;
  instance.fitBounds(OPERA_RADAR_BOUNDS, {
    padding: compact
      ? { top: 72, right: 24, bottom: 48, left: 24 }
      : { top: 40, right: 72, bottom: 40, left: 56 },
    bearing: 0,
    pitch: 0,
    duration,
    essential: true,
  });
};

export interface MapProps {
  product: RadarProduct;
  basemap: string;
  showLabels: boolean;
  currentTimeIndex: number;
  frames: RadarFrame[];
  opacity: number;
  minQuality: number | null;
  onRenderState: (state: MapRenderState) => void;
  onMapClick?: (info: { lon: number; lat: number; name: string }) => void;
  selectedPixel?: { lon: number; lat: number } | null;
  resetViewTrigger?: number;
  loopAnimation?: boolean;
}

export function WeatherMap({
  product,
  basemap,
  showLabels,
  currentTimeIndex,
  frames,
  opacity,
  minQuality,
  onRenderState,
  onMapClick,
  selectedPixel,
  resetViewTrigger,
  loopAnimation = true,
}: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const clickHandlerRef = useRef(onMapClick);
  const renderHandlerRef = useRef(onRenderState);
  const renderGeneration = useRef(0);
  const basemapRef = useRef(basemap);
  const showLabelsRef = useRef(showLabels);
  const appliedBasemapRef = useRef(basemap);
  const rawBufferMapRef = useRef<Map<string, RawRadarBuffer>>(new Map());
  const preloadCooldownRef = useRef(0);
  const loopAnimationRef = useRef(loopAnimation);
  const warmCachesRef = useRef<(() => void) | null>(null);
  /** Track actual RadarWebGLLayer instances because getLayer() returns
   *  MapLibre's CustomStyleLayer wrapper, not our class instance. */
  const webglLayersRef = useRef<Map<string, RadarWebGLLayer>>(new Map());
  const minQualityRef = useRef(minQuality);
  const opacityRef = useRef(opacity);
  const [mapReady, setMapReady] = useState(false);
  const [styleRevision, setStyleRevision] = useState(0);

  useEffect(() => {
    loopAnimationRef.current = loopAnimation;
    // Changing loop behavior only updates hidden work; it must not restart
    // the selected frame's pending request.
    warmCachesRef.current?.();
  }, [loopAnimation]);

  useEffect(() => {
    clickHandlerRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    renderHandlerRef.current = onRenderState;
  }, [onRenderState]);

  useEffect(() => {
    basemapRef.current = basemap;
  }, [basemap]);

  useEffect(() => {
    showLabelsRef.current = showLabels;
  }, [showLabels]);

  useEffect(() => {
    minQualityRef.current = minQuality;
  }, [minQuality]);

  useEffect(() => {
    opacityRef.current = opacity;
    const instance = map.current;
    if (!instance || !mapReady) return;
    webglLayersRef.current.forEach((layer) => { layer.opacity = opacity; });
    instance.getStyle()?.layers?.forEach((layer) => {
      if (layer.id.startsWith("radar-layer-") && layer.type === "raster") {
        instance.setPaintProperty(layer.id, "raster-opacity", opacity);
      }
    });
    instance.triggerRepaint();
  }, [mapReady, opacity]);

  useEffect(() => {
    rawBufferMapRef.current.clear();
  }, [product]);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    const instance = new maplibregl.Map({
      container: mapContainer.current,
      style: STYLE_URLS[basemap] ?? STYLE_URLS.positron,
      center: [10, 50],
      zoom: 3,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
      maxPitch: 0,
      maxBounds: OPERA_MAX_BOUNDS,
    });
    map.current = instance;
    instance.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    // Force the compact attribution to start collapsed ("i" icon only).
    // MapLibre auto-expands it on wider containers via .maplibregl-compact-show;
    // remove that class after the control renders so only the icon is visible.
    instance.once("load", () => {
      const attrib = instance.getContainer().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact");
      if (attrib) attrib.classList.remove("maplibregl-compact-show");
    });
    // Match EuroMeteo: zoom-only navigation stack in the upper-left.
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    instance.on("dblclick", (event) => {
      // Pixel analysis is deliberately a double-click action so ordinary map
      // navigation cannot open it accidentally. Prevent the same gesture from
      // also activating MapLibre's default double-click zoom.
      event.preventDefault();
      
      const lng = event.lngLat.lng;
      const lat = event.lngLat.lat;
      let valueStr = "";
      
      if (isWebGLSupported(instance)) {
        const activeIdentity = webglLayersRef.current.get(SINGLE_WEBGL_LAYER_ID)?.visibleFrameId();
        const bufferInfo = activeIdentity ? rawBufferMapRef.current.get(activeIdentity) : undefined;
        if (bufferInfo) {
          const { data, width, height, minVal, maxVal, bounds } = bufferInfo;
          // Interpolate coordinate to pixel
          const nw = maplibregl.MercatorCoordinate.fromLngLat({lng: bounds.west, lat: bounds.north});
          const se = maplibregl.MercatorCoordinate.fromLngLat({lng: bounds.east, lat: bounds.south});
          const mc = maplibregl.MercatorCoordinate.fromLngLat({lng, lat});
          
          if (mc.x >= nw.x && mc.x <= se.x && mc.y >= nw.y && mc.y <= se.y) {
            const u = (mc.x - nw.x) / (se.x - nw.x);
            const v = (mc.y - nw.y) / (se.y - nw.y);
            const pixelX = Math.floor(u * width);
            const pixelY = Math.floor(v * height);
            
            if (pixelX >= 0 && pixelX < width && pixelY >= 0 && pixelY < height) {
              const idx = (pixelY * width + pixelX) * 2;
              const byteVal = data[idx];
              const qualByte = data[idx + 1];
              const quality = qualByte >= 254 ? 1.0 : qualByte / 254.0;
              
              if (quality >= (minQualityRef.current ?? 0) && byteVal > 0) {
                const val = minVal + ((byteVal - 1) / 254.0) * (maxVal - minVal);
                valueStr = ` (${val.toFixed(2)})`;
              }
            }
          }
        }
      }

      clickHandlerRef.current?.({
        lon: Math.round(lng * 10_000) / 10_000,
        lat: Math.round(lat * 10_000) / 10_000,
        name: `${lat.toFixed(2)}, ${lng.toFixed(2)}${valueStr}`,
      });
    });
    const handleSettledStyleRender = () => {
      // React reconciles the radar graph only after MapLibre has rendered the
      // replacement style once. At this point isStyleLoaded() is stable and
      // custom sources cannot be discarded by the remainder of setStyle().
      setStyleRevision((revision) => revision + 1);
    };
    const handleStyleLoad = () => {
      if (basemapRef.current === "satellite") {
        if (!instance.getSource("sentinel")) {
          instance.addSource("sentinel", {
            type: "raster",
            tiles: [
              "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg",
            ],
            tileSize: 256,
            attribution: "Sentinel-2 cloudless by EOX",
          });
        }
        if (!instance.getLayer("sentinel-satellite")) {
          instance.addLayer(
            {
              id: "sentinel-satellite",
              type: "raster",
              source: "sentinel",
              minzoom: 0,
              maxzoom: 18,
            },
            instance.getStyle().layers[0]?.id,
          );
        }
        instance.getStyle().layers.forEach((layer) => {
          const isLabel = isPlaceLabelLayer(layer);
          const isBoundary = isAdministrativeBoundaryLayer(layer);
          const isSatellite = layer.id === "sentinel-satellite";
          const isRadar = layer.id.startsWith("radar-layer-");
          instance.setLayoutProperty(
            layer.id,
            "visibility",
            (isLabel && showLabelsRef.current) || isBoundary || isSatellite || isRadar ? "visible" : "none",
          );
          if (isBoundary && instance.getLayer(layer.id)?.type === "line") {
            instance.setPaintProperty(layer.id, "line-color", "rgba(255, 255, 255, 0.5)");
          }
        });
      }
      instance.getStyle().layers.forEach((layer) => {
        if (isPlaceLabelLayer(layer) && instance.getLayer(layer.id)) {
          instance.setLayoutProperty(layer.id, "visibility", showLabelsRef.current ? "visible" : "none");
        }
      });
      // A style replacement removes all custom radar sources and layers.
      // Wait for the first native render so the replacement graph is settled
      // before asking React to restore them.
      instance.once("render", handleSettledStyleRender);
    };
    instance.on("style.load", handleStyleLoad);
    instance.once("load", () => {
      fitRadarExtent(instance, 0);
      setMapReady(true);
    });
    return () => {
      instance.off("style.load", handleStyleLoad);
      instance.off("render", handleSettledStyleRender);
      instance.remove();
      map.current = null;
    };
    // The initial style is intentionally fixed at construction; later changes
    // are handled by the style.load-aware effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !mapReady) return;
    // The constructor already applied the initial basemap. Re-applying it here
    // destroys radar layers during initial load, so only replace a genuinely
    // different style (the same guard used by EuroMeteo).
    if (appliedBasemapRef.current === basemap) return;
    appliedBasemapRef.current = basemap;
    instance.setStyle(STYLE_URLS[basemap] ?? STYLE_URLS.positron, {
      diff: false,
    });
  }, [basemap, mapReady]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const applyLabelVisibility = () => {
      if (!instance.isStyleLoaded()) return;
      instance.getStyle().layers.forEach((layer) => {
        if (isPlaceLabelLayer(layer) && instance.getLayer(layer.id)) {
          instance.setLayoutProperty(layer.id, "visibility", showLabels ? "visible" : "none");
        }
      });
    };
    applyLabelVisibility();
    instance.on("styledata", applyLabelVisibility);
    return () => {
      instance.off("styledata", applyLabelVisibility);
    };
  }, [showLabels, styleRevision]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !mapReady) return;
    const currentFrame = frames[currentTimeIndex];
    if (!currentFrame) {
      renderHandlerRef.current({ status: "idle", message: "No published frame is available." });
      return;
    }

    const generation = ++renderGeneration.current;
    let cancelled = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let moveThrottleTimer: ReturnType<typeof setTimeout> | undefined;
    let lastMoveReconcileTime = 0;
    let activeSourceId: string | undefined;
    let layersReconciled = false;
    let viewportGeneration = 0;
    let requestedViewportIdentity: string | undefined;
    let loadController = new AbortController();
    // Continental fallback uses a separate controller so viewport-triggered
    // aborts (zoom/pan) never kill the reusable low-res texture fetch.
    const continentalController = new AbortController();
    const desiredFrames = selectAnimationFrames(frames, currentTimeIndex);

    const finish = (state: MapRenderState) => {
      if (cancelled || generation !== renderGeneration.current) return;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      instance.off("idle", handleIdle);
      instance.off("render", handleRender);
      instance.off("sourcedata", handleSourceData);
      instance.off("error", handleError);
      renderHandlerRef.current(state);
    };
    const finishReady = (backend: "cog" | "geozarr") => {
      const usedArchiveFallback = currentFrame.backend === "cog" && backend === "geozarr";
      finish({
        status: backend === "geozarr" ? "degraded" : "ready",
        message:
          usedArchiveFallback
            ? "The hot COG was unavailable; rendered from the permanent GeoZarr archive."
            : backend === "geozarr"
              ? "Rendered from the permanent GeoZarr archive."
              : "Frame rendered from the rolling COG cache.",
        frameKey: frameIdentity(currentFrame, minQuality),
        backend,
        hasUsableFrame: true,
      });
    };
    const activeSourceIsLoaded = () =>
      Boolean(
        activeSourceId &&
          instance.getSource(activeSourceId) &&
          instance.isSourceLoaded(activeSourceId),
      );
    const handleSourceData = (event: maplibregl.MapSourceDataEvent) => {
      // During rapid timeline changes, use the completion signal emitted for
      // the active source itself rather than re-querying state after an event
      // from an unrelated source.
      const activeTileContentArrived =
        event.sourceId === activeSourceId &&
        event.sourceDataType === "content" &&
        Boolean(event.tile);
      if (
        event.sourceId === activeSourceId &&
        (event.isSourceLoaded || activeTileContentArrived)
      ) {
        finishReady(currentFrame.backend);
      }
    };
    const handleIdle = () => {
      if (activeSourceIsLoaded()) finishReady(currentFrame.backend);
    };
    const handleRender = () => {
      // Layer/source replacement during a fast slider gesture can race past
      // the last sourcedata notification. MapLibre still renders the settled
      // style, so re-check the active source on its native render event.
      if (activeSourceIsLoaded()) finishReady(currentFrame.backend);
    };
    const handleError = (event: maplibregl.ErrorEvent & { sourceId?: string }) => {
      const activeIdentity = frameIdentity(currentFrame, minQuality);
      if (event.sourceId?.includes(activeIdentity)) {
        finish({ status: "error", message: "The selected radar frame could not be rendered.", backend: currentFrame.backend });
      }
    };

    const scheduleFallbackTimer = () => {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(() => {
        if (cancelled || generation !== renderGeneration.current) return;
        // A slow request is still pending. Keep its completion listeners and
        // prevent playback from aborting it by advancing to another frame.
        renderHandlerRef.current({
          status: "degraded",
          hasUsableFrame: false,
          message: "Radar is taking longer to load. Playback will resume when the frame is ready.",
          frameKey: frameIdentity(currentFrame, minQuality),
          backend: currentFrame.backend,
        });
      }, tileLoadTimeoutMs(currentFrame));
    };

    const reconcileLayers = () => {
      // Custom WebGL layers only need the style graph — not all tile sources —
      // to be ready.  isStyleLoaded() blocks until every raster/vector source
      // has finished loading tiles, which can delay radar restoration after a
      // basemap switch by seconds (or indefinitely if a styledata event is
      // missed).  The style.load event guarantees the JSON is parsed and
      // _loaded is set, which is all addLayer needs (_checkLoaded).
      if (layersReconciled || generation !== renderGeneration.current) return;
      try { instance.getStyle(); } catch { return; } // style not yet initialized
      layersReconciled = true;
      const activeViewportGeneration = ++viewportGeneration;
      const signal = loadController.signal;
      instance.off("style.load", reconcileLayers);
      const reportLoadingState = () => {
        renderHandlerRef.current({
          status: "loading",
          message: "Rendering radar frame…",
          frameKey: frameIdentity(currentFrame, minQuality),
          backend: currentFrame.backend,
        });
      };

      const desiredLayerIds: string[] = [];
      const desiredSourceIds: string[] = [];
      const radarBeforeId = radarOverlayBeforeId(instance.getStyle().layers);
      const webGLAvailable = isWebGLSupported(instance);
      if (webGLAvailable) {
        desiredLayerIds.push(SINGLE_WEBGL_LAYER_ID);
        let webglLayer = webglLayersRef.current.get(SINGLE_WEBGL_LAYER_ID);
        if (webglLayer && instance.getLayer(SINGLE_WEBGL_LAYER_ID) && !webglLayer.isInitialized()) {
          instance.removeLayer(SINGLE_WEBGL_LAYER_ID);
          webglLayersRef.current.delete(SINGLE_WEBGL_LAYER_ID);
          webglLayer = undefined;
        }
        if (!webglLayer || !instance.getLayer(SINGLE_WEBGL_LAYER_ID)) {
          webglLayer = new RadarWebGLLayer(SINGLE_WEBGL_LAYER_ID, currentFrame.product);
          webglLayersRef.current.set(SINGLE_WEBGL_LAYER_ID, webglLayer);
          instance.addLayer(webglLayer, radarBeforeId);
        }

        webglLayer.opacity = opacityRef.current;
        webglLayer.minQuality = minQuality ?? 0;
        webglLayer.setProduct(currentFrame.product);

        const pyramid = getEuropeanScalePyramid(instance.getZoom(), instance.getBounds());
        const currentIdentity = frameIdentity(currentFrame, minQuality, pyramid.bboxKey, pyramid.maxSize);
        requestedViewportIdentity = currentIdentity;
        const continentalIdentity = continentalFrameIdentity(currentFrame, minQuality);
        const isCurrentRequest = () =>
          !signal.aborted &&
          generation === renderGeneration.current &&
          activeViewportGeneration === viewportGeneration;

        /** Upload a raw frame using the viewport abort controller. */
        const uploadRawFrame = async (
          frame: RadarFrame,
          identity: string,
          coordinates: [[number, number], [number, number], [number, number], [number, number]],
          bboxKey: string | undefined,
          maxSize: number,
          activate: boolean,
          fetchSignal: AbortSignal,
          allowArchiveFallback = true,
          background = false,
        ) => {
          const parsed = await fetchRadarFrame(
            buildRawFrameUrl(frame, TILE_API_BASE, bboxKey, maxSize, allowArchiveFallback, background),
            fetchSignal,
            background,
            async (response) => {
              if (background && [429, 503].includes(response.status)) {
                preloadCooldownRef.current = Date.now() + 30_000;
                await response.body?.cancel();
                return;
              }
              return parseRawRadarResponse(response);
            },
          );
          if (!parsed) return;
          // Continental uploads are always accepted (they survive viewport
          // changes); viewport-specific uploads check the viewport generation.
          if (fetchSignal !== continentalController.signal && !isCurrentRequest()) return;
          if (fetchSignal.aborted || generation !== renderGeneration.current) return;
          const mercatorCoordinates = coordinates.map(([lng, lat]) => {
            const coordinate = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat });
            return [coordinate.x, coordinate.y] as [number, number];
          });
          webglLayer!.setFrameData(
            identity,
            parsed.data,
            parsed.width,
            parsed.height,
            mercatorCoordinates,
            parsed.backend,
            activate,
          );
          rawBufferMapRef.current.delete(identity);
          rawBufferMapRef.current.set(identity, {
            data: parsed.data,
            width: parsed.width,
            height: parsed.height,
            minVal: parsed.minVal,
            maxVal: parsed.maxVal,
            backend: parsed.backend,
            bounds: boundsFromCoordinates(coordinates),
          });
          while (rawBufferMapRef.current.size > MAX_RAW_BUFFER_CACHE_SIZE) {
            const oldestIdentity = rawBufferMapRef.current.keys().next().value;
            if (!oldestIdentity) break;
            rawBufferMapRef.current.delete(oldestIdentity);
          }
          return parsed.backend;
        };

        // After a basemap switch the WebGL layer is freshly created with
        // an empty GPU texture cache, but rawBufferMapRef (CPU-side)
        // survives. Re-upload the needed buffers synchronously so the
        // radar appears on the very first frame — no flash, no re-fetch.
        const restoreFromCpuCache = (identity: string, activate: boolean) => {
          if (webglLayer!.hasFrame(identity)) return;
          const cached = rawBufferMapRef.current.get(identity);
          if (!cached) return;
          const { data, width, height, bounds } = cached;
          const mercCoords: [number, number][] = (
            [
              [bounds.west, bounds.north], // NW
              [bounds.east, bounds.north], // NE
              [bounds.east, bounds.south], // SE
              [bounds.west, bounds.south], // SW
            ] as [number, number][]
          ).map(([lng, lat]) => {
            const mc = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat });
            return [mc.x, mc.y] as [number, number];
          });
          webglLayer!.setFrameData(identity, data, width, height, mercCoords, cached.backend, activate);
        };
        restoreFromCpuCache(currentIdentity, true);
        restoreFromCpuCache(continentalIdentity, false);

        // Warm hidden textures only after the selected view is usable. The
        // server admits these requests only when foreground capacity is spare.
        let warming = false;
        const warmCaches = async () => {
          const documentIsHidden = () => document.visibilityState === "hidden";
          if (warming || !isCurrentRequest() ||
              webglLayer!.frameBackend(currentIdentity) !== "cog" ||
              Date.now() < preloadCooldownRef.current || documentIsHidden()) return;
          warming = true;
          try {
            // Playback may wrap from the initially selected latest frame to
            // the first. Warm that destination before the secondary zoom aid.
            const adjacent = selectAnimationFrames(frames, currentTimeIndex, loopAnimationRef.current)[1];
            if (adjacent) {
              const identity = frameIdentity(adjacent, minQuality, pyramid.bboxKey, pyramid.maxSize);
              restoreFromCpuCache(identity, false);
              if (!webglLayer!.hasFrame(identity)) {
                const backend = await uploadRawFrame(adjacent, identity, pyramid.bboxCoords,
                  pyramid.bboxKey, pyramid.maxSize, false, signal, true, true);
                if (!backend) return;
              }
            }
            if (!isCurrentRequest() || Date.now() < preloadCooldownRef.current || documentIsHidden()) return;
            if (pyramid.bboxKey && !webglLayer!.hasFrame(continentalIdentity)) {
              await uploadRawFrame(currentFrame, continentalIdentity,
                OPERA_IMAGE_COORDINATES, undefined, 1024, false, signal, true, true);
            }
          } catch (error: unknown) {
            if (!(error instanceof DOMException && error.name === "AbortError")) {
              preloadCooldownRef.current = Date.now() + 30_000;
            }
          } finally {
            warming = false;
          }
        };
        warmCachesRef.current = () => { void warmCaches(); };

        if (webglLayer.hasFrame(currentIdentity)) {
          webglLayer.showFrame(currentIdentity);
          finishReady(webglLayer.frameBackend(currentIdentity) ?? currentFrame.backend);
          void warmCaches();
        } else {
          // --- Fallback priority ---
          // 1. Keep the CURRENT visible texture (any zoom level) as the primary
          //    fallback. This preserves the highest-resolution data the user
          //    has already seen while the new crop loads.
          // 2. Fall back to the continental (low-res) texture only when there
          //    is no same-frame texture already on screen.
          // 3. NEVER clear a working visible texture during zoom/pan. Only
          //    clear when genuinely nothing is available (initial load or
          //    product switch already cleared the cache via setProduct).
          const visibleIdentity = webglLayer.visibleFrameId();
          const sameFrameRemainsVisible = isFrameIdentityVariant(
            visibleIdentity,
            currentFrame,
            minQuality,
          );

          reportLoadingState();

          if (sameFrameRemainsVisible && visibleIdentity && webglLayer.hasFrame(visibleIdentity)) {
            // Keep the previous crop/resolution on screen while the new crop
            // loads. MapLibre continues transforming its Mercator quad during
            // zoom, avoiding a blank flash between valid same-frame textures.
            webglLayer.showFrame(visibleIdentity);
          } else if (webglLayer.hasFrame(continentalIdentity)) {
            // No same-frame texture visible; fall back to the continental view.
            webglLayer.showFrame(continentalIdentity);
          } else if (visibleIdentity && webglLayer.hasFrame(visibleIdentity)) {
            // A texture from a different frame is still on screen (e.g. the
            // user switched timestamps). Keep it visible rather than blanking
            // the map while the new frame loads.
          } else {
            webglLayer.clearFrame();
          }

          void uploadRawFrame(
            currentFrame,
            currentIdentity,
            pyramid.bboxCoords,
            pyramid.bboxKey,
            pyramid.maxSize,
            true,
            signal,
          ).then((backend) => {
            if (backend && isCurrentRequest()) {
              finishReady(backend);
              void warmCaches();
            }
          }).catch(async (error: unknown) => {
            if (error instanceof DOMException && error.name === "AbortError") return;
            if (!isCurrentRequest()) return;
            // If no usable same-frame texture exists, attempt the small full
            // frame once the detailed request has exhausted its busy retries.
            if (pyramid.bboxKey && !webglLayer!.hasFrame(continentalIdentity) &&
                !sameFrameRemainsVisible) {
              try {
                await uploadRawFrame(currentFrame, continentalIdentity, OPERA_IMAGE_COORDINATES,
                  undefined, 1024, false, continentalController.signal);
              } catch { /* Preserve the original detailed-request error. */ }
              if (!isCurrentRequest()) return;
            }
            // On fetch failure, show the best available cached texture:
            // first try the current visible frame, then continental.
            const currentVisible = webglLayer!.visibleFrameId();
            const degradedIdentity =
              (sameFrameRemainsVisible && currentVisible && webglLayer!.hasFrame(currentVisible))
                ? currentVisible
                : webglLayer!.hasFrame(continentalIdentity)
                  ? continentalIdentity
                  : null;
            if (degradedIdentity) {
              webglLayer!.showFrame(degradedIdentity);
              finish({
                status: "degraded",
                hasUsableFrame: true,
                message: "The detailed radar view failed; keeping the same frame at the previous resolution.",
                frameKey: frameIdentity(currentFrame, minQuality),
                backend: webglLayer!.frameBackend(degradedIdentity) ?? currentFrame.backend,
              });
            } else {
              finish({
                status: "error",
                message: error instanceof Error ? error.message : "The selected radar frame could not be rendered.",
                frameKey: frameIdentity(currentFrame, minQuality),
                backend: currentFrame.backend,
              });
            }
          });
          scheduleFallbackTimer();
        }

      } else {
        reportLoadingState();
        // The raster fallback cannot mark tile requests as background work.
        // Keep it to the visible source rather than queueing hidden tiles.
        desiredFrames.slice(0, 1).forEach((frame, index) => {
          const identity = frameIdentity(frame, minQuality);
          const layerId = `radar-layer-${identity}`;
          const sourceId = `radar-source-${identity}`;
          desiredLayerIds.push(layerId);
          // Raster fallback
          if (index === 0) activeSourceId = sourceId;
          desiredSourceIds.push(sourceId);
          
          if (!instance.getSource(sourceId)) {
             instance.addSource(sourceId, {
                type: "raster",
                tiles: [buildTileUrl(frame, minQuality, TILE_API_BASE)],
                tileSize: 256,
             });
          }
          if (!instance.getLayer(layerId)) {
             instance.addLayer({
                id: layerId,
                type: "raster",
                source: sourceId,
                layout: { visibility: "visible" },
                paint: {
                   "raster-opacity": index === 0 ? opacityRef.current : 0,
                   "raster-fade-duration": 0,
                }
             }, radarBeforeId);
          } else {
             instance.setPaintProperty(layerId, "raster-opacity", index === 0 ? opacityRef.current : 0);
          }
        });
      }

      // Keep the style graph bounded to the current and one preloaded frame.
      instance.getStyle()?.layers?.forEach((layer) => {
        if (layer.id.startsWith("radar-layer-") && !desiredLayerIds.includes(layer.id)) {
          instance.removeLayer(layer.id);
          webglLayersRef.current.delete(layer.id);
        }
      });
      const style = instance.getStyle();
      Object.keys(style?.sources ?? {}).forEach((sourceId) => {
        if (sourceId.startsWith("radar-source-") && !desiredSourceIds.includes(sourceId)) {
          instance.removeSource(sourceId);
        }
      });

      if (!webGLAvailable) {
        instance.off("idle", handleIdle);
        instance.off("render", handleRender);
        instance.off("sourcedata", handleSourceData);
        instance.off("error", handleError);
        instance.on("idle", handleIdle);
        instance.on("render", handleRender);
        instance.on("sourcedata", handleSourceData);
        instance.on("error", handleError);
        if (activeSourceIsLoaded()) finishReady(currentFrame.backend);
        else scheduleFallbackTimer();
      }
    };

    // Leading-edge throttle: fire immediately on the first move, then
    // suppress further calls for 200ms. This avoids the "endless delay"
    // problem of debounce during continuous Mac trackpad pinch-zoom while
    // still preventing cascading abort→fetch→abort cycles.
    const MOVE_THROTTLE_MS = 200;
    const doMoveReconcile = () => {
      lastMoveReconcileTime = Date.now();
      const pyramid = getEuropeanScalePyramid(instance.getZoom(), instance.getBounds());
      if (requestedViewportIdentity === frameIdentity(currentFrame, minQuality, pyramid.bboxKey, pyramid.maxSize)) return;
      loadController.abort();
      loadController = new AbortController();
      layersReconciled = false;
      reconcileLayers();
    };
    const handleMoveEnd = () => {
      const elapsed = Date.now() - lastMoveReconcileTime;
      if (elapsed >= MOVE_THROTTLE_MS) {
        // Leading edge: fire immediately if enough time has passed.
        doMoveReconcile();
      } else {
        // Trailing edge: schedule once for when the throttle window expires.
        if (moveThrottleTimer) clearTimeout(moveThrottleTimer);
        moveThrottleTimer = setTimeout(doMoveReconcile, MOVE_THROTTLE_MS - elapsed);
      }
    };

    reconcileLayers();
    instance.on("style.load", reconcileLayers);
    instance.on("moveend", handleMoveEnd);
    return () => {
      cancelled = true;
      warmCachesRef.current = null;
      loadController.abort();
      continentalController.abort();
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (moveThrottleTimer) clearTimeout(moveThrottleTimer);
      instance.off("style.load", reconcileLayers);
      instance.off("moveend", handleMoveEnd);
      instance.off("idle", handleIdle);
      instance.off("render", handleRender);
      instance.off("sourcedata", handleSourceData);
      instance.off("error", handleError);
    };
  }, [currentTimeIndex, frames, mapReady, minQuality, product, styleRevision]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (!selectedPixel) return;
    const element = document.createElement("div");
    element.className = "h-3.5 w-3.5 cursor-pointer rounded-full border-[3px] border-white bg-blue-500 shadow-lg";
    markerRef.current = new maplibregl.Marker({ element })
      .setLngLat([selectedPixel.lon, selectedPixel.lat])
      .addTo(instance);
  }, [selectedPixel]);

  useEffect(() => {
    if (resetViewTrigger && resetViewTrigger > 0 && map.current) {
      fitRadarExtent(map.current, 1500);
    }
  }, [resetViewTrigger]);

  return (
    <>
      <div ref={mapContainer} className="absolute inset-0 h-full w-full" aria-label="Interactive OPERA radar map. Double-click to select a pixel for analysis." />
    </>
  );
}
