"use client";

import React, { useState, useEffect, useMemo, Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";
import { WeatherMap } from "@/components/Map";
import { DashboardCharts } from "@/components/DashboardCharts";
import { WeatherTable } from "@/components/Table";
import { ColumnDef } from "@tanstack/react-table";
import { Map, List, BarChart3, AlertCircle, Info, Calendar, Thermometer, Wind, Database, Download, Maximize, Minimize, MapPin, Mountain, Loader2 } from "lucide-react";
import { downloadCSV, downloadExcel } from "@/utils/export";

interface Station {
  id: string;
  name: string;
  country: string;
  longitude: number;
  latitude: number;
  elevation: number | null;
  available_params: string;
}

interface HourlyRow {
  datetime: string;
  [key: string]: string | number | undefined;
}

// Keys that indicate ocean/marine data
const OCEAN_KEY_PREFIXES = [
  "seaSurface", "seaWater", "sea_surface", "sea_water",
];

function isOceanKey(key: string): boolean {
  return OCEAN_KEY_PREFIXES.some((p) => key.startsWith(p));
}

// Convert camelCase to human-readable: "seaSurfaceTemperature" → "Sea Surface Temperature"
function camelToTitle(str: string): string {
  return str
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .replace(/(\d+)([a-zA-Z])/g, "$1 $2")
    .trim();
}

function EuroMeteoApp() {
  // --- Sidebar & General Filters State ---
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string>("");
  const [selectedStation, setSelectedStation] = useState<string>("");
  
  // Default to Last 31 Days like MeteoGate
  const [endDate, setEndDate] = useState<string>(
    new Date().toISOString().split("T")[0] // default to today
  );
  const [startDate, setStartDate] = useState<string>(
    new Date(new Date().getTime() - 32 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] // default to yesterday - 31 days
  );
  const [parameter, setParameter] = useState<string>("air_temperature");

  // --- UI Elements State ---
  const [activeTab, setActiveTab] = useState<string>("map");
  const [dashboardSubTab, setDashboardSubTab] = useState<string>("plots");
  const [dashboardDataTab, setDashboardDataTab] = useState<string>("land");
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [isLoadingStations, setIsLoadingStations] = useState<boolean>(true);
  const [stationLogs, setStationLogs] = useState<HourlyRow[]>([]);
  const [stationUnits, setStationUnits] = useState<Record<string, string>>({});
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Lifted state from Map for current observation values
  const [areaObservations, setAreaObservations] = useState<Record<string, number[]>>({});
  
  // Default to 3 hours ago (matching MeteoGate R app)
  const [selectedHour, setSelectedHour] = useState<number>(() => {
    const d = new Date();
    d.setUTCHours(d.getUTCHours() - 3);
    return d.getUTCHours();
  });
  
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Monitor native fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  // --- Initial Loading of Station Metadata ---
  useEffect(() => {
    const fetchStations = async () => {
      try {
        const res = await fetch("/api/stations");
        const json = await res.json();
        if (json.success) {
          setStations(json.data);
        } else {
          setErrorMsg(json.message || "Failed to load station lists.");
        }
      } catch (err) {
        console.error("Stations fetch error:", err);
        setErrorMsg("Failed to connect to the weather observation backend.");
      } finally {
        setIsLoadingStations(false);
      }
    };
    fetchStations();
  }, []);

  // --- URL Search Params Synchronization ---
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Read initial states from URL on mount
    const params = new URLSearchParams(window.location.search);
    const country = params.get("country");
    const station = params.get("station");
    const param = params.get("parameter");
    const start = params.get("start");
    const end = params.get("end");
    const tab = params.get("tab");

    if (country) setSelectedCountry(country);
    if (station) setSelectedStation(station);
    if (param) setParameter(param);
    if (start) setStartDate(start);
    if (end) setEndDate(end);
    if (tab) setActiveTab(tab);
  }, []);

  // Sync state changes back to URL query parameters and notify parent iframe
  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedCountry) params.set("country", selectedCountry);
    if (selectedStation) params.set("station", selectedStation);
    if (parameter) params.set("parameter", parameter);
    if (startDate) params.set("start", startDate);
    if (endDate) params.set("end", endDate);
    if (activeTab) params.set("tab", activeTab);

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState(null, "", newUrl);

    // Notify parent window of state changes if embedded in an iframe
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'EUROMETEO_STATE_CHANGE',
        payload: {
          country: selectedCountry,
          station: selectedStation,
          parameter: parameter,
          start: startDate,
          end: endDate,
          tab: activeTab
        },
        search: `?${params.toString()}`
      }, '*');
    }
  }, [selectedCountry, selectedStation, parameter, startDate, endDate, activeTab]);

  const [loadingMessage, setLoadingMessage] = useState<string>("Connecting to API...");

  // --- Fetch detailed logs when a station is selected ---
  useEffect(() => {
    if (!selectedStation) {
      setStationLogs([]);
      return;
    }

    const abortController = new AbortController();

    const fetchDetailedLogs = async () => {
      setIsLoadingLogs(true);
      setLoadingMessage("Connecting to API...");
      
      try {
        const res = await fetch(
          `/api/observations/station-details?stationId=${selectedStation}&start=${startDate}&end=${endDate}`,
          { signal: abortController.signal }
        );
        
        if (!res.ok) {
           throw new Error(`HTTP error! status: ${res.status}`);
        }
        
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No reader available");
        
        const decoder = new TextDecoder();
        let buffer = "";
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          // Last part might be incomplete, keep it in buffer
          buffer = parts.pop() || "";
          
          for (const chunk of parts) {
            const lines = chunk.split('\n');
            let event = "message";
            let data = "";
            
            for (const line of lines) {
              if (line.startsWith("event: ")) event = line.slice(7);
              else if (line.startsWith("data: ")) data = line.slice(6);
            }
            
            if (event === "progress" && data) {
              try {
                const parsed = JSON.parse(data);
                setLoadingMessage(parsed.message);
              } catch (e) {}
            } else if (event === "complete" && data) {
              try {
                const parsed = JSON.parse(data);
                setStationLogs(parsed.data || []);
                setStationUnits(parsed.units || {});
              } catch (e) {}
            } else if (event === "error" && data) {
              try {
                const parsed = JSON.parse(data);
                console.warn("SSE Error:", parsed.message);
                setErrorMsg(parsed.message);
              } catch (e) {}
            }
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("Detailed logs fetch error:", err);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoadingLogs(false);
        }
      }
    };

    fetchDetailedLogs();

    return () => {
      abortController.abort();
    };
  }, [selectedStation, startDate, endDate]);

  // Find active station object details
  const activeStationDetails = useMemo(() => {
    return stations.find((st) => st.id === selectedStation) || null;
  }, [stations, selectedStation]);

  // --- Table Column Definitions ---

  // 1. Station info table columns
  const stationColumns = useMemo<ColumnDef<Station>[]>(
    () => {
      const cols: ColumnDef<Station>[] = [
        { accessorKey: "name", header: "Station Name" },
        { accessorKey: "id", header: "WIGOS ID", meta: { className: "hidden sm:table-cell" } },
        { accessorKey: "country", header: "Country" },
        {
          id: "currentValue",
          header: "Current Value",
          cell: (info) => {
            const st = info.row.original;
            const vals = areaObservations[st.id] || [];
            const val = vals[selectedHour] ?? NaN;
            return isNaN(val) ? "-" : `${Math.round(val * 10) / 10}`;
          }
        },
        {
          accessorKey: "elevation",
          header: "Elevation",
          cell: (info) => {
            const val = info.getValue() as number | null;
            return val !== null ? `${val} m` : "Unknown";
          },
        },
        {
          accessorKey: "longitude",
          header: "Longitude",
          meta: { className: "hidden md:table-cell" },
          cell: (info) => (info.getValue() as number).toFixed(4),
        },
        {
          accessorKey: "latitude",
          header: "Latitude",
          meta: { className: "hidden md:table-cell" },
          cell: (info) => (info.getValue() as number).toFixed(4),
        },
        { accessorKey: "available_params", header: "Available Parameters", meta: { className: "hidden lg:table-cell" } },
      ];
      return cols;
    },
    [areaObservations, selectedHour]
  );

  // --- Comprehensive readable header labels ---
  const paramMeta: Record<string, string> = useMemo(() => ({
    // Temperature
    temperature: "Temp", tempMin: "Min Temp", tempMax: "Max Temp",
    tempMin50cm: "Min Temp 50cm", tempMinGround: "Min Temp Grnd",
    dewPoint: "Dew Point", virtualTemperature: "Virtual Temp",
    surfaceTemperature: "Surface Temp",
    // Humidity
    humidity: "Rel Humidity",
    // Precipitation (multi-column)
    precipitation: "Precip", precipitation1h: "Precip 1h",
    precipitation3h: "Precip 3h", precipitation6h: "Precip 6h",
    precipitation12h: "Precip 12h", precipitation24h: "Precip 24h",
    lwePrecipitationRate: "Precip Rate", rainfallRate: "Rain Rate",
    // Snow
    snowDepth: "Snow Depth", snowFresh: "Fresh Snow",
    // Wind
    windSpeed: "Wind Speed", windSpeed2m: "Wind Speed 2m",
    windGust: "Wind Gust", windGustInst: "Wind Gust Inst",
    windGustDirection: "Gust Dir", windDirection: "Wind Dir",
    // Pressure
    pressure: "Pressure MSL", pressureStation: "Pressure Stn",
    pressureTendency: "Press Tendency",
    // Cloud & Visibility
    cloudCover: "Cloud Cover", cloudCoverLow: "Low Cloud",
    cloudBaseAltitude: "Cloud Base", visibility: "Visibility",
    // Radiation
    solarRadiation: "Solar Rad", sunshineDuration: "Sun Dur",
    surfaceDiffuseDownwellingShortwave: "Diffuse SW↓",
    surfaceDirectDownwellingShortwave: "Direct SW↓",
    surfaceDownwellingLongwaveFluxInAir: "LW↓",
    surfaceUpwellingLongwaveFluxInAir: "LW↑",
    surfaceUpwellingShortwaveFluxInAir: "SW↑",
    surfaceNetDownwardRadiativeFlux: "Net Rad↓",
    downwellingLongwaveFluxInAir: "LW↓ Air",
    surfaceDownwellingPhotosyntheticPhotonFluxInAir: "PAR Photon",
    surfaceDownwellingPhotosyntheticRadiativeFluxInAir: "PAR Rad",
    integralWrtTimeOfSurfaceDownwellingLongwaveFluxInAir: "LW↓ Integral",
    integralWrtTimeOfSurfaceDownwellingShortwaveFluxInAir: "SW↓ Integral",
    ultravioletIndex: "UV Index",
    // Soil
    soilTemp10cm: "Soil T 10cm", soilTemp20cm: "Soil T 20cm", soilTemp50cm: "Soil T 50cm",
    // ETP
    etp: "ETP",
    // Radar
    equivalentReflectivityFactor: "Radar Refl",
    // Ocean / Marine
    seaSurfaceTemperature: "SST",
    seaSurfaceWaveSignificantHeight: "Sig Wave Ht",
    seaSurfaceWaveMaximumHeight: "Max Wave Ht",
    seaSurfaceWaveMaximumPeriod: "Max Wave Per",
    seaSurfaceWaveMeanPeriod: "Mean Wave Per",
    seaSurfaceWaveSignificantPeriod: "Sig Wave Per",
    seaSurfaceWaveFromDirection: "Wave Dir",
    seaSurfaceWaveDirectionalSpread: "Wave Spread",
    seaSurfaceWavePeriodOfHighestWave: "Highest Wave Per",
    seaSurfaceWaveEnergyAtVarianceSpectralDensityMaximum: "Wave Energy Max",
    seaSurfaceWaveFromDirectionAtVarianceSpectralDensityMaximum: "Wave Dir Max",
    seaSurfaceWaveMeanPeriodFromVarianceSpectralDensityFirstFrequencyMoment: "Wave Per 1st Mom",
    seaSurfaceWaveMeanPeriodFromVarianceSpectralDensitySecondFrequencyMoment: "Wave Per 2nd Mom",
    seaSurfaceWavePeriodAtVarianceSpectralDensityMaximum: "Wave Per Max",
    seaSurfaceSwellWaveFromDirection: "Swell Dir",
    seaSurfaceSwellWaveSignificantHeight: "Swell Ht",
    seaSurfaceSwellWaveMeanPeriodFromVarianceSpectralDensitySecondFrequencyMoment: "Swell Per 2nd Mom",
    seaSurfaceWindWaveFromDirection: "Wind Wave Dir",
    seaSurfaceWindWaveSignificantHeight: "Wind Wave Ht",
    seaSurfaceWindWaveMeanPeriodFromVarianceSpectralDensitySecondFrequencyMoment: "Wind Wave Per",
    seaWaterTemperature: "Sea Water Temp",
    seaWaterSalinity: "Salinity",
    seaWaterSpeed: "Current Speed",
    seaWaterElectricalConductivity: "Conductivity",
  }), []);

  // Weather-logical sort order for land parameters
  const LAND_SORT_ORDER = [
    "temperature", "tempMin", "tempMax", "tempMinGround", "tempMin50cm",
    "dewPoint", "humidity", "virtualTemperature", "surfaceTemperature",
    "precipitation", "precipitation1h", "precipitation3h", "precipitation6h",
    "precipitation12h", "precipitation24h", "lwePrecipitationRate", "rainfallRate",
    "snowDepth", "snowFresh",
    "windSpeed", "windSpeed2m", "windGust", "windGustInst", "windGustDirection", "windDirection",
    "pressure", "pressureStation", "pressureTendency",
    "cloudCover", "cloudCoverLow", "cloudBaseAltitude", "visibility",
    "solarRadiation", "sunshineDuration", "ultravioletIndex", "etp",
    "soilTemp10cm", "soilTemp20cm", "soilTemp50cm",
    "equivalentReflectivityFactor",
  ];

  // Keys that should render as integers (directions, percentages, indices)
  const INTEGER_KEYS = new Set([
    "windDirection", "windGustDirection", "cloudCover", "cloudCoverLow",
    "humidity", "ultravioletIndex",
  ]);

  // --- Column builder helper ---
  function buildColumns(
    keys: string[],
    sortOrder: string[],
  ): ColumnDef<HourlyRow>[] {
    const datetimeCol: ColumnDef<HourlyRow> = {
      accessorKey: "datetime",
      header: "Datetime (UTC)",
      cell: (info) => {
        try {
          return new Date(info.getValue() as string).toLocaleString(undefined, {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          });
        } catch {
          return info.getValue() as string;
        }
      },
    };

    const sorted = [...keys].sort((a, b) => {
      const ia = sortOrder.indexOf(a);
      const ib = sortOrder.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    const dataCols: ColumnDef<HourlyRow>[] = sorted.map((key) => {
      const headerName = paramMeta[key] || camelToTitle(key);
      const unit = stationUnits[key] || "";
      return {
        accessorKey: key as any,
        header: `${headerName}${unit ? ` [${unit}]` : ""}`,
        cell: (info: any) => {
          const val = info.getValue() as number | undefined;
          if (val === undefined || val === null) return "-";
          if (INTEGER_KEYS.has(key) || key.toLowerCase().includes("direction")) {
            return `${Math.round(val)}`;
          }
          return `${val.toFixed(1)}`;
        },
      };
    });

    return [datetimeCol, ...dataCols];
  }

  // 2. Observations logs: detect present keys, dedup, split land/ocean
  const { landColumns, oceanColumns, hasOceanData, hasLandData } = useMemo(() => {
    if (!stationLogs || stationLogs.length === 0) {
      return {
        landColumns: buildColumns([], LAND_SORT_ORDER),
        oceanColumns: buildColumns([], []),
        hasOceanData: false,
        hasLandData: false,
      };
    }

    // Collect all keys that have at least one non-null value
    const presentKeys = new Set<string>();
    stationLogs.forEach((row) => {
      Object.keys(row).forEach((k) => {
        if (k !== "datetime" && (row as any)[k] !== undefined && (row as any)[k] !== null) {
          presentKeys.add(k);
        }
      });
    });

    // --- Duplicate column deduplication (matching R get_station_display_cols) ---
    const keysArray = Array.from(presentKeys).sort((a, b) => a.length - b.length);
    const deduped = new Set<string>();
    const dropped = new Set<string>();

    for (const key of keysArray) {
      if (dropped.has(key)) continue;
      let isDuplicate = false;
      for (const kept of deduped) {
        let allSame = true;
        for (const row of stationLogs) {
          const v1 = (row as any)[key];
          const v2 = (row as any)[kept];
          const v1null = v1 === undefined || v1 === null;
          const v2null = v2 === undefined || v2 === null;
          if (v1null && v2null) continue;
          if (v1null !== v2null) { allSame = false; break; }
          if (typeof v1 === "number" && typeof v2 === "number") {
            if (Math.abs(v1 - v2) > 1e-9) { allSame = false; break; }
          } else if (v1 !== v2) { allSame = false; break; }
        }
        if (allSame) { isDuplicate = true; break; }
      }
      if (!isDuplicate) deduped.add(key);
      else dropped.add(key);
    }

    // Split into land and ocean keys
    const landKeys: string[] = [];
    const oceanKeys: string[] = [];
    for (const key of deduped) {
      if (isOceanKey(key)) oceanKeys.push(key);
      else landKeys.push(key);
    }

    // Ocean sort: alphabetical by readable name
    const oceanSort = [...oceanKeys].sort((a, b) => {
      const na = paramMeta[a] || camelToTitle(a);
      const nb = paramMeta[b] || camelToTitle(b);
      return na.localeCompare(nb);
    });

    return {
      landColumns: buildColumns(landKeys, LAND_SORT_ORDER),
      oceanColumns: buildColumns(oceanKeys, oceanSort),
      hasOceanData: oceanKeys.length > 0,
      hasLandData: landKeys.length > 0,
    };
  }, [stationLogs, stationUnits]);

  const handleStationDoubleClick = (station: Station) => {
    setSelectedStation(station.id);
    setActiveTab("dashboard");
  };

  return (
    <div className="flex h-[100dvh] w-screen overflow-hidden bg-slate-50">
      {/* Sidebar Filter controls panel */}
      <Sidebar
        stations={stations}
        selectedCountry={selectedCountry}
        setSelectedCountry={setSelectedCountry}
        selectedStation={selectedStation}
        setSelectedStation={setSelectedStation}
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        parameter={parameter}
        setParameter={setParameter}
        isOpen={sidebarOpen}
        setIsOpen={setSidebarOpen}
        selectedHour={selectedHour}
        observations={areaObservations}
      />

      {/* Main View Shell Container */}
      <main className={`flex-1 h-full flex flex-col min-w-0 relative bg-slate-50 transition-all ${isFullscreen ? "fixed inset-0 z-50 pl-0" : "pl-0 lg:pl-[310px]"}`}>
        {/* Top tab switcher header navigation */}
        <header className="h-[70px] border-b border-slate-100/50 bg-white/70 backdrop-blur-md flex items-center justify-between pl-[72px] pr-4 lg:px-6 shrink-0 overflow-x-auto custom-scrollbar">
          <div className="flex items-center gap-4 shrink-0">
            <div className="flex items-center gap-1 shrink-0">
              {[
                { id: "map", label: "Map View", icon: Map },
                { id: "stations", label: "Stations Info", icon: List },
                { id: "dashboard", label: "Dashboard", icon: BarChart3 },
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all btn-premium cursor-pointer ${
                      isActive
                        ? "bg-blue-500 text-white shadow-md shadow-blue-500/10"
                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                    }`}
                  >
                    <Icon size={14} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={toggleFullscreen}
              className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer min-w-[44px] min-h-[44px] flex items-center justify-center"
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </header>

        {/* View Switch Panels Container */}
        <div className="flex-1 w-full p-6 overflow-hidden min-h-0 flex flex-col">
          {isLoadingStations ? (
            <div className="flex-grow flex flex-col items-center justify-center gap-3">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider animate-pulse">
                Loading base maps...
              </p>
            </div>
          ) : errorMsg ? (
            <div className="flex-grow flex flex-col items-center justify-center gap-3 text-center max-w-md mx-auto">
              <AlertCircle className="text-rose-500" size={40} />
              <h3 className="text-base font-bold text-slate-700">Database Connection Failed</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{errorMsg}</p>
            </div>
          ) : (
            <div className="flex-grow w-full h-full min-h-0 relative">
              {/* Tab: Map View — always mounted, hidden when inactive */}
              <div className="w-full h-full" style={{ display: activeTab === "map" ? "block" : "none" }}>
                <WeatherMap
                  stations={stations}
                  selectedCountry={selectedCountry}
                  selectedStation={selectedStation}
                  setSelectedStation={setSelectedStation}
                  parameter={parameter}
                  startDate={startDate}
                  endDate={endDate}
                  observations={areaObservations}
                  setObservations={setAreaObservations}
                  selectedHour={selectedHour}
                  setSelectedHour={setSelectedHour}
                  onStationClick={(stationId) => {
                    setActiveTab("dashboard");
                  }}
                />
              </div>

              {/* Tab: Stations Info table — always mounted, hidden when inactive */}
              <div className="w-full h-full flex flex-col gap-4" style={{ display: activeTab === "stations" ? "flex" : "none" }}>
                <div className="bg-blue-50/50 border border-blue-100/50 rounded-2xl p-4 flex gap-3 items-center text-sm font-medium text-slate-600">
                  <Info size={16} className="text-blue-500 shrink-0" />
                  <p>
                    Double-click or tap a row to select the station and view its detailed hourly weather log.
                  </p>
                </div>
                <div className="flex-grow min-h-0">
                  <WeatherTable
                    data={stations}
                    columns={stationColumns}
                    onRowDoubleClick={handleStationDoubleClick}
                    searchPlaceholder="Search stations by name or WIGOS ID..."
                    searchKey="name"
                  />
                </div>
              </div>

              {/* Tab: Dashboard charts & raw logs — always mounted, hidden when inactive */}
              <div className="w-full h-full overflow-y-auto custom-scrollbar flex flex-col gap-6 pr-1 pb-6" style={{ display: activeTab === "dashboard" ? "flex" : "none" }}>
                  {!selectedStation ? (
                    <div className="w-full h-[400px] flex flex-col items-center justify-center text-center gap-3">
                      <BarChart3 className="text-slate-300" size={48} />
                      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">No Station Selected</h3>
                      <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
                        Select a marker from the Map View or double-click a row in the Stations list to inspect metrics.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Station details banner card */}
                      {activeStationDetails && (
                        <div className="glass-card rounded-2xl p-6 border border-slate-100/50 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex flex-col gap-1">
                            <h2 className="text-lg font-bold text-slate-800 tracking-tight">
                              {activeStationDetails.name}
                            </h2>
                            <p className="text-sm text-slate-400 font-semibold tracking-wider uppercase">
                              WIGOS ID: {activeStationDetails.id} &bull; Country: {activeStationDetails.country}
                            </p>
                          </div>
                          <div className="flex items-center gap-6 text-sm font-bold text-slate-500 border-l border-slate-100 pl-0 sm:pl-6 pt-3 sm:pt-0">
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => downloadCSV(stationLogs, `meteo_station_${activeStationDetails.id}_${startDate}_${endDate}`)}
                                  disabled={stationLogs.length === 0}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 hover:text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                  <Download size={14} /> CSV
                                </button>
                                <button
                                  onClick={() => downloadExcel(stationLogs, `meteo_station_${activeStationDetails.id}_${startDate}_${endDate}`)}
                                  disabled={stationLogs.length === 0}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 hover:text-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                  <Download size={14} /> Excel
                                </button>
                              </div>
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-slate-400 flex items-center gap-1.5"><Mountain size={13} /> Elev</span>
                              <span className="text-slate-800 text-sm">
                                {activeStationDetails.elevation !== null ? `${activeStationDetails.elevation} m` : "Unknown"}
                              </span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-slate-400 flex items-center gap-1.5"><MapPin size={13} /> Lon</span>
                              <span className="text-slate-800 text-sm">{activeStationDetails.longitude.toFixed(3)}°</span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-slate-400 flex items-center gap-1.5"><MapPin size={13} /> Lat</span>
                              <span className="text-slate-800 text-sm">{activeStationDetails.latitude.toFixed(3)}°</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Loaders overlay */}
                      {isLoadingLogs ? (
                        <div className="w-full h-[200px] flex flex-col items-center justify-center gap-2">
                          <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                          <p className="text-xs font-bold text-slate-400 tracking-wider uppercase animate-pulse">
                            {loadingMessage}
                          </p>
                        </div>
                      ) : (
                        <>
                          {/* Dashboard Sub-tabs */}
                          <div className="flex items-center gap-2 mb-2 border-b border-slate-200 pb-2">
                            <button
                              onClick={() => setDashboardSubTab("plots")}
                              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${dashboardSubTab === "plots" ? "bg-blue-100 text-blue-700" : "text-slate-500 hover:bg-slate-100"}`}
                            >
                              Plots
                            </button>
                            <button
                              onClick={() => setDashboardSubTab("data")}
                              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${dashboardSubTab === "data" ? "bg-blue-100 text-blue-700" : "text-slate-500 hover:bg-slate-100"}`}
                            >
                              Data
                            </button>
                          </div>

                          {dashboardSubTab === "plots" ? (
                            <DashboardCharts data={stationLogs} />
                          ) : (
                            <div className="flex flex-col gap-3 min-h-[400px]">
                              {/* Land / Ocean sub-tabs (only show if both exist) */}
                              {hasLandData && hasOceanData && (
                                <div className="flex items-center gap-2 mb-1">
                                  <button
                                    onClick={() => setDashboardDataTab("land")}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                      dashboardDataTab === "land"
                                        ? "bg-emerald-100 text-emerald-700"
                                        : "text-slate-400 hover:bg-slate-100"
                                    }`}
                                  >
                                    🌍 Land
                                  </button>
                                  <button
                                    onClick={() => setDashboardDataTab("ocean")}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                      dashboardDataTab === "ocean"
                                        ? "bg-cyan-100 text-cyan-700"
                                        : "text-slate-400 hover:bg-slate-100"
                                    }`}
                                  >
                                    🌊 Ocean
                                  </button>
                                </div>
                              )}
                              <div className="flex-1">
                                <WeatherTable
                                  data={stationLogs}
                                  columns={
                                    hasOceanData && (!hasLandData || dashboardDataTab === "ocean")
                                      ? oceanColumns
                                      : landColumns
                                  }
                                  searchPlaceholder="Filter logs by hour or value..."
                                  searchKey="datetime"
                                />
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={
      <div className="h-[100dvh] w-screen flex flex-col items-center justify-center gap-3 bg-slate-50">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-bold text-slate-400 tracking-wider uppercase animate-pulse">
          Initializing EuroMeteo...
        </p>
      </div>
    }>
      <EuroMeteoApp />
    </Suspense>
  );
}
