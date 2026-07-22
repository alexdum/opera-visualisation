import type { RadarFrame, RadarProduct } from "@/types/radar";

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

export const frameIdentity = (frame: RadarFrame, minQuality: number | null) =>
  `${frame.product}-${frame.timestamp}-${frame.revision}-${qualityKeyForProduct(frame.product, minQuality)}`;

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

export const buildRawFrameUrl = (
  frame: RadarFrame,
  apiBase = "",
) => {
  const normalizedBase = apiBase.replace(/\/$/, "");
  return `${normalizedBase}/tiles/raw/frame/${encodeURIComponent(frame.product)}/${frame.timestamp}/${encodeURIComponent(frame.revision)}.bin?source=${encodeURIComponent(frame.backend)}`;
};
