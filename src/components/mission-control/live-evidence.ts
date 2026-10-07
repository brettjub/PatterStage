// ═══════════════════════════════════════════════════════════════
// Mission Control — live evidence observation (pure, UI-side contract)
// ═══════════════════════════════════════════════════════════════
// Validates GET /api/mission-control/evidence and tracks poll state.
// The browser only ever talks to that same-origin route. This file is
// the UI's copy of the shared contract; it never imports backend code.
// Evidence is its own section: it never makes inbox, radar or
// deliverables rows live, and never upgrades the page past `mixed`.

import { describeFailure } from "./live-agents";
import type { OwnerOverviewSnapshot } from "./types";

export const EVIDENCE_ROUTE = "/api/mission-control/evidence";
export const EVIDENCE_POLL_MS = 60_000;
/** Abort a single request that hangs longer than this. */
export const EVIDENCE_REQUEST_TIMEOUT_MS = 20_000;
/** A source's last successful check older than this renders STALE. */
export const EVIDENCE_STALE_AFTER_MINUTES = 10;

const MAX_ITEMS_PER_SOURCE = 100;
const MAX_ID = 200;
const MAX_TITLE = 300;
const MAX_STATUS = 120;
const MAX_NOTE = 300;
const MAX_URL = 2048;

export const EVIDENCE_SOURCE_IDS = ["hermes", "github", "drive"] as const;
export type EvidenceSourceId = (typeof EVIDENCE_SOURCE_IDS)[number];

export type EvidenceItemKind = "task" | "run" | "pull_request" | "document";
export type EvidenceSourceStatus = "live" | "unavailable";

/** Each source may only report the kinds it can actually observe. */
const KINDS_BY_SOURCE: Record<EvidenceSourceId, readonly EvidenceItemKind[]> = {
  hermes: ["task", "run"],
  github: ["pull_request"],
  drive: ["document"],
};

/** Hosts a link may point at, per source. Hermes evidence is never linked. */
const LINK_HOSTS_BY_SOURCE: Record<EvidenceSourceId, readonly string[]> = {
  hermes: [],
  github: ["github.com"],
  drive: ["drive.google.com", "docs.google.com"],
};

export interface EvidenceItem {
  id: string;
  kind: EvidenceItemKind;
  title: string;
  status: string;
  observedAt: string;
  /** Only present when the URL passed `safeEvidenceUrl` for this source. */
  url?: string;
  /** True when the route sent a URL that was withheld as unsafe. */
  urlWithheld?: boolean;
  project?: string;
  note?: string;
}

export interface EvidenceSource {
  id: EvidenceSourceId;
  status: EvidenceSourceStatus;
  /** Last successful check of this source; null when never checked. */
  checkedAt: string | null;
  items: EvidenceItem[];
}

export interface EvidenceObservation {
  checkedAt: string;
  /** Always all three sources, in `EVIDENCE_SOURCE_IDS` order. */
  sources: EvidenceSource[];
}

export type EvidenceConnectorStatus = "connecting" | "connected" | "unavailable";

export interface LiveEvidenceState {
  /** Never cleared by a failed poll — a held observation goes STALE instead. */
  observation: EvidenceObservation | null;
  connector: EvidenceConnectorStatus;
  /** Reason for the most recent failed poll; null after a success. */
  lastError: string | null;
}

export const INITIAL_LIVE_EVIDENCE_STATE: LiveEvidenceState = {
  observation: null,
  connector: "connecting",
  lastError: null,
};

