import type { RadarFrame, RadarProduct } from "@/types/radar";

export const OPERA_WGS84_BOUNDS: [number, number, number, number] = [-39.552438, 31.749398, 57.81137, 73.931257];

export const OPERA_IMAGE_COORDINATES: [[number, number], [number, number], [number, number], [number, number]] = [
  [-39.552438, 73.931257],  // top-left
  [57.81137, 73.931257],    // top-right
  [57.81137, 31.749398],    // bottom-right
  [-39.552438, 31.749398],  // bottom-left
];

const DEFAULT_PRODUCT_CADENCE_MS: Record<RadarProduct, number> = {
  DBZH: 5 * 60_000,
  RATE: 15 * 60_000,
  ACRR: 15 * 60_000,
};

const greatestCommonDivisor = (left: number, right: number): number =>
  right === 0 ? left : greatestCommonDivisor(right, left % right);

/**
 * Infer the native publication cadence from cataloged frames. Missing frames
 * produce multiples of the cadence, so their greatest common divisor retains
 * the native step. The product default covers empty and single-frame catalogs.
 */
export const inferRadarCadenceMs = (frames: readonly RadarFrame[], product: RadarProduct) => {
  const timestamps = frames
    .map((frame) => Date.parse(frame.nominal_time))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const differences = timestamps
    .slice(1)
    .map((timestamp, index) => timestamp - timestamps[index])
    .filter((difference) => difference > 0);

  return differences.length > 0
    ? differences.reduce(greatestCommonDivisor)
    : DEFAULT_PRODUCT_CADENCE_MS[product];
};

