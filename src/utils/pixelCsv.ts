import type { RadarProduct } from "@/types/radar";
import type { PixelObservation } from "@/utils/pixelTimeline";

const UNITS: Record<RadarProduct, string> = {
  DBZH: "dBZ",
  RATE: "mm/h",
  ACRR: "mm",
};

const HEADERS = [
  "time_utc",
  "start_time_utc",
  "end_time_utc",
  "value",
  "product",
  "unit",
  "status",
  "status_code",
  "quality_json",
  "revision",
];

const stableJson = (value: Record<string, number | null>) =>
  JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
  );

export const escapeCsvCell = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Prevent a string cell from being evaluated as a spreadsheet formula.
  // Numeric measurements remain numeric because they arrive as numbers.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const buildPixelCsv = (data: readonly PixelObservation[], product: RadarProduct) => {
  const rows = data.map((row) => [
    row.time,
    row.start_time,
    row.end_time,
    row.value,
    row.product,
    UNITS[product],
    row.status,
    row.status_code,
    stableJson(row.quality),
    row.revision,
  ]);
  return [HEADERS, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n");
};

export const downloadPixelCsv = (
  data: readonly PixelObservation[],
  product: RadarProduct,
  filename: string,
) => {
  if (data.length === 0) return;
  const blob = new Blob(["\uFEFF", buildPixelCsv(data, product)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename.replace(/[^a-zA-Z0-9._-]/g, "-")}.csv`;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
