// ═══════════════════════════════════════════════════════════════
// Live evidence — read-only Hermes / GitHub / Drive observations
// ═══════════════════════════════════════════════════════════════
// A separate section from the other panels: evidence listed here does
// not make any project, inbox item or radar row live. Each source
// shows its own status, so "unavailable" never reads as zero or idle.
// The item row, state chip and freshness line are reused by the
// Observed artifacts shelf.

import { ExternalLink, FileSearch } from "lucide-react";
import Section from "./Section";
import { TextChip } from "./StateChip";
import { formatAge, formatUtc } from "./freshness";
import {
  EVIDENCE_ROUTE,
  EVIDENCE_SOURCE_IDS,
  EVIDENCE_STALE_AFTER_MINUTES,
  evidenceAgeMinutes,
  evidenceSourceDisplay,
  type EvidenceItem,
  type EvidenceItemKind,
  type EvidenceSource,
  type EvidenceSourceDisplay,
  type EvidenceSourceId,
  type LiveEvidenceState,
} from "./live-evidence";

const SOURCE_COPY: Record<EvidenceSourceId, { name: string; scope: string; statusLabel: string }> = {
  hermes: {
    name: "Hermes tasks & runs",
    scope: "Only task and run records the Hermes route actually returned. Not an agent assignment or project status.",
    statusLabel: "Recorded state",
  },
  github: {
    name: "GitHub pull requests",
    scope: "PR state and checks only. A PR or green check is not a merge, deploy or release approval.",
    statusLabel: "PR / checks",
  },
  drive: {
    name: "Google Drive documents",
    scope: "File metadata only. Document contents are not read or shown.",
    statusLabel: "Metadata",
  },
};

const KIND_LABEL: Record<EvidenceItemKind, string> = {
  task: "Task",
  run: "Run",
  pull_request: "Pull request",
  document: "Document",
};

export const DISPLAY_CHIP: Record<EvidenceSourceDisplay, { text: string; classes: string }> = {
  live: { text: "LIVE", classes: "border-semantic-success/40 text-semantic-success" },
  held: { text: "HELD — LAST POLL FAILED", classes: "border-semantic-warning/50 border-dashed text-semantic-warning" },
  stale: { text: "STALE", classes: "border-semantic-warning/50 border-dashed text-semantic-warning" },
  unavailable: { text: "UNAVAILABLE", classes: "border-semantic-danger/40 border-dashed text-semantic-danger" },
  unknown: { text: "UNKNOWN", classes: "border-white/20 border-dashed text-white/60" },
};

function Checked({ iso, nowMs, stale }: { iso: string | null; nowMs: number; stale: boolean }) {
  const age = evidenceAgeMinutes(iso, nowMs);
  if (!iso || age === null) return <span>No successful check on record</span>;
  const when = (
    <time dateTime={iso}>
      {formatAge(age)} ({formatUtc(iso)})
    </time>
  );
  return stale ? (
    <span className="text-semantic-warning">STALE — last success {when}</span>
  ) : (
    <span>checked {when}</span>
  );
}

function EmptyText({ display, source }: { display: EvidenceSourceDisplay; source: EvidenceSource | undefined }) {
  if (display === "unavailable") {
    return <>Source unavailable — it could not be read. This is not zero and not idle.</>;
  }
  if (!source) return <>No evidence observation yet — state unknown.</>;
  if (display === "live") return <>Source live — returned 0 items.</>;
  return <>The last successful check returned 0 items.</>;
}

export function ItemRow({ item, sourceId, nowMs }: { item: EvidenceItem; sourceId: EvidenceSourceId; nowMs: number }) {
  const age = evidenceAgeMinutes(item.observedAt, nowMs);
  return (
    <li className="rounded-md border border-white/10 p-2 min-w-0" data-testid="mc-evidence-item" data-kind={item.kind}>
      <p className="text-sm text-white break-words">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-start gap-1 underline decoration-white/30 underline-offset-2 hover:text-neon-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan/60 rounded-sm"
          >
            <span className="break-words">{item.title}</span>
            <ExternalLink className="mt-0.5 w-3 h-3 shrink-0" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          item.title
        )}
      </p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
        <dt className="text-white/50">{SOURCE_COPY[sourceId].statusLabel}</dt>
        <dd className="min-w-0 break-words" data-testid="mc-evidence-item-status">
          <TextChip>{item.status}</TextChip>
          <span className="ml-2 text-white/60">{KIND_LABEL[item.kind]}</span>
        </dd>
        {item.project && (
          <>
            <dt className="text-white/50">Project</dt>
            <dd className="min-w-0 break-words font-mono text-white/70">{item.project}</dd>
          </>
        )}
        <dt className="text-white/50">Observed</dt>
        <dd className="font-mono text-white/70">
          {age === null ? (
            "time unknown"
          ) : (
            <time dateTime={item.observedAt}>
              {formatAge(age)} ({formatUtc(item.observedAt)})
            </time>
          )}
        </dd>
      </dl>
      {item.note && <p className="mt-1 text-xs text-white/60 break-words">{item.note}</p>}
      {item.urlWithheld && (
        <p className="mt-1 text-xs text-white/50" data-testid="mc-evidence-link-withheld">
          Link withheld: not an allowed https address for this source.
        </p>
      )}
    </li>
  );
}

