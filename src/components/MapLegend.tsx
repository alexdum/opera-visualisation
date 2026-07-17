import React, { useMemo } from "react";
import { getLegendStops, getUnitForParam } from "@/utils/colors";

interface MapLegendProps {
  parameter: string;
  values?: number[];
}

export const MapLegend: React.FC<MapLegendProps> = ({ parameter, values }) => {
  const allStops = useMemo(() => getLegendStops(parameter), [parameter]);
  const unit = getUnitForParam(parameter);

  // Clip legend stops to the value range visible on screen
  const stops = useMemo(() => {
    if (!values || values.length === 0) {
      return allStops;
    }

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);


    // stops are sorted HIGH → LOW (reversed palette)
    // Find the range of stops that covers [minVal, maxVal],
    // plus one extra stop on each end for the boundary color blocks.

    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < allStops.length; i++) {
      // First stop whose value is <= maxVal (upper boundary of visible range)
      if (startIndex === -1 && allStops[i].val <= maxVal) {
        startIndex = i;
      }
      // First stop whose value <= minVal (lower boundary of visible range)
      if (endIndex === -1 && allStops[i].val <= minVal) {
        endIndex = i;
      }
    }

    if (startIndex === -1) startIndex = 0;
    if (endIndex === -1) endIndex = allStops.length - 1;

    // Add one extra stop above (lower index = higher value) and below
    startIndex = Math.max(0, startIndex - 1);
    endIndex = Math.min(allStops.length - 1, endIndex + 1);



    if (startIndex <= endIndex) {
      return allStops.slice(startIndex, endIndex + 1);
    }

    return allStops;
  }, [allStops, values, parameter]);

  const isTemperature = parameter.includes("temperature");

  return (
    <div className="hidden md:flex absolute bottom-[140px] right-2.5 bg-white/90 backdrop-blur-md p-3.5 pr-12 rounded-xl shadow-lg border border-slate-200 z-10 font-sans text-xs flex-col">
      <div className="font-bold text-slate-700 text-center text-sm border-b border-slate-200 pb-2 mb-2">
        {unit}
      </div>
      <div className="flex flex-col">
        {stops.map((stop: any, i: number) => (
          <div key={`${stop.val}`} className="relative flex items-center" style={{ height: isTemperature ? '11px' : '16px' }}>
            <div 
              className="w-7 h-full border-x border-black/20" 
              style={{ 
                backgroundColor: stop.color, 
                opacity: 0.9,
                borderTop: i === 0 ? '1px solid rgba(0,0,0,0.2)' : 'none',
                borderBottom: i === stops.length - 1 ? '1px solid rgba(0,0,0,0.2)' : 'none',
              }} 
            />
            {stop.showLabel && (
              <span 
                className="absolute left-9 text-slate-600 font-semibold text-[11px] leading-none min-w-[24px] z-10"
                style={{ bottom: 0, transform: 'translateY(50%)' }}
              >
                {stop.val}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
