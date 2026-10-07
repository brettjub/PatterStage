// ═══════════════════════════════════════════════════════════════
// Mission Control — owner register observation (pure, UI-side contract)
// ═══════════════════════════════════════════════════════════════
// Validates GET /api/mission-control/register and tracks poll state.
// The register is a manually maintained Google Sheet: a successful poll
// verifies the READ, not that any recorded project status is correct.
// Row owner-review times stay separate from the register read time; a row
// with no owner review is UNVERIFIED. The browser only talks to the
// same-origin route and never writes anything.

import { describeFailure } from "./live-agents";
import { isIsoUtc } from "./live-evidence";
import type { ProjectState } from "./types";

export const REGISTER_ROUTE = "/api/mission-control/register";
export const REGISTER_POLL_MS = 60_000;
/** Abort a single request that hangs longer than this. */
export const REGISTER_REQUEST_TIMEOUT_MS = 20_000;
/** The last successful read older than this renders STALE. */
export const REGISTER_STALE_AFTER_MINUTES = 10;
/** An owner review older than this renders OWNER REVIEW STALE. */
export const OWNER_REVIEW_STALE_AFTER_DAYS = 7;

const MAX_ROWS = 200;
const MAX_SLUG = 100;
const MAX_TITLE = 300;
const MAX_TEXT = 1000;
const MAX_URL = 2048;

