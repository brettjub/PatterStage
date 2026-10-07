// ═══════════════════════════════════════════════════════════════
// DemoDataBanner — persistent DEMO / MIXED / NOT LIVE notice
// ═══════════════════════════════════════════════════════════════

import { ShieldAlert } from "lucide-react";

const COPY = {
  demo: {
    title: "DEMO · NOT CONNECTED · NOT LIVE",
    body: "Synthetic fixture data. No project, inbox or business system is being read.",
  },
  mixed: {
    title: "MIXED · DEMO DATA + LIVE AGENT PROCESS OBSERVATION · PAGE NOT LIVE",
    body: "Only the agent board reflects a live process observation (check its freshness). Owner inbox, projects and deliverables are synthetic demo data.",
  },
} as const;

/** Which sections have carried a live observation; drives the mixed-mode wording. */
export interface LiveParts {
  agents: boolean;
  evidence: boolean;
}

function mixedCopy(parts: LiveParts): { title: string; body: string } {
  if (!parts.evidence) return COPY.mixed;
  const live = parts.agents ? "the agent board and the Live evidence section reflect" : "the Live evidence section reflects";
  return {
    title: "MIXED · DEMO DATA + LIVE OBSERVATIONS · PAGE NOT LIVE",
    body: `Only ${live} live observations (check each source's freshness). Owner inbox, project radar and deliverables are synthetic demo data; evidence does not make any project live.`,
  };
}

export default function DemoDataBanner({
  mode = "demo",
  liveParts = { agents: true, evidence: false },
}: {
  mode?: "demo" | "mixed";
  liveParts?: LiveParts;
}) {
  const copy = mode === "mixed" ? mixedCopy(liveParts) : COPY.demo;
  return (
    <aside
      aria-label="Data source notice"
      data-testid="mc-demo-banner"
      data-mode={mode}
      className="border-b border-semantic-warning/40 bg-dark-900/80 px-4 py-2"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
        <ShieldAlert className="w-4 h-4 text-semantic-warning shrink-0" aria-hidden="true" />
        <strong className="text-semantic-warning tracking-wide">{copy.title}</strong>
        <span className="text-white/70">
          {copy.body} Read-only: nothing on this page can dispatch, cancel, approve, save or send.
        </span>
      </div>
    </aside>
  );
}
