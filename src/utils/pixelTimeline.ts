export type ObservationStatus = "detected" | "undetect" | "nodata" | "unknown";
export type TimelineStatus = ObservationStatus | "missing";

export interface PixelObservation {
  time: string;
  start_time: string | null;
  end_time: string | null;
  value: number | null;
  product: string;
  status: ObservationStatus;
  status_code: number;
  quality: Record<string, number | null>;
  revision: string;
}

export interface PixelTimelineEntry extends Omit<PixelObservation, "status"> {
  status: TimelineStatus;
  synthetic: boolean;
}

export interface StatusSegment {
  status: TimelineStatus;
  count: number;
  startTime: string;
  endTime: string;
}

const DEFAULT_CADENCE_MS: Record<string, number> = {
  DBZH: 5 * 60_000,
  RATE: 15 * 60_000,
  ACRR: 15 * 60_000,
};

const greatestCommonDivisor = (left: number, right: number): number =>
  right === 0 ? left : greatestCommonDivisor(right, left % right);

export const inferPixelCadenceMs = (data: PixelObservation[], product: string) => {
  const timestamps = data
    .map((row) => Date.parse(row.time))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const differences = timestamps
    .slice(1)
    .map((timestamp, index) => timestamp - timestamps[index])
    .filter((difference) => difference > 0);
  return differences.length > 0
    ? differences.reduce(greatestCommonDivisor)
    : (DEFAULT_CADENCE_MS[product] ?? 5 * 60_000);
};

export const buildPixelTimeline = (
  data: PixelObservation[],
  product: string,
  windowStart?: string,
  windowEnd?: string,
): PixelTimelineEntry[] => {
  const validRows = data
    .filter((row) => Number.isFinite(Date.parse(row.time)))
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
  if (!windowStart || !windowEnd) {
    return validRows.map((row) => ({ ...row, synthetic: false }));
  }

  const start = Date.parse(windowStart);
  const end = Date.parse(windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return validRows.map((row) => ({ ...row, synthetic: false }));
  }

  const cadence = inferPixelCadenceMs(validRows, product);
  const rowsByTimestamp = new Map(validRows.map((row) => [Date.parse(row.time), row]));
  const timeline: PixelTimelineEntry[] = [];
  for (let timestamp = start; timestamp <= end; timestamp += cadence) {
    const row = rowsByTimestamp.get(timestamp);
    if (row) {
      timeline.push({ ...row, synthetic: false });
      continue;
    }
    timeline.push({
      time: new Date(timestamp).toISOString(),
      start_time: null,
      end_time: null,
      value: null,
      product,
      status: "missing",
      status_code: -1,
      quality: {},
      revision: "",
      synthetic: true,
    });
  }
  return timeline;
};

export const countPixelStatuses = (timeline: PixelTimelineEntry[]) =>
  timeline.reduce<Record<TimelineStatus, number>>(
    (counts, row) => ({ ...counts, [row.status]: counts[row.status] + 1 }),
    { detected: 0, undetect: 0, nodata: 0, missing: 0, unknown: 0 },
  );

export const buildStatusSegments = (timeline: PixelTimelineEntry[]): StatusSegment[] =>
  timeline.reduce<StatusSegment[]>((segments, row) => {
    const current = segments.at(-1);
    if (current?.status === row.status) {
      current.count += 1;
      current.endTime = row.time;
    } else {
      segments.push({ status: row.status, count: 1, startTime: row.time, endTime: row.time });
    }
    return segments;
  }, []);
