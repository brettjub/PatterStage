// ═══════════════════════════════════════════════════════════════
// Owner Overview — one-minute, read-only Mission Control view
// ═══════════════════════════════════════════════════════════════
// Pure render of an `OwnerOverviewSnapshot` at a given `nowMs`.
// Contains no fetches and no action controls; live agent and evidence
// polling live in `MissionControlClient.tsx` and arrive via props.

import AgentBoard from "./AgentBoard";
import DeliverablesRisks from "./DeliverablesRisks";
import DemoDataBanner from "./DemoDataBanner";
import LiveEvidence from "./LiveEvidence";
import OwnerInbox, { sortInboxOldestFirst } from "./OwnerInbox";
import ProjectRadar from "./ProjectRadar";
import type { LiveAgentsState } from "./live-agents";
import { EVIDENCE_SOURCE_IDS, liveEvidenceSourceIds, type LiveEvidenceState } from "./live-evidence";
import { assessFreshness, displayedAgentState, formatAge, type DisplayedAgentState } from "./freshness";
import type { OwnerOverviewSnapshot, SourceStamp } from "./types";

const JUMP_LINKS = [
  { href: "#owner-inbox", label: "Owner inbox" },
  { href: "#agent-board", label: "Agents" },
  { href: "#project-radar", label: "Projects" },
  { href: "#deliverables-risks", label: "Deliverables & risks" },
] as const;

const EVIDENCE_JUMP_LINK = { href: "#live-evidence", label: "Live evidence" } as const;

const AGENT_SUMMARY_ORDER: DisplayedAgentState[] = [
  "running",
  "paused",
  "idle",
  "blocked",
  "offline",
  "stale",
  "unknown",
];

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

  return (
    <div className="flex flex-col" data-testid="mc-owner-overview">
      {snapshot.mode !== "live" && <DemoDataBanner mode={snapshot.mode} liveParts={liveParts} />}

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

        <nav aria-label="Owner overview sections">
          <ul className="flex flex-wrap gap-2">
            {jumpLinks.map((l) => (
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
