import type { MapRenderState } from "@/types/radar";

export const canAdvanceRadarFrame = (state: MapRenderState, frameKey?: string) =>
  Boolean(frameKey && state.frameKey === frameKey &&
    (state.status === "ready" || (state.status === "degraded" && state.hasUsableFrame)));

const waitForRetry = (delay: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const abort = () => {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    reject(new DOMException("Radar request cancelled", "AbortError"));
  };
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", abort);
    resolve();
  }, delay);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
});

/** Retry transient congestion only for the selected frame; hidden work backs off. */
export const fetchRadarFrame = async (url: string, signal: AbortSignal, background = false) => {
  const attempts = background ? 1 : 3;
  for (let attempt = 0; ; attempt += 1) {
    signal.throwIfAborted();
    const response = await fetch(url, { signal, priority: background ? "low" : "high" });
    if (![429, 503].includes(response.status) || attempt >= attempts - 1) return response;

    const retryAfter = response.headers.get("Retry-After");
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    const requestedDelay = Number.isFinite(seconds)
      ? seconds * 1000
      : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
    // Keep automatic recovery bounded without retrying before a long upstream
    // rate-limit window expires.
    if (requestedDelay > 10_000) return response;
    const delay = Number.isFinite(requestedDelay)
      ? Math.max(500, requestedDelay)
      : 1000 * 2 ** attempt;
    // Release the failed response before retrying, and spread retries across visitors.
    await response.body?.cancel();
    await waitForRetry(delay + Math.random() * 500, signal);
  }
};
