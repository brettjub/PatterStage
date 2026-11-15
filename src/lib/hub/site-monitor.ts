// ═══════════════════════════════════════════════════════════════
// site-monitor.ts — Run health checks for stored sites and save them
// ═══════════════════════════════════════════════════════════════

import { checkSite, isCheckStale, mapWithLimit } from "@/lib/hub/site-check";
import { getSite, listSites, recordSiteCheck } from "@/lib/hub/sites-repository";
import type { HubSite } from "@/types/hub";

const CONCURRENCY = 5;

/** Concurrent check runs share one promise per site so a page refresh can't double-check. */
const inFlight = new Map<string, Promise<void>>();

async function runCheck(site: HubSite): Promise<void> {
  const pending = inFlight.get(site.id);
  if (pending) return pending;
  const job = (async () => {
    const result = await checkSite(site.url);
    // The site may have been deleted while the request was in flight.
    if (getSite(site.id)) recordSiteCheck(site.id, result);
  })().finally(() => inFlight.delete(site.id));
  inFlight.set(site.id, job);
  return job;
}

/** Check the given sites (all when `ids` is omitted). `onlyStale` skips recently checked ones. */
export async function checkSites(options: { ids?: string[]; onlyStale?: boolean } = {}): Promise<HubSite[]> {
  let sites = listSites();
  if (options.ids) {
    const wanted = new Set(options.ids);
    sites = sites.filter((s) => wanted.has(s.id));
  }
  if (options.onlyStale) sites = sites.filter((s) => isCheckStale(s.lastCheckedAt));
  await mapWithLimit(sites, CONCURRENCY, runCheck);
  return listSites();
}
