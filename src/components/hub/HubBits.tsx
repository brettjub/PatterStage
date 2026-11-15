// ═══════════════════════════════════════════════════════════════
// HubBits — Small presentational pieces shared by hub pages
// ═══════════════════════════════════════════════════════════════

"use client";

import { Flag } from "lucide-react";

import { describeDue, percent, type DueTone } from "@/lib/hub/hub-format";
import type { CiState, ProjectColor, SiteHealth, TaskPriority } from "@/types/hub";
import { PROJECT_COLORS } from "@/types/hub";

// Literal class names so Tailwind picks them up.
export const PROJECT_COLOR_CLASSES: Record<ProjectColor, { dot: string; text: string; border: string; bar: string; chip: string }> = {
  cyan: { dot: "bg-neon-cyan", text: "text-neon-cyan", border: "border-neon-cyan/30", bar: "bg-neon-cyan/70", chip: "bg-neon-cyan/10 text-neon-cyan" },
  purple: { dot: "bg-neon-purple", text: "text-neon-purple", border: "border-neon-purple/30", bar: "bg-neon-purple/70", chip: "bg-neon-purple/10 text-neon-purple" },
  green: { dot: "bg-neon-green", text: "text-neon-green", border: "border-neon-green/30", bar: "bg-neon-green/70", chip: "bg-neon-green/10 text-neon-green" },
  pink: { dot: "bg-neon-pink", text: "text-neon-pink", border: "border-neon-pink/30", bar: "bg-neon-pink/70", chip: "bg-neon-pink/10 text-neon-pink" },
  orange: { dot: "bg-neon-orange", text: "text-neon-orange", border: "border-neon-orange/30", bar: "bg-neon-orange/70", chip: "bg-neon-orange/10 text-neon-orange" },
};

export function ProjectChip({ name, color }: { name: string; color: ProjectColor | null }) {
  const c = PROJECT_COLOR_CLASSES[color ?? "cyan"];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono max-w-[10rem] ${c.chip}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
      <span className="truncate">{name}</span>
    </span>
  );
}

const DUE_TONE_CLASSES: Record<DueTone, string> = {
  overdue: "bg-semantic-danger/10 text-semantic-danger",
  today: "bg-neon-orange/10 text-neon-orange",
  soon: "bg-white/5 text-white/70",
  later: "bg-white/5 text-white/40",
};

export function DueLabel({ dueDate, today, done = false }: { dueDate: string; today: string; done?: boolean }) {
  const { label, tone } = describeDue(dueDate, today);
  return (
    <span
      title={"Due " + dueDate}
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono whitespace-nowrap ${
        done ? "bg-white/5 text-white/30" : DUE_TONE_CLASSES[tone]
      }`}
    >
      {done ? dueDate : label}
    </span>
  );
}

export function PriorityFlag({ priority }: { priority: TaskPriority }) {
  if (priority === "normal") return null;
  return (
    <Flag
      aria-label={priority === "high" ? "High priority" : "Low priority"}
      className={`w-3 h-3 flex-shrink-0 ${priority === "high" ? "text-neon-pink" : "text-white/25"}`}
    />
  );
}

const SITE_DOT: Record<SiteHealth | "unknown", string> = {
  up: "bg-neon-green",
  degraded: "bg-semantic-warning",
  down: "bg-semantic-danger",
  unknown: "bg-white/30",
};

export function SiteStatusDot({ status }: { status: SiteHealth | null }) {
  const key = status ?? "unknown";
  return (
    <span
      aria-label={status ? "Site " + status : "Not checked yet"}
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${SITE_DOT[key]} ${status === "up" ? "pulse-glow" : ""}`}
    />
  );
}

const CI_CLASSES: Record<CiState, { label: string; cls: string }> = {
  success: { label: "CI passing", cls: "bg-neon-green/10 text-neon-green" },
  failure: { label: "CI failing", cls: "bg-semantic-danger/10 text-semantic-danger" },
  running: { label: "CI running", cls: "bg-neon-cyan/10 text-neon-cyan" },
  cancelled: { label: "CI cancelled", cls: "bg-white/5 text-white/50" },
  none: { label: "No CI", cls: "bg-white/5 text-white/30" },
};

export function CiBadge({ state, url }: { state: CiState; url?: string | null }) {
  const c = CI_CLASSES[state];
  const cls = `inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono whitespace-nowrap ${c.cls}`;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className={cls + " hover:underline"}>
      {c.label}
    </a>
  ) : (
    <span className={cls}>{c.label}</span>
  );
}

export function ProgressBar({ done, total, color }: { done: number; total: number; color: ProjectColor }) {
  const pct = percent(done, total);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full rounded-full ${PROJECT_COLOR_CLASSES[color].bar}`} style={{ width: pct + "%" }} />
      </div>
      <span className="text-[10px] font-mono text-white/40 w-8 text-right">{pct}%</span>
    </div>
  );
}

export function ColorPicker({ value, onChange }: { value: ProjectColor; onChange: (c: ProjectColor) => void }) {
  return (
    <div className="flex items-center gap-2" role="radiogroup" aria-label="Colour">
      {PROJECT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={`w-6 h-6 rounded-full border-2 transition-transform ${PROJECT_COLOR_CLASSES[c].dot} ${
            value === c ? "border-white scale-110" : "border-transparent opacity-60 hover:opacity-100"
          }`}
        />
      ))}
    </div>
  );
}

// ── Form fields ────────────────────────────────────────────────

export const fieldClass =
  "w-full bg-dark-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-neon-cyan/50 transition-colors font-mono disabled:opacity-50";

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-white/60">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-white/35">{hint}</span>}
    </label>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function SelectField({
  value,
  onChange,
  options,
  ariaLabel,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className={`${fieldClass} pr-8 cursor-pointer ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-dark-900">
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Segmented tab control for filters. */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-white/10 bg-dark-900/50 p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
            value === o.value ? "bg-white/10 text-white" : "text-white/45 hover:text-white/80"
          }`}
        >
          {o.label}
          {o.count !== undefined && <span className="ml-1.5 text-white/35">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 px-6 py-10 text-center">
      <Icon className="w-6 h-6 text-white/25 mx-auto mb-3" />
      <div className="text-sm text-white/70">{title}</div>
      {children && <div className="text-xs text-white/40 mt-1.5 max-w-md mx-auto">{children}</div>}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-semantic-danger/30 bg-semantic-danger/10 px-4 py-3 text-sm text-semantic-danger flex items-center justify-between gap-3">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="text-xs font-mono underline hover:no-underline">
          Retry
        </button>
      )}
    </div>
  );
}
