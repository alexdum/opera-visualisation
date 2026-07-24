import { describe, expect, it } from "vitest";

import type { RadarFrame } from "@/types/radar";
import {
  buildTileUrl,
  buildRawFrameUrl,
  continentalFrameIdentity,
  frameIdentity,
  formatRadarCadence,
  inferRadarCadenceMs,
  getEuropeanScalePyramid,
  isFrameIdentityVariant,
  parseQualityUrlValue,
  radarOverlayBeforeId,
  radarOverlayInsertionIndex,
  selectAnimationFrames,
  tileLoadTimeoutMs,
} from "@/utils/radar";


const makeFrame = (product: RadarFrame["product"], timestamp: string, revision: string): RadarFrame => ({
  product,
  timestamp,
  nominal_time: "2026-07-21T00:00:00Z",
  start_time: null,
  end_time: null,
  revision,
  archive_ready: true,
  hot_cog_ready: true,
  hot_cog: `hot-cog/${product}/frame.tif`,
  geozarr: `geozarr/${product}/2026/2026-07.zarr`,
  quality_variables: [`${product}_quality_qi_total`],
  backend: "cog",
});

describe("radar tile identity", () => {
  it("separates raw and filtered DBZH cache identities", () => {
    const frame = makeFrame("DBZH", "202607210000", "revision");
    expect(frameIdentity(frame, null)).not.toBe(frameIdentity(frame, 0.1));
    expect(buildTileUrl(frame, null)).toContain("min_quality=off");
    expect(buildTileUrl(frame, 0.1)).toContain("min_quality=0.10");
  });

  it("does not apply the DBZH threshold to RATE", () => {
    const frame = makeFrame("RATE", "202607210000", "revision");
    expect(buildTileUrl(frame, 0.1)).toContain("min_quality=off");
  });

  it("targets FastAPI rather than the Next development server", () => {
    const frame = makeFrame("RATE", "202607210000", "revision");
    expect(buildTileUrl(frame, null, "http://localhost:7860")).toBe(
      "http://localhost:7860/tiles/RATE/202607210000/revision/{z}/{x}/{y}.webp?min_quality=off&source=cog",
    );
  });

  it("includes the catalog-selected archive backend in historical tile URLs", () => {
    const frame = { ...makeFrame("DBZH", "202607210000", "revision"), backend: "geozarr" as const };
    expect(buildTileUrl(frame, null)).toContain("source=geozarr");
  });

  it("separates COG and GeoZarr cache identities", () => {
    const cog = makeFrame("DBZH", "202607210000", "revision");
    const archive = { ...cog, backend: "geozarr" as const };
    expect(frameIdentity(cog, 0.1)).not.toBe(frameIdentity(archive, 0.1));
  });

  it("can forbid archive fallback for a hidden COG preload", () => {
    const frame = makeFrame("DBZH", "202607210000", "revision");
    expect(buildRawFrameUrl(frame, "", undefined, 1024, false)).toContain("allow_archive_fallback=false");
  });

  it("versions immutable raw renders so renderer changes bypass browser caches", () => {
    const frame = makeFrame("DBZH", "202607210000", "revision");
    expect(buildRawFrameUrl(frame)).toContain("render_version=3");
  });

  it("uses the actual continental request size as its reusable fallback identity", () => {
    const frame = makeFrame("DBZH", "202607210000", "revision");
    const continental = continentalFrameIdentity(frame, null);

    expect(continental).toBe(frameIdentity(frame, null, undefined, 1024));
    expect(isFrameIdentityVariant(continental, frame, null)).toBe(true);
    expect(isFrameIdentityVariant(frameIdentity(frame, null, "20.00,43.00,31.50,49.00", 1536), frame, null)).toBe(true);
    expect(isFrameIdentityVariant(continental, { ...frame, timestamp: "202607210005" }, null)).toBe(false);
  });
});

describe("zoom-aware radar resolution", () => {
  const bounds = {
    getWest: () => 5.12,
    getSouth: () => 45.12,
    getEast: () => 14.88,
    getNorth: () => 54.88,
  };

  it("uses the fast continental texture below zoom 6", () => {
    const pyramid = getEuropeanScalePyramid(5.99, bounds, { width: 2000, height: 1400 });
    expect(pyramid.bboxKey).toBe("0.0000,40.0000,20.0000,60.0000");
    expect(pyramid.maxSize).toBe(2048);
  });

  it("snaps regional requests and sizes them for device pixels", () => {
    const pyramid = getEuropeanScalePyramid(6, bounds, { width: 1300, height: 900 });
    expect(pyramid.bboxKey).toBe("0.0000,40.0000,20.0000,60.0000");
    expect(pyramid.maxSize).toBe(2048);
  });

  it("caps high-resolution local requests at the backend limit", () => {
    const pyramid = getEuropeanScalePyramid(8, bounds, { width: 3000, height: 2000 });
    expect(pyramid.bboxKey).toBe("0.0000,40.0000,20.0000,60.0000");
    expect(pyramid.maxSize).toBe(2048);
  });
});

