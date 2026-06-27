"use client";

import React, { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";
import { WeatherMap } from "@/components/Map";
import { DashboardCharts } from "@/components/DashboardCharts";
import { WeatherTable } from "@/components/Table";
import { ColumnDef } from "@tanstack/react-table";
import { Map, List, BarChart3, AlertCircle, Info, Calendar, Thermometer, Wind, Database, Download, Maximize, Minimize, MapPin, Mountain, Loader2 } from "lucide-react";
import { downloadCSV, downloadExcel } from "@/utils/export";
import { countryMatches, resolveCountryName } from "@/utils/country";

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

interface StationSampling {
  isSubHourly: boolean;
  intervalMinutes: number | null;
  intervalLabel: string | null;
  rangeLimitDays: number | null;
  maxTimestampsPerDay: number;
}

type DateRangeMode = "unknown" | "auto" | "manual";

interface AutoRangeWindow {
  startDate: string;
  endDate: string;
  limitDays: number;
  stationId: string;
  locked: boolean;
  sampling: StationSampling | null;
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

function getWindowStartDate(endDate: string, limitDays: number): string {
  const end = new Date(`${endDate}T00:00:00Z`);
  if (isNaN(end.getTime())) return endDate;

  end.setUTCDate(end.getUTCDate() - (limitDays - 1));
  return end.toISOString().split("T")[0];
}

function getDateWindowDays(startDate: string, endDate: string): number | null {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return null;

  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

// Slugify station/country names — must match the parent page's implementation exactly
function slugify(text: string): string {
  if (!text) return '';
  let s = text;
  // Norwegian/Danish
  s = s.replace(/\u00f8/g, 'o').replace(/\u00d8/g, 'o');
  s = s.replace(/\u00e6/g, 'ae').replace(/\u00c6/g, 'ae');
  // Polish
  s = s.replace(/\u0142/g, 'l').replace(/\u0141/g, 'l');
  // Icelandic
  s = s.replace(/\u00f0/g, 'd').replace(/\u00d0/g, 'd');
  s = s.replace(/\u00fe/g, 'th').replace(/\u00de/g, 'th');
  // Turkish
  s = s.replace(/\u0131/g, 'i');
  // German umlauts
  s = s.replace(/\u00fc/g, 'ue').replace(/\u00dc/g, 'ue');
  s = s.replace(/\u00f6/g, 'oe').replace(/\u00d6/g, 'oe');
  s = s.replace(/\u00e4/g, 'ae').replace(/\u00c4/g, 'ae');
  s = s.replace(/\u00df/g, 'ss');
  s = s.toLowerCase();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s;
}

function NoStationDataMessage() {
  return (
    <div className="min-h-[260px] w-full flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/70 px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <AlertCircle className="text-slate-300" size={32} />
        <p className="text-sm font-bold text-slate-500">
          No data available for the station and period selected.
        </p>
      </div>
    </div>
  );
}

function EuroMeteoApp() {
  // --- Sidebar & General Filters State ---
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string>("");
  const [selectedStation, setSelectedStation] = useState<string>("");
  // Pending station slug: set when a station slug is received (from URL or message)
  // but can't be resolved yet because stations haven't loaded
  const [pendingStationSlug, setPendingStationSlug] = useState<string>("");
  
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
  const [stationSampling, setStationSampling] = useState<StationSampling | null>(null);
  const autoRangeWindowRef = useRef<AutoRangeWindow | null>(null);
  const dateRangeModeRef = useRef<DateRangeMode>("unknown");
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

  const countryNames = useMemo(() => {
    const unique = new Set(stations.map((st) => st.country).filter(Boolean));
    return Array.from(unique).sort();
  }, [stations]);

  const canonicalSelectedCountry = useMemo(
    () => resolveCountryName(selectedCountry, countryNames),
    [selectedCountry, countryNames]
  );
  
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

    // Read stationSlug for deferred resolution (SEO hub links pass slugs, not IDs)
    const stationSlug = params.get("stationSlug");
    if (stationSlug && !station) {
      setPendingStationSlug(stationSlug);
    }
  }, []);

  // --- Resolve pending station slug once stations are loaded ---
  useEffect(() => {
    if (!pendingStationSlug || stations.length === 0) return;

    const match = stations.find((st) => slugify(st.name) === pendingStationSlug);
    if (match) {
      setSelectedStation(match.id);
      setPendingStationSlug('');
    }
  }, [pendingStationSlug, stations]);

  // --- Listen for navigation commands from parent window (iframe embedding) ---
  // The parent page (climateexplorer.app) sends 'eurometeo-navigate' messages
  // when users click country/station links, so the iframe can navigate without
  // a full page reload.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleParentMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== 'eurometeo-navigate') return;

      // Update parameter
      if (data.parameter) {
        setParameter(data.parameter);
      }

      // Update country (display name)
      if (data.country) {
        setSelectedCountry(data.country);
      } else if (data.country === '' || data.country === null) {
        setSelectedCountry('');
      }

      // Update station (WIGOS ID or slug)
      if (data.stationId) {
        setSelectedStation(data.stationId);
        setPendingStationSlug('');
      } else if (data.stationSlug) {
        // Slug needs deferred resolution against the stations list
        setPendingStationSlug(data.stationSlug);
      } else {
        setStationSampling(null);
        setSelectedStation('');
        setPendingStationSlug('');
      }

      // Update tab
      if (data.tab) {
        setActiveTab(data.tab);
      }
    };

    window.addEventListener('message', handleParentMessage);
    return () => window.removeEventListener('message', handleParentMessage);
  }, []);

  // Sync state changes back to URL query parameters and notify parent iframe
  useEffect(() => {
    const params = new URLSearchParams();
    if (canonicalSelectedCountry) params.set("country", canonicalSelectedCountry);
    if (selectedStation) params.set("station", selectedStation);
    if (parameter) params.set("parameter", parameter);
    if (startDate) params.set("start", startDate);
    if (endDate) params.set("end", endDate);
    if (activeTab) params.set("tab", activeTab);

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState(null, "", newUrl);

    // Notify parent window of state changes if embedded in an iframe
    if (window.parent !== window) {
      // Resolve station name and country from loaded metadata so the parent
      // page can build SEO-friendly URL slugs without a pre-populated cache
      const stationDetails = selectedStation
        ? stations.find((st) => st.id === selectedStation) || null
        : null;

      // Build lightweight station list for the selected country so the parent
      // page can render clickable station links in the dynamic context area
      const countryStations = canonicalSelectedCountry
        ? stations
            .filter((st) => countryMatches(st.country, canonicalSelectedCountry))
            .map((st) => ({ id: st.id, name: st.name }))
        : null;

      window.parent.postMessage({
        type: 'EUROMETEO_STATE_CHANGE',
        payload: {
          country: canonicalSelectedCountry,
          station: selectedStation,
          stationName: stationDetails?.name || null,
          stationCountry: stationDetails?.country || null,
          parameter: parameter,
          start: startDate,
          end: endDate,
          tab: activeTab,
          countryStations: countryStations
        },
        search: `?${params.toString()}`
      }, '*');
    }
  }, [canonicalSelectedCountry, selectedStation, parameter, startDate, endDate, activeTab, stations]);


  const [loadingMessage, setLoadingMessage] = useState<string>("Connecting to API...");

  // Sync country filter to match the selected station's country
  useEffect(() => {
    if (!selectedStation || stations.length === 0) return;
    const station = stations.find(st => st.id === selectedStation);
    if (station && !countryMatches(station.country, canonicalSelectedCountry)) {
      setSelectedCountry(station.country);
    }
  }, [selectedStation, stations, canonicalSelectedCountry]);

  // --- Fetch detailed logs when a station is selected ---
  useEffect(() => {
    if (!selectedStation) {
      setStationLogs([]);
      setStationSampling(null);
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
                const sampling = parsed.sampling || null;
                const effectiveRange = parsed.effectiveRange;
                const currentAutoRange = autoRangeWindowRef.current;
                const lockedAutoRangeApplies =
                  dateRangeModeRef.current === "auto" &&
                  currentAutoRange !== null &&
                  currentAutoRange.locked &&
                  currentAutoRange.stationId === selectedStation &&
                  currentAutoRange.startDate === startDate &&
                  currentAutoRange.endDate === endDate;
                const rangeLimitDays =
                  typeof sampling?.rangeLimitDays === "number"
                    ? sampling.rangeLimitDays
                    : typeof effectiveRange?.limitDays === "number"
                      ? effectiveRange.limitDays
                      : null;
                setStationSampling(
                  lockedAutoRangeApplies && currentAutoRange?.sampling
                    ? currentAutoRange.sampling
                    : sampling
                );

                if (
                  effectiveRange?.adjusted &&
                  typeof effectiveRange.start === "string" &&
                  effectiveRange.start !== startDate
                ) {
                  if (rangeLimitDays !== null) {
                    dateRangeModeRef.current = "auto";
                    autoRangeWindowRef.current = {
                      startDate: effectiveRange.start,
                      endDate,
                      limitDays: rangeLimitDays,
                      stationId: selectedStation,
                      locked: true,
                      sampling,
                    };
                  }
                  setStartDate(effectiveRange.start);
                } else if (rangeLimitDays !== null) {
                  const currentWindowDays = getDateWindowDays(startDate, endDate);
                  const expectedWindowStart = getWindowStartDate(endDate, rangeLimitDays);
                  const hasActiveAutoRange =
                    dateRangeModeRef.current === "auto" &&
                    currentAutoRange !== null &&
                    currentAutoRange.startDate === startDate &&
                    currentAutoRange.endDate === endDate;
                  const shouldSeedAutoRange =
                    dateRangeModeRef.current === "unknown" &&
                    currentWindowDays === rangeLimitDays &&
                    startDate === expectedWindowStart;
                  const activeAutoRange = hasActiveAutoRange
                    ? currentAutoRange
                    : shouldSeedAutoRange
                      ? {
                          startDate,
                          endDate,
                          limitDays: rangeLimitDays,
                          stationId: selectedStation,
                          locked: false,
                          sampling,
                        }
                      : null;

                  if (shouldSeedAutoRange && activeAutoRange) {
                    dateRangeModeRef.current = "auto";
                    autoRangeWindowRef.current = activeAutoRange;
                  }

                  const isLockedToCurrentStation =
                    activeAutoRange?.locked &&
                    activeAutoRange.stationId === selectedStation;

                  if (
                    activeAutoRange &&
                    !isLockedToCurrentStation &&
                    rangeLimitDays > activeAutoRange.limitDays
                  ) {
                    const expandedStart = getWindowStartDate(endDate, rangeLimitDays);
                    dateRangeModeRef.current = "auto";
                    autoRangeWindowRef.current = {
                      startDate: expandedStart,
                      endDate,
                      limitDays: rangeLimitDays,
                      stationId: selectedStation,
                      locked: false,
                      sampling,
                    };

                    if (expandedStart !== startDate) {
                      setStartDate(expandedStart);
                    }
                  }
                }
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

  // Jump to Dashboard 3 seconds after a station is selected
  useEffect(() => {
    if (!selectedStation) return;
    
    // Only set timeout if we aren't already on the dashboard
    if (activeTab === "dashboard") return;
    
    const timer = setTimeout(() => {
      setActiveTab("dashboard");
    }, 3000);
    
    return () => clearTimeout(timer);
  }, [selectedStation]); // We only trigger on station selection, activeTab is checked inside to avoid loops

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
    solarRadiation: "Solar Rad",
    sunshineDuration10m: "Sun Dur 10m", sunshineDuration1h: "Sun Dur 1h",
    sunshineDuration3h: "Sun Dur 3h", sunshineDuration6h: "Sun Dur 6h",
    sunshineDuration12h: "Sun Dur 12h", sunshineDuration24h: "Sun Dur 24h",
    sunshineDuration: "Sun Dur",
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
    "solarRadiation",
    "sunshineDuration10m", "sunshineDuration1h", "sunshineDuration3h",
    "sunshineDuration6h", "sunshineDuration12h", "sunshineDuration24h",
    "sunshineDuration", "ultravioletIndex", "etp",
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
      sortingFn: (rowA, rowB, columnId) =>
        new Date(rowA.getValue(columnId) as string).getTime() -
        new Date(rowB.getValue(columnId) as string).getTime(),
      cell: (info) => {
        try {
          return new Date(info.getValue() as string).toLocaleString(undefined, {
            timeZone: "UTC",
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

  const showingOceanData = hasOceanData && (!hasLandData || dashboardDataTab === "ocean");
  const activeLogColumns = showingOceanData ? oceanColumns : landColumns;
  const hasActiveLogData = stationLogs.length > 0 && (showingOceanData ? hasOceanData : hasLandData);

  const handleStationSelection = (stationId: string) => {
    if (!stationId) {
      setStationSampling(null);
    }
    setSelectedStation(stationId);
  };

  const handleStationDoubleClick = (station: Station) => {
    handleStationSelection(station.id);
    setActiveTab("dashboard");
  };

  const handleManualStartDateChange = (date: string) => {
    autoRangeWindowRef.current = null;
    dateRangeModeRef.current = "manual";
    setStationSampling(null);
    setStartDate(date);
  };

  const handleManualEndDateChange = (date: string) => {
    autoRangeWindowRef.current = null;
    dateRangeModeRef.current = "manual";
    setStationSampling(null);
    setEndDate(date);
  };

  const handleMapParameterChange = (param: string) => {
    setParameter(param);
    if (activeTab === "dashboard") {
      setStationSampling(null);
      setSelectedStation("");
      setPendingStationSlug("");
      setSelectedCountry("");
    }
    setActiveTab("map");
    setSidebarOpen(false);
  };

  return (
    <div className="flex h-[100dvh] w-screen overflow-hidden bg-slate-50">
      {/* Sidebar Filter controls panel */}
      <Sidebar
        stations={stations}
        selectedCountry={canonicalSelectedCountry}
        setSelectedCountry={setSelectedCountry}
        selectedStation={selectedStation}
        setSelectedStation={handleStationSelection}
        startDate={startDate}
        setStartDate={handleManualStartDateChange}
        endDate={endDate}
        setEndDate={handleManualEndDateChange}
        parameter={parameter}
        setParameter={handleMapParameterChange}
        isOpen={sidebarOpen}
        setIsOpen={setSidebarOpen}
        selectedHour={selectedHour}
        observations={areaObservations}
      />

      {/* Main View Shell Container */}
      <main className={`flex-1 h-full flex flex-col min-w-0 relative bg-slate-50 transition-all ${isFullscreen ? "fixed inset-0 z-50 pl-0" : "pl-0 lg:pl-[280px]"}`}>
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
        <div className="flex-1 w-full overflow-hidden min-h-0 flex flex-col">
          {errorMsg && !isLoadingStations && stations.length === 0 ? (
            <div className="flex-grow flex flex-col items-center justify-center gap-3 text-center max-w-md mx-auto">
              <AlertCircle className="text-rose-500" size={40} />
              <h3 className="text-base font-bold text-slate-700">Database Connection Failed</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{errorMsg}</p>
            </div>
          ) : (
            <div className="flex-grow w-full h-full min-h-0 relative">
              {/* Tab: Map View — always mounted, renders immediately even without stations */}
              <div className="w-full h-full relative" style={{ display: activeTab === "map" ? "block" : "none" }}>
                <WeatherMap
                  stations={stations}
                  selectedCountry={canonicalSelectedCountry}
                  selectedStation={selectedStation}
                  setSelectedStation={handleStationSelection}
                  parameter={parameter}
                  startDate={startDate}
                  endDate={endDate}
                  observations={areaObservations}
                  setObservations={setAreaObservations}
                  selectedHour={selectedHour}
                  setSelectedHour={setSelectedHour}
                  isLoadingStations={isLoadingStations}
                  onStationClick={(stationId) => {
                    setActiveTab("dashboard");
                  }}
                />
              </div>

              {/* Tab: Stations Info table — always mounted, hidden when inactive */}
              <div className="w-full h-full flex flex-col gap-4 p-1 md:p-6" style={{ display: activeTab === "stations" ? "flex" : "none" }}>
                {isLoadingStations ? (
                  <div className="flex-grow flex flex-col items-center justify-center gap-3">
                    <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm font-bold text-slate-500 uppercase tracking-wider animate-pulse">
                      Loading stations...
                    </p>
                  </div>
                ) : (
                  <>
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
                  </>
                )}
              </div>

              {/* Tab: Dashboard charts & raw logs — always mounted, hidden when inactive */}
              <div className="w-full h-full overflow-y-auto custom-scrollbar flex flex-col gap-6 pr-1 pb-6 p-1 md:p-6" style={{ display: activeTab === "dashboard" ? "flex" : "none" }}>
                  {isLoadingStations ? (
                    <div className="flex-grow flex flex-col items-center justify-center gap-3">
                      <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm font-bold text-slate-500 uppercase tracking-wider animate-pulse">
                        Loading stations...
                      </p>
                    </div>
                  ) : !selectedStation ? (
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
	                          <div className="flex flex-wrap items-center gap-4 text-sm font-bold text-slate-500 border-l border-slate-100 pl-0 sm:pl-6 pt-3 sm:pt-0">
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
	                            {stationSampling?.intervalLabel && (
	                              <div className="flex flex-col gap-0.5">
	                                <span className="text-slate-400 flex items-center gap-1.5"><Database size={13} /> Freq</span>
	                                <span className="text-slate-800 text-sm">
	                                  {stationSampling.intervalLabel}
	                                  {stationSampling.rangeLimitDays
	                                    ? ` / ${stationSampling.rangeLimitDays} ${stationSampling.rangeLimitDays === 1 ? "day" : "days"}`
	                                    : ""}
	                                </span>
	                              </div>
	                            )}
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

	                          {/* Sub-tab: Plots (always mounted, cached when inactive) */}
	                          <div className={`cached-view ${dashboardSubTab === "plots" ? "is-active" : ""}`}>
	                            <DashboardCharts data={stationLogs} units={stationUnits} />
	                          </div>

                          {/* Sub-tab: Data Table (always mounted, cached when inactive) */}
                          <div 
                            className={`cached-view flex-col gap-3 min-h-[400px] ${dashboardSubTab === "data" ? "is-active" : ""}`}
                          >
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
                                {hasActiveLogData ? (
                                  <WeatherTable
                                    data={stationLogs}
                                    columns={activeLogColumns}
                                    searchPlaceholder="Filter logs by hour or value..."
                                    searchKey="datetime"
                                    defaultSorting={[{ id: "datetime", desc: true }]}
                                  />
                                ) : (
                                  <NoStationDataMessage />
                                )}
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}
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
