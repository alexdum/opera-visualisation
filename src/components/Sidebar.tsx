import React, { useMemo, useState, useRef, useEffect } from "react";
import { 
  Search, 
  Calendar, 
  CloudRain, 
  Thermometer, 
  Wind, 
  Database,
  Info,
  Menu,
  X,
  ChevronDown
} from "lucide-react";
import { countryMatches } from "@/utils/country";

interface Station {
  id: string;
  name: string;
  country: string;
  longitude: number;
  latitude: number;
  elevation: number | null;
  available_params: string;
}

interface SidebarProps {
  stations: Station[];
  selectedCountry: string;
  setSelectedCountry: (country: string) => void;
  selectedStation: string;
  setSelectedStation: (stationId: string) => void;
  startDate: string;
  setStartDate: (date: string) => void;
  endDate: string;
  setEndDate: (date: string) => void;
  parameter: string;
  setParameter: (param: string) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  selectedHour: number;
  observations?: Record<string, number[]>;
}

const FilterLabel = ({
  id,
  label,
  help,
}: {
  id: string;
  label: string;
  help: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      onFocus={() => setIsOpen(true)}
      onBlur={handleBlur}
      className="relative w-full text-sm font-semibold text-slate-500 tracking-wider uppercase flex items-center gap-1.5"
    >
      <span>{label}</span>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsOpen(true);
        }}
        aria-label={`Explain ${label}`}
        aria-expanded={isOpen}
        aria-controls={id}
        className="inline-flex min-h-[24px] min-w-[24px] items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      >
        <Info size={12} />
      </button>
      {isOpen && (
        <div
          id={id}
          role="tooltip"
          className="absolute left-0 top-7 z-[70] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium leading-relaxed text-slate-600 shadow-lg normal-case tracking-normal"
        >
          {help}
        </div>
      )}
    </div>
  );
};

