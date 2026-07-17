import React from "react";
import { getLegendStops, getUnitForParam } from "@/utils/colors";

interface MapLegendProps {
  parameter: string;
  values?: number[];
}

export const MapLegend: React.FC<MapLegendProps> = ({ parameter, values }) => {
  let stops = getLegendStops(parameter);
  const unit = getUnitForParam(parameter);

  if (values && values.length > 0) {
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);

    let startIndex = stops.findIndex((s: any) => s.val <= maxVal);
    if (startIndex > 0) {
      startIndex -= 1;
    } else if (startIndex === -1) {
      startIndex = 0;
    }
    
    let endIndex = stops.findIndex((s: any) => s.val <= minVal);
    if (endIndex === -1) endIndex = stops.length - 1;

    if (startIndex <= endIndex) {
      stops = stops.slice(startIndex, endIndex + 1);
    }
  }

  return (
    <div className="hidden md:flex absolute bottom-[140px] right-2.5 bg-white/90 backdrop-blur-md p-3.5 pr-12 rounded-xl shadow-lg border border-slate-200 z-10 font-sans text-xs flex-col">
      <div className="font-bold text-slate-700 text-center text-sm border-b border-slate-200 pb-2 mb-2">
        {unit}
      </div>
      <div className="flex flex-col">
        {stops.map((stop: any, i: number) => (
          <div key={i} className="relative flex items-center h-4">
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
