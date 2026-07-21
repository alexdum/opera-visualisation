import { describe, expect, it } from "vitest";

import {
  buildPixelTimeline,
  buildStatusSegments,
  countPixelStatuses,
  type PixelObservation,
} from "@/utils/pixelTimeline";

const observation = (time: string, status: PixelObservation["status"], value: number | null): PixelObservation => ({
  time,
  start_time: time,
  end_time: time,
  value,
  product: "DBZH",
  status,
  status_code: status === "detected" ? 0 : status === "undetect" ? 1 : 2,
  quality: {},
  revision: time,
});

describe("pixel status timeline", () => {
  it("inserts missing expected timestamps without converting undetect to zero", () => {
    const timeline = buildPixelTimeline(
      [
        observation("2026-07-21T00:00:00Z", "detected", 12),
        observation("2026-07-21T00:05:00Z", "undetect", null),
        observation("2026-07-21T00:15:00Z", "nodata", null),
      ],
      "DBZH",
      "2026-07-21T00:00:00Z",
      "2026-07-21T00:15:00Z",
    );

    expect(timeline.map((row) => row.status)).toEqual(["detected", "undetect", "missing", "nodata"]);
    expect(timeline[1].value).toBeNull();
    expect(timeline[2].synthetic).toBe(true);
    expect(countPixelStatuses(timeline)).toMatchObject({ detected: 1, undetect: 1, nodata: 1, missing: 1 });
  });

  it("combines adjacent equal statuses into aligned ribbon segments", () => {
    const timeline = buildPixelTimeline(
      [
        observation("2026-07-21T00:00:00Z", "detected", 12),
        observation("2026-07-21T00:05:00Z", "detected", 13),
        observation("2026-07-21T00:10:00Z", "undetect", null),
      ],
      "DBZH",
    );
    expect(buildStatusSegments(timeline).map(({ status, count }) => ({ status, count }))).toEqual([
      { status: "detected", count: 2 },
      { status: "undetect", count: 1 },
    ]);
  });
});
