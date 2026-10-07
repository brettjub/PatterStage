// ═══════════════════════════════════════════════════════════════
// Observed artifacts — Drive / GitHub items the evidence route returned
// ═══════════════════════════════════════════════════════════════
// Runtime replacement for the deliverables placeholder. Items are
// observed artifacts only: not completed deliverables and not linked to
// any task. Each source keeps its own state and last-success time, so a
// held, stale or unavailable source never reads as current or as zero.

import { Archive } from "lucide-react";
import Section from "./Section";
import { ItemRow, SourceFreshness, SourceStateChip } from "./LiveEvidence";
import {
  evidenceSourceDisplay,
  type EvidenceSource,
  type EvidenceSourceDisplay,
  type EvidenceSourceId,
  type LiveEvidenceState,
} from "./live-evidence";

const SHELF_SOURCES: { id: EvidenceSourceId; name: string; scope: string }[] = [
  {
    id: "drive",
    name: "Google Drive files",
    scope: "Direct children of the selected folder. Metadata only; contents are not read.",
  },
  {
    id: "github",
    name: "GitHub pull requests",
    scope: "Recent PatterStage PRs. PR state or a green check is not a merge, deploy or release approval.",
  },
];

function EmptyText({ display, source }: { display: EvidenceSourceDisplay; source: EvidenceSource | undefined }) {
  if (display === "unavailable") return <>Source unavailable — it could not be read. This is not zero.</>;
  if (!source || display === "unknown") return <>Not connected — state unknown.</>;
  if (display === "live") return <>Source live — this bounded query returned 0 items.</>;
  return <>The last successful check returned 0 items.</>;
}

function ShelfSource({
  id,
  name,
  scope,
  live,
  nowMs,
}: {
  id: EvidenceSourceId;
  name: string;
  scope: string;
  live: LiveEvidenceState;
  nowMs: number;
}) {
  const source = live.observation?.sources.find((s) => s.id === id);
  const display = evidenceSourceDisplay(source, live.connector, nowMs);
  const headingId = `mc-artifacts-${id}-heading`;
  return (
    <li
      className="rounded-lg border border-white/10 bg-dark-950/40 p-3 min-w-0"
      data-testid="mc-artifact-source"
      data-source-id={id}
      data-display={display}
      aria-labelledby={headingId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="text-sm font-semibold text-white">
          {name}
        </h3>
        <SourceStateChip display={display} />
      </div>
      <p className="mt-1 text-xs text-white/60">{scope}</p>
      <SourceFreshness source={source} display={display} nowMs={nowMs} />
      {source && source.items.length > 0 ? (
        <ul className="mt-2 space-y-2" aria-label={`${name} observed artifacts`}>
          {source.items.map((item) => (
            <ItemRow key={item.id} item={item} sourceId={id} nowMs={nowMs} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-white/70" data-testid="mc-artifact-source-empty">
          <EmptyText display={display} source={source} />
        </p>
      )}
    </li>
  );
}

export default function ObservedArtifacts({ live, nowMs }: { live: LiveEvidenceState; nowMs: number }) {
  return (
    <Section
      id="observed-artifacts"
      title="Observed artifacts"
      icon={Archive}
      description="Files and pull requests the evidence route observed. These are observed artifacts — not completed deliverables, and not linked to any task, project status or approval."
    >
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="Observed artifact sources">
        {SHELF_SOURCES.map((s) => (
          <ShelfSource key={s.id} id={s.id} name={s.name} scope={s.scope} live={live} nowMs={nowMs} />
        ))}
      </ul>
    </Section>
  );
}