const PROJECT_STATES: readonly ProjectState[] = ["active", "paused", "idea", "unknown"];
const SOURCE_HOSTS: readonly string[] = ["docs.google.com", "drive.google.com", "github.com"];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHEET_PATH = /^\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit$/;
const SHEET_HASH = /^(#gid=\d+)?$/;

const TOP_KEYS = new Set(["schemaVersion", "checkedAt", "sheetUrl", "decisions", "projects"]);
const DECISION_KEYS = new Set(["id", "projectId", "title", "target", "impact", "raisedAt", "ownerReviewedAt", "sourceUrl"]);
const PROJECT_KEYS = new Set([
  "id",
  "name",
  "outcome",
  "recordedState",
  "position",
  "blocker",
  "nextMove",
  "ownerReviewedAt",
  "sourceUrl",
]);

interface RowSource {
  /** ISO-8601 UTC time the owner last reviewed this row; absent = never (UNVERIFIED). */
  ownerReviewedAt?: string;
  /** Only present when the URL passed `safeRegisterSourceUrl`. */
  sourceUrl?: string;
  /** True when the route sent a URL that was withheld as unsafe. */
  sourceUrlWithheld?: boolean;
}

export interface RegisterDecision extends RowSource {
  id: string;
  projectId: string;
  title: string;
  target: string;
  impact: string;
  raisedAt: string;
}

export interface RegisterProject extends RowSource {
  id: string;
  name: string;
  outcome: string;
  /** As typed into the sheet — not a verified current state. */
  recordedState: ProjectState;
  position: string;
  blocker?: string;
  nextMove: string;
}

export interface RegisterObservation {
  /** When the backend read the sheet (not when anyone reviewed it). */
  checkedAt: string;
  /** Only set when the sheet URL passed `safeSheetUrl`. */
  sheetUrl: string | null;
  sheetUrlWithheld: boolean;
  decisions: RegisterDecision[];
  projects: RegisterProject[];
}

export type RegisterConnectorStatus = "connecting" | "connected" | "unavailable";

export interface RegisterState {
  /** Never cleared by a failed poll — a held read goes STALE instead. */
  observation: RegisterObservation | null;
  connector: RegisterConnectorStatus;
  /** Reason for the most recent failed poll; null after a success. */
  lastError: string | null;
}

export const INITIAL_REGISTER_STATE: RegisterState = {
  observation: null,
  connector: "connecting",
  lastError: null,
};

export type RegisterParseResult =
  | { ok: true; observation: RegisterObservation }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isText(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

function isSlug(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_SLUG && SLUG.test(v);
}

function onlyKeys(raw: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(raw).every((k) => allowed.has(k));
}

function parseUrl(raw: string): URL | null {
  if (raw.length > MAX_URL) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

/** The register sheet itself: https://docs.google.com/spreadsheets/d/<id>/edit (optionally #gid=N). */
export function safeSheetUrl(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url || url.hostname !== "docs.google.com") return null;
  if (!SHEET_PATH.test(url.pathname) || url.search || !SHEET_HASH.test(url.hash)) return null;
  return url.href;
}

/** A row's source link: https Google Docs/Drive or GitHub only. */
export function safeRegisterSourceUrl(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url || !SOURCE_HOSTS.includes(url.hostname.toLowerCase())) return null;
  return url.href;
}

/** Shared optional row fields; returns null if malformed. */
function parseRowSource(raw: Record<string, unknown>): RowSource | null {
  const { ownerReviewedAt, sourceUrl } = raw;
  if (ownerReviewedAt !== undefined && !isIsoUtc(ownerReviewedAt)) return null;
  if (sourceUrl !== undefined && typeof sourceUrl !== "string") return null;
  const safe = typeof sourceUrl === "string" ? safeRegisterSourceUrl(sourceUrl) : null;
  return {
    ...(typeof ownerReviewedAt === "string" ? { ownerReviewedAt } : {}),
    ...(safe ? { sourceUrl: safe } : {}),
    ...(typeof sourceUrl === "string" && !safe ? { sourceUrlWithheld: true } : {}),
  };
}

function parseDecision(raw: unknown): RegisterDecision | null {
  if (!isRecord(raw) || !onlyKeys(raw, DECISION_KEYS)) return null;
  const { id, projectId, title, target, impact, raisedAt } = raw;
  if (!isSlug(id) || !isSlug(projectId)) return null;
  if (!isText(title, MAX_TITLE) || !isText(target, MAX_TEXT) || !isText(impact, MAX_TEXT)) return null;
  if (!isIsoUtc(raisedAt)) return null;
  const source = parseRowSource(raw);
  if (!source) return null;
  return { id, projectId, title, target, impact, raisedAt, ...source };
}

function parseProject(raw: unknown): RegisterProject | null {
  if (!isRecord(raw) || !onlyKeys(raw, PROJECT_KEYS)) return null;
  const { id, name, outcome, recordedState, position, blocker, nextMove } = raw;
  if (!isSlug(id) || !isText(name, MAX_TITLE) || !isText(outcome, MAX_TEXT)) return null;
  if (typeof recordedState !== "string" || !PROJECT_STATES.includes(recordedState as ProjectState)) return null;
  if (!isText(position, MAX_TEXT) || !isText(nextMove, MAX_TEXT)) return null;
  if (blocker !== undefined && !isText(blocker, MAX_TEXT)) return null;
  const source = parseRowSource(raw);
  if (!source) return null;
  return {
    id,
    name,
    outcome,
    recordedState: recordedState as ProjectState,
    position,
    ...(typeof blocker === "string" ? { blocker } : {}),
    nextMove,
    ...source,
  };
}

function parseRows<T extends { id: string }>(
  raw: unknown,
  label: string,
  parse: (r: unknown) => T | null
): T[] | string {
  if (!Array.isArray(raw) || raw.length > MAX_ROWS) return label;
  const rows: T[] = [];
  const ids = new Set<string>();
  for (const r of raw) {
    const row = parse(r);
    if (!row) return `malformed ${label} row`;
    if (ids.has(row.id)) return `duplicate ${label} id`;
    ids.add(row.id);
    rows.push(row);
  }
  return rows;
}

/**
 * Validate an HTTP 200 body. Any malformed row rejects the whole response:
 * a partial register could silently hide a decision or invent a zero.
 * Unsafe links are withheld, not fatal.
 */
export function parseRegisterResponse(body: unknown): RegisterParseResult {
  if (!isRecord(body)) return { ok: false, error: "Invalid response: not an object" };
  if (!onlyKeys(body, TOP_KEYS)) return { ok: false, error: "Invalid response: unexpected field" };
  if (body.schemaVersion !== 1) return { ok: false, error: "Invalid response: unsupported schemaVersion" };
  if (!isIsoUtc(body.checkedAt)) return { ok: false, error: "Invalid response: checkedAt" };
  if (typeof body.sheetUrl !== "string") return { ok: false, error: "Invalid response: sheetUrl" };
  const decisions = parseRows(body.decisions, "decision", parseDecision);
  if (typeof decisions === "string") return { ok: false, error: `Invalid response: ${decisions}` };
  const projects = parseRows(body.projects, "project", parseProject);
  if (typeof projects === "string") return { ok: false, error: `Invalid response: ${projects}` };
  const sheetUrl = safeSheetUrl(body.sheetUrl);
  return {
    ok: true,
    observation: { checkedAt: body.checkedAt, sheetUrl, sheetUrlWithheld: sheetUrl === null, decisions, projects },
  };
}

/**
 * One GET of the same-origin route. Never throws: every failure becomes
 * `{ ok: false }`. Aborts on `signal` (unmount) or after the request timeout.
 */
export async function fetchOwnerRegister(
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<RegisterParseResult> {
  const request = new AbortController();
  const onAbort = () => request.abort();
  signal.addEventListener("abort", onAbort);
  const timeout = setTimeout(() => request.abort(), REGISTER_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(REGISTER_ROUTE, {
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
    return parseRegisterResponse(body);
  } catch {
    if (request.signal.aborted && !signal.aborted) return { ok: false, error: "Request timed out" };
    return { ok: false, error: "Route unreachable" };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}

export function applyRegisterSuccess(_state: RegisterState, observation: RegisterObservation): RegisterState {
  return { observation, connector: "connected", lastError: null };
}

/** Keep the prior read and its timestamps untouched; only the connector status changes. */
export function applyRegisterFailure(state: RegisterState, error: string): RegisterState {
  return { observation: state.observation, connector: "unavailable", lastError: error };
}

const MINUTE_MS = 60_000;
const CLOCK_SKEW_TOLERANCE_MS = 30_000;

/** Whole minutes since `iso`, or null if missing/invalid/too far in the future. */
export function minutesSince(iso: string | undefined | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t > nowMs + CLOCK_SKEW_TOLERANCE_MS) return null;
  return Math.floor(Math.max(0, nowMs - t) / MINUTE_MS);
}

/**
 * Headline state of the register read. Only `live` is a current read.
 * - `held`: the last read is fresh but the latest poll failed.
 * - `stale`: the last successful read is older than the threshold.
 * - `unavailable`: no read has ever succeeded and the last poll failed.
 * - `unknown`: the read time is unusable (e.g. in the future).
 */
export type RegisterDisplay = "live" | "held" | "stale" | "unavailable" | "connecting" | "unknown";

export function registerSourceDisplay(state: RegisterState, nowMs: number): RegisterDisplay {
  if (!state.observation) return state.connector === "connecting" ? "connecting" : "unavailable";
  const age = minutesSince(state.observation.checkedAt, nowMs);
  if (age === null) return "unknown";
  if (age > REGISTER_STALE_AFTER_MINUTES) return "stale";
  return state.connector === "connected" ? "live" : "held";
}

export type OwnerReviewState = "reviewed" | "review_stale" | "unverified";

/** A row is only owner-reviewed if it carries a usable review time; none at all is UNVERIFIED. */
export function ownerReviewStatus(
  ownerReviewedAt: string | undefined,
  nowMs: number
): { state: OwnerReviewState; ageMinutes: number | null } {
  const age = minutesSince(ownerReviewedAt, nowMs);
  if (age === null) return { state: "unverified", ageMinutes: null };
  return { state: age > OWNER_REVIEW_STALE_AFTER_DAYS * 24 * 60 ? "review_stale" : "reviewed", ageMinutes: age };
}
