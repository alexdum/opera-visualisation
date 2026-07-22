// OPERA DBZH Palette (Horizontal reflectivity, dBZ - NOAA NWS standard 24-step)
export const OPERA_DBZH_PALETTE = [
  { val: -35, color: "#E6E6E6" },
  { val: -30, color: "#CCCCCC" },
  { val: -25, color: "#B3B3B3" },
  { val: -20, color: "#999999" },
  { val: -15, color: "#808080" },
  { val: -10, color: "#666666" },
  { val: -5,  color: "#333333" },
  { val: 0,   color: "#0A0A5C" },
  { val: 5,   color: "#1C1C8C" },
  { val: 10,  color: "#3333BC" },
  { val: 15,  color: "#5252DC" },
  { val: 20,  color: "#4DED4D" },
  { val: 25,  color: "#32C832" },
  { val: 30,  color: "#1E961E" },
  { val: 35,  color: "#0F5E0F" },
  { val: 40,  color: "#FFE040" },
  { val: 45,  color: "#FFA81C" },
  { val: 50,  color: "#E10000" },
  { val: 55,  color: "#A00000" },
  { val: 60,  color: "#5A0000" },
  { val: 65,  color: "#C850C8" },
  { val: 70,  color: "#961E96" },
  { val: 75,  color: "#E6E6E6" },
  { val: 80,  color: "#4B4B4B" },
  { val: 85,  color: "#303030" },
];

// OPERA RATE and ACRR Palette (mm/h or mm)
export const OPERA_PRECIP_PALETTE = [
  { val: 0.1, color: "#00FFFF" },
  { val: 0.5, color: "#00AAFF" },
  { val: 1,   color: "#0055FF" },
  { val: 2,   color: "#0000FF" },
  { val: 5,   color: "#00FF00" },
  { val: 10,  color: "#00AA00" },
  { val: 20,  color: "#005500" },
  { val: 50,  color: "#FFFF00" },
  { val: 100, color: "#FFaa00" },
  { val: 200, color: "#FF0000" },
  { val: 300, color: "#AA0000" }
];

const getPaletteForParam = (product: string) => {
  if (product === "DBZH") return OPERA_DBZH_PALETTE;
  if (product === "RATE" || product === "ACRR") return OPERA_PRECIP_PALETTE;
  return OPERA_DBZH_PALETTE;
};

export const getColorFromPalette = (value: number, product: string): string => {
  if (value === null || value === undefined || isNaN(value)) return "transparent";

  const palette = getPaletteForParam(product);

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

export const getLegendStops = (product: string) => {
  const palette = [...getPaletteForParam(product)];

  return palette.reverse().map(stop => {
    return {
      val: stop.val,
      color: stop.color,
      showLabel: true
    };
  });
};

export const getUnitForParam = (product: string) => {
  if (product === "DBZH") return "dBZ";
  if (product === "RATE") return "mm/h";
  if (product === "ACRR") return "mm";
  return "";
};
