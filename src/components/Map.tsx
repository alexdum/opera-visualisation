import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Layers, ShieldAlert, Home, Info, ChevronUp, ChevronDown } from "lucide-react";
import { getColorFromPalette, getUnitForParam } from "@/utils/colors";
import { countryMatches } from "@/utils/country";
import { MapLegend } from "./MapLegend";
import { Tooltip } from "./Tooltip";

interface Station {
  id: string;
  name: string;
  country: string;
  longitude: number;
  latitude: number;
  elevation: number | null;
  available_params: string;
}

interface MapProps {
  stations: Station[];
  selectedCountry: string;
  selectedStation: string;
  setSelectedStation: (stationId: string) => void;
  parameter: string;
  startDate: string;
  endDate: string;
  observations: Record<string, number[]>;
  setObservations: (obs: Record<string, number[]>) => void;
  selectedHour: number;
  setSelectedHour: (hour: number | ((prev: number) => number)) => void;
  isLoadingStations?: boolean;
  onStationClick?: (stationId: string) => void;
}

interface AreaObservation {
  stationId: string;
  value: number;
}

interface LegacyCoverageRange {
  values?: unknown[];
}

interface LegacyCoverage {
  "metocean:wigosId"?: string;
  domain?: {
    axes?: {
      t?: {
        values?: string[];
      };
    };
  };
  ranges?: Record<string, LegacyCoverageRange>;
}

interface AreaObservationsResponse {
  success: boolean;
  message?: string;
  observations?: AreaObservation[];
  coverages?: LegacyCoverage[];
}

const SOURCE_ID = "stations-source";
const CIRCLE_LAYER = "stations-circles";
const TEXT_LAYER = "stations-labels";
const SELECTED_LAYER = "stations-selected";
const OBSERVATION_FETCH_DEBOUNCE_MS = 250;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

function getPointCoordinates(geometry: GeoJSON.Geometry | null | undefined): [number, number] | null {
  if (!geometry || geometry.type !== "Point") return null;
  const [longitude, latitude] = geometry.coordinates;
  if (typeof longitude !== "number" || typeof latitude !== "number") return null;
  return [longitude, latitude];
}

