import React, { useMemo } from "react";
import { 
  Globe, 
  Search, 
  Calendar, 
  CloudRain, 
  Thermometer, 
  Wind, 
  Database,
  Info,
  Menu,
  X
} from "lucide-react";

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
}

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
  setIsOpen
}) => {
  // Extract unique countries sorted alphabetically
  const countries = useMemo(() => {
    const unique = new Set(stations.map(st => st.country).filter(Boolean));
    return Array.from(unique).sort();
  }, [stations]);

  // Filter stations based on selected country for the station dropdown
  const filteredStations = useMemo(() => {
    if (!selectedCountry) return stations;
    return stations.filter(st => st.country === selectedCountry);
  }, [stations, selectedCountry]);

  // Count filtered stations
  const activeCount = filteredStations.length;

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
        className={`fixed top-0 left-0 z-40 h-full w-[310px] glass-sidebar flex flex-col justify-between p-6 transition-transform duration-300 ease-in-out lg:translate-x-0 ${
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
            <label className="text-sm font-semibold text-slate-500 tracking-wider uppercase flex items-center gap-1.5">
              Zoom to Country
              <div className="group relative" title="Select a country to filter the station list and zoom the map.">
                <Info size={12} className="text-slate-400 cursor-help" />
              </div>
            </label>
            <div className="relative">
              <select
                value={selectedCountry}
                onChange={(e) => {
                  setSelectedCountry(e.target.value);
                  setSelectedStation(""); // Reset station on country change
                }}
                className="w-full bg-white/70 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer appearance-none"
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
            <label className="text-sm font-semibold text-slate-500 tracking-wider uppercase flex items-center gap-1.5">
              Find Station
            </label>
            <div className="relative">
              <select
                value={selectedStation}
                onChange={(e) => setSelectedStation(e.target.value)}
                className="w-full bg-white/70 border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 text-sm text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer appearance-none"
              >
                <option value="">Select a station...</option>
                {filteredStations.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name} ({st.country})
                  </option>
                ))}
              </select>
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-400 w-0 h-0" />
            </div>
          </div>

          {/* Date Picker Range */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-500 tracking-wider uppercase flex items-center gap-1.5">
              Select Period
            </label>
            <div className="flex flex-col gap-2">
              <div className="relative">
                <input
                  type="date"
                  value={startDate}
                  min="2026-03-05"
                  max={endDate || new Date().toISOString().split("T")[0]}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className="w-full bg-white/70 border border-slate-200 rounded-xl pl-9 pr-3.5 py-2 text-sm text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer"
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
                  className="w-full bg-white/70 border border-slate-200 rounded-xl pl-9 pr-3.5 py-2 text-sm text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer"
                />
                <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              </div>
            </div>
          </div>

          {/* Weather Parameter Selector */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-500 tracking-wider uppercase flex items-center gap-1.5">
              Map Parameter
            </label>
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
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex flex-col gap-1 text-xs font-medium text-slate-500">
            <div className="flex justify-between">
              <span>Active Stations:</span>
              <span className="font-bold text-slate-800">{activeCount}</span>
            </div>
            <div className="flex justify-between">
              <span>Total in Domain:</span>
              <span className="text-slate-600">{stations.length}</span>
            </div>
          </div>

          <div className="text-xs text-slate-400 font-medium leading-relaxed">
            Data Source: <span className="font-semibold text-slate-500">MeteoGate / E-SOH</span>
            <br />
            Includes: Temperature, Precip, Wind, Pressure.
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
