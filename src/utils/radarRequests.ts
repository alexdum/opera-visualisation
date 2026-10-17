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

export function fetchRadarFrame(url: string, signal: AbortSignal, background?: boolean): Promise<Response>;
export function fetchRadarFrame<T>(
  url: string, signal: AbortSignal, background: boolean, readResponse: (response: Response) => Promise<T>,
): Promise<T>;
/** Retry congestion and interrupted transfers for selected frames, within one shared budget. */
export async function fetchRadarFrame<T>(
  url: string, signal: AbortSignal, background = false,
  readResponse?: (response: Response) => Promise<T>,
): Promise<Response | T> {
  const attempts = background ? 1 : 3;
  for (let attempt = 0; ; attempt += 1) {
    signal.throwIfAborted();
    let delay = 1000 * 2 ** attempt;
    let response: Response | undefined;
    try {
      response = await fetch(url, { signal, priority: background ? "low" : "high" });
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const requestedDelay = Number.isFinite(seconds)
        ? seconds * 1000
        : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
      if (![429, 503].includes(response.status) || attempt >= attempts - 1 || requestedDelay > 10_000) {
        // Include body reading: a connection can fail after fetch resolves its headers.
        return readResponse ? await readResponse(response) : response;
      }
      if (Number.isFinite(requestedDelay)) delay = Math.max(500, requestedDelay);
      await response.body?.cancel();
    } catch (error) {
      signal.throwIfAborted();
      const networkFailure = error instanceof TypeError ||
        (error instanceof DOMException && error.name === "NetworkError");
      if (!networkFailure || (response && !response.ok) || attempt >= attempts - 1) throw error;
    }
    await waitForRetry(delay + Math.random() * 500, signal);
  }
}
