import React, { useMemo } from "react";
import { getLegendStops, getUnitForParam } from "@/utils/colors";

interface MapLegendProps {
  product: string;
}

interface LegendStop {
  val: number;
  color: string;
  showLabel: boolean;
  label?: string;
}

export const MapLegend: React.FC<MapLegendProps> = ({ product }) => {
  const stops = useMemo(() => getLegendStops(product), [product]);
  const unit = getUnitForParam(product);

  return (
    <div className="absolute bottom-8 right-8 bg-slate-800/90 backdrop-blur-md p-3.5 pr-12 rounded-xl shadow-lg border border-slate-700 z-10 font-sans text-xs flex-col text-slate-100">
      <div className="font-bold text-center text-sm border-b border-slate-600 pb-2 mb-2">
        {unit}
      </div>
      <div className="flex flex-col">
        {stops.map((stop: LegendStop, i: number) => (
          <div key={`${stop.val}`} className="relative flex items-center h-4">
            <div
              className="w-7 h-full border-x border-black/40"
              style={{
                backgroundColor: stop.color,
                opacity: 0.9,
                borderTop: i === 0 ? '1px solid rgba(0,0,0,0.4)' : 'none',
                borderBottom: i === stops.length - 1 ? '1px solid rgba(0,0,0,0.4)' : 'none',
              }}
            />
            {stop.showLabel && (
              <span
                className="absolute left-9 font-semibold text-[11px] leading-none min-w-[24px] z-10 text-slate-300"
                style={{ bottom: 0, transform: 'translateY(50%)' }}
              >
                {stop.label !== undefined ? stop.label : stop.val}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
MapLegend.displayName = "MapLegend";
