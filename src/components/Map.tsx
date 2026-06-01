import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Layers, ShieldAlert, Home } from "lucide-react";
import { getColorFromPalette, getUnitForParam } from "@/utils/colors";
import { MapLegend } from "./MapLegend";

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
  onStationClick?: (stationId: string) => void;
}

const SOURCE_ID = "stations-source";
const CIRCLE_LAYER = "stations-circles";
const TEXT_LAYER = "stations-labels";
const SELECTED_LAYER = "stations-selected";

export const WeatherMap: React.FC<MapProps> = ({
  stations,
  selectedCountry,
  selectedStation,
  setSelectedStation,
  parameter,
  startDate,
  endDate,
  observations,
  setObservations,
  selectedHour,
  setSelectedHour,
  onStationClick
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  // ── Extract the actual values present on the map for the legend ──
  const currentValues = useMemo(() => {
    const vals: number[] = [];
    stations.forEach(st => {
      const val = observations[st.id]?.[selectedHour];
      if (val !== undefined && val !== null && !isNaN(val)) {
        vals.push(val);
      }
    });
    return vals;
  }, [stations, observations, selectedHour]);

  const sourceReadyRef = useRef(false);

  const [basemap, setBasemap] = useState<string>("positron");
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isStyleSelectorOpen, setIsStyleSelectorOpen] = useState<boolean>(false);

  // ── Stable refs for all values used inside map event handlers ──
  // This avoids stale closures in the one-time-registered event handlers.
  const setSelectedStationRef = useRef(setSelectedStation);
  setSelectedStationRef.current = setSelectedStation;
  const onStationClickRef = useRef(onStationClick);
  onStationClickRef.current = onStationClick;
  const selectedStationRef = useRef(selectedStation);
  selectedStationRef.current = selectedStation;
  const parameterRef = useRef(parameter);
  parameterRef.current = parameter;
  const stationsRef = useRef(stations);
  stationsRef.current = stations;
  const observationsRef = useRef(observations);
  observationsRef.current = observations;
  const selectedHourRef = useRef(selectedHour);
  selectedHourRef.current = selectedHour;
  const showLabelsRef = useRef(showLabels);
  showLabelsRef.current = showLabels;
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;

  // ── 1. Fetch area observations whenever period, parameter, or hour changes ──
  useEffect(() => {
    if (stations.length === 0) return;

    const abortController = new AbortController();

    const fetchObservations = async () => {
      setIsLoading(true);
      setErrorMsg(null);
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

        const res = await fetch("/api/observations/area", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parameter,
            datetimeRange,
            bounds,
            stations
          }),
          signal: abortController.signal
        });

        if (abortController.signal.aborted) return;

        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || "Failed to fetch observations");

        // Parse coverages: extract a single value per station (closest to target hour)
        const newObs: Record<string, number[]> = {};

        json.coverages.forEach((coverage: any) => {
          const wigosId = coverage["metocean:wigosId"];
          const domain = coverage.domain || {};
          const axes = domain.axes || {};
          const tAxis = axes.t || {};
          const timestamps: string[] = tAxis.values || [];

          const ranges = coverage.ranges || {};
          
          // Match R: prefer instantaneous PT0S values for temperature
          const rangeKeys = Object.keys(ranges);
          let bestKey = rangeKeys[0];
          if (!parameter.includes("precipitation")) {
            const pt0s = rangeKeys.find(k => k.includes("PT0S"));
            if (pt0s) bestKey = pt0s;
          }

          if (bestKey) {
            const values: any[] = ranges[bestKey]?.values || [];
            // Build hourly array — put all values into their respective hour slots
            const hourlyVals = new Array(24).fill(NaN);
            const len = Math.min(values.length, timestamps.length);
            
            for (let i = 0; i < len; i++) {
              const val = values[i];
              if (val !== null && val !== undefined) {
                try {
                  const date = new Date(timestamps[i]);
                  const hour = date.getUTCHours();
                  if (hour >= 0 && hour < 24) {
                    const numVal = parseFloat(val);
                    // Basic QC matching R: temperature -60 to 60
                    if (parameter.includes("temperature") && (numVal < -60 || numVal > 60)) continue;
                    hourlyVals[hour] = numVal;
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
            newObs[wigosId] = hourlyVals;
          }
        });

        if (abortController.signal.aborted) return;

        // DEBUG: Log what we got
        const obsIds = Object.keys(newObs);
        const stIds = stations.slice(0, 3).map(s => s.id);
        const sampleObs = obsIds.length > 0 ? newObs[obsIds[0]] : [];
        console.log(`[Map DEBUG] Obs loaded: ${obsIds.length} stations. Sample obs IDs: ${obsIds.slice(0,3).join(', ')}`);
        console.log(`[Map DEBUG] Sample station IDs: ${stIds.join(', ')}`);
        console.log(`[Map DEBUG] Sample hourly values for first obs: ${JSON.stringify(sampleObs?.slice(selectedHour, selectedHour + 3))}`);
        console.log(`[Map DEBUG] ID match test: station[0]="${stIds[0]}" in obs? ${stIds[0] in newObs}`);
        setObservations(newObs);
      } catch (error: any) {
        if (error.name === "AbortError") return;
        console.error("[Map] Fetch observations failed:", error);
        setErrorMsg("MeteoGate observation fetch timed out or returned empty coordinates. Degraded mode active.");
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchObservations();
    return () => abortController.abort();
  }, [stations, parameter, endDate, selectedHour]);

  // ── Build GeoJSON from current refs (always reads latest values) ──
  const buildGeoJSON = useCallback((): GeoJSON.FeatureCollection => {
    const sts = stationsRef.current;
    const obs = observationsRef.current;
    const hour = selectedHourRef.current;
    const param = parameterRef.current;
    const selStation = selectedStationRef.current;

    return {
      type: "FeatureCollection",
      features: sts
        .map((st) => {
          const hourlyVals = obs[st.id] || [];
          const hourVal = hourlyVals[hour] ?? NaN;
          const color = isNaN(hourVal) ? "#cbd5e1" : getColorFromPalette(hourVal, param);
          const label = isNaN(hourVal) ? "" : `${Math.round(hourVal * 10) / 10}`;
          const isSelected = st.id === selStation;

          return {
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
              color,
              label,
              value: isNaN(hourVal) ? null : Math.round(hourVal * 10) / 10,
              selected: isSelected ? 1 : 0
            }
          };
        })
        // Only return features that have a valid observation for the selected hour
        .filter((f) => f.properties.value !== null)
    };
  }, []); // No deps — reads from refs

  // ── Add source and layers to the map ──
  const addSourceAndLayers = useCallback(() => {
    const m = map.current;
    if (!m) return;

    // Remove existing layers/source if present
    try { if (m.getLayer(TEXT_LAYER)) m.removeLayer(TEXT_LAYER); } catch {}
    try { if (m.getLayer(SELECTED_LAYER)) m.removeLayer(SELECTED_LAYER); } catch {}
    try { if (m.getLayer(CIRCLE_LAYER)) m.removeLayer(CIRCLE_LAYER); } catch {}
    try { if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID); } catch {}

    const geojson = buildGeoJSON();

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
  addSourceAndLayersRef.current = addSourceAndLayers;

  // ── 2. Initialize MapLibre GL (runs once) ──
  useEffect(() => {
    if (!mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [10, 50],
      zoom: 4,
      attributionControl: false,
      projection: { type: "globe" }
    } as any);

    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.current.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

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

      const coords = (feature.geometry as any).coordinates.slice();
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
      const coords = (feature.geometry as any).coordinates;

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
    if (!map.current || !map.current.isStyleLoaded()) return;
    const labelLayers = ["place_label_city", "place_label_town", "place_label_village", "poi_label", "road_label", "water_label"];
    labelLayers.forEach(layer => {
      if (map.current?.getLayer(layer)) {
        map.current.setLayoutProperty(layer, 'visibility', showLabels ? 'visible' : 'none');
      }
    });
  }, [showLabels]);

  // ── 4. Update GeoJSON source data reactively ──
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const tryUpdate = () => {
      if (!sourceReadyRef.current) {
        console.log('[Map DEBUG] tryUpdate: sourceReadyRef is false');
        return false;
      }
      const source = m.getSource(SOURCE_ID) as maplibregl.GeoJSONSource;
      if (!source) {
        console.log('[Map DEBUG] tryUpdate: source not found');
        return false;
      }
      const geojson = buildGeoJSON();
      const coloredCount = geojson.features.filter((f: any) => f.properties?.color !== '#cbd5e1').length;
      console.log(`[Map DEBUG] tryUpdate SUCCESS: ${geojson.features.length} features, ${coloredCount} colored`);
      source.setData(geojson);
      return true;
    };

    // Try immediately
    if (tryUpdate()) return;

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
      const countryStations = stations.filter(st => st.country === selectedCountry);
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
        zoom: 3.5,
        essential: true
      });
    }
  }, [selectedCountry, selectedStation, stations]);

  const handleHomeClick = () => {
    if (!map.current) return;
    setSelectedStation("");
    map.current.flyTo({ 
      center: [10, 50], 
      zoom: 4, 
      essential: true,
      duration: 1500
    });
  };


  return (
    <div className="relative w-full h-full flex flex-col min-h-0">
      {/* Interactive Map Canvas Container */}
      <div ref={mapContainer} className="flex-1 w-full h-full min-h-0 bg-slate-50" />

      {/* Home Button */}
      <button
        onClick={handleHomeClick}
        className="absolute top-[80px] left-2.5 z-10 p-1.5 bg-white shadow-sm border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50 transition-colors"
        title="Zoom to All Stations"
      >
        <Home size={20} />
      </button>

      {/* Map Legend */}
      <MapLegend parameter={parameter} values={currentValues} />

      {/* Map Styles Layer selector - Collapsed by default, positioned below Home button */}
      <div className="absolute top-[120px] left-2.5 z-10 flex flex-col gap-1">
        <button
          onClick={() => setIsStyleSelectorOpen(!isStyleSelectorOpen)}
          className={`p-1.5 shadow-sm border rounded-md transition-colors ${
            isStyleSelectorOpen 
              ? 'bg-blue-50 border-blue-200 text-blue-600' 
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
          title="Map Styles"
        >
          <Layers size={20} />
        </button>

        {isStyleSelectorOpen && (
          <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl p-3.5 shadow-lg flex flex-col gap-2.5 w-[200px]">
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
                    onChange={() => setBasemap(item.id)}
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
        )}
      </div>

      {/* Error/Bypass Alert Banner */}
      {errorMsg && (
        <div className="absolute top-4 left-16 right-4 lg:left-4 z-10 bg-amber-50/95 backdrop-blur-md border border-amber-200 rounded-xl p-3 shadow-md flex items-center gap-3">
          <ShieldAlert className="text-amber-500 shrink-0" size={20} />
          <p className="text-xs font-semibold text-amber-700 leading-normal">{errorMsg}</p>
        </div>
      )}

      {/* Timeline slider control panel at bottom of map */}
      <div className="absolute bottom-6 left-6 right-6 z-10 bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl p-4 shadow-xl flex flex-col md:flex-row items-center gap-4">
        {/* Timeline Slider bar */}
        <div className="flex-1 w-full flex flex-col gap-1">
          <div className="flex justify-between items-center text-xs font-bold text-slate-600 px-1">
            <span>Hourly Timeline (24h UTC)</span>
            <span className="text-blue-500 bg-blue-50 border border-blue-100 rounded px-2 py-0.5">
              Hour: {selectedHour} UTC
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="23"
            value={selectedHour}
            onChange={(e) => setSelectedHour(parseInt(e.target.value))}
            className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="relative w-full h-6 mt-1 text-xs text-slate-400 font-semibold">
            {[0, 3, 6, 9, 12, 15, 18, 21, 23].map((h) => (
              <div
                key={h}
                className="absolute top-0 flex flex-col items-center w-6 -ml-3"
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