describe("bounded animation window", () => {
  it("keeps only current and next frames", () => {
    const frames = [
      makeFrame("DBZH", "202607210000", "a"),
      makeFrame("DBZH", "202607210005", "b"),
      makeFrame("DBZH", "202607210010", "c"),
    ];
    expect(selectAnimationFrames(frames, 0)).toEqual(frames.slice(0, 2));
    expect(selectAnimationFrames(frames, 2)).toEqual([frames[2]]);
  });

  it("does not preload hidden GeoZarr archive frames", () => {
    const frames = [
      { ...makeFrame("DBZH", "202607200000", "a"), backend: "geozarr" as const },
      { ...makeFrame("DBZH", "202607200005", "b"), backend: "geozarr" as const },
    ];
    expect(selectAnimationFrames(frames, 0)).toEqual([frames[0]]);
  });

  it("does not preload GeoZarr when crossing the hot-cache boundary", () => {
    const frames = [
      makeFrame("DBZH", "202607200000", "a"),
      { ...makeFrame("DBZH", "202607200005", "b"), backend: "geozarr" as const },
    ];
    expect(selectAnimationFrames(frames, 0)).toEqual([frames[0]]);
  });

  it("allows archive rendering more time than hot COG rendering", () => {
    const cog = makeFrame("DBZH", "202607200000", "a");
    const geozarr = { ...cog, backend: "geozarr" as const };
    expect(tileLoadTimeoutMs(cog)).toBe(10_000);
    expect(tileLoadTimeoutMs(geozarr)).toBe(35_000);
  });
});

describe("product-aware timeline cadence", () => {
  const frameAt = (product: RadarFrame["product"], nominalTime: string) => ({
    ...makeFrame(product, nominalTime.replace(/\D/g, "").slice(0, 12), nominalTime),
    nominal_time: nominalTime,
  });

  it("infers DBZH's five-minute native step", () => {
    const frames = [
      frameAt("DBZH", "2026-07-21T00:00:00Z"),
      frameAt("DBZH", "2026-07-21T00:05:00Z"),
      frameAt("DBZH", "2026-07-21T00:10:00Z"),
    ];
    expect(inferRadarCadenceMs(frames, "DBZH")).toBe(5 * 60_000);
    expect(formatRadarCadence(inferRadarCadenceMs(frames, "DBZH"))).toBe("5 min");
  });

  it("retains RATE's native step when a catalog frame is missing", () => {
    const frames = [
      frameAt("RATE", "2026-07-21T00:00:00Z"),
      frameAt("RATE", "2026-07-21T00:15:00Z"),
      frameAt("RATE", "2026-07-21T00:45:00Z"),
    ];
    expect(inferRadarCadenceMs(frames, "RATE")).toBe(15 * 60_000);
  });

  it("uses the product default when only one ACRR frame is available", () => {
    expect(inferRadarCadenceMs([frameAt("ACRR", "2026-07-21T00:00:00Z")], "ACRR")).toBe(15 * 60_000);
  });
});

describe("shareable quality URL", () => {
  it("accepts off and normalized finite thresholds", () => {
    expect(parseQualityUrlValue("off")).toBeNull();
    expect(parseQualityUrlValue("0.10")).toBe(0.1);
    expect(parseQualityUrlValue("1")).toBe(1);
  });

  it("ignores invalid values", () => {
    expect(parseQualityUrlValue("-1")).toBeUndefined();
    expect(parseQualityUrlValue("nan")).toBeUndefined();
    expect(parseQualityUrlValue(null)).toBeUndefined();
  });
});

describe("radar map layer ordering", () => {
  it("inserts radar above the basemap but below administrative boundaries and labels", () => {
    const layers = [
      { id: "background", type: "background" },
      { id: "land", type: "fill" },
      { id: "roads", type: "line" },
      { id: "boundary_country", type: "line" },
      { id: "place_label_city", type: "symbol" },
    ];
    expect(radarOverlayInsertionIndex(layers)).toBe(3);
    expect(radarOverlayBeforeId(layers)).toBe("boundary_country");
  });

  it("uses the first symbol label when a style has no named administrative boundary", () => {
    const layers = [
      { id: "background", type: "background" },
      { id: "roads", type: "line" },
      { id: "cities", type: "symbol" },
    ];
    expect(radarOverlayBeforeId(layers)).toBe("cities");
  });

  it("falls back to the style top when no reference overlays exist", () => {
    const layers = [
      { id: "background", type: "background" },
      { id: "land", type: "fill" },
    ];
    expect(radarOverlayInsertionIndex(layers)).toBe(layers.length);
    expect(radarOverlayBeforeId(layers)).toBeUndefined();
  });
});
