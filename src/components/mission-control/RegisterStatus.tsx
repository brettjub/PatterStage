// ═══════════════════════════════════════════════════════════════
// Owner register — shared read-state, owner-review and link cues
// ═══════════════════════════════════════════════════════════════
// Used by the owner inbox and project radar. The register read time
// (`checkedAt`) and each row's `ownerReviewedAt` are always shown as
// two separate facts: a fresh read never implies a fresh review.

import { ExternalLink } from "lucide-react";
import { formatAge, formatUtc } from "./freshness";
import {
  minutesSince,
  ownerReviewStatus,
  registerSourceDisplay,
  type RegisterDisplay,
  type RegisterState,
} from "./live-register";

export const REGISTER_DISPLAY_CHIP: Record<RegisterDisplay, { text: string; classes: string }> = {
  live: { text: "LIVE READ", classes: "border-semantic-success/40 text-semantic-success" },
  held: { text: "HELD — LAST READ FAILED", classes: "border-semantic-warning/50 border-dashed text-semantic-warning" },
  stale: { text: "STALE", classes: "border-semantic-warning/50 border-dashed text-semantic-warning" },
  unavailable: { text: "UNAVAILABLE", classes: "border-semantic-danger/40 border-dashed text-semantic-danger" },
  connecting: { text: "CONNECTING", classes: "border-white/20 border-dashed text-white/60" },
  unknown: { text: "UNKNOWN", classes: "border-white/20 border-dashed text-white/60" },
};

/** "read just now (…)" / "last successful read 2m ago (…)" / "STALE — last successful read …". */
export function registerReadText(register: RegisterState, nowMs: number): string {
  const checkedAt = register.observation?.checkedAt;
  const age = minutesSince(checkedAt, nowMs);
  if (!checkedAt || age === null) return "No successful read on record";
  const when = `${formatAge(age)} (${formatUtc(checkedAt)})`;
  const display = registerSourceDisplay(register, nowMs);
  if (display === "stale") return `STALE — last successful read ${when}`;
  return display === "live" ? `read ${when}` : `last successful read ${when}`;
}

/** Panel header: register read state, read time and the latest poll error. */
export function RegisterReadStatus({ register, nowMs }: { register: RegisterState; nowMs: number }) {
  const display = registerSourceDisplay(register, nowMs);
  const chip = REGISTER_DISPLAY_CHIP[display];
  return (
    <div className="mb-3 text-[11px] font-mono text-white/60" data-register-display={display}>
      <p className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 font-semibold ${chip.classes}`} data-testid="mc-register-state">
          {chip.text}
        </span>
        <span>Owner register (manually maintained)</span>
        <span aria-hidden="true">·</span>
        <span data-testid="mc-register-read" className={display === "stale" ? "text-semantic-warning" : undefined}>
          {registerReadText(register, nowMs)}
        </span>
      </p>
      {register.connector === "unavailable" && register.lastError && (
        <p className="mt-1 text-semantic-warning" role="status" data-testid="mc-register-error">
          Latest read failed: {register.lastError}.
          {register.observation ? " Showing the last successful read — not current." : ""}
        </p>
      )}
    </div>
  );
}

/** Per-row owner review, kept apart from the register read time. */
export function OwnerReviewLine({ ownerReviewedAt, nowMs }: { ownerReviewedAt?: string; nowMs: number }) {
  const review = ownerReviewStatus(ownerReviewedAt, nowMs);
  if (review.state === "unverified" || !ownerReviewedAt || review.ageMinutes === null) {
    return <span>UNVERIFIED — No owner review recorded</span>;
  }
  const when = (
    <time dateTime={ownerReviewedAt}>
      {formatAge(review.ageMinutes)} ({formatUtc(ownerReviewedAt)})
    </time>
  );
  return review.state === "review_stale" ? (
    <span className="text-semantic-warning">OWNER REVIEW STALE — last reviewed {when}</span>
  ) : (
    <span>Owner reviewed {when}</span>
  );
}

/** Row provenance: register read + owner review, plus the row's source link when allowed. */
export function RegisterRowProvenance({
  register,
  ownerReviewedAt,
  sourceUrl,
  sourceUrlWithheld,
  nowMs,
}: {
  register: RegisterState;
  ownerReviewedAt?: string;
  sourceUrl?: string;
  sourceUrlWithheld?: boolean;
  nowMs: number;
}) {
  return (
    <div className="mt-2 space-y-0.5 text-[11px] leading-snug font-mono text-white/60" data-testid="mc-register-row-source">
      <p>
        <OwnerReviewLine ownerReviewedAt={ownerReviewedAt} nowMs={nowMs} />
      </p>
      <p>Owner register · {registerReadText(register, nowMs)}</p>
      {sourceUrl && (
        <p>
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline decoration-white/30 underline-offset-2 hover:text-neon-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan/60 rounded-sm"
          >
            Source
            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </p>
      )}
      {sourceUrlWithheld && (
        <p className="text-white/50" data-testid="mc-register-link-withheld">
          Source link withheld: not an allowed https Google Drive or GitHub address.
        </p>
      )}
    </div>
  );
}