export const formatRadarCadence = (cadenceMs: number) => {
  const minutes = cadenceMs / 60_000;
  if (minutes < 1) return `${Math.round(cadenceMs / 1_000)} sec`;
  if (minutes < 60) return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`;
};

export interface MapStyleLayerLike {
  id: string;
  type?: string;
}

export const isAdministrativeBoundaryLayer = (layer: MapStyleLayerLike) =>
  layer.type === "line" && /(?:admin|boundary|border)/i.test(layer.id);

export const isPlaceLabelLayer = (layer: MapStyleLayerLike) =>
  layer.type === "symbol" || /label/i.test(layer.id);

export const radarOverlayInsertionIndex = (layers: readonly MapStyleLayerLike[]) => {
  const overlayIndex = layers.findIndex(
    (layer) => isAdministrativeBoundaryLayer(layer) || isPlaceLabelLayer(layer),
  );
  return overlayIndex < 0 ? layers.length : overlayIndex;
};

export const radarOverlayBeforeId = (layers: readonly MapStyleLayerLike[]) =>
  layers[radarOverlayInsertionIndex(layers)]?.id;

export const qualityKeyForProduct = (product: RadarProduct, minQuality: number | null) =>
  product === "DBZH" ? (minQuality === null ? "off" : minQuality.toFixed(2)) : "off";

export const frameIdentity = (frame: RadarFrame, minQuality: number | null, bbox?: string, maxSize?: number) =>
  `${frame.product}-${frame.timestamp}-${frame.revision}-${frame.backend}-${qualityKeyForProduct(frame.product, minQuality)}${bbox ? `-${bbox}` : ""}${maxSize ? `-m${maxSize}` : ""}`;

export const tileLoadTimeoutMs = (frame: RadarFrame) =>
  frame.backend === "geozarr" ? 35_000 : 10_000;

export const selectAnimationFrames = (frames: RadarFrame[], currentIndex: number) => {
  const current = frames[currentIndex];
  if (!current) return [];

  const next = frames[currentIndex + 1];
  // COGs are cheap to preload and make recent animation smoother. Historical
  // GeoZarr tiles require remote chunk reads and reprojection per tile, so
  // preloading a hidden archive frame doubles renderer pressure and can starve
  // the frame the user is actually viewing.
  return current.backend === "cog" && next?.backend === "cog"
    ? [current, next]
    : [current];
};

export const buildTileUrl = (
  frame: RadarFrame,
  minQuality: number | null,
  apiBase = "",
) => {
  const quality = qualityKeyForProduct(frame.product, minQuality);
  const normalizedBase = apiBase.replace(/\/$/, "");
  return `${normalizedBase}/tiles/${encodeURIComponent(frame.product)}/${frame.timestamp}/${encodeURIComponent(frame.revision)}/{z}/{x}/{y}.webp?min_quality=${encodeURIComponent(quality)}&source=${encodeURIComponent(frame.backend)}`;
};

/** Build the URL for a full-frame image (single image per timestep). */
export const buildFrameUrl = (
  frame: RadarFrame,
  minQuality: number | null,
  apiBase = "",
  bbox?: { west: number; south: number; east: number; north: number },
) => {
  const quality = qualityKeyForProduct(frame.product, minQuality);
  const normalizedBase = apiBase.replace(/\/$/, "");
  let url = `${normalizedBase}/tiles/frame/${encodeURIComponent(frame.product)}/${frame.timestamp}/${encodeURIComponent(frame.revision)}.webp?min_quality=${encodeURIComponent(quality)}&source=${encodeURIComponent(frame.backend)}`;
  if (bbox) {
    url += `&bbox=${bbox.west.toFixed(4)},${bbox.south.toFixed(4)},${bbox.east.toFixed(4)},${bbox.north.toFixed(4)}`;
  }
  return url;
};

export const parseQualityUrlValue = (value: string | null): number | null | undefined => {
  if (value === null) return undefined;
  if (value === "off") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined;
};

export interface EuropeanScalePyramid {
  bboxKey?: string;
  maxSize: number;
  bboxCoords: [[number, number], [number, number], [number, number], [number, number]];
  bboxBounds: [[number, number], [number, number], [number, number], [number, number]];
}

export const getEuropeanScalePyramid = (
  zoom: number,
  bounds?: { getWest: () => number; getSouth: () => number; getEast: () => number; getNorth: () => number },
  viewport?: { width: number; height: number },
): EuropeanScalePyramid => {
  // Level 0: Full Continental view (Zoom < 6.0)
  if (zoom < 6.0 || !bounds) {
    return {
      maxSize: 1024,
      bboxCoords: OPERA_IMAGE_COORDINATES,
      bboxBounds: OPERA_IMAGE_COORDINATES,
    };
  }

  let west = bounds.getWest();
  let south = bounds.getSouth();
  let east = bounds.getEast();
  let north = bounds.getNorth();

  // Clamp to OPERA bounds
  west = Math.max(west, OPERA_WGS84_BOUNDS[0]);
  south = Math.max(south, OPERA_WGS84_BOUNDS[1]);
  east = Math.min(east, OPERA_WGS84_BOUNDS[2]);
  north = Math.min(north, OPERA_WGS84_BOUNDS[3]);

  if (west >= east || south >= north) {
    return {
      maxSize: 1024,
      bboxCoords: OPERA_IMAGE_COORDINATES,
      bboxBounds: OPERA_IMAGE_COORDINATES,
    };
  }

  // Level 1: Country / Regional scale (Zoom 6.0 - 8.0) -> 0.5° grid snapping (~2.5km)
  // Level 2: High-res local scale (Zoom >= 8.0) -> 0.25° grid snapping (~1km native COG)
  const step = zoom >= 8.0 ? 0.25 : 0.5;
  const viewportPixels = Math.max(viewport?.width ?? 0, viewport?.height ?? 0);
  const baseSize = zoom >= 8.0 ? 1536 : 1024;
  const maximumSize = zoom >= 8.0 ? 2048 : 1536;
  const maxSize = Math.min(
    maximumSize,
    Math.max(baseSize, Math.ceil(viewportPixels / 256) * 256),
  );

  const minLon = Math.floor(west / step) * step;
  const minLat = Math.floor(south / step) * step;
  const maxLon = Math.ceil(east / step) * step;
  const maxLat = Math.ceil(north / step) * step;

  const bboxKey = `${minLon.toFixed(2)},${minLat.toFixed(2)},${maxLon.toFixed(2)},${maxLat.toFixed(2)}`;

  const bboxBounds: [[number, number], [number, number], [number, number], [number, number]] = [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
  ];

  const bboxCoords: [[number, number], [number, number], [number, number], [number, number]] = [
    [minLon, maxLat], // NW
    [maxLon, maxLat], // NE
    [maxLon, minLat], // SE
    [minLon, minLat], // SW
  ];

  return {
    bboxKey,
    maxSize,
    bboxCoords,
    bboxBounds,
  };
};

export const buildRawFrameUrl = (
  frame: RadarFrame,
  apiBase = "",
  bbox?: string,
  maxSize?: number,
  allowArchiveFallback = true,
) => {
  const normalizedBase = apiBase.replace(/\/$/, "");
  let url = `${normalizedBase}/tiles/raw/${encodeURIComponent(frame.product)}/${frame.timestamp}/${encodeURIComponent(frame.revision)}.bin?source=${encodeURIComponent(frame.backend)}`;
  if (maxSize) url += `&max_size=${maxSize}`;
  if (bbox) url += `&bbox=${encodeURIComponent(bbox)}`;
  if (!allowArchiveFallback) url += "&allow_archive_fallback=false";
  return url;
};
