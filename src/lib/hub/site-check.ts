// ═══════════════════════════════════════════════════════════════
// site-check.ts — HTTP health check for watched websites
// ═══════════════════════════════════════════════════════════════
//
// A site is "up" when it answers 2xx/3xx, "degraded" on 4xx (reachable
// but returning an error page, e.g. 404 or a login wall), and "down" on
// 5xx, timeouts and connection failures.

import type { SiteCheckResult } from "@/lib/hub/sites-repository";
import type { SiteHealth } from "@/types/hub";

export const SITE_CHECK_TIMEOUT_MS = 10_000;
/** Checks older than this are re-run when a hub page asks for fresh data. */
export const SITE_CHECK_STALE_MS = 5 * 60_000;

export function classifyHttpStatus(status: number): SiteHealth {
  if (status >= 200 && status < 400) return "up";
  if (status >= 400 && status < 500) return "degraded";
  return "down";
}

function describeFetchError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return `No answer within ${SITE_CHECK_TIMEOUT_MS / 1000}s`;
    }
    const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
    if (cause?.code === "ENOTFOUND") return "Address not found (DNS)";
    if (cause?.code === "ECONNREFUSED") return "Connection refused";
    if (cause?.code) return cause.code + (cause.message ? ": " + cause.message : "");
    // e.g. undici's "bad port" for ports fetch refuses to use.
    if (cause?.message) return cause.message;
    return error.message;
  }
  return String(error);
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Request `url` once and classify the outcome. Never throws. */
export async function checkSite(
  url: string,
  fetchImpl: FetchLike = fetch,
  clock: () => number = Date.now,
): Promise<SiteCheckResult> {
  const started = clock();
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: { "User-Agent": "ControlHub-SiteCheck/1.0", Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(SITE_CHECK_TIMEOUT_MS),
    });
    const responseMs = Math.max(0, Math.round(clock() - started));
    // Only the status line matters; release the connection without reading the body.
    try {
      await res.body?.cancel();
    } catch {
      // body already consumed or not cancellable
    }
    const status = classifyHttpStatus(res.status);
    return {
      status,
      httpStatus: res.status,
      responseMs,
      error: status === "up" ? null : `HTTP ${res.status}${res.statusText ? " " + res.statusText : ""}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "down",
      httpStatus: null,
      responseMs: null,
      error: describeFetchError(error),
      checkedAt: new Date().toISOString(),
    };
  }
}

/** Run `worker` over `items` with at most `limit` in flight. Results keep input order. */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export function isCheckStale(lastCheckedAt: string | null, nowMs: number = Date.now()): boolean {
  if (!lastCheckedAt) return true;
  const t = Date.parse(lastCheckedAt);
  return Number.isNaN(t) || nowMs - t > SITE_CHECK_STALE_MS;
}
