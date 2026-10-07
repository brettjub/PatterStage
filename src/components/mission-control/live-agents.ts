// ═══════════════════════════════════════════════════════════════
// Mission Control — live agent process observation (pure)
// ═══════════════════════════════════════════════════════════════
// Validates GET /api/mission-control/agents and tracks poll state.
// The browser only ever talks to that same-origin route; the route
// (implemented server-side) is what reaches the VPS exporter.
// Only the agent board can become live, so a snapshot is never `live`:
// a demo snapshot becomes `mixed`; the runtime `observed` one stays put.

import { assessFreshness } from "./freshness";
import type { AgentAvailability, AgentBoardEntry, OwnerOverviewSnapshot } from "./types";

export const LIVE_AGENTS_ROUTE = "/api/mission-control/agents";
export const LIVE_AGENTS_POLL_MS = 20_000;
/** Abort a single request that hangs longer than this. */
export const LIVE_AGENTS_REQUEST_TIMEOUT_MS = 15_000;
/** Re-render cadence so a held observation ages into STALE without a new response. */
export const CLOCK_TICK_MS = 15_000;
/** The board-level observation turns STALE after this many minutes. */
export const LIVE_STALE_AFTER_MINUTES = 1;

const MAX_AGENTS = 200;
const MAX_TEXT = 200;

const AVAILABILITIES: readonly AgentAvailability[] = [
  "running",
  "idle",
  "paused",
  "blocked",
  "offline",
  "unknown",
];

/** Last successful observation, exactly as the route reported it. */
export interface LiveAgentsObservation {
  source: string;
  checkedAt: string;
  agents: AgentBoardEntry[];
}

export type ConnectorStatus = "connecting" | "connected" | "unavailable";

export interface LiveAgentsState {
  /** Never cleared by a failed poll — a held observation goes STALE instead. */
  observation: LiveAgentsObservation | null;
  connector: ConnectorStatus;
  /** Reason for the most recent failed poll; null after a success. */
  lastError: string | null;
}

export const INITIAL_LIVE_AGENTS_STATE: LiveAgentsState = {
  observation: null,
  connector: "connecting",
  lastError: null,
};

export type ParseResult =
  | { ok: true; observation: LiveAgentsObservation }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isText(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= MAX_TEXT;
}

