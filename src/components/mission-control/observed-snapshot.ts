// ═══════════════════════════════════════════════════════════════
// Mission Control — observed-only runtime snapshot (pure)
// ═══════════════════════════════════════════════════════════════
// The `/mission-control` page starts from this, never from the demo
// fixture. It carries no records: agents arrive from the agents route,
// artifacts from the evidence route, and the inbox/radar panels have no
// authoritative source yet so they render NOT CONNECTED, not zero.

import type { OwnerOverviewSnapshot } from "./types";

export function buildObservedSnapshot(nowMs: number): OwnerOverviewSnapshot {
  return {
    mode: "observed",
    generatedAt: new Date(nowMs).toISOString(),
    inbox: [],
    agents: [],
    projects: [],
    deliverables: {
      stamp: { source: "No deliverable source", kind: "not_connected", checkedAt: null, staleAfterMinutes: 0 },
      items: [],
    },
    risks: [],
  };
}
