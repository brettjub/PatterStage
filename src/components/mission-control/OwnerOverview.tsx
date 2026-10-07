// ═══════════════════════════════════════════════════════════════
// Owner Overview — one-minute, read-only Mission Control view
// ═══════════════════════════════════════════════════════════════
// Pure render of an `OwnerOverviewSnapshot` at a given `nowMs`.
// Contains no fetches and no action controls; live agent and evidence
// polling live in `MissionControlClient.tsx` and arrive via props.
// `observed` mode (the runtime page) shows only route observations;
// demo/mixed modes render the fixture for pure tests.

import AgentBoard from "./AgentBoard";
import DeliverablesRisks from "./DeliverablesRisks";
import DemoDataBanner from "./DemoDataBanner";
import LiveEvidence from "./LiveEvidence";
import ObservedArtifacts from "./ObservedArtifacts";
import OwnerInbox, { sortInboxOldestFirst } from "./OwnerInbox";
import ProjectRadar from "./ProjectRadar";
import SourceCoverageBanner, { sourceCoverage } from "./SourceCoverageBanner";
import { agentSourceDisplay, INITIAL_LIVE_AGENTS_STATE, type LiveAgentsState } from "./live-agents";
import {
  EVIDENCE_SOURCE_IDS,
  evidenceSourceDisplay,
  INITIAL_LIVE_EVIDENCE_STATE,
  liveEvidenceSourceIds,
  type EvidenceSourceDisplay,
  type EvidenceSourceId,
  type LiveEvidenceState,
} from "./live-evidence";
import { assessFreshness, displayedAgentState, formatAge, type DisplayedAgentState } from "./freshness";
import type { OwnerOverviewSnapshot, SourceStamp } from "./types";

const JUMP_LINKS = [
  { href: "#owner-inbox", label: "Owner inbox" },
  { href: "#agent-board", label: "Agents" },
  { href: "#project-radar", label: "Projects" },
  { href: "#deliverables-risks", label: "Deliverables & risks" },
] as const;

const EVIDENCE_JUMP_LINK = { href: "#live-evidence", label: "Live evidence" } as const;

const OBSERVED_JUMP_LINKS = [
  JUMP_LINKS[0],
  JUMP_LINKS[1],
  EVIDENCE_JUMP_LINK,
  JUMP_LINKS[2],
  { href: "#observed-artifacts", label: "Observed artifacts" },
] as const;

/** Panels with no authoritative source in observed mode (owner inbox, project radar). */
const NOT_CONNECTED_PANELS = 2;

const AGENT_SUMMARY_ORDER: DisplayedAgentState[] = [
  "running",
  "paused",
  "idle",
  "blocked",
  "offline",
  "stale",
  "unknown",
];

