// OPERA DBZH Palette (Horizontal reflectivity, dBZ)
export const OPERA_DBZH_PALETTE = [
  { val: -5,  color: "#0A82C8" },
  { val: 0,   color: "#0A9BB4" },
  { val: 5,   color: "#0AB9AF" },
  { val: 10,  color: "#05CDAA" },
  { val: 15,  color: "#8CE614" },
  { val: 20,  color: "#F0F014" },
  { val: 25,  color: "#FFCD14" },
  { val: 30,  color: "#FF9632" },
  { val: 35,  color: "#FF503C" },
  { val: 40,  color: "#FA78FF" },
  { val: 45,  color: "#BEFFFF" }
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
