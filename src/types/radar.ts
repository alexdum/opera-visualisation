export type RadarProduct = "DBZH" | "RATE" | "ACRR";

export interface RadarFrame {
  product: RadarProduct;
  timestamp: string;
  nominal_time: string;
  start_time: string | null;
  end_time: string | null;
  revision: string;
  archive_ready: boolean;
  hot_cog_ready: boolean;
  hot_cog: string | null;
  geozarr: string;
  quality_variables: string[];
  backend: "cog" | "geozarr";
}

export interface CatalogResponse {
  schema_version: number;
  product: RadarProduct;
  date: string | null;
  latest_timestamp: string;
  timestamps: string[];
  frames: RadarFrame[];
  archive_ready: boolean;
  hot_cog_ready: boolean;
  hot_window_start: string | null;
}

export type MapRenderStatus = "idle" | "loading" | "ready" | "degraded" | "error";

export interface MapRenderState {
  status: MapRenderStatus;
  message?: string;
  frameKey?: string;
}