function JumpNav({ links }: { links: readonly { href: string; label: string }[] }) {
  return (
    <nav aria-label="Owner overview sections">
      <ul className="flex flex-wrap gap-2">
        {links.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              className="inline-flex min-h-11 items-center rounded-lg border border-white/15 bg-dark-900/60 px-3 text-sm text-white/80 hover:border-neon-cyan/50 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan/60"
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function allStamps(s: OwnerOverviewSnapshot): SourceStamp[] {
  return [
    ...s.inbox.map((i) => i.stamp),
    ...s.agents.map((a) => a.stamp),
    ...s.projects.map((p) => p.stamp),
    s.deliverables.stamp,
    ...s.deliverables.items.map((d) => d.stamp),
    ...s.risks.map((r) => r.stamp),
  ];
}

interface OwnerOverviewProps {
  snapshot: OwnerOverviewSnapshot;
  nowMs: number;
  /** Live agent connector state; omit to render fixture agents only. */
  live?: LiveAgentsState;
  /** Live evidence connector state; omit to leave the evidence section out. */
  evidence?: LiveEvidenceState;
}

export default function OwnerOverview({ snapshot, nowMs, live, evidence }: OwnerOverviewProps) {
  const inbox = sortInboxOldestFirst(snapshot.inbox);
  const oldest = inbox[0];
  const oldestAge = oldest ? Math.max(0, Math.floor((nowMs - Date.parse(oldest.createdAt)) / 60_000)) : null;

  const agentCounts = new Map<DisplayedAgentState, number>();
  for (const a of snapshot.agents) {
    const shown = displayedAgentState(a.availability, assessFreshness(a.stamp, nowMs));
    agentCounts.set(shown, (agentCounts.get(shown) ?? 0) + 1);
  }
  const agentSummary = AGENT_SUMMARY_ORDER.filter((s) => agentCounts.has(s))
    .map((s) => `${agentCounts.get(s)} ${s === "stale" ? "STALE" : s}`)
    .join(" · ");

  const blocker = snapshot.projects.find((p) => p.blocker);
  const stamps = allStamps(snapshot);
  const staleOrUnknownCount = stamps.filter((st) => assessFreshness(st, nowMs).state !== "fresh").length;
  // Evidence sources count as live only while fresh and backed by a successful poll.
  const liveEvidence = evidence ? liveEvidenceSourceIds(evidence, nowMs) : [];
  const liveSourceCount =
    new Set(
      stamps.filter((st) => st.kind === "live" && assessFreshness(st, nowMs).state === "fresh").map((st) => st.source)
    ).size + liveEvidence.length;
  const staleOrUnknownTotal =
    staleOrUnknownCount + (evidence ? EVIDENCE_SOURCE_IDS.length - liveEvidence.length : 0);
  const jumpLinks = evidence
    ? [JUMP_LINKS[0], JUMP_LINKS[1], EVIDENCE_JUMP_LINK, ...JUMP_LINKS.slice(2)]
    : JUMP_LINKS;
  const liveParts = {
    agents: Boolean(live?.observation),
    evidence: evidence?.observation?.sources.some((s) => s.status === "live") ?? false,
  };
  const agentsText = agentSummary || (live && !live.observation ? "not connected — unknown" : "none reported");

  if (snapshot.mode === "observed") {
    return (
      <ObservedOverview
        nowMs={nowMs}
        live={live ?? INITIAL_LIVE_AGENTS_STATE}
        evidence={evidence ?? INITIAL_LIVE_EVIDENCE_STATE}
        snapshot={snapshot}
        agentsText={agentsText}
      />
    );
  }

  return (
    <div className="flex flex-col" data-testid="mc-owner-overview">
      {(snapshot.mode === "demo" || snapshot.mode === "mixed") && (
        <DemoDataBanner mode={snapshot.mode} liveParts={liveParts} />
      )}

      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 space-y-4">
        <section aria-labelledby="mc-summary-heading" className="rounded-xl border border-white/10 bg-dark-900/50 p-4">
          <h2 id="mc-summary-heading" className="text-sm font-bold uppercase tracking-wider text-white">
            One-minute view{" "}
            <span className="ml-1 text-xs font-mono font-normal text-semantic-warning">
              {snapshot.mode !== "mixed"
                ? "(demo)"
                : liveParts.evidence
                  ? "(mostly demo — live observations listed separately)"
                  : "(mostly demo — only agent processes live)"}
            </span>
          </h2>
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div className="min-w-0">
              <dt className="text-xs text-white/60">Owner inbox (demo)</dt>
              <dd className="text-white" data-testid="mc-summary-needs">
                {inbox.length} open{oldestAge !== null ? ` · oldest ${formatAge(oldestAge)}` : ""}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-white/60">Agents</dt>
              <dd className="text-white" data-testid="mc-summary-agents">
                {agentsText}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-white/60">Biggest recorded blocker</dt>
              <dd className="text-white break-words" data-testid="mc-summary-blocker">
                {blocker ? `${blocker.name} — demo, unverified, see Project radar` : "none recorded"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-white/60">Freshness</dt>
              <dd className="text-white" data-testid="mc-summary-freshness">
                {liveSourceCount} live {liveSourceCount === 1 ? "source" : "sources"} · {staleOrUnknownTotal} stale or
                unchecked
              </dd>
            </div>
          </dl>
        </section>

        <JumpNav links={jumpLinks} />

        <OwnerInbox items={snapshot.inbox} nowMs={nowMs} />
        <AgentBoard agents={snapshot.agents} nowMs={nowMs} live={live} />
        {evidence && <LiveEvidence live={evidence} nowMs={nowMs} />}
        <ProjectRadar projects={snapshot.projects} nowMs={nowMs} />
        <DeliverablesRisks
          deliverables={snapshot.deliverables}
          risks={snapshot.risks}
          staleOrUnknownCount={staleOrUnknownTotal}
          nowMs={nowMs}
        />

        <p className="text-xs text-white/60 pb-4" data-testid="mc-readonly-note">
          Read-only slice. Dispatch, cancel, approve, save and send controls are intentionally absent: no owner
          authentication or payload-bound approval exists. See docs/mission-control-owner-overview.md.
        </p>
      </div>
    </div>
  );
}

function SummaryItem({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-white/60">{label}</dt>
      <dd className="text-white break-words" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

/** Runtime view: route observations only; panels without a source say NOT CONNECTED. */
function ObservedOverview({
  snapshot,
  nowMs,
  live,
  evidence,
  agentsText,
}: {
  snapshot: OwnerOverviewSnapshot;
  nowMs: number;
  live: LiveAgentsState;
  evidence: LiveEvidenceState;
  agentsText: string;
}) {
  const agentDisplay = agentSourceDisplay(live, nowMs);
  const evidenceDisplay = Object.fromEntries(
    EVIDENCE_SOURCE_IDS.map((id) => [
      id,
      evidenceSourceDisplay(evidence.observation?.sources.find((s) => s.id === id), evidence.connector, nowMs),
    ])
  ) as Record<EvidenceSourceId, EvidenceSourceDisplay>;
  const coverage = sourceCoverage(agentDisplay, evidenceDisplay);
  const totalSources = 1 + EVIDENCE_SOURCE_IDS.length;
  const liveCount = (agentDisplay === "live" ? 1 : 0) + liveEvidenceSourceIds(evidence, nowMs).length;
  const observedAgentsText = agentDisplay === "live"
    ? agentsText
    : agentDisplay === "held" || agentDisplay === "stale"
      ? `${agentDisplay.toUpperCase()} — last reported: ${agentsText}`
      : agentDisplay === "connecting"
        ? "CONNECTING — state unknown"
        : "NOT CONNECTED — state unknown";

  return (
    <div className="flex flex-col" data-testid="mc-owner-overview">
      <SourceCoverageBanner agents={agentDisplay} evidence={evidenceDisplay} />

      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 space-y-4">
        <section aria-labelledby="mc-summary-heading" className="rounded-xl border border-white/10 bg-dark-900/50 p-4">
          <h2 id="mc-summary-heading" className="text-sm font-bold uppercase tracking-wider text-white">
            One-minute view{" "}
            <span className="ml-1 text-xs font-mono font-normal text-semantic-warning">
              {coverage === "partial"
                ? "(observed sources only — partial coverage)"
                : coverage === "held"
                  ? "(no current source — held or stale observations only)"
                  : "(not connected — unknown)"}
            </span>
          </h2>
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <SummaryItem label="Owner inbox" testId="mc-summary-needs">
              NOT CONNECTED — unknown (no inbox source)
            </SummaryItem>
            <SummaryItem label="Agents" testId="mc-summary-agents">
              {observedAgentsText}
            </SummaryItem>
            <SummaryItem label="Biggest recorded blocker" testId="mc-summary-blocker">
              UNKNOWN — no project source connected
            </SummaryItem>
            <SummaryItem label="Freshness" testId="mc-summary-freshness">
              {liveCount} of {totalSources} observed sources live · {totalSources - liveCount} not currently live
              (unknown, unavailable, held or stale) · {NOT_CONNECTED_PANELS} panels not connected
            </SummaryItem>
          </dl>
        </section>

        <JumpNav links={OBSERVED_JUMP_LINKS} />

        <OwnerInbox items={[]} nowMs={nowMs} notConnected />
        <AgentBoard agents={snapshot.agents} nowMs={nowMs} live={live} />
        <LiveEvidence live={evidence} nowMs={nowMs} observedMode />
        <ProjectRadar projects={[]} nowMs={nowMs} notConnected />
        <ObservedArtifacts live={evidence} nowMs={nowMs} />

        <p className="text-xs text-white/60 pb-4" data-testid="mc-readonly-note">
          Read-only slice. Dispatch, cancel, approve, save and send controls are intentionally absent: no owner
          authentication or payload-bound approval exists. See docs/mission-control-owner-overview.md.
        </p>
      </div>
    </div>
  );
}
