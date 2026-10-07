// ═══════════════════════════════════════════════════════════════
// Owner inbox — owner decisions and approvals, oldest first
// ═══════════════════════════════════════════════════════════════

import { Inbox } from "lucide-react";
import Section from "./Section";
import SourceTag from "./SourceTag";
import { TextChip } from "./StateChip";
import { formatAge } from "./freshness";
import { RegisterReadStatus, RegisterRowProvenance } from "./RegisterStatus";
import { registerSourceDisplay, type RegisterDecision, type RegisterState } from "./live-register";
import type { OwnerInboxItem } from "./types";

/** Items older than this are flagged. */
export const OVERDUE_AFTER_MINUTES = 3 * 24 * 60;

export function sortInboxOldestFirst(items: OwnerInboxItem[]): OwnerInboxItem[] {
  return [...items].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export function sortDecisionsOldestFirst(items: RegisterDecision[]): RegisterDecision[] {
  return [...items].sort((a, b) => Date.parse(a.raisedAt) - Date.parse(b.raisedAt));
}

function raisedAgeMinutes(iso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 60_000));
}

function RaisedLine({ project, raisedAt, nowMs }: { project: string; raisedAt: string; nowMs: number }) {
  const ageMinutes = raisedAgeMinutes(raisedAt, nowMs);
  return (
    <>
      <span className="text-xs font-mono text-white/60">{project}</span>
      <span className="text-xs font-mono text-white/60">· raised {formatAge(ageMinutes)}</span>
      {ageMinutes > OVERDUE_AFTER_MINUTES && (
        <span className="text-xs font-mono font-semibold text-semantic-warning">Older than 3 days</span>
      )}
    </>
  );
}

function TargetImpact({ target, impact }: { target: string; impact: string }) {
  return (
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
      <dt className="text-white/50">Target</dt>
      <dd className="text-white/80 min-w-0 break-words">{target}</dd>
      <dt className="text-white/50">Impact</dt>
      <dd className="text-white/80 min-w-0 break-words">{impact}</dd>
    </dl>
  );
}

function RegisterEmptyText({ register, nowMs }: { register: RegisterState; nowMs: number }) {
  const display = registerSourceDisplay(register, nowMs);
  if (display === "live") return <>0 open decisions recorded in register.</>;
  if (display === "connecting") return <>CONNECTING — owner register not read yet. Open decisions are unknown.</>;
  if (display === "unavailable") {
    return <>UNAVAILABLE — the owner register could not be read. Open decisions are unknown; this is not zero.</>;
  }
  return <>The last successful read recorded 0 open decisions; the current count is unknown.</>;
}

/** Inbox backed by the owner register: recorded decisions only, never an approval control. */
function RegisterInbox({ register, nowMs }: { register: RegisterState; nowMs: number }) {
  const decisions = sortDecisionsOldestFirst(register.observation?.decisions ?? []);
  const projectNames = new Map((register.observation?.projects ?? []).map((p) => [p.id, p.name]));
  return (
    <Section
      id="owner-inbox"
      title="Owner inbox"
      icon={Inbox}
      description="Open owner decisions as recorded in the owner register, oldest first. Read-only: decisions are made in the register, not on this page."
    >
      <RegisterReadStatus register={register} nowMs={nowMs} />
      {decisions.length === 0 ? (
        <p className="text-sm text-white/70" data-testid="mc-inbox-empty">
          <RegisterEmptyText register={register} nowMs={nowMs} />
        </p>
      ) : (
        <ul className="space-y-3" aria-label="Owner decisions recorded in register">
          {decisions.map((d) => (
            <li
              key={d.id}
              className="rounded-lg border border-white/10 bg-dark-950/40 p-3"
              data-testid="mc-inbox-item"
              data-decision-id={d.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                <TextChip>Decision</TextChip>
                <RaisedLine project={projectNames.get(d.projectId) ?? d.projectId} raisedAt={d.raisedAt} nowMs={nowMs} />
              </div>
              <h3 className="mt-2 text-sm font-semibold text-white">{d.title}</h3>
              <TargetImpact target={d.target} impact={d.impact} />
              <RegisterRowProvenance
                register={register}
                ownerReviewedAt={d.ownerReviewedAt}
                sourceUrl={d.sourceUrl}
                sourceUrlWithheld={d.sourceUrlWithheld}
                nowMs={nowMs}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export default function OwnerInbox({
  items,
  nowMs,
  notConnected = false,
  register,
}: {
  items: OwnerInboxItem[];
  nowMs: number;
  /** No authoritative inbox source exists: show NOT CONNECTED, never an empty or zero inbox. */
  notConnected?: boolean;
  /** Owner register poll state; when given, the inbox shows recorded decisions from it instead of `items`. */
  register?: RegisterState;
}) {
  if (register) return <RegisterInbox register={register} nowMs={nowMs} />;
  const sorted = sortInboxOldestFirst(items);
  if (notConnected) {
    return (
      <Section
        id="owner-inbox"
        title="Owner inbox"
        icon={Inbox}
        description="Owner decisions and approval requests, oldest first, once a source exists."
      >
        <p className="rounded-lg border border-dashed border-white/20 p-3 text-sm text-white/70" data-testid="mc-inbox-not-connected">
          NOT CONNECTED — no authoritative owner-inbox source exists yet. Pending decisions and approvals are unknown;
          this is not zero.
        </p>
      </Section>
    );
  }
  return (
    <Section
      id="owner-inbox"
      title="Owner inbox"
      icon={Inbox}
      description="Owner decisions and approval requests, oldest first. Synthetic example rows only — not real requests."
    >
      {sorted.length === 0 ? (
        <p className="text-sm text-white/60">No items from the configured source.</p>
      ) : (
        <ul className="space-y-3" aria-label="Owner decisions and approvals">
          {sorted.map((item) => {
            return (
              <li
                key={item.id}
                className="rounded-lg border border-white/10 bg-dark-950/40 p-3"
                data-testid="mc-inbox-item"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <TextChip>{item.kind === "decision" ? "Decision" : "Approval"}</TextChip>
                  <RaisedLine project={item.project} raisedAt={item.createdAt} nowMs={nowMs} />
                </div>
                <h3 className="mt-2 text-sm font-semibold text-white">{item.title}</h3>
                <TargetImpact target={item.target} impact={item.impact} />
                {item.kind === "approval" && (
                  <p className="mt-2 text-xs text-white/60">
                    Approve / reject unavailable: this page is read-only and has no approval backend bound to
                    an exact payload.
                  </p>
                )}
                <SourceTag stamp={item.stamp} nowMs={nowMs} />
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
