// ═══════════════════════════════════════════════════════════════
// Mission Control — Owner Overview data contract
// ═══════════════════════════════════════════════════════════════
// Shape a read-only adapter must supply. Agents may come from the
// live process observation route (see `live-agents.ts`). At runtime
// (`observed` mode) every other panel is empty: inbox and projects have
// no source and render NOT CONNECTED. `demo-fixture.ts` fills them only
// for pure component tests.
// See docs/mission-control-owner-overview.md.

/** Where a datum came from. Only `live` may ever be presented as current. */
export type SourceKind = "demo" | "not_connected" | "live";

/** Provenance + freshness attached to every status the page shows. */
export interface SourceStamp {
  /** Human-readable source name, e.g. "Hermes process scan". */
  source: string;
  kind: SourceKind;
  /** ISO-8601 UTC time of the last *successful* read; null when never read. */
  checkedAt: string | null;
  /** Age (minutes) after which the datum must render as STALE, never as idle/zero. */
  staleAfterMinutes: number;
}

/** Agent availability — what the worker itself is doing, independent of any task. */
export type AgentAvailability =
  | "running"
  | "idle"
  | "paused"
  | "blocked"
  | "offline"
  | "unknown";

/** Run state — the state of the agent's current/last run, tracked separately from availability. */
export type RunState =
  | "queued"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "unknown";

export interface AgentRun {
  /** Short task label; never inferred from a branch name alone. */
  taskLabel: string;
  runState: RunState;
  project: string;
  worktree?: string;
}

export interface AgentBoardEntry {
  id: string;
  name: string;
  runtime: string;
  availability: AgentAvailability;
  run: AgentRun | null;
  note?: string;
  /** Heartbeat / last observation of this agent. */
  stamp: SourceStamp;
}

export type ProjectState = "active" | "paused" | "idea" | "unknown";

export interface ProjectRadarEntry {
  id: string;
  name: string;
  outcome: string;
  /** State as recorded by the source — not a verified current state. */
  recordedState: ProjectState;
  position: string;
  blocker?: string;
  nextMove: string;
  verification: "verified" | "unverified";
  stamp: SourceStamp;
}

export type OwnerItemKind = "decision" | "approval";

export interface OwnerInboxItem {
  id: string;
  kind: OwnerItemKind;
  title: string;
  project: string;
  /** Exact system/resource the decision or approval applies to. */
  target: string;
  impact: string;
  /** ISO-8601 UTC time the request was raised (drives age sorting). */
  createdAt: string;
  stamp: SourceStamp;
}

export interface DeliverableEntry {
  id: string;
  title: string;
  project: string;
  kind: "document" | "pull_request" | "test_run" | "preview" | "report";
  url?: string;
  stamp: SourceStamp;
}

export interface RiskEntry {
  id: string;
  label: string;
  detail: string;
  severity: "info" | "warning" | "danger";
  stamp: SourceStamp;
}

export interface OwnerOverviewSnapshot {
  /**
   * `demo`: every panel is fixture data (pure tests only). `mixed`: a demo snapshot
   * with a live agent or evidence observation merged in (pure tests only).
   * `observed`: the runtime page — only route observations, no fixture records;
   * panels without a source render NOT CONNECTED. `live` is reserved for a future
   * where every panel has a verified adapter — nothing sets it today.
   */
  mode: "demo" | "mixed" | "observed" | "live";
  generatedAt: string;
  inbox: OwnerInboxItem[];
  agents: AgentBoardEntry[];
  projects: ProjectRadarEntry[];
  deliverables: { stamp: SourceStamp; items: DeliverableEntry[] };
  risks: RiskEntry[];
}
