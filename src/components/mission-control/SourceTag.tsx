// ═══════════════════════════════════════════════════════════════
// SourceTag — source + freshness cue rendered under every status
// ═══════════════════════════════════════════════════════════════

import { assessFreshness, formatAge, formatUtc, SOURCE_KIND_LABEL } from "./freshness";
import type { SourceStamp } from "./types";

const KIND_CLASSES: Record<SourceStamp["kind"], string> = {
  demo: "border-semantic-warning/40 text-semantic-warning",
  not_connected: "border-white/20 text-white/60",
  live: "border-semantic-success/40 text-semantic-success",
};

export default function SourceTag({ stamp, nowMs }: { stamp: SourceStamp; nowMs: number }) {
  const freshness = assessFreshness(stamp, nowMs);
  const simulated = stamp.kind === "demo" ? "simulated " : "";

  let freshnessText: React.ReactNode;
  if (freshness.state === "unknown" || !stamp.checkedAt || freshness.ageMinutes === null) {
    freshnessText = <span>No successful check on record</span>;
  } else {
    const when = (
      <time dateTime={stamp.checkedAt} title={formatUtc(stamp.checkedAt)}>
        {formatAge(freshness.ageMinutes)} ({formatUtc(stamp.checkedAt)})
      </time>
    );
    freshnessText =
      freshness.state === "stale" ? (
        <span className="text-semantic-warning">
          STALE — {simulated}last success {when}
        </span>
      ) : (
        <span>
          {simulated}check {when}
        </span>
      );
  }

  return (
    <p
      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-snug font-mono text-white/60"
      data-testid="mc-source-tag"
      data-freshness={freshness.state}
      data-source-kind={stamp.kind}
    >
      <span className={`rounded border px-1.5 py-0.5 ${KIND_CLASSES[stamp.kind]}`}>
        {SOURCE_KIND_LABEL[stamp.kind]}
      </span>
      <span>
        <span className="sr-only">Source: </span>
        {stamp.source}
      </span>
      <span aria-hidden="true">·</span>
      {freshnessText}
    </p>
  );
}