export function SourceStateChip({ display }: { display: EvidenceSourceDisplay }) {
  const chip = DISPLAY_CHIP[display];
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[11px] font-mono font-semibold ${chip.classes}`}
      data-testid="mc-evidence-source-state"
    >
      {chip.text}
    </span>
  );
}

/** Last-success line for one source; an unavailable source never reads as current. */
export function SourceFreshness({
  source,
  display,
  nowMs,
}: {
  source: EvidenceSource | undefined;
  display: EvidenceSourceDisplay;
  nowMs: number;
}) {
  return (
    <p className="mt-1 text-[11px] font-mono text-white/60" data-testid="mc-evidence-source-checked">
      <span className="sr-only">Freshness: </span>
      {source?.status === "unavailable" ? (
        <span>
          Unavailable at the last poll
          {source.checkedAt ? (
            <>
              {" "}· last success <Checked iso={source.checkedAt} nowMs={nowMs} stale={false} />
            </>
          ) : (
            " · no successful check on record"
          )}
        </span>
      ) : (
        <Checked iso={source?.checkedAt ?? null} nowMs={nowMs} stale={display === "stale"} />
      )}
    </p>
  );
}

function SourceCard({ id, live, nowMs }: { id: EvidenceSourceId; live: LiveEvidenceState; nowMs: number }) {
  const source = live.observation?.sources.find((s) => s.id === id);
  const display = evidenceSourceDisplay(source, live.connector, nowMs);
  const copy = SOURCE_COPY[id];
  const headingId = `mc-evidence-${id}-heading`;

  return (
    <li
      className="rounded-lg border border-white/10 bg-dark-950/40 p-3 min-w-0"
      data-testid="mc-evidence-source"
      data-source-id={id}
      data-display={display}
      aria-labelledby={headingId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="text-sm font-semibold text-white">
          {copy.name}
        </h3>
        <SourceStateChip display={display} />
      </div>
      <p className="mt-1 text-xs text-white/60">{copy.scope}</p>
      <SourceFreshness source={source} display={display} nowMs={nowMs} />
      {source && source.items.length > 0 ? (
        <ul className="mt-2 space-y-2" aria-label={`${copy.name} evidence`}>
          {source.items.map((item) => (
            <ItemRow key={item.id} item={item} sourceId={id} nowMs={nowMs} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-white/70" data-testid="mc-evidence-source-empty">
          <EmptyText display={display} source={source} />
        </p>
      )}
    </li>
  );
}

function ConnectorLine({ live, nowMs }: { live: LiveEvidenceState; nowMs: number }) {
  const { connector, observation, lastError } = live;
  let text: React.ReactNode;
  if (connector === "connecting") {
    text = <span>Connecting — no evidence observation yet. Every source is unknown.</span>;
  } else if (connector === "connected") {
    text = <span className="text-semantic-success">Evidence route OK — last poll succeeded.</span>;
  } else if (observation) {
    const age = evidenceAgeMinutes(observation.checkedAt, nowMs);
    text = (
      <span className="text-semantic-warning">
        EVIDENCE ROUTE UNAVAILABLE ({lastError}). Holding the last observation
        {age !== null ? ` from ${formatAge(age)} (${formatUtc(observation.checkedAt)})` : ""}; no source is shown as
        live until a poll succeeds.
      </span>
    );
  } else {
    text = (
      <span className="text-semantic-warning">
        NOT CONNECTED — evidence route unavailable ({lastError}). Every source is unknown; nothing is shown.
      </span>
    );
  }
  return (
    <p className="text-xs" role="status" data-testid="mc-evidence-connector" data-connector={connector}>
      {text}
    </p>
  );
}

export default function LiveEvidence({
  live,
  nowMs,
  observedMode = false,
}: {
  live: LiveEvidenceState;
  nowMs: number;
  /** Runtime page: no demo panels exist, so the description must not mention them. */
  observedMode?: boolean;
}) {
  const separateFrom = observedMode ? "separate from the other panels" : "separate from the demo panels";
  return (
    <Section
      id="live-evidence"
      title="Live evidence"
      icon={FileSearch}
      description={`Read-only observations from ${EVIDENCE_ROUTE}, ${separateFrom}. Evidence here does not make any inbox item or project live. Sources go STALE ${EVIDENCE_STALE_AFTER_MINUTES} minutes after their last successful check.`}
    >
      <ConnectorLine live={live} nowMs={nowMs} />
      <ul className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3" aria-label="Evidence sources">
        {EVIDENCE_SOURCE_IDS.map((id) => (
          <SourceCard key={id} id={id} live={live} nowMs={nowMs} />
        ))}
      </ul>
    </Section>
  );
}