export type EvidenceParseResult =
  | { ok: true; observation: EvidenceObservation }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isText(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

// UTC only: a trailing `Z` or `+00:00`. Local offsets are rejected so ages never drift.
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$/;

export function isIsoUtc(v: unknown): v is string {
  return typeof v === "string" && ISO_UTC.test(v) && !Number.isNaN(Date.parse(v));
}

/**
 * Return the URL only if it is safe to render as a link for `source`:
 * absolute https, no embedded credentials, default port, and an allowed host.
 */
export function safeEvidenceUrl(source: EvidenceSourceId, raw: string): string | null {
  if (raw.length > MAX_URL) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (!LINK_HOSTS_BY_SOURCE[source].includes(url.hostname.toLowerCase())) return null;
  return url.href;
}

function parseItem(source: EvidenceSourceId, raw: unknown): EvidenceItem | null {
  if (!isRecord(raw)) return null;
  const { id, kind, title, status, observedAt, url, project, note } = raw;
  if (!isText(id, MAX_ID) || !isText(title, MAX_TITLE) || !isText(status, MAX_STATUS)) return null;
  if (typeof kind !== "string" || !KINDS_BY_SOURCE[source].includes(kind as EvidenceItemKind)) return null;
  if (!isIsoUtc(observedAt)) return null;
  if (url !== undefined && typeof url !== "string") return null;
  if (project !== undefined && !isText(project, MAX_TITLE)) return null;
  if (note !== undefined && (typeof note !== "string" || note.length > MAX_NOTE)) return null;

  const safeUrl = typeof url === "string" ? safeEvidenceUrl(source, url) : null;
  return {
    id,
    kind: kind as EvidenceItemKind,
    title,
    status,
    observedAt,
    ...(safeUrl ? { url: safeUrl } : {}),
    ...(typeof url === "string" && !safeUrl ? { urlWithheld: true } : {}),
    ...(typeof project === "string" ? { project } : {}),
    ...(typeof note === "string" && note.trim() ? { note } : {}),
  };
}

function parseSource(raw: unknown): EvidenceSource | string {
  if (!isRecord(raw)) return "malformed source";
  const { id, status, checkedAt, items } = raw;
  if (typeof id !== "string" || !EVIDENCE_SOURCE_IDS.includes(id as EvidenceSourceId)) return "unknown source id";
  const sourceId = id as EvidenceSourceId;
  if (status !== "live" && status !== "unavailable") return `${sourceId} status`;
  if (checkedAt !== null && !isIsoUtc(checkedAt)) return `${sourceId} checkedAt`;
  // A live claim needs a successful check time behind it.
  if (status === "live" && checkedAt === null) return `${sourceId} live without checkedAt`;
  if (!Array.isArray(items) || items.length > MAX_ITEMS_PER_SOURCE) return `${sourceId} items`;
  // Unavailable means "could not read", so it must not carry items that look current.
  if (status === "unavailable" && items.length > 0) return `${sourceId} unavailable with items`;

  const parsed: EvidenceItem[] = [];
  const ids = new Set<string>();
  for (const rawItem of items) {
    const item = parseItem(sourceId, rawItem);
    if (!item) return `malformed ${sourceId} item`;
    if (ids.has(item.id)) return `duplicate ${sourceId} item id`;
    ids.add(item.id);
    parsed.push(item);
  }
  return { id: sourceId, status, checkedAt, items: parsed };
}

/**
 * Validate an HTTP 200 body. Any malformed source or item rejects the whole
 * response: a partial shelf could silently hide evidence or invent a zero.
 */
export function parseEvidenceResponse(body: unknown): EvidenceParseResult {
  if (!isRecord(body)) return { ok: false, error: "Invalid response: not an object" };
  if (body.schemaVersion !== 1) return { ok: false, error: "Invalid response: unsupported schemaVersion" };
  if (!isIsoUtc(body.checkedAt)) return { ok: false, error: "Invalid response: checkedAt" };
  if (!Array.isArray(body.sources) || body.sources.length !== EVIDENCE_SOURCE_IDS.length) {
    return { ok: false, error: "Invalid response: expected exactly three sources" };
  }
  const byId = new Map<EvidenceSourceId, EvidenceSource>();
  for (const raw of body.sources) {
    const source = parseSource(raw);
    if (typeof source === "string") return { ok: false, error: `Invalid response: ${source}` };
    if (byId.has(source.id)) return { ok: false, error: "Invalid response: duplicate source id" };
    byId.set(source.id, source);
  }
  const sources = EVIDENCE_SOURCE_IDS.map((id) => byId.get(id)).filter((s): s is EvidenceSource => !!s);
  if (sources.length !== EVIDENCE_SOURCE_IDS.length) return { ok: false, error: "Invalid response: missing source" };
  return { ok: true, observation: { checkedAt: body.checkedAt, sources } };
}

/**
 * One poll of the same-origin route. Never throws: every failure becomes
 * `{ ok: false }`. Aborts on `signal` (unmount) or after the request timeout.
 */
export async function fetchLiveEvidence(
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<EvidenceParseResult> {
  const request = new AbortController();
  const onAbort = () => request.abort();
  signal.addEventListener("abort", onAbort);
  const timeout = setTimeout(() => request.abort(), EVIDENCE_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(EVIDENCE_ROUTE, {
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
    return parseEvidenceResponse(body);
  } catch {
    if (request.signal.aborted && !signal.aborted) return { ok: false, error: "Request timed out" };
    return { ok: false, error: "Route unreachable" };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}

export function applyEvidenceSuccess(_state: LiveEvidenceState, observation: EvidenceObservation): LiveEvidenceState {
  return { observation, connector: "connected", lastError: null };
}

/** Keep the prior observation and its timestamps untouched; only the connector status changes. */
export function applyEvidenceFailure(state: LiveEvidenceState, error: string): LiveEvidenceState {
  return { observation: state.observation, connector: "unavailable", lastError: error };
}

/** Headline state shown for one source. Only `live` may be presented as current. */
export type EvidenceSourceDisplay = "live" | "held" | "stale" | "unavailable" | "unknown";

const MINUTE_MS = 60_000;
const CLOCK_SKEW_TOLERANCE_MS = 30_000;

/** Whole minutes since `checkedAt`, or null if missing/invalid/too far in the future. */
export function evidenceAgeMinutes(checkedAt: string | null, nowMs: number): number | null {
  if (!checkedAt) return null;
  const t = Date.parse(checkedAt);
  if (Number.isNaN(t) || t > nowMs + CLOCK_SKEW_TOLERANCE_MS) return null;
  return Math.floor(Math.max(0, nowMs - t) / MINUTE_MS);
}

/**
 * - `live`: connector up, source reported live, last check within the threshold.
 * - `held`: source was live at the last success but the latest poll failed.
 * - `stale`: the last successful check is older than the threshold.
 * - `unavailable`: the route reported the source could not be read.
 * - `unknown`: no observation, or an unusable timestamp.
 */
export function evidenceSourceDisplay(
  source: EvidenceSource | undefined,
  connector: EvidenceConnectorStatus,
  nowMs: number
): EvidenceSourceDisplay {
  if (!source) return "unknown";
  if (source.status === "unavailable") return "unavailable";
  const age = evidenceAgeMinutes(source.checkedAt, nowMs);
  if (age === null) return "unknown";
  if (age > EVIDENCE_STALE_AFTER_MINUTES) return "stale";
  return connector === "connected" ? "live" : "held";
}

/** Sources currently presentable as live (fresh and from a successful poll). */
export function liveEvidenceSourceIds(state: LiveEvidenceState, nowMs: number): EvidenceSourceId[] {
  return (state.observation?.sources ?? [])
    .filter((s) => evidenceSourceDisplay(s, state.connector, nowMs) === "live")
    .map((s) => s.id);
}

/**
 * Raise the snapshot to `mixed` when some evidence was observed live.
 * Never sets `live`, and never touches inbox, projects or deliverables.
 */
export function withEvidenceMode(snapshot: OwnerOverviewSnapshot, state: LiveEvidenceState): OwnerOverviewSnapshot {
  const anyLive = state.observation?.sources.some((s) => s.status === "live") ?? false;
  if (!anyLive || snapshot.mode !== "demo") return snapshot;
  return { ...snapshot, mode: "mixed" };
}
