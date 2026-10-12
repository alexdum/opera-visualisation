import { afterEach, describe, expect, it, vi } from "vitest";
import { canAdvanceRadarFrame, fetchRadarFrame } from "./radarRequests";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("radar congestion recovery", () => {
  it("retries a busy foreground frame, then returns the successful response", async () => {
    vi.useFakeTimers();
    const ready = new Response("frame");
    const request = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(ready);
    vi.stubGlobal("fetch", request);
    const pending = fetchRadarFrame("/frame", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(501);
    expect(await pending).toBe(ready);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1].priority).toBe("high");
  });

  it("bounds foreground retries and does not retry missing or invalid frames", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockImplementation(() => Promise.resolve(new Response("busy", { status: 503 })));
    vi.stubGlobal("fetch", request);
    const pending = fetchRadarFrame("/frame", new AbortController().signal);
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(503);
    expect(request).toHaveBeenCalledTimes(3);
    request.mockClear().mockResolvedValue(new Response("missing", { status: 404 }));
    expect((await fetchRadarFrame("/frame", new AbortController().signal)).status).toBe(404);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("never retries a hidden preload", async () => {
    const request = vi.fn().mockResolvedValue(new Response("busy", { status: 503 }));
    vi.stubGlobal("fetch", request);
    expect((await fetchRadarFrame("/frame", new AbortController().signal, true)).status).toBe(503);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1].priority).toBe("low");
  });

  it("does not shorten a long upstream Retry-After window", async () => {
    const response = new Response("rate limited", { status: 429, headers: { "Retry-After": "60" } });
    const request = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", request);
    expect(await fetchRadarFrame("/frame", new AbortController().signal)).toBe(response);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("cancels retry waits when the user selects another frame", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValue(new Response("busy", { status: 503 }));
    vi.stubGlobal("fetch", request);
    const controller = new AbortController();
    const pending = fetchRadarFrame("/frame", controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejected;
    await vi.runAllTimersAsync();
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("playback readiness", () => {
  it("waits through timeout warnings until the selected frame actually becomes usable", () => {
    expect(canAdvanceRadarFrame({ status: "degraded", frameKey: "current", hasUsableFrame: false }, "current")).toBe(false);
    expect(canAdvanceRadarFrame({ status: "degraded", frameKey: "current", hasUsableFrame: true }, "current")).toBe(true);
    expect(canAdvanceRadarFrame({ status: "ready", frameKey: "previous" }, "current")).toBe(false);
    expect(canAdvanceRadarFrame({ status: "ready", frameKey: "current" }, "current")).toBe(true);
    expect(canAdvanceRadarFrame({ status: "ready" })).toBe(false);
  });
});
