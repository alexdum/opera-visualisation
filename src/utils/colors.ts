// OPERA DBZH Palette (Horizontal reflectivity, dBZ - MeteoRomania ANM scale)
export const OPERA_DBZH_PALETTE = [
  { val: -5,  color: "#6482A0" },
  { val: 0,   color: "#00ECEC" },
  { val: 15,  color: "#00A0F0" },
  { val: 20,  color: "#0000F0" },
  { val: 25,  color: "#00FF00" },
  { val: 30,  color: "#00C000" },
  { val: 35,  color: "#008000" },
  { val: 40,  color: "#FFFF00" },
  { val: 45,  color: "#FF8000" },
  { val: 50,  color: "#FF0000" },
  { val: 55,  color: "#C00000" },
  { val: 60,  color: "#FF00FF" },
  { val: 65,  color: "#990099" },
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
