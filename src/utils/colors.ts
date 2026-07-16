export const ECMWF_TEMP_PALETTE = [
  { val: -50, color: "#4C4C4C" }, { val: -48, color: "#808080" }, { val: -46, color: "#999999" },
  { val: -44, color: "#B3B3B3" }, { val: -42, color: "#CCCCCC" }, { val: -40, color: "#CC9E86" },
  { val: -38, color: "#C0896B" }, { val: -36, color: "#B67552" }, { val: -34, color: "#975F40" },
  { val: -32, color: "#7C4E34" }, { val: -30, color: "#590099" }, { val: -28, color: "#8000E6" },
  { val: -26, color: "#9933FF" }, { val: -24, color: "#C066FF" }, { val: -22, color: "#D999FF" },
  { val: -20, color: "#FFC0FF" }, { val: -18, color: "#FF97FF" }, { val: -16, color: "#E133E1" },
  { val: -14, color: "#AE33AE" }, { val: -12, color: "#7A337A" }, { val: -10, color: "#0000C0" },
  { val: -8, color: "#0000FF" }, { val: -6, color: "#3366FF" }, { val: -4, color: "#66B3FF" },
  { val: -2, color: "#99E6FF" }, { val: 0, color: "#008C30" }, { val: 2, color: "#26C019" },
  { val: 4, color: "#80D900" }, { val: 6, color: "#A6F300" }, { val: 8, color: "#CCFF33" },
  { val: 10, color: "#FFFF99" }, { val: 12, color: "#FFFF00" }, { val: 14, color: "#FFD900" },
  { val: 16, color: "#FFBD00" }, { val: 18, color: "#FF9E00" }, { val: 20, color: "#FF8000" },
  { val: 22, color: "#FF6000" }, { val: 24, color: "#FF0000" }, { val: 26, color: "#CC0000" },
  { val: 28, color: "#CC3D6E" }, { val: 30, color: "#FF00FF" }, { val: 32, color: "#FF97FF" },
  { val: 34, color: "#D779FF" }, { val: 36, color: "#AE00F9" }, { val: 38, color: "#7D00B3" },
  { val: 40, color: "#975F40" }, { val: 42, color: "#B67552" }, { val: 44, color: "#C0896B" },
  { val: 46, color: "#CC9E86" }, { val: 48, color: "#CCCCCC" }, { val: 50, color: "#B3B3B3" },
  { val: 52, color: "#999999" }, { val: 54, color: "#808080" }, { val: 56, color: "#4C4C4C" }
];

// CMOCEAN Rain (7-stop sequential, light-to-dark for precipitation)
export const ECMWF_PRECIP_PALETTE = [
  { val: 0, color: "#eeedf3" },
  { val: 0.1, color: "#d5c1a8" },
  { val: 1, color: "#91a77d" },
  { val: 5, color: "#3d8e6e" },
  { val: 10, color: "#046b6d" },
  { val: 25, color: "#224359" },
  { val: 50, color: "#221b38" }
];

// Original ECMWF Sea Level Pressure palette
export const ECMWF_PRESSURE_PALETTE = [
  { val: 960, color: "#ff00ff" },
  { val: 965, color: "#ac00e6" },
  { val: 970, color: "#5a00cd" },
  { val: 975, color: "#0800b3" },
  { val: 980, color: "#0047b3" },
  { val: 985, color: "#008edd" },
  { val: 990, color: "#00cdff" },
  { val: 995, color: "#00e695" },
  { val: 1000, color: "#00d900" },
  { val: 1005, color: "#7fde00" },
  { val: 1010, color: "#ccff00" },
  { val: 1015, color: "#ffea00" },
  { val: 1020, color: "#ffaa00" },
  { val: 1025, color: "#ff6600" },
  { val: 1030, color: "#ff3300" },
  { val: 1035, color: "#de0000" },
  { val: 1040, color: "#aa0000" }
];

// Original ECMWF Wind Speed palette
export const ECMWF_WIND_PALETTE = [
  { val: 0, color: "#ffffff" },
  { val: 0.5, color: "#e5f5f9" },
  { val: 2, color: "#ccece6" },
  { val: 4, color: "#99d8c9" },
  { val: 6, color: "#66c2a4" },
  { val: 10, color: "#41ae76" },
  { val: 15, color: "#ffeda0" },
  { val: 20, color: "#feb24c" },
  { val: 25, color: "#f03b20" },
  { val: 30, color: "#bd0026" },
  { val: 40, color: "#7a0177" },
  { val: 50, color: "#4a004a" }
];

const getPaletteForParam = (parameter: string) => {
  if (parameter.includes("temperature")) return ECMWF_TEMP_PALETTE;
  if (parameter.includes("precipitation")) return ECMWF_PRECIP_PALETTE;
  if (parameter.includes("pressure")) return ECMWF_PRESSURE_PALETTE;
  if (parameter.includes("wind")) return ECMWF_WIND_PALETTE;
  return ECMWF_TEMP_PALETTE; // default
};

export const getColorFromPalette = (value: number, parameter: string): string => {
  if (value === null || value === undefined || isNaN(value)) return "#cbd5e1";

  const palette = getPaletteForParam(parameter);

  if (parameter.includes("precipitation")) {
    if (value < 0) return "#F0F0F0";
    const val = Math.max(0, Math.min(50, value));

    let idx = 0;
    for (let i = 0; i < palette.length - 1; i++) {
      if (val >= palette[i].val && val <= palette[i+1].val) {
        idx = i;
        break;
      }
    }
    const start = palette[idx];
    const end = palette[idx + 1];
    
    if (start.val === end.val) return start.color;

    const f = (val - start.val) / (end.val - start.val);

    const hexToRgb = (hex: string) => {
      const r = parseInt(hex.substring(1, 3), 16);
      const g = parseInt(hex.substring(3, 5), 16);
      const b = parseInt(hex.substring(5, 7), 16);
      return [r, g, b];
    };

    const rgbStart = hexToRgb(start.color);
    const rgbEnd = hexToRgb(end.color);

    const r = Math.round(rgbStart[0] + (rgbEnd[0] - rgbStart[0]) * f);
    const g = Math.round(rgbStart[1] + (rgbEnd[1] - rgbStart[1]) * f);
    const b = Math.round(rgbStart[2] + (rgbEnd[2] - rgbStart[2]) * f);

    const rgbToHex = (r: number, g: number, b: number) => {
      return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    };
    return rgbToHex(r, g, b);
  }

  // Step intervals for Temperature, Wind, Pressure
  if (value <= palette[0].val) return palette[0].color;
  if (value >= palette[palette.length - 1].val) return palette[palette.length - 1].color;

  let color = palette[0].color;
  for (let i = 0; i < palette.length; i++) {
    if (value >= palette[i].val) {
      color = palette[i].color;
    } else {
      break;
    }
  }
  return color;
};

export const getLegendStops = (parameter: string) => {
  const palette = [...getPaletteForParam(parameter)];

  return palette.reverse().map(stop => {
    let showLabel = true;
    
    if (parameter.includes("temperature")) {
      showLabel = stop.val % 8 === 0 || stop.val === 0;
    }

    return {
      val: stop.val,
      color: stop.color,
      showLabel
    };
  });
};

export const getUnitForParam = (parameter: string) => {
  if (parameter.includes("temperature")) return "°C";
  if (parameter.includes("precipitation")) return "mm";
  if (parameter.includes("pressure")) return "hPa";
  if (parameter.includes("wind")) return "m/s";
  return "";
};
