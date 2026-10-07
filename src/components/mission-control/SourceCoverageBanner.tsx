// ═══════════════════════════════════════════════════════════════
// SourceCoverageBanner — runtime (observed-mode) data-source notice
// ═══════════════════════════════════════════════════════════════
// States which sources are live, held, stale or not connected right now.
// Never says "demo" (no fixture data is shown) and never "live" for the
// page as a whole: owner inbox and project radar have no source.

import { ShieldAlert } from "lucide-react";
import type { AgentSourceDisplay } from "./live-agents";
import type { EvidenceSourceDisplay, EvidenceSourceId } from "./live-evidence";

/** `partial`: some source is live. `held`: only held/stale observations. `none`: nothing observed. */
export type SourceCoverage = "partial" | "held" | "none";

const AGENT_LABEL: Record<AgentSourceDisplay, string> = {
  live: "LIVE",
  held: "HELD",
  stale: "STALE",
  connecting: "CONNECTING",
  not_connected: "NOT CONNECTED",
};

const EVIDENCE_LABEL: Record<EvidenceSourceDisplay, string> = {
  live: "LIVE",
  held: "HELD",
  stale: "STALE",
  unavailable: "UNAVAILABLE",
  unknown: "UNKNOWN",
};

const EVIDENCE_NAME: Record<EvidenceSourceId, string> = {
  hermes: "Hermes schedule",
  github: "GitHub PRs",
  drive: "Drive files",
};

export function sourceCoverage(
  agents: AgentSourceDisplay,
  evidence: Record<EvidenceSourceId, EvidenceSourceDisplay>
): SourceCoverage {
  const states: string[] = [agents, ...Object.values(evidence)];
  if (states.includes("live")) return "partial";
  if (states.includes("held") || states.includes("stale")) return "held";
  return "none";
}

export default function SourceCoverageBanner({
  agents,
  evidence,
}: {
  agents: AgentSourceDisplay;
  evidence: Record<EvidenceSourceId, EvidenceSourceDisplay>;
}) {
  const coverage = sourceCoverage(agents, evidence);
  const connecting = agents === "connecting" && Object.values(evidence).every((d) => d === "unknown");
  const title =
    coverage === "partial"
      ? "OBSERVED DATA ONLY · PARTIAL COVERAGE · PAGE NOT FULLY CONNECTED"
      : coverage === "held"
        ? "OBSERVED DATA ONLY · NO CURRENT SOURCE · LAST OBSERVATIONS HELD OR STALE"
        : connecting
          ? "CONNECTING · STATE UNKNOWN"
          : "NOT CONNECTED · STATE UNKNOWN";
  const parts = [
    `Agent processes: ${AGENT_LABEL[agents]}`,
    ...(Object.keys(EVIDENCE_NAME) as EvidenceSourceId[]).map((id) => `${EVIDENCE_NAME[id]}: ${EVIDENCE_LABEL[evidence[id]]}`),
    "Owner inbox and project radar: NOT CONNECTED (no authoritative source)",
  ];
  return (
    <aside
      aria-label="Data source notice"
      data-testid="mc-source-banner"
      data-mode="observed"
      data-coverage={coverage}
      className="border-b border-semantic-warning/40 bg-dark-900/80 px-4 py-2"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
        <ShieldAlert className="w-4 h-4 text-semantic-warning shrink-0" aria-hidden="true" />
        <strong className="text-semantic-warning tracking-wide">{title}</strong>
        <span className="text-white/70">
          {parts.join(" · ")}. Only route observations are shown; nothing is filled in. Read-only: nothing on this
          page can dispatch, cancel, approve, save or send.
        </span>
      </div>
    </aside>
  );
}
