import { afterEach, describe, expect, it, vi } from "vitest";
import { canAdvanceRadarFrame, fetchRadarFrame } from "./radarRequests";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("radar congestion recovery", () => {
  it("retries a temporary fetch failure for the same foreground frame", async () => {
    vi.useFakeTimers();
    const ready = new Response("frame");
    const request = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(ready);
    vi.stubGlobal("fetch", request);
    const signal = new AbortController().signal;
    const pending = fetchRadarFrame("/frame", signal);
    await vi.advanceTimersByTimeAsync(999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(501);
    expect(await pending).toBe(ready);
    expect(request.mock.calls).toEqual([
      ["/frame", { signal, priority: "high" }],
      ["/frame", { signal, priority: "high" }],
    ]);
  });

  it("recovers when the connection breaks while reading the response body", async () => {
    vi.useFakeTimers();
    const broken = new Response(new ReadableStream({
      start(controller) { controller.error(new TypeError("Connection closed")); },
    }));
    const request = vi.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(new Response("frame"));
    vi.stubGlobal("fetch", request);
    const pending = fetchRadarFrame("/frame", new AbortController().signal, false, (response) => response.text());
    await vi.runAllTimersAsync();
    expect(await pending).toBe("frame");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("shares the retry limit across congestion and network failures", async () => {
    vi.useFakeTimers();
    const failure = new TypeError("Failed to fetch");
    const request = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockRejectedValue(failure);
    vi.stubGlobal("fetch", request);
    const pending = fetchRadarFrame("/frame", new AbortController().signal);
    const rejected = expect(pending).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    await rejected;
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("never retries hidden network failures or malformed frame data", async () => {
    const failure = new TypeError("Failed to fetch");
    const request = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal("fetch", request);
    await expect(fetchRadarFrame("/frame", new AbortController().signal, true)).rejects.toBe(failure);
    expect(request).toHaveBeenCalledTimes(1);
    request.mockClear().mockResolvedValue(new Response("invalid"));
    const invalid = new Error("Invalid raw radar payload");
    await expect(fetchRadarFrame("/frame", new AbortController().signal, false, async () => {
      throw invalid;
    })).rejects.toBe(invalid);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("cancels a network retry wait when the selection changes", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
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

  it("preserves HTTP failures and long Retry-After even if reading the error body fails", async () => {
    const failure = new TypeError("Connection closed");
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    for (const response of [
      new Response("missing", { status: 404 }),
      new Response("busy", { status: 503, headers: { "Retry-After": "60" } }),
    ]) {
      request.mockClear().mockResolvedValue(response);
      await expect(fetchRadarFrame("/frame", new AbortController().signal, false, async () => {
        throw failure;
      })).rejects.toBe(failure);
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  it("also recovers from a browser NetworkError", async () => {
    vi.useFakeTimers();
    const ready = new Response("frame");
    const request = vi.fn()
      .mockRejectedValueOnce(new DOMException("Connection closed", "NetworkError"))
      .mockResolvedValueOnce(ready);
    vi.stubGlobal("fetch", request);
    const pending = fetchRadarFrame("/frame", new AbortController().signal);
    await vi.runAllTimersAsync();
    expect(await pending).toBe(ready);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not retry an in-flight abort, even with a TypeError abort reason", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new TypeError("Selection changed");
    const request = vi.fn().mockImplementation(async () => {
      controller.abort(reason);
      throw reason;
    });
    vi.stubGlobal("fetch", request);
    await expect(fetchRadarFrame("/frame", controller.signal)).rejects.toBe(reason);
    await vi.runAllTimersAsync();
    expect(request).toHaveBeenCalledTimes(1);
  });

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
