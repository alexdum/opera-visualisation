"use client";

import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Home } from "lucide-react";

import type { MapRenderState, RadarFrame, RadarProduct } from "@/types/radar";
import {
  buildFrameUrl,
  buildTileUrl,
  frameIdentity,
  isAdministrativeBoundaryLayer,
  isPlaceLabelLayer,
  radarOverlayBeforeId,
  radarOverlayInsertionIndex,
  selectAnimationFrames,
  tileLoadTimeoutMs,
} from "@/utils/radar";


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

// WGS84 envelope of the authoritative OPERA composite grid, derived from the
// harvested 3800 × 4400 LAEA COG. RATE and ACRR use the same footprint at a
// coarser resolution, so this is the correct home extent for every product.
export const OPERA_RADAR_BOUNDS: maplibregl.LngLatBoundsLike = [
  [-39.552438, 31.749398],
  [57.81137, 73.931257],
];

/** Four corners of the OPERA extent for MapLibre image sources [lng, lat]. */
const OPERA_IMAGE_COORDINATES: [[number, number], [number, number], [number, number], [number, number]] = [
  [-39.552438, 73.931257],  // top-left
  [57.81137, 73.931257],    // top-right
  [57.81137, 31.749398],    // bottom-right
  [-39.552438, 31.749398],  // bottom-left
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
    if (!mapContainer.current || map.current) return;
    const instance = new maplibregl.Map({
      container: mapContainer.current,
      style: STYLE_URLS[basemap] ?? STYLE_URLS.positron,
      center: [10, 50],
      zoom: 3,
      attributionControl: false,
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
      clickHandlerRef.current?.({
        lon: Math.round(event.lngLat.lng * 10_000) / 10_000,
        lat: Math.round(event.lngLat.lat * 10_000) / 10_000,
        name: `${event.lngLat.lat.toFixed(2)}, ${event.lngLat.lng.toFixed(2)}`,
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
        const radarLayers = (previousStyle?.layers ?? []).filter((layer) => layer.id.startsWith("radar-layer-"));
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
    let activeSourceId: string | undefined;
    let layersReconciled = false;
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
    const finishReady = () => {
      finish({
        status: currentFrame.backend === "geozarr" ? "degraded" : "ready",
        message:
          currentFrame.backend === "geozarr"
            ? "Rendered from the permanent GeoZarr archive."
            : "Frame rendered from the rolling COG cache.",
        frameKey: frameIdentity(currentFrame, minQuality),
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
        finishReady();
      }
    };
    const handleIdle = () => {
      if (activeSourceIsLoaded()) finishReady();
    };
    const handleRender = () => {
      // Layer/source replacement during a fast slider gesture can race past
      // the last sourcedata notification. MapLibre still renders the settled
      // style, so re-check the active source on its native render event.
      if (activeSourceIsLoaded()) finishReady();
    };
    const handleError = (event: maplibregl.ErrorEvent & { sourceId?: string }) => {
      const activeIdentity = frameIdentity(currentFrame, minQuality);
      if (event.sourceId?.includes(activeIdentity)) {
        finish({ status: "error", message: "The selected radar frame could not be rendered." });
      }
    };

    const reconcileLayers = () => {
      if (layersReconciled || !instance.isStyleLoaded() || generation !== renderGeneration.current) return;
      layersReconciled = true;
      instance.off("style.load", reconcileLayers);
      instance.off("styledata", reconcileLayers);
      renderHandlerRef.current({
        status: "loading",
        message: "Rendering radar frame…",
        frameKey: frameIdentity(currentFrame, minQuality),
      });

      const desiredLayerIds: string[] = [];
      const desiredSourceIds: string[] = [];
      const radarBeforeId = radarOverlayBeforeId(instance.getStyle().layers);
      desiredFrames.forEach((frame, index) => {
        const identity = frameIdentity(frame, minQuality);
        const sourceId = `radar-source-${identity}`;
        const layerId = `radar-layer-${identity}`;
        if (index === 0) activeSourceId = sourceId;
        desiredSourceIds.push(sourceId);
        desiredLayerIds.push(layerId);
        const frameUrl = buildFrameUrl(frame, minQuality, TILE_API_BASE);
        if (!instance.getSource(sourceId)) {
          instance.addSource(sourceId, {
            type: "image",
            url: frameUrl,
            coordinates: OPERA_IMAGE_COORDINATES,
          });
        }
        if (!instance.getLayer(layerId)) {
          instance.addLayer(
            {
              id: layerId,
              type: "raster",
              source: sourceId,
              layout: { visibility: "visible" },
              paint: {
                "raster-opacity": index === 0 ? opacity : 0,
                "raster-fade-duration": 0,
              },
            },
            radarBeforeId,
          );
        } else {
          instance.setPaintProperty(layerId, "raster-opacity", index === 0 ? opacity : 0);
          instance.setLayoutProperty(layerId, "visibility", "visible");
        }
      });

      // Keep the style graph bounded to the current and one preloaded frame.
      instance.getStyle()?.layers?.forEach((layer) => {
        if (layer.id.startsWith("radar-layer-") && !desiredLayerIds.includes(layer.id)) {
          instance.removeLayer(layer.id);
        }
      });
      const style = instance.getStyle();
      Object.keys(style?.sources ?? {}).forEach((sourceId) => {
        if (sourceId.startsWith("radar-source-") && !desiredSourceIds.includes(sourceId)) {
          instance.removeSource(sourceId);
        }
      });

      instance.off("idle", handleIdle);
      instance.off("render", handleRender);
      instance.off("sourcedata", handleSourceData);
      instance.off("error", handleError);
      instance.on("idle", handleIdle);
      instance.on("render", handleRender);
      instance.on("sourcedata", handleSourceData);
      instance.on("error", handleError);
      // The hidden next frame may still be preloading. The user-visible frame
      // is ready as soon as its own source is loaded; global map idleness is
      // neither necessary nor reliable for this state transition.
      if (activeSourceIsLoaded()) {
        finishReady();
      } else {
        fallbackTimer = setTimeout(() => {
          finish({
            status: "degraded",
            message: "Tile loading is taking longer than expected; the visible map may be incomplete.",
            frameKey: frameIdentity(currentFrame, minQuality),
          });
        }, tileLoadTimeoutMs(currentFrame));
      }
    };

    if (instance.isStyleLoaded()) reconcileLayers();
    instance.on("style.load", reconcileLayers);
    // style.load means the style JSON has been installed, but its sprite and
    // source graph may not yet satisfy isStyleLoaded(). styledata is the
    // native follow-up signal used to retry without timing guesses.
    instance.on("styledata", reconcileLayers);
    return () => {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      instance.off("style.load", reconcileLayers);
      instance.off("styledata", reconcileLayers);
      instance.off("idle", handleIdle);
      instance.off("render", handleRender);
      instance.off("sourcedata", handleSourceData);
      instance.off("error", handleError);
    };
  }, [currentTimeIndex, frames, mapReady, minQuality, opacity, product, styleRevision]);

  // ── Viewport-aware image refresh ──────────────────────────────────────
  // When the user zooms or pans, update the active image source to render
  // only the visible region at high resolution. This gives COG overviews
  // the best chance to match the current pixel density.
  useEffect(() => {
    const instance = map.current;
    if (!instance || !mapReady) return;
    const currentFrame = frames[currentTimeIndex];
    if (!currentFrame) return;

    const updateImageForViewport = () => {
      if (!instance.isStyleLoaded()) return;
      const mapBounds = instance.getBounds();
      const bbox = {
        west: mapBounds.getWest(),
        south: mapBounds.getSouth(),
        east: mapBounds.getEast(),
        north: mapBounds.getNorth(),
      };
      // Clamp to OPERA extent
      const clampedBbox = {
        west: Math.max(bbox.west, -39.552438),
        south: Math.max(bbox.south, 31.749398),
        east: Math.min(bbox.east, 57.81137),
        north: Math.min(bbox.north, 73.931257),
      };
      // Only use viewport bbox if the user is zoomed in enough that
      // the OPERA extent doesn't fit entirely in the viewport.
      const isZoomedIn =
        clampedBbox.east - clampedBbox.west < 90 ||
        clampedBbox.north - clampedBbox.south < 35;

      const viewportBbox = isZoomedIn ? clampedBbox : undefined;
      const coordinates: [[number, number], [number, number], [number, number], [number, number]] = viewportBbox
        ? [
            [viewportBbox.west, viewportBbox.north],
            [viewportBbox.east, viewportBbox.north],
            [viewportBbox.east, viewportBbox.south],
            [viewportBbox.west, viewportBbox.south],
          ]
        : OPERA_IMAGE_COORDINATES;

      const desiredFrames = selectAnimationFrames(frames, currentTimeIndex);
      desiredFrames.forEach((frame) => {
        const identity = frameIdentity(frame, minQuality);
        const sourceId = `radar-source-${identity}`;
        const source = instance.getSource(sourceId) as maplibregl.ImageSource | undefined;
        if (!source) return;
        const frameUrl = buildFrameUrl(frame, minQuality, TILE_API_BASE, viewportBbox);
        source.updateImage({ url: frameUrl, coordinates });
      });
    };

    instance.on("moveend", updateImageForViewport);
    return () => {
      instance.off("moveend", updateImageForViewport);
    };
  }, [currentTimeIndex, frames, mapReady, minQuality, product]);

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
