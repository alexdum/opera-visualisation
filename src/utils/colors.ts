// OPERA DBZH Palette (Horizontal reflectivity, dBZ - exact MeteoRomania ANM 15-color bar)
export const OPERA_DBZH_PALETTE = [
  { val: 0.12619,   color: "#287490", label: "0" }, // dark teal blue
  { val: 5,   color: "#2899C0" }, // medium teal blue
  { val: 10,  color: "#20BFEF" }, // sky blue cyan
  { val: 15,  color: "#00FF00" }, // bright green ("slab")
  { val: 20,  color: "#00D000" }, // green
  { val: 25,  color: "#00A000" }, // medium green ("moderat")
  { val: 30,  color: "#006000" }, // dark green
  { val: 35,  color: "#FFD000" }, // bright yellow ("abundant")
  { val: 40,  color: "#FF9900" }, // orange
  { val: 45,  color: "#FF0000" }, // red
  { val: 50,  color: "#B00000" }, // dark red
  { val: 55,  color: "#500000" }, // very dark maroon
  { val: 60,  color: "#FF00FF" }, // magenta
  { val: 65,  color: "#9013FE" }, // purple
  { val: 70,  color: "#FF0080" }, // hot pink
];

// OPERA RATE and ACRR Palette (mm/h or mm)
export const OPERA_PRECIP_PALETTE = [
  { val: 0.1,  color: "#00FFFF" },
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
      showLabel: true,
      label: 'label' in stop ? stop.label : undefined
    };
  });
};

export const getUnitForParam = (product: string) => {
  if (product === "DBZH") return "dBZ";
  if (product === "RATE") return "mm/h";
  if (product === "ACRR") return "mm";
  return "";
};
