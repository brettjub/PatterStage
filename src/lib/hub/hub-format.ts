// ═══════════════════════════════════════════════════════════════
// hub-format.ts — Pure display helpers for hub pages (client-safe)
// ═══════════════════════════════════════════════════════════════

import type { HubTask } from "@/types/hub";

/** Today's date (YYYY-MM-DD) in the browser's or server's local time zone. */
export function todayLocal(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

/** The date `days` after `date` (YYYY-MM-DD). */
export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type DueTone = "overdue" | "today" | "soon" | "later";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short human label for a due date relative to today, e.g. "3d overdue", "Today", "Fri", "Mar 5". */
export function describeDue(dueDate: string, today: string): { label: string; tone: DueTone } {
  const diff = daysBetween(today, dueDate);
  if (diff < 0) return { label: `${-diff}d overdue`, tone: "overdue" };
  if (diff === 0) return { label: "Today", tone: "today" };
  if (diff === 1) return { label: "Tomorrow", tone: "soon" };
  const d = new Date(dueDate + "T00:00:00Z");
  if (diff < 7) return { label: WEEKDAYS[d.getUTCDay()], tone: "soon" };
  const sameYear = dueDate.slice(0, 4) === today.slice(0, 4);
  const label = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` + (sameYear ? "" : `, ${d.getUTCFullYear()}`);
  return { label, tone: "later" };
}

/** Prompt text for a Hermes mission created from a task. */
export function buildTaskMissionInstruction(
  task: Pick<HubTask, "title" | "notes" | "projectName" | "dueDate">,
): string {
  const lines = [`Task: ${task.title.trim()}`];
  if (task.projectName) lines.push(`Project: ${task.projectName}`);
  if (task.dueDate) lines.push(`Due: ${task.dueDate}`);
  const notes = task.notes.trim();
  if (notes) lines.push("", "Details:", notes);
  lines.push("", "When you finish, summarise what you did and anything I still need to do.");
  return lines.join("\n");
}

/** Percentage (0-100, rounded) of `done` out of `total`; 0 when total is 0. */
export function percent(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}