// Custom Searchable Dropdown for Stations
const SearchableStationSelect = ({ 
  stations, 
  selectedStation, 
  setSelectedStation 
}: { 
  stations: Station[], 
  selectedStation: string, 
  setSelectedStation: (id: string) => void 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selected = stations.find(s => s.id === selectedStation);
  
  const filtered = useMemo(() => {
    if (!search) return stations;
    const lower = search.toLowerCase();
    return stations.filter(s => 
      s.name.toLowerCase().includes(lower) || 
      s.id.toLowerCase().includes(lower) ||
      s.country.toLowerCase().includes(lower)
    );
  }, [stations, search]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-white/70 border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 text-base md:text-sm text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer text-left flex items-center justify-between"
      >
        <div className="truncate pr-2">
          {selected ? `${selected.name} (${selected.country})` : <span className="text-slate-400">Select a station...</span>}
        </div>
        <ChevronDown size={15} className={`text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={15} />

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-xl overflow-hidden flex flex-col">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                autoFocus
                type="text"
                placeholder="Search name, ID or country..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-base md:text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
            </div>
          </div>
          <div className="max-h-[250px] overflow-y-auto custom-scrollbar p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-400">No stations found</div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStation("");
                    setIsOpen(false);
                    setSearch("");
                  }}
                  className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                    !selectedStation ? "bg-blue-50 text-blue-700 font-bold" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Clear Selection
                </button>
                {filtered.map(st => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => {
                      setSelectedStation(st.id);
                      setIsOpen(false);
                      setSearch("");
                    }}
                    className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                      selectedStation === st.id ? "bg-blue-50 text-blue-700 font-bold" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div className="truncate font-medium">{st.name}</div>
                    <div className="text-xs text-slate-400 flex justify-between">
                      <span>{st.id}</span>
                      <span>{st.country}</span>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  stations,
  selectedCountry,
  setSelectedCountry,
  selectedStation,
  setSelectedStation,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  parameter,
  setParameter,
  isOpen,
  setIsOpen,
  selectedHour,
  observations
}) => {
  // Extract unique countries sorted alphabetically
  const countries = useMemo(() => {
    const unique = new Set(stations.map(st => st.country).filter(Boolean));
    return Array.from(unique).sort();
  }, [stations]);

  // Filter stations based on selected country for the station dropdown
  const filteredStations = useMemo(() => {
    if (!selectedCountry) return stations;
    return stations.filter(st => countryMatches(st.country, selectedCountry));
  }, [stations, selectedCountry]);

  // Count stations that have actual valid observations for the selected hour
  const activeCount = useMemo(() => {
    if (!observations || Object.keys(observations).length === 0) {
      return filteredStations.length;
    }
    let count = 0;
    filteredStations.forEach((st) => {
      const val = observations[st.id]?.[selectedHour];
      if (val !== undefined && val !== null && !isNaN(val)) {
        count++;
      }
    });
    return count;
  }, [filteredStations, observations, selectedHour]);

  const hoursAgo = useMemo(() => {
    const selectedDateStr = `${endDate}T${selectedHour.toString().padStart(2, "0")}:00:00Z`;
    const selectedTime = new Date(selectedDateStr).getTime();
    const now = new Date().getTime();
    const diff = now - selectedTime;
    return Math.max(0, Math.floor(diff / (1000 * 60 * 60)));
  }, [endDate, selectedHour]);

  // Date range constraints (max 31 days)
  const handleStartDateChange = (newStart: string) => {
    setStartDate(newStart);
    const startObj = new Date(newStart);
    const endObj = new Date(endDate);
    
    // Auto-adjust end date if range exceeds 31 days
    if (endObj.getTime() - startObj.getTime() > 31 * 24 * 60 * 60 * 1000) {
      const newEnd = new Date(startObj.getTime() + 31 * 24 * 60 * 60 * 1000);
      // Ensure we don't set future dates
      const maxDate = new Date();
      if (newEnd > maxDate) {
        setEndDate(maxDate.toISOString().split("T")[0]);
      } else {
        setEndDate(newEnd.toISOString().split("T")[0]);
      }
    } else if (startObj > endObj) {
      setEndDate(newStart);
    }
  };

  const handleEndDateChange = (newEnd: string) => {
    setEndDate(newEnd);
    const startObj = new Date(startDate);
    const endObj = new Date(newEnd);
    
    // Auto-adjust start date if range exceeds 31 days
    if (endObj.getTime() - startObj.getTime() > 31 * 24 * 60 * 60 * 1000) {
      const newStart = new Date(endObj.getTime() - 31 * 24 * 60 * 60 * 1000);
      setStartDate(newStart.toISOString().split("T")[0]);
    } else if (startObj > endObj) {
      setStartDate(newEnd);
    }
  };

  return (
    <>
      {/* Mobile Toggle Button */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2.5 bg-white/90 backdrop-blur-md border border-slate-200 rounded-xl shadow-md text-slate-700 hover:text-slate-900 transition-all active:scale-95 min-w-[44px] min-h-[44px] flex items-center justify-center"
        aria-label="Toggle navigation menu"
      >
        {isOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Sidebar Container */}
      <aside 
        className={`fixed top-0 left-0 z-40 h-full w-[280px] glass-sidebar flex flex-col justify-between p-6 transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header Branding */}
        <div className="flex flex-col gap-1 mt-10 lg:mt-2">
          <h2 className="text-lg font-bold tracking-tight text-slate-800">
            Filters
          </h2>
        </div>

        {/* Scrollable Filters Block */}
        <div className="flex-1 my-6 overflow-y-auto custom-scrollbar pr-1 flex flex-col gap-6">
          {/* Zoom to Country */}
          <div className="flex flex-col gap-2">
            <FilterLabel
              id="filter-help-country"
              label="Zoom to Country"
              help="Filters the station list to the selected country and moves the map to that country's station area. All Countries shows every available station."
            />
            <div className="relative">
              <select
                value={selectedCountry}
                onChange={(e) => {
                  setSelectedCountry(e.target.value);
                  setSelectedStation(""); // Reset station on country change
                }}
                className="w-full bg-white/70 border border-slate-200 rounded-xl px-3.5 py-2.5 text-base md:text-sm text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer appearance-none"
              >
                <option value="">All Countries</option>
                {countries.map((country) => (
                  <option key={country} value={country}>
                    {country}
                  </option>
                ))}
              </select>
              <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-400 w-0 h-0" />
            </div>
          </div>

          {/* Find Station */}
          <div className="flex flex-col gap-2">
            <FilterLabel
              id="filter-help-station"
              label="Find Station"
              help="Searches by station name, WIGOS ID, or country. Selecting a station focuses it on the map and loads its detailed observation dashboard."
            />
            <SearchableStationSelect 
              stations={filteredStations} 
              selectedStation={selectedStation} 
              setSelectedStation={setSelectedStation} 
            />
          </div>

          {/* Date Picker Range */}
          <div className="flex flex-col gap-2">
            <FilterLabel
              id="filter-help-period"
              label="Select Period"
              help="Sets the observation date range used for station logs, charts, and map values. The range is limited to 31 days and cannot go into the future."
            />
            <div className="flex flex-col gap-2">
              <div className="relative">
                <input
                  type="date"
                  value={startDate}
                  min="2026-03-05"
                  max={endDate || new Date().toISOString().split("T")[0]}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className="w-full bg-white/70 border border-slate-200 rounded-xl pl-9 pr-3.5 py-2 text-base md:text-sm text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer"
                />
                <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              </div>
              <div className="relative">
                <input
                  type="date"
                  value={endDate}
                  min={startDate || "2026-03-05"}
                  max={new Date().toISOString().split("T")[0]}
                  onChange={(e) => handleEndDateChange(e.target.value)}
                  className="w-full bg-white/70 border border-slate-200 rounded-xl pl-9 pr-3.5 py-2 text-base md:text-sm text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer"
                />
                <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              </div>
            </div>
          </div>

          {/* Weather Parameter Selector */}
          <div className="flex flex-col gap-2">
            <FilterLabel
              id="filter-help-parameter"
              label="Map Parameter"
              help="Chooses the weather variable shown by marker colors on the map. From the Dashboard, selecting a parameter returns to the initial broad Map View so the spatial distribution is visible."
            />
            <div className="flex flex-col gap-1.5">
              {[
                { id: "air_temperature", label: "Air Temperature", icon: Thermometer, color: "text-rose-500 bg-rose-50 border-rose-100" },
                { id: "precipitation_amount", label: "Precipitation", icon: CloudRain, color: "text-blue-500 bg-blue-50 border-blue-100" },
                { id: "air_pressure_at_mean_sea_level", label: "Sea Level Pressure", icon: Database, color: "text-emerald-500 bg-emerald-50 border-emerald-100" },
                { id: "wind_speed", label: "Wind Speed", icon: Wind, color: "text-amber-500 bg-amber-50 border-amber-100" }
              ].map((item) => {
                const Icon = item.icon;
                const isSelected = parameter === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setParameter(item.id)}
                    className={`flex items-center gap-3 px-3.5 py-3 rounded-xl border text-sm font-medium transition-all text-left w-full cursor-pointer ${
                      isSelected 
                        ? `${item.color} shadow-sm border-blue-200 ring-2 ring-blue-500/10` 
                        : "border-slate-100 hover:border-slate-200 hover:bg-slate-50 text-slate-600"
                    }`}
                  >
                    <Icon size={18} className={isSelected ? "" : "text-slate-400"} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer info & stats */}
        <div className="border-t border-slate-100 pt-4 flex flex-col gap-3">
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex flex-col gap-1.5 text-sm font-medium text-slate-600">
            <div><span className="font-bold text-slate-800">{stations.length}</span> stations found</div>
            <div className="text-blue-600 font-semibold border-b border-slate-200 pb-2 mb-1">Showing: {activeCount} stations</div>
            <div className="text-slate-800 font-bold">{endDate} {selectedHour.toString().padStart(2, "0")}:00 UTC</div>
            <div className="text-slate-500 text-xs">{hoursAgo} hour(s) ago</div>
          </div>

          <div className="bg-blue-50/50 border border-blue-100/50 rounded-xl p-3 flex gap-2 items-start text-xs font-medium text-slate-600">
            <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
            <p>Tip: Click map points to view detailed weather plots.</p>
          </div>
        </div>
      </aside>

      {/* Backdrop overlay for mobile */}
      {isOpen && (
        <div 
          onClick={() => setIsOpen(false)}
          className="lg:hidden fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-30 transition-opacity" 
        />
      )}
    </>
  );
};
