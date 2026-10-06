// ═══════════════════════════════════════════════════════════════
// Mission Control — freshness + label helpers (pure)
// ═══════════════════════════════════════════════════════════════

import type { AgentAvailability, RunState, SourceKind, SourceStamp } from "./types";

export type FreshnessState = "fresh" | "stale" | "unknown";

export interface Freshness {
  state: FreshnessState;
  /** Whole minutes since `checkedAt`; null when unknown. */
  ageMinutes: number | null;
}

const MINUTE_MS = 60_000;
/** A remote clock this far ahead of the browser still counts as "just now". */
export const CLOCK_SKEW_TOLERANCE_MS = 30_000;

/**
 * Classify a stamp against `nowMs`. Missing, unparsable or future timestamps
 * (beyond a small clock-skew allowance) are `unknown` — they never count as fresh.
 */
export function assessFreshness(stamp: SourceStamp, nowMs: number): Freshness {
  if (!stamp.checkedAt) return { state: "unknown", ageMinutes: null };
  const checked = Date.parse(stamp.checkedAt);
  if (Number.isNaN(checked) || checked > nowMs + CLOCK_SKEW_TOLERANCE_MS) {
    return { state: "unknown", ageMinutes: null };
  }
  const ageMinutes = Math.floor(Math.max(0, nowMs - checked) / MINUTE_MS);
  return {
    state: ageMinutes > stamp.staleAfterMinutes ? "stale" : "fresh",
    ageMinutes,
  };
}

export function formatAge(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Deterministic UTC rendering ("2026-10-06 21:30 UTC") — no locale/timezone drift. */
export function formatUtc(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "invalid time";
  return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  demo: "DEMO",
  not_connected: "NOT CONNECTED",
  live: "LIVE",
};

export const AVAILABILITY_LABEL: Record<AgentAvailability, string> = {
  running: "Running",
  idle: "Idle",
  paused: "Paused",
  blocked: "Blocked",
  offline: "Offline",
  unknown: "Unknown",
};

export const RUN_STATE_LABEL: Record<RunState, string> = {
  queued: "Queued",
  running: "Running",
  waiting_approval: "Waiting for approval",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
  unknown: "Unknown",
};

/** What the board shows as the headline state: STALE/UNKNOWN override the last reported availability. */
export type DisplayedAgentState = AgentAvailability | "stale";

export function displayedAgentState(
  availability: AgentAvailability,
  freshness: Freshness
): DisplayedAgentState {
  if (freshness.state === "stale") return "stale";
  if (freshness.state === "unknown") return "unknown";
  return availability;
}
