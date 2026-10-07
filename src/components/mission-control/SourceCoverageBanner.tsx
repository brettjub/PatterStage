// ═══════════════════════════════════════════════════════════════
// SourceCoverageBanner — runtime (observed-mode) data-source notice
// ═══════════════════════════════════════════════════════════════
// States which sources are live, held, stale or not connected right now.
// Never says "demo" (no fixture data is shown) and never "live" for the
// page as a whole. The owner register, when polled, is a manually kept
// sheet: a LIVE READ is a successful read, not a verified status.

import { ExternalLink, ShieldAlert } from "lucide-react";
import type { AgentSourceDisplay } from "./live-agents";
import type { EvidenceSourceDisplay, EvidenceSourceId } from "./live-evidence";
import type { RegisterDisplay } from "./live-register";

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

const REGISTER_LABEL: Record<RegisterDisplay, string> = {
  live: "LIVE READ",
  held: "HELD",
  stale: "STALE",
  unavailable: "UNAVAILABLE",
  connecting: "CONNECTING",
  unknown: "UNKNOWN",
};

const EVIDENCE_NAME: Record<EvidenceSourceId, string> = {
  hermes: "Hermes schedule",
  github: "GitHub PRs",
  drive: "Drive files",
};

export function sourceCoverage(
  agents: AgentSourceDisplay,
  evidence: Record<EvidenceSourceId, EvidenceSourceDisplay>,
  register?: RegisterDisplay
): SourceCoverage {
  const states: string[] = [agents, ...Object.values(evidence), ...(register ? [register] : [])];
  if (states.includes("live")) return "partial";
  if (states.includes("held") || states.includes("stale")) return "held";
  return "none";
}

/** Owner register poll as the banner reports it; `sheetUrl` is already allowlisted (null = withheld or none). */
export interface RegisterBannerInfo {
  display: RegisterDisplay;
  sheetUrl: string | null;
  sheetUrlWithheld: boolean;
}

function RegisterSheetLink({ register }: { register: RegisterBannerInfo }) {
  if (register.sheetUrl) {
    return (
      <a
        href={register.sheetUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-neon-cyan underline decoration-neon-cyan/40 underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan/60 rounded-sm"
      >
        Edit source register
        <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span className="sr-only">(opens the Google Sheet in a new tab; edits happen there, not on this page)</span>
      </a>
    );
  }
  if (register.sheetUrlWithheld) {
    return (
      <span className="text-white/50" data-testid="mc-register-sheet-withheld">
        Register link withheld: not an allowed Google Sheets address.
      </span>
    );
  }
  return null;
}

export default function SourceCoverageBanner({
  agents,
  evidence,
  register,
}: {
  agents: AgentSourceDisplay;
  evidence: Record<EvidenceSourceId, EvidenceSourceDisplay>;
  /** Omit when the owner register is not polled: inbox and radar then read NOT CONNECTED. */
  register?: RegisterBannerInfo;
}) {
  const coverage = sourceCoverage(agents, evidence, register?.display);
  const connecting =
    agents === "connecting" &&
    Object.values(evidence).every((d) => d === "unknown") &&
    (!register || register.display === "connecting");
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
    register
      ? `Owner register: ${REGISTER_LABEL[register.display]} (owner inbox + project radar; manually maintained sheet — a successful read is not verification of recorded status)`
      : "Owner inbox and project radar: NOT CONNECTED (no authoritative source)",
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
        {register && <RegisterSheetLink register={register} />}
      </div>
    </aside>
  );
}
