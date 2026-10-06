// ═══════════════════════════════════════════════════════════════
// Owner inbox — owner decisions and approvals, oldest first
// ═══════════════════════════════════════════════════════════════

import { Inbox } from "lucide-react";
import Section from "./Section";
import SourceTag from "./SourceTag";
import { TextChip } from "./StateChip";
import { formatAge } from "./freshness";
import type { OwnerInboxItem } from "./types";

/** Items older than this are flagged. */
export const OVERDUE_AFTER_MINUTES = 3 * 24 * 60;

export function sortInboxOldestFirst(items: OwnerInboxItem[]): OwnerInboxItem[] {
  return [...items].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export default function OwnerInbox({ items, nowMs }: { items: OwnerInboxItem[]; nowMs: number }) {
  const sorted = sortInboxOldestFirst(items);
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
            const ageMinutes = Math.max(0, Math.floor((nowMs - Date.parse(item.createdAt)) / 60_000));
            const overdue = ageMinutes > OVERDUE_AFTER_MINUTES;
            return (
              <li
                key={item.id}
                className="rounded-lg border border-white/10 bg-dark-950/40 p-3"
                data-testid="mc-inbox-item"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <TextChip>{item.kind === "decision" ? "Decision" : "Approval"}</TextChip>
                  <span className="text-xs font-mono text-white/60">{item.project}</span>
                  <span className="text-xs font-mono text-white/60">· raised {formatAge(ageMinutes)}</span>
                  {overdue && (
                    <span className="text-xs font-mono font-semibold text-semantic-warning">
                      Older than 3 days
                    </span>
                  )}
                </div>
                <h3 className="mt-2 text-sm font-semibold text-white">{item.title}</h3>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
                  <dt className="text-white/50">Target</dt>
                  <dd className="text-white/80 min-w-0 break-words">{item.target}</dd>
                  <dt className="text-white/50">Impact</dt>
                  <dd className="text-white/80 min-w-0 break-words">{item.impact}</dd>
                </dl>
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
