// ═══════════════════════════════════════════════════════════════
// Deliverables / risks — placeholder until an evidence source exists
// ═══════════════════════════════════════════════════════════════

import { PackageOpen } from "lucide-react";
import Section from "./Section";
import SourceTag from "./SourceTag";
import type { DeliverableEntry, RiskEntry, SourceStamp } from "./types";

const SEVERITY_LABEL: Record<RiskEntry["severity"], { text: string; classes: string }> = {
  info: { text: "Info", classes: "text-semantic-info" },
  warning: { text: "Warning", classes: "text-semantic-warning" },
  danger: { text: "Risk", classes: "text-semantic-danger" },
};

interface DeliverablesRisksProps {
  deliverables: { stamp: SourceStamp; items: DeliverableEntry[] };
  risks: RiskEntry[];
  /** Count of statuses on this page whose source is stale or never checked. */
  staleOrUnknownCount: number;
  nowMs: number;
}

export default function DeliverablesRisks({
  deliverables,
  risks,
  staleOrUnknownCount,
  nowMs,
}: DeliverablesRisksProps) {
  return (
    <Section
      id="deliverables-risks"
      title="Deliverables & risks"
      icon={PackageOpen}
      description="Placeholder. No evidence shelf is connected, so nothing is listed rather than invented."
    >
      <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70">Newest deliverables</h3>
      {deliverables.items.length === 0 ? (
        <div className="mt-1 rounded-lg border border-dashed border-white/20 p-3" data-testid="mc-deliverables-empty">
          <p className="text-sm text-white/70">Not connected — no deliverables to show.</p>
          <SourceTag stamp={deliverables.stamp} nowMs={nowMs} />
        </div>
      ) : (
        <ul className="mt-1 space-y-2">
          {deliverables.items.map((d) => (
            <li key={d.id} className="rounded-lg border border-white/10 p-3">
              <p className="text-sm text-white">{d.title}</p>
              <p className="text-xs font-mono text-white/60">{d.project}</p>
              <SourceTag stamp={d.stamp} nowMs={nowMs} />
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-white/70">Risks</h3>
      <ul className="mt-1 space-y-2" aria-label="Risks">
        <li className="rounded-lg border border-white/10 p-3" data-testid="mc-risk-stale-count">
          <p className="text-sm text-white">
            <span className="font-mono font-semibold text-semantic-warning">Warning</span> · {staleOrUnknownCount}{" "}
            {staleOrUnknownCount === 1 ? "status has" : "statuses have"} a stale or missing check
          </p>
          <p className="mt-1 text-xs text-white/60">Computed on this page from the source timestamps shown below each row.</p>
        </li>
        {risks.map((r) => {
          const sev = SEVERITY_LABEL[r.severity];
          return (
            <li key={r.id} className="rounded-lg border border-white/10 p-3">
              <p className="text-sm text-white">
                <span className={`font-mono font-semibold ${sev.classes}`}>{sev.text}</span> · {r.label}
              </p>
              <p className="mt-1 text-xs text-white/60">{r.detail}</p>
              <SourceTag stamp={r.stamp} nowMs={nowMs} />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