export const WeatherMap: React.FC<MapProps> = ({
  stations,
  selectedCountry,
  selectedStation,
  setSelectedStation,
  parameter,
  endDate,
  observations,
  setObservations,
  selectedHour,
  setSelectedHour,
  isLoadingStations,
  onStationClick
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const observationRequestKey = useMemo(
    () => `${parameter}|${endDate}|${selectedHour}`,
    [parameter, endDate, selectedHour]
  );
  const [activeObservationKey, setActiveObservationKey] = useState<string>("");

  // ── Extract the actual values present on the map for the legend ──
  const currentValues = useMemo(() => {
    if (activeObservationKey !== observationRequestKey) return [];

    const vals: number[] = [];
    stations.forEach(st => {
      const val = observations[st.id]?.[selectedHour];
      if (val !== undefined && val !== null && !isNaN(val)) {
        vals.push(val);
      }
    });
    return vals;
  }, [activeObservationKey, observationRequestKey, stations, observations, selectedHour]);

  const sourceReadyRef = useRef(false);

  const [basemap, setBasemap] = useState<string>("positron");
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [visibleBounds, setVisibleBounds] = useState<maplibregl.LngLatBounds | null>(null);
  const [isStatsExpanded, setIsStatsExpanded] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setIsStatsExpanded(false);
    }
  }, []);  // Calculate maximum allowed hour (prevent future selections for today)
  const maxAllowedHour = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    if (endDate === todayStr) {
      return new Date().getUTCHours();
    }
    return 23;
  }, [endDate]);

  // Clamp selected hour if it exceeds max allowed (e.g. when changing date to today)
  useEffect(() => {
    if (selectedHour > maxAllowedHour) {
      setSelectedHour(maxAllowedHour);
    }
  }, [maxAllowedHour, selectedHour, setSelectedHour]);

  // ── Stable refs for all values used inside map event handlers ──
  // This avoids stale closures in the one-time-registered event handlers.
  const setSelectedStationRef = useRef(setSelectedStation);
  const onStationClickRef = useRef(onStationClick);
  const parameterRef = useRef(parameter);
  const showLabelsRef = useRef(showLabels);
  const basemapRef = useRef(basemap);

  useEffect(() => {
    setSelectedStationRef.current = setSelectedStation;
    onStationClickRef.current = onStationClick;
    parameterRef.current = parameter;
    showLabelsRef.current = showLabels;
    basemapRef.current = basemap;
  }, [setSelectedStation, onStationClick, parameter, showLabels, basemap]);

  // ── 1. Fetch area observations whenever period, parameter, or hour changes ──
  useEffect(() => {
    if (stations.length === 0) return;

    const abortController = new AbortController();
    const requestKey = observationRequestKey;

    const fetchObservations = async () => {
      setIsLoading(true);
      setErrorMsg(null);
      setObservations({});
      setActiveObservationKey("");

      try {
        const bounds = stations.reduce(
          (acc, st) => ({
            lng_min: Math.min(acc.lng_min, st.longitude),
            lng_max: Math.max(acc.lng_max, st.longitude),
            lat_min: Math.min(acc.lat_min, st.latitude),
            lat_max: Math.max(acc.lat_max, st.latitude),
          }),
          { lng_min: 180, lng_max: -180, lat_min: 90, lat_max: -90 }
        );

        // Match MeteoGate R: request a 1-hour window for the selected hour
        const hourStr = selectedHour.toString().padStart(2, "0");
        const endMinute = `${hourStr}:59`;
        const startMinute = `${hourStr}:00`;
        const datetimeRange = `${endDate}T${startMinute}Z/${endDate}T${endMinute}Z`;
        const stationLocations = stations.map((st) => ({
          longitude: st.longitude,
          latitude: st.latitude,
        }));

        const res = await fetch("/api/observations/area", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parameter,
            datetimeRange,
            bounds,
            stations: stationLocations
          }),
          signal: abortController.signal
        });

        if (abortController.signal.aborted) return;

        const json = await res.json() as AreaObservationsResponse;
        if (!res.ok || !json.success) throw new Error(json.message || "Failed to fetch observations");

        const newObs: Record<string, number[]> = {};

        if (Array.isArray(json.observations)) {
          json.observations.forEach((observation: AreaObservation) => {
            const stationId = observation.stationId;
            const numVal = Number(observation.value);
            if (!stationId || !Number.isFinite(numVal)) return;
            if (parameter.includes("temperature") && (numVal < -60 || numVal > 60)) return;

            const hourlyVals = new Array(24).fill(NaN);
            hourlyVals[selectedHour] = numVal;
            newObs[stationId] = hourlyVals;
          });
        } else if (Array.isArray(json.coverages)) {
          json.coverages.forEach((coverage) => {
            const wigosId = coverage["metocean:wigosId"];
            if (!wigosId) return;

            const domain = coverage.domain || {};
            const axes = domain.axes || {};
            const tAxis = axes.t || {};
            const timestamps: string[] = tAxis.values || [];
            const ranges = coverage.ranges || {};

            const rangeKeys = Object.keys(ranges);
            let bestKey = rangeKeys[0];
            if (!parameter.includes("precipitation")) {
              const pt0s = rangeKeys.find(k => k.includes("PT0S"));
              if (pt0s) bestKey = pt0s;
            }

            if (bestKey) {
              const values: unknown[] = ranges[bestKey]?.values || [];
              const hourlyVals = new Array(24).fill(NaN);
              const len = Math.min(values.length, timestamps.length);

              for (let i = 0; i < len; i++) {
                const val = values[i];
                if (val !== null && val !== undefined) {
                  try {
                    const date = new Date(timestamps[i]);
                    const hour = date.getUTCHours();
                    if (hour >= 0 && hour < 24) {
                      const numVal = Number(val);
                      if (parameter.includes("temperature") && (numVal < -60 || numVal > 60)) continue;
                      hourlyVals[hour] = numVal;
                    }
                  } catch {
                    // Ignore parse errors
                  }
                }
              }
              newObs[wigosId] = hourlyVals;
            }
          });
        }

        if (abortController.signal.aborted) return;
        setObservations(newObs);
        setActiveObservationKey(requestKey);
      } catch (error: unknown) {
        if (getErrorName(error) === "AbortError") return;
        console.error("[Map] Fetch observations failed:", error);
        setObservations({});
        setActiveObservationKey("");
        setErrorMsg(getErrorMessage(error) || "MeteoGate observation fetch timed out or returned empty coordinates. Degraded mode active.");
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    const timer = window.setTimeout(fetchObservations, OBSERVATION_FETCH_DEBOUNCE_MS);
    return () => {
      abortController.abort();
      window.clearTimeout(timer);
    };
  }, [stations, parameter, endDate, selectedHour, observationRequestKey, setObservations]);

  // ── Build GeoJSON from current refs (always reads latest values) ──
  const buildGeoJSON = useCallback(async (): Promise<GeoJSON.FeatureCollection> => {
    const features: GeoJSON.Feature[] = [];
    if (activeObservationKey !== observationRequestKey) {
      return {
        type: "FeatureCollection",
        features
      };
    }

    const CHUNK_SIZE = 500;
    for (let i = 0; i < stations.length; i += CHUNK_SIZE) {
      const chunk = stations.slice(i, i + CHUNK_SIZE);
      for (const st of chunk) {
        const hourlyVals = observations[st.id] || [];
        const hourVal = hourlyVals[selectedHour] ?? NaN;
        if (!Number.isFinite(hourVal)) continue;

        const value = Math.round(hourVal * 10) / 10;
        const isSelected = st.id === selectedStation;

        features.push({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [st.longitude, st.latitude]
          },
          properties: {
            id: st.id,
            name: st.name,
            country: st.country,
            elevation: st.elevation,
            color: getColorFromPalette(hourVal, parameter),
            label: `${value}`,
            value,
            selected: isSelected ? 1 : 0
          }
        });
      }
      await new Promise(r => setTimeout(r, 0));
    }

    return {
      type: "FeatureCollection",
      features
    };
  }, [
    activeObservationKey,
    observationRequestKey,
    stations,
    observations,
    selectedHour,
    selectedStation,
    parameter
  ]);

  // ── Calculate statistics for stations currently visible on screen ──
  const [visibleStats, setVisibleStats] = useState<{
    avg: number;
    max: number;
    maxStation: Station | null;
    min: number;
    minStation: Station | null;
    count: number;
  } | null>(null);

  useEffect(() => {
    let isCancelled = false;
    
    if (!visibleBounds || activeObservationKey !== observationRequestKey) {
      setVisibleStats(null);
      return;
    }

    const computeStats = async () => {
      let minVal = Infinity;
      let maxVal = -Infinity;
      let minStation: Station | null = null;
      let maxStation: Station | null = null;
      let sum = 0;
      let count = 0;

      const CHUNK_SIZE = 500;
      for (let i = 0; i < stations.length; i += CHUNK_SIZE) {
        if (isCancelled) return;
        const chunk = stations.slice(i, i + CHUNK_SIZE);

        for (const st of chunk) {
          if (
            st.longitude >= visibleBounds.getWest() &&
            st.longitude <= visibleBounds.getEast() &&
            st.latitude >= visibleBounds.getSouth() &&
            st.latitude <= visibleBounds.getNorth()
          ) {
            const val = observations[st.id]?.[selectedHour];
            if (val !== undefined && val !== null && !isNaN(val)) {
              sum += val;
              count++;
              if (val < minVal) {
                minVal = val;
                minStation = st;
              }
              if (val > maxVal) {
                maxVal = val;
                maxStation = st;
              }
            }
          }
        }
        await new Promise(r => setTimeout(r, 0));
      }

      if (isCancelled) return;

      if (count === 0) {
        setVisibleStats(null);
      } else {
        setVisibleStats({
          count,
          avg: sum / count,
          min: minVal,
          max: maxVal,
          minStation,
          maxStation
        });
      }
    };

    computeStats();

    return () => { isCancelled = true; };
  }, [visibleBounds, activeObservationKey, observationRequestKey, stations, observations, selectedHour]);

  // ── Add source and layers to the map ──
  const addSourceAndLayers = useCallback(async () => {
    const m = map.current;
    if (!m) return;

    // Remove existing layers/source if present
    try { if (m.getLayer(TEXT_LAYER)) m.removeLayer(TEXT_LAYER); } catch {}
    try { if (m.getLayer(SELECTED_LAYER)) m.removeLayer(SELECTED_LAYER); } catch {}
    try { if (m.getLayer(CIRCLE_LAYER)) m.removeLayer(CIRCLE_LAYER); } catch {}
    try { if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID); } catch {}

    const geojson = await buildGeoJSON();

    m.addSource(SOURCE_ID, {
      type: "geojson",
      data: geojson
    });

    // Find the first symbol/label layer to insert our stations beneath
    let firstLabelId: string | undefined;
    const layers = m.getStyle()?.layers || [];
    for (const layer of layers) {
      if (layer.type === "symbol" && layer.id.includes("label")) {
        firstLabelId = layer.id;
        break;
      }
    }

    // Main circle layer — colored by the data-driven `color` property
    m.addLayer({
      id: CIRCLE_LAYER,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          2, 4,
          5, 7,
          8, 10,
          12, 14
        ],
        "circle-color": ["get", "color"],
        "circle-stroke-width": [
          "case",
          ["==", ["get", "selected"], 1], 3,
          0
        ],
        "circle-stroke-color": "#1e293b",
        "circle-opacity": 0.92,
        "circle-stroke-opacity": 1
      }
    }, firstLabelId);

    // Selected ring highlight layer
    m.addLayer({
      id: SELECTED_LAYER,
      type: "circle",
      source: SOURCE_ID,
      filter: ["==", ["get", "selected"], 1],
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          2, 8,
          5, 12,
          8, 16,
          12, 20
        ],
        "circle-color": "transparent",
        "circle-stroke-width": 3,
        "circle-stroke-color": "rgba(59,130,246,0.4)"
      }
    }, firstLabelId);

    // Text label layer — value inside the circle at higher zoom
    m.addLayer({
      id: TEXT_LAYER,
      type: "symbol",
      source: SOURCE_ID,
      minzoom: 5,
      layout: {
        "text-field": ["get", "label"],
        "text-size": [
          "interpolate", ["linear"], ["zoom"],
          5, 8,
          8, 10,
          12, 12
        ],
        "text-font": ["Open Sans Bold"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-anchor": "bottom",
        "text-offset": [0, -1]
      },
      paint: {
        "text-color": "#1e293b",
        "text-halo-color": "rgba(255,255,255,0.85)",
        "text-halo-width": 1.2
      }
    }, firstLabelId);

    sourceReadyRef.current = true;
  }, [buildGeoJSON]);

  // Ref so the style.load handler always calls the latest version
  const addSourceAndLayersRef = useRef(addSourceAndLayers);

  useEffect(() => {
    addSourceAndLayersRef.current = addSourceAndLayers;
  }, [addSourceAndLayers]);

  // ── 2. Initialize MapLibre GL (runs once) ──
  useEffect(() => {
    if (!mapContainer.current) return;

    const mapOptions: maplibregl.MapOptions & { projection: { type: "globe" } } = {
      container: mapContainer.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [10, 50],
      zoom: 3,
      attributionControl: false,
      projection: { type: "globe" }
    };

    map.current = new maplibregl.Map(mapOptions);

    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.current.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    const updateBounds = () => {
      if (map.current) {
        setVisibleBounds(map.current.getBounds());
      }
    };
    map.current.on('moveend', updateBounds);
    map.current.on('zoomend', updateBounds);
    map.current.on('load', updateBounds);

    // Create a reusable popup
    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      offset: 12,
      maxWidth: "260px"
    });

    // When style loads (initial + basemap change), re-add our data layers
    map.current.on("style.load", () => {
      sourceReadyRef.current = false;

      if (map.current) {
        map.current.setProjection({ type: "globe" });
      }

      // Add satellite raster if needed (Hybrid mode)
      const m = map.current;
      if (m && basemapRef.current === "satellite") {
        if (!m.getSource("sentinel")) {
          m.addSource("sentinel", {
            type: "raster",
            tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg"],
            tileSize: 256,
            attribution: "Sentinel-2 cloudless by EOX"
          });
          m.addLayer({
            id: "sentinel-satellite",
            type: "raster",
            source: "sentinel",
            minzoom: 0,
            maxzoom: 18
          }, m.getStyle().layers[0]?.id);

          // Hide all opaque background/land/water layers so satellite shows through, 
          // but explicitly keep borders (boundary) and labels (label)
          const layers = m.getStyle().layers;
          layers.forEach(layer => {
            const id = layer.id;
            // Identify if the layer is a label or a boundary
            const isLabel = id.includes("label");
            const isBoundary = id.includes("boundary");
            const isCustom = id === "sentinel-satellite" || id === CIRCLE_LAYER || id === SELECTED_LAYER || id === TEXT_LAYER;
            
            if (!isLabel && !isBoundary && !isCustom) {
              m.setLayoutProperty(id, 'visibility', 'none');
            } else if (isBoundary) {
              // Ensure boundaries are visible over the satellite imagery
              m.setLayoutProperty(id, 'visibility', 'visible');
              // Lighten boundaries slightly so they are visible over dark satellite areas
              if (m.getLayer(id)?.type === "line") {
                m.setPaintProperty(id, 'line-color', 'rgba(255, 255, 255, 0.4)');
              }
            }
          });
        }
      }

      // Re-apply label visibility based on toggle
      if (m) {
        const labelLayers = ["place_label_city", "place_label_town", "place_label_village", "poi_label", "road_label", "water_label"];
        labelLayers.forEach(layer => {
          if (m.getLayer(layer)) {
            m.setLayoutProperty(layer, 'visibility', showLabelsRef.current ? 'visible' : 'none');
          }
        });
      }

      // Re-add station layers (always uses latest data via ref)
      addSourceAndLayersRef.current();
    });

    // ── Hover: change cursor + show popup ──
    map.current.on("mouseenter", CIRCLE_LAYER, (e) => {
      const m = map.current;
      if (!m) return;
      m.getCanvas().style.cursor = "pointer";

      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;

      const coords = getPointCoordinates(feature.geometry as GeoJSON.Geometry);
      if (!coords) return;
      const props = feature.properties;
      const param = parameterRef.current; // always fresh

      const valueDisplay = props.value !== null && props.value !== undefined
        ? `${props.value} ${getUnitForParam(param)}`
        : "No data";

      popupRef.current
        ?.setLngLat(coords)
        .setHTML(`
          <div style="padding:10px;font-family:system-ui,sans-serif;min-width:170px">
            <h4 style="font-weight:700;color:#1e293b;font-size:13px;margin:0 0 3px 0">${props.name}</h4>
            <p style="font-size:10px;color:#64748b;font-weight:500;margin:0 0 8px 0">${props.id}</p>
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;border-top:1px solid #f1f5f9;padding-top:6px">
              <span style="font-weight:500;color:#94a3b8">${param.replace(/_/g, ' ')}:</span>
              <span style="font-weight:700;color:#1e293b">${valueDisplay}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding-top:4px">
              <span style="font-weight:500;color:#94a3b8">Elevation:</span>
              <span style="font-weight:500;color:#475569">${props.elevation !== null && props.elevation !== "null" ? `${props.elevation}m` : "Unknown"}</span>
            </div>
            <div style="margin-top:8px;padding-top:6px;border-top:1px solid #f1f5f9;text-align:center">
              <span style="font-size:10px;color:#3b82f6;font-weight:600">Click to view dashboard →</span>
            </div>
          </div>
        `)
        .addTo(m);
    });

    map.current.on("mouseleave", CIRCLE_LAYER, () => {
      const m = map.current;
      if (!m) return;
      m.getCanvas().style.cursor = "";
      popupRef.current?.remove();
    });

    // ── Click: select station + fly to it ──
    map.current.on("click", CIRCLE_LAYER, (e) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;

      const stationId = feature.properties.id;
      const coords = getPointCoordinates(feature.geometry as GeoJSON.Geometry);
      if (!coords) return;

      setSelectedStationRef.current(stationId);
      if (onStationClickRef.current) {
        onStationClickRef.current(stationId);
      }

      if (map.current) {
        map.current.flyTo({
          center: coords,
          zoom: Math.max(map.current.getZoom(), 7),
          essential: true,
          duration: 800
        });
      }
    });

    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
      map.current?.remove();
      map.current = null;
      sourceReadyRef.current = false;
    };
  }, []); // Runs once

  // ── 3. Handle basemap changes ──
  const initialBasemapRef = useRef(true);
  
  useEffect(() => {
    if (!map.current) return;
    
    // On initial mount, the map constructor already sets the style.
    // Calling setStyle again would destroy our source/layers and cause a race condition.
    if (initialBasemapRef.current) {
      initialBasemapRef.current = false;
      return;
    }
    
    // For satellite, we use 'positron' as the base to get all the vector boundaries/labels
    const styleUrl = basemap === "satellite" || basemap === "positron" 
      ? "https://tiles.openfreemap.org/styles/positron" 
      : "https://tiles.openfreemap.org/styles/bright";
      
    map.current.setStyle(styleUrl);
  }, [basemap]);

  // ── 3b. Sync Label Visibility without full style reload ──
  useEffect(() => {
    if (!map.current) return;
    
    const applyLabelVisibility = () => {
      if (!map.current || !map.current.isStyleLoaded()) return;
      const style = map.current.getStyle();
      if (style && style.layers) {
        style.layers.forEach(layer => {
          if (layer.id.includes('label') && layer.id !== TEXT_LAYER) {
            map.current?.setLayoutProperty(layer.id, 'visibility', showLabels ? 'visible' : 'none');
          }
        });
      }
    };

    if (map.current.isStyleLoaded()) {
      applyLabelVisibility();
    }
    
    map.current.on('style.load', applyLabelVisibility);
    return () => {
      map.current?.off('style.load', applyLabelVisibility);
    };
  }, [showLabels]);

  // ── 4. Update GeoJSON source data reactively ──
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const tryUpdate = async () => {
      if (!sourceReadyRef.current) {
        return false;
      }
      const source = m.getSource(SOURCE_ID) as maplibregl.GeoJSONSource;
      if (!source) {
        return false;
      }
      const geojson = await buildGeoJSON();
      source.setData(geojson);
      return true;
    };

    // Try immediately
    tryUpdate();

    // If source isn't ready yet (style still loading), wait for style.load then update
    const onStyleLoad = () => {
      // Small delay to let addSourceAndLayers finish
      setTimeout(() => {
        tryUpdate();
      }, 100);
    };
    m.on('style.load', onStyleLoad);
    
    // Also retry after a short delay in case style was already loaded but source wasn't added yet
    const timer = setTimeout(() => tryUpdate(), 300);
    
    return () => {
      m.off('style.load', onStyleLoad);
      clearTimeout(timer);
    };
  }, [stations, observations, selectedHour, parameter, selectedStation, buildGeoJSON]);

  // ── 5. Zoom to Selected Country or Station Centroid ──
  useEffect(() => {
    if (!map.current || stations.length === 0) return;

    if (selectedStation) {
      const activeSt = stations.find(st => st.id === selectedStation);
      if (activeSt) {
        map.current.flyTo({
          center: [activeSt.longitude, activeSt.latitude],
          zoom: 7.5,
          essential: true
        });
      }
    } else if (selectedCountry) {
      const countryStations = stations.filter(st => countryMatches(st.country, selectedCountry));
      if (countryStations.length > 0) {
        const bounds = countryStations.reduce(
          (acc, st) => ({
            minLng: Math.min(acc.minLng, st.longitude),
            maxLng: Math.max(acc.maxLng, st.longitude),
            minLat: Math.min(acc.minLat, st.latitude),
            maxLat: Math.max(acc.maxLat, st.latitude),
          }),
          { minLng: 180, maxLng: -180, minLat: 90, maxLat: -90 }
        );

        map.current.fitBounds(
          [bounds.minLng - 1, bounds.minLat - 1, bounds.maxLng + 1, bounds.maxLat + 1],
          { padding: 50, duration: 1500 }
        );
      }
    } else {
      map.current.flyTo({
        center: [15, 50],
        zoom: 3,
        essential: true
      });
    }
  }, [selectedCountry, selectedStation, stations]);

  const handleHomeClick = () => {
    if (!map.current) return;
    setSelectedStation("");
    map.current.flyTo({ 
      center: [10, 50], 
      zoom: 3, 
      essential: true,
      duration: 1500
    });
  };


  return (
    <div className="relative w-full h-full flex flex-col min-h-0">
      {/* Interactive Map Canvas Container */}
      <div ref={mapContainer} className="flex-1 w-full h-full min-h-0 bg-slate-50" />

      {/* Home Button */}
      <div className="absolute top-[80px] left-2.5 z-10">
        <Tooltip content="Zoom to All Stations" position="right">
          <button
            onClick={handleHomeClick}
            className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-white shadow-sm border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <Home size={20} />
          </button>
        </Tooltip>
      </div>

      {/* Map Legend */}
      <MapLegend parameter={parameter} values={currentValues} />

      {/* Visible Extent Summary Cards */}
      {visibleStats && (
        <div className="absolute top-2.5 right-2.5 z-10 flex flex-col gap-2 max-w-[280px]">
          <details 
            className="group bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-lg flex flex-col transition-all duration-200 marker:content-['']"
            open={isStatsExpanded}
            onToggle={(e) => setIsStatsExpanded(e.currentTarget.open)}
          >
            <summary className="p-3 text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-start justify-between gap-2 cursor-pointer border-slate-100 group-open:border-b group-open:pb-1.5 list-none [&::-webkit-details-marker]:hidden">
              <div className="flex flex-col leading-tight gap-0.5">
                <Tooltip content={parameter} position="left">
                  <span className="truncate inline-block max-w-[120px]">
                    {({
                      air_temperature: "Air Temperature",
                      precipitation_amount: "Precipitation",
                      air_pressure_at_mean_sea_level: "Sea Level Pressure",
                      wind_speed: "Wind Speed",
                    }[parameter] || parameter.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim())}
                  </span>
                </Tooltip>
                <span className="text-[9px] text-slate-400 tracking-normal normal-case font-medium flex items-center gap-1 cursor-help relative group/tip">
                  Screen Extent
                  <Info size={10} className="text-slate-400" />
                  <span className="pointer-events-none opacity-0 group-hover/tip:opacity-100 group-hover/tip:pointer-events-auto transition-opacity duration-200 absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-medium leading-relaxed text-slate-600 shadow-lg normal-case tracking-normal">
                    These aggregated statistics dynamically update to only include the stations currently visible within the map boundaries.
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-[9px] shrink-0">{visibleStats.count} stn</span>
                <div className="text-slate-400 bg-slate-50 rounded-md p-0.5 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                  <ChevronDown size={14} className="group-open:rotate-180 transition-transform" />
                </div>
              </div>
            </summary>
            
            <div className="p-3 pt-1.5 flex flex-col animate-in fade-in duration-200">
              <div className="flex justify-between items-center">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase">Average</span>
                  <span className="text-sm font-bold text-slate-800">
                    {visibleStats.avg.toFixed(1)} {getUnitForParam(parameter)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 mt-1 pt-1.5 border-t border-slate-50">
                  <div className="flex justify-between items-start gap-3">
                    <span className="text-[10px] font-semibold text-red-500/80 uppercase">Max</span>
                    <div className="flex flex-col items-end">
                      <span className="text-sm font-bold text-slate-800">
                        {visibleStats.max.toFixed(1)} {getUnitForParam(parameter)}
                      </span>
                      {visibleStats.maxStation && (
                        <span className="text-[9px] font-medium text-slate-500 text-right truncate w-full max-w-[180px]">
                          {visibleStats.maxStation.name}, {visibleStats.maxStation.country}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-0.5 mt-1 pt-1.5 border-t border-slate-50">
                  <div className="flex justify-between items-start gap-3">
                    <span className="text-[10px] font-semibold text-blue-500/80 uppercase">Min</span>
                    <div className="flex flex-col items-end">
                      <span className="text-sm font-bold text-slate-800">
                        {visibleStats.min.toFixed(1)} {getUnitForParam(parameter)}
                      </span>
                      {visibleStats.minStation && (
                        <span className="text-[9px] font-medium text-slate-500 text-right truncate w-full max-w-[180px]">
                          {visibleStats.minStation.name}, {visibleStats.minStation.country}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
            </div>
          </details>
        </div>
      )}

      {/* Map Styles Layer selector */}
      <div className="absolute top-[130px] left-2.5 z-10 flex flex-col gap-1">
        <Tooltip content="Map Styles" position="right">
          <button
            popoverTarget="map-styles-menu"
            className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-white shadow-sm border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <Layers size={20} />
          </button>
        </Tooltip>

        <div id="map-styles-menu" popover="auto" className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl p-3.5 shadow-lg flex-col gap-2.5 w-[200px] m-0 fixed top-[130px] left-[64px]">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
            <Layers size={14} className="text-slate-500" />
              Map Styles
            </h4>
            <div className="flex flex-col gap-2">
              {[
                { id: "positron", label: "OpenFreeMap Positron" },
                { id: "bright", label: "OpenFreeMap Bright" },
                { id: "satellite", label: "Satellite Imagery" }
              ].map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer">
                  <input
                    type="radio"
                    name="basemap"
                    checked={basemap === item.id}
                    onChange={() => {
                      setBasemap(item.id);
                      // Automatically close the popover when a new base style is chosen
                      document.getElementById("map-styles-menu")?.hidePopover();
                    }}
                    className="text-blue-500 focus:ring-blue-400"
                  />
                  {item.label}
                </label>
              ))}
              <div className="border-t border-slate-100 mt-1 pt-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showLabels}
                    onChange={(e) => setShowLabels(e.target.checked)}
                    className="text-blue-500 rounded focus:ring-blue-400"
                  />
                  Show Labels
                </label>
              </div>
          </div>
        </div>
      </div>

      {/* Error/Bypass Alert Banner */}
      {errorMsg && (
        <div className="absolute top-4 left-16 right-4 lg:left-4 z-10 bg-amber-50/95 backdrop-blur-md border border-amber-200 rounded-xl p-3 shadow-md flex items-center gap-3">
          <ShieldAlert className="text-amber-500 shrink-0" size={20} />
          <p className="text-xs font-semibold text-amber-700 leading-normal">{errorMsg}</p>
        </div>
      )}

      {/* Loading Overlay Spinner — unified for stations loading and data fetching */}
      {(isLoadingStations || isLoading) && (
        <div className="absolute inset-0 z-40 bg-slate-50/40 backdrop-blur-[2px] flex items-center justify-center pointer-events-none transition-all duration-300">
          <div className="flex flex-col items-center gap-3 bg-white/95 p-5 rounded-2xl shadow-xl border border-slate-200 pointer-events-auto">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-bold text-slate-600 uppercase tracking-wider animate-pulse">
              {isLoadingStations ? "Loading Stations..." : "Fetching Data..."}
            </p>
          </div>
        </div>
      )}

      {/* Timeline slider control panel at bottom of map */}
      <div className="absolute bottom-1 left-1 right-1 md:bottom-6 md:left-6 md:right-6 z-10 bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl p-4 shadow-xl flex flex-col md:flex-row items-center gap-4">
        {/* Timeline Slider bar */}
        <div className="flex-1 w-full flex flex-col gap-1">
          <div className="flex justify-center items-center text-sm font-bold px-1 mb-1">
            <span className="text-blue-600 bg-blue-50 border border-blue-200 shadow-sm rounded-full px-4 py-1">
              {endDate} at {selectedHour.toString().padStart(2, "0")}:00 UTC
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="23"
            value={selectedHour}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              if (val <= maxAllowedHour) {
                setSelectedHour(val);
              }
            }}
            className="w-full h-4 md:h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="relative w-full h-6 mt-1 text-xs text-slate-400 font-semibold">
            {[0, 3, 6, 9, 12, 15, 18, 21, 23].map((h) => (
              <div
                key={h}
                className={`absolute top-0 flex flex-col items-center w-6 -ml-3 transition-opacity ${h > maxAllowedHour ? "opacity-30" : "opacity-100"}`}
                style={{
                  left: `calc(10px + (100% - 20px) * ${h / 23})`,
                }}
              >
                <div className="w-[1.5px] h-1.5 bg-slate-300 mb-0.5 rounded-full" />
                <span>{h}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
