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

export default function DemoDataBanner({ mode = "demo" }: { mode?: "demo" | "mixed" }) {
  const copy = COPY[mode];
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
