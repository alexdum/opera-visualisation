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

/** Stable identity for the continental texture used during regional zoom transitions. */
export const continentalFrameIdentity = (frame: RadarFrame, minQuality: number | null) =>
  frameIdentity(frame, minQuality, undefined, 1024);

/** Whether a cached crop/resolution belongs to the selected logical radar frame. */
export const isFrameIdentityVariant = (
  identity: string | null,
  frame: RadarFrame,
  minQuality: number | null,
) => {
  if (!identity) return false;
  const baseIdentity = frameIdentity(frame, minQuality);
  return identity === baseIdentity || identity.startsWith(`${baseIdentity}-`);
};

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
  // Level 0: Full Continental view (Zoom < 5.0)
  if (zoom < 5.0 || !bounds) {
    return {
      maxSize: 2048,
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
      maxSize: 2048,
      bboxCoords: OPERA_IMAGE_COORDINATES,
      bboxBounds: OPERA_IMAGE_COORDINATES,
    };
  }

  // Native OPERA COG is 1km resolution (~0.01 degrees).
  // A 1024x1024 pixel image perfectly covers a 10°x10° area at native resolution.
  // By using a large 10°, 20°, or 40° grid, we cover entire countries/regions in a single tile.
  // Panning within this huge tile generates NO new network requests.
  let step = 40.0;
  if (zoom >= 6.0) step = 10.0;
  else if (zoom >= 5.0) step = 20.0;

  const minLon = Math.floor(west / step) * step;
  const minLat = Math.floor(south / step) * step;
  const maxLon = Math.ceil(east / step) * step;
  const maxLat = Math.ceil(north / step) * step;

  // If the bbox crosses a grid line, it might be 20° wide instead of 10°.
  // We scale the requested resolution to maintain the target deg/pixel.
  const lonSpan = maxLon - minLon;
  const latSpan = maxLat - minLat;
  const maxSpan = Math.max(lonSpan, latSpan);
  
  // We target ~100 pixels per degree for full native resolution (1km).
  // At zoom < 5.0 (continental), 40° span uses 2048px (half res) to save VRAM, 
  // because the screen cannot display 4000 pixels anyway.
  // At zoom 5+ (country level), we use 20° or 10° spans with 2048px or 1024px, achieving full 1km resolution.
  let maxSize = 1024;
  if (maxSpan >= 30) maxSize = 2048; // Continental 40° view or large straddle
  else if (maxSpan >= 15) maxSize = 2048; // Regional 20° view (Full Resolution)
  else maxSize = Math.max(1024, Math.round((maxSpan / 10.0) * 1024)); // Local 10° view (Full Resolution)



  const finalMinLon = Math.max(minLon, OPERA_WGS84_BOUNDS[0]);
  const finalMinLat = Math.max(minLat, OPERA_WGS84_BOUNDS[1]);
  const finalMaxLon = Math.min(maxLon, OPERA_WGS84_BOUNDS[2]);
  const finalMaxLat = Math.min(maxLat, OPERA_WGS84_BOUNDS[3]);

  const bboxKey = `${finalMinLon.toFixed(4)},${finalMinLat.toFixed(4)},${finalMaxLon.toFixed(4)},${finalMaxLat.toFixed(4)}`;

  const bboxBounds: [[number, number], [number, number], [number, number], [number, number]] = [
    [finalMinLon, finalMinLat],
    [finalMaxLon, finalMinLat],
    [finalMaxLon, finalMaxLat],
    [finalMinLon, finalMaxLat],
  ];

  const bboxCoords: [[number, number], [number, number], [number, number], [number, number]] = [
    [finalMinLon, finalMaxLat], // NW
    [finalMaxLon, finalMaxLat], // NE
    [finalMaxLon, finalMinLat], // SE
    [finalMinLon, finalMinLat], // SW
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
