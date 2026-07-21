import { describe, expect, it } from "vitest";

import { buildPixelCsv, escapeCsvCell } from "@/utils/pixelCsv";
import type { PixelObservation } from "@/utils/pixelTimeline";

const observation: PixelObservation = {
  time: "2026-07-21T12:00:00Z",
  start_time: "2026-07-21T11:55:00Z",
  end_time: "2026-07-21T12:00:00Z",
  value: 12.5,
  product: "DBZH",
  status: "detected",
  status_code: 0,
  quality: { z_quality: 0.8, a_quality: null },
  revision: "revision,with-quote\"",
};

describe("cached pixel CSV export", () => {
  it("matches the API schema and stably serializes quality values", () => {
    const csv = buildPixelCsv([observation], "DBZH");
    expect(csv.split("\r\n")[0]).toBe(
      "time_utc,start_time_utc,end_time_utc,value,product,unit,status,status_code,quality_json,revision",
    );
    expect(csv).toContain('"{""a_quality"":null,""z_quality"":0.8}"');
    expect(csv).toContain('"revision,with-quote"""');
    expect(csv).toContain(",12.5,DBZH,dBZ,detected,0,");
  });

  it("preserves empty values and prevents string formulas", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell("=HYPERLINK(\"bad\")")).toBe('"\'=HYPERLINK(""bad"")"');
    expect(escapeCsvCell(-5)).toBe("-5");
  });
});