function isIsoTime(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

function parseAgent(raw: unknown): AgentBoardEntry | null {
  if (!isRecord(raw)) return null;
  const { id, name, runtime, availability, run, note, stamp } = raw;
  if (!isText(id) || !isText(name) || !isText(runtime)) return null;
  if (typeof availability !== "string" || !AVAILABILITIES.includes(availability as AgentAvailability)) return null;
  // A process scan cannot see assignments; anything but null would be an unbacked claim.
  if (run !== null) return null;
  if (note !== undefined && (typeof note !== "string" || note.length > MAX_TEXT)) return null;
  if (!isRecord(stamp)) return null;
  if (!isText(stamp.source) || stamp.kind !== "live" || !isIsoTime(stamp.checkedAt)) return null;
  if (typeof stamp.staleAfterMinutes !== "number" || !Number.isFinite(stamp.staleAfterMinutes) || stamp.staleAfterMinutes < 0) {
    return null;
  }
  return {
    id,
    name,
    runtime,
    availability: availability as AgentAvailability,
    run: null,
    ...(typeof note === "string" && note ? { note } : {}),
    stamp: {
      source: stamp.source,
      kind: "live",
      checkedAt: stamp.checkedAt,
      staleAfterMinutes: stamp.staleAfterMinutes,
    },
  };
}

/**
 * Validate an HTTP 200 body. Any malformed agent rejects the whole response:
 * a partial board could silently hide a process.
 */
export function parseLiveAgentsResponse(body: unknown): ParseResult {
  if (!isRecord(body)) return { ok: false, error: "Invalid response: not an object" };
  if (body.schemaVersion !== 1) return { ok: false, error: "Invalid response: unsupported schemaVersion" };
  if (!isIsoTime(body.checkedAt)) return { ok: false, error: "Invalid response: checkedAt" };
  if (!isText(body.source)) return { ok: false, error: "Invalid response: source" };
  if (!Array.isArray(body.agents) || body.agents.length > MAX_AGENTS) {
    return { ok: false, error: "Invalid response: agents" };
  }
  const agents: AgentBoardEntry[] = [];
  const ids = new Set<string>();
  for (const raw of body.agents) {
    const agent = parseAgent(raw);
    if (!agent) return { ok: false, error: "Invalid response: malformed agent entry" };
    if (ids.has(agent.id)) return { ok: false, error: "Invalid response: duplicate agent id" };
    ids.add(agent.id);
    agents.push(agent);
  }
  return { ok: true, observation: { source: body.source, checkedAt: body.checkedAt, agents } };
}

/** Pull a short, display-safe reason out of a 503 `{ error }` body. */
export function describeFailure(status: number, body: unknown): string {
  const msg = isRecord(body) && typeof body.error === "string" ? body.error.trim() : "";
  const base = msg ? msg.slice(0, MAX_TEXT) : `HTTP ${status}`;
  return status === 503 || !msg ? base : `HTTP ${status}: ${base}`;
}

/**
 * One poll of the same-origin route. Never throws: every failure becomes
 * `{ ok: false }`. Aborts on `signal` (unmount) or after the request timeout.
 */
export async function fetchLiveAgents(signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<ParseResult> {
  const request = new AbortController();
  const onAbort = () => request.abort();
  signal.addEventListener("abort", onAbort);
  const timeout = setTimeout(() => request.abort(), LIVE_AGENTS_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(LIVE_AGENTS_ROUTE, {
      cache: "no-store",
      signal: request.signal,
      headers: { Accept: "application/json" },
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      if (res.ok) return { ok: false, error: "Invalid response: not JSON" };
    }
    if (!res.ok) return { ok: false, error: describeFailure(res.status, body) };
    return parseLiveAgentsResponse(body);
  } catch {
    if (request.signal.aborted && !signal.aborted) return { ok: false, error: "Request timed out" };
    return { ok: false, error: "Route unreachable" };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}

export function applyPollSuccess(_state: LiveAgentsState, observation: LiveAgentsObservation): LiveAgentsState {
  return { observation, connector: "connected", lastError: null };
}

/** Keep the prior observation and its checkedAt untouched; only the connector status changes. */
export function applyPollFailure(state: LiveAgentsState, error: string): LiveAgentsState {
  return { observation: state.observation, connector: "unavailable", lastError: error };
}

/**
 * Put the live agents (or none, before any success) into the snapshot.
 * Fixture agents are never shown next to a live connector. An `observed`
 * snapshot keeps its mode; a demo snapshot becomes `mixed` once observed.
 */
export function mergeLiveAgents(snapshot: OwnerOverviewSnapshot, live: LiveAgentsState): OwnerOverviewSnapshot {
  return {
    ...snapshot,
    mode: snapshot.mode === "observed" ? "observed" : live.observation ? "mixed" : "demo",
    agents: live.observation ? live.observation.agents : [],
  };
}

/** Headline state of the agent process source. Only `live` may be presented as current. */
export type AgentSourceDisplay = "live" | "held" | "stale" | "connecting" | "not_connected";

export function agentSourceDisplay(live: LiveAgentsState, nowMs: number): AgentSourceDisplay {
  if (!live.observation) return live.connector === "connecting" ? "connecting" : "not_connected";
  const freshness = assessFreshness(
    { source: live.observation.source, kind: "live", checkedAt: live.observation.checkedAt, staleAfterMinutes: LIVE_STALE_AFTER_MINUTES },
    nowMs
  );
  if (freshness.state !== "fresh") return "stale";
  return live.connector === "connected" ? "live" : "held";
}
