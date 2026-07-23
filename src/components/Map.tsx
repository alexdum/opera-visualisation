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
  radarOverlayInsertionIndex,
  selectAnimationFrames,
  tileLoadTimeoutMs,
} from "@/utils/radar";
import { isWebGLSupported, RadarWebGLLayer } from "./RadarWebGLLayer";

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
  /** Track actual RadarWebGLLayer instances because getLayer() returns
   *  MapLibre's CustomStyleLayer wrapper, not our class instance. */
  const webglLayersRef = useRef<Map<string, RadarWebGLLayer>>(new Map());
  const minQualityRef = useRef(minQuality);
  const [mapReady, setMapReady] = useState(false);
  const [styleRevision, setStyleRevision] = useState(0);

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
    });
    map.current = instance;
    instance.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
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
      // Positron and Satellite intentionally share the same vector style URL.
      // Force the hybrid rebuild so switching between them still emits the
      // style lifecycle needed to add/remove the Sentinel layer.
      diff: false,
      // MapLibre's transformStyle hook carries application-owned layers into
      // the incoming basemap before it is committed. This makes style changes
      // atomic from the radar overlay's perspective and avoids a blank frame.
      transformStyle: (previousStyle, nextStyle) => {
        const radarSources = Object.fromEntries(
          Object.entries(previousStyle?.sources ?? {}).filter(([sourceId]) => sourceId.startsWith("radar-source-")),
        );
        const radarLayers = (previousStyle?.layers ?? []).filter((layer) => layer.id.startsWith("radar-layer-") && layer.type !== "custom");
        const radarIndex = radarOverlayInsertionIndex(nextStyle.layers);
        return {
          ...nextStyle,
          sources: { ...nextStyle.sources, ...radarSources },
          layers: [
            ...nextStyle.layers.slice(0, radarIndex),
            ...radarLayers,
            ...nextStyle.layers.slice(radarIndex),
          ],
        };
      },
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
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let moveThrottleTimer: ReturnType<typeof setTimeout> | undefined;
    let lastMoveReconcileTime = 0;
    let activeSourceId: string | undefined;
    let layersReconciled = false;
    let viewportGeneration = 0;
    let loadController = new AbortController();
    // Continental fallback uses a separate controller so viewport-triggered
    // aborts (zoom/pan) never kill the reusable low-res texture fetch.
    const continentalController = new AbortController();
    const desiredFrames = selectAnimationFrames(frames, currentTimeIndex);

    const finish = (state: MapRenderState) => {
      if (generation !== renderGeneration.current) return;
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
        finish({
          status: "degraded",
          message: "Radar loading is taking longer than expected; the visible map may be incomplete.",
          frameKey: frameIdentity(currentFrame, minQuality),
          backend: currentFrame.backend,
        });
      }, tileLoadTimeoutMs(currentFrame));
    };

    const reconcileLayers = () => {
      if (layersReconciled || !instance.isStyleLoaded() || generation !== renderGeneration.current) return;
      layersReconciled = true;
      const activeViewportGeneration = ++viewportGeneration;
      const signal = loadController.signal;
      instance.off("style.load", reconcileLayers);
      instance.off("styledata", reconcileLayers);
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
        if (!webglLayer || !instance.getLayer(SINGLE_WEBGL_LAYER_ID)) {
          webglLayer = new RadarWebGLLayer(SINGLE_WEBGL_LAYER_ID, currentFrame.product);
          webglLayersRef.current.set(SINGLE_WEBGL_LAYER_ID, webglLayer);
          instance.addLayer(webglLayer, radarBeforeId);
        }

        webglLayer.opacity = opacity;
        webglLayer.minQuality = minQuality ?? 0;
        webglLayer.setProduct(currentFrame.product);

        const canvas = instance.getCanvas();
        const pyramid = getEuropeanScalePyramid(instance.getZoom(), instance.getBounds(), {
          width: canvas.width,
          height: canvas.height,
        });
        const currentIdentity = frameIdentity(currentFrame, minQuality, pyramid.bboxKey, pyramid.maxSize);
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
        ) => {
          const response = await fetch(
            buildRawFrameUrl(frame, TILE_API_BASE, bboxKey, maxSize, allowArchiveFallback),
            { signal: fetchSignal },
          );
          const parsed = await parseRawRadarResponse(response);
          // Continental uploads are always accepted (they survive viewport
          // changes); viewport-specific uploads check the viewport generation.
          if (fetchSignal !== continentalController.signal && !isCurrentRequest()) return;
          if (generation !== renderGeneration.current) return;
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
            bounds: boundsFromCoordinates(coordinates),
          });
          while (rawBufferMapRef.current.size > MAX_RAW_BUFFER_CACHE_SIZE) {
            const oldestIdentity = rawBufferMapRef.current.keys().next().value;
            if (!oldestIdentity) break;
            rawBufferMapRef.current.delete(oldestIdentity);
          }
          return parsed.backend;
        };

        if (webglLayer.hasFrame(currentIdentity)) {
          webglLayer.showFrame(currentIdentity);
          finishReady(webglLayer.frameBackend(currentIdentity) ?? currentFrame.backend);
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

          // Ensure the continental texture is cached (last-resort fallback).
          // Uses a separate controller so viewport aborts never kill this.
          if (pyramid.bboxKey && !webglLayer.hasFrame(continentalIdentity)) {
            void uploadRawFrame(
              currentFrame,
              continentalIdentity,
              OPERA_IMAGE_COORDINATES,
              undefined,
              1024,
              false,
              continentalController.signal,
            ).then(() => {
              if (generation !== renderGeneration.current) return;
              // If nothing better is visible yet, show the continental texture.
              const currentVisible = webglLayer!.visibleFrameId();
              if (!currentVisible || !webglLayer!.hasFrame(currentVisible)) {
                webglLayer!.showFrame(continentalIdentity);
              }
            }).catch((error: unknown) => {
              if (!(error instanceof DOMException && error.name === "AbortError")) {
                console.warn("Continental radar fallback failed", error);
              }
            });
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
            if (backend && isCurrentRequest()) finishReady(backend);
          }).catch((error: unknown) => {
            if (error instanceof DOMException && error.name === "AbortError") return;
            if (!isCurrentRequest()) return;
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

        const adjacentFrame = desiredFrames[1];
        if (adjacentFrame) {
          const adjacentIdentity = frameIdentity(adjacentFrame, minQuality, pyramid.bboxKey, pyramid.maxSize);
          if (!webglLayer.hasFrame(adjacentIdentity)) {
            void uploadRawFrame(
              adjacentFrame,
              adjacentIdentity,
              pyramid.bboxCoords,
              pyramid.bboxKey,
              pyramid.maxSize,
              false,
              signal,
              false,
            ).catch((error: unknown) => {
              if (!(error instanceof DOMException && error.name === "AbortError")) {
                console.warn("Adjacent radar preload failed", error);
              }
            });
          }
        }
      } else {
        reportLoadingState();
        desiredFrames.forEach((frame, index) => {
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
                   "raster-opacity": index === 0 ? opacity : 0,
                   "raster-fade-duration": 0,
                }
             }, radarBeforeId);
          } else {
             instance.setPaintProperty(layerId, "raster-opacity", index === 0 ? opacity : 0);
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

    if (instance.isStyleLoaded()) reconcileLayers();
    instance.on("style.load", reconcileLayers);
    // style.load means the style JSON has been installed, but its sprite and
    // source graph may not yet satisfy isStyleLoaded(). styledata is the
    // native follow-up signal used to retry without timing guesses.
    instance.on("styledata", reconcileLayers);
    instance.on("moveend", handleMoveEnd);
    return () => {
      loadController.abort();
      continentalController.abort();
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (moveThrottleTimer) clearTimeout(moveThrottleTimer);
      instance.off("style.load", reconcileLayers);
      instance.off("styledata", reconcileLayers);
      instance.off("moveend", handleMoveEnd);
      instance.off("idle", handleIdle);
      instance.off("render", handleRender);
      instance.off("sourcedata", handleSourceData);
      instance.off("error", handleError);
    };
  }, [currentTimeIndex, frames, mapReady, minQuality, opacity, product, styleRevision]);

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

  const handleHomeClick = () => {
    if (map.current) fitRadarExtent(map.current, 1500);
  };

  return (
    <>
      <div ref={mapContainer} className="absolute inset-0 h-full w-full" aria-label="Interactive OPERA radar map. Double-click to select a pixel for analysis." />
      <div className="absolute left-2.5 top-[80px] z-20 group">
        <button
          type="button"
          onClick={handleHomeClick}
          aria-label="Fit map to OPERA radar coverage"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <Home size={20} aria-hidden="true" />
        </button>
        <span className="tooltip-content pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          Fit OPERA radar coverage
        </span>
      </div>
    </>
  );
}
