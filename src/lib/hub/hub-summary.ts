// ═══════════════════════════════════════════════════════════════
// hub-summary.ts — One-call overview for the dashboard home page
// ═══════════════════════════════════════════════════════════════

import { addDays } from "@/lib/hub/hub-format";
import { hubDb, listProjects, listTasks, localToday } from "@/lib/hub/hub-repository";
import { listSites } from "@/lib/hub/sites-repository";
import type { HubSummary, HubTask } from "@/types/hub";

const UP_NEXT_LIMIT = 6;
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 } as const;

/** The date seven days before `today` (YYYY-MM-DD), used for "done this week". */
export function weekStart(today: string): string {
  return addDays(today, -6);
}

/**
 * Most urgent open tasks: overdue and due-today first (earliest first),
 * then in-progress, then high priority, then the rest by due date.
 */
export function rankUpNext(tasks: readonly HubTask[], today: string, limit = UP_NEXT_LIMIT): HubTask[] {
  const urgency = (t: HubTask): number => {
    if (t.dueDate && t.dueDate <= today) return 0;
    if (t.status === "doing") return 1;
    if (t.priority === "high") return 2;
    return 3;
  };
  return tasks
    .filter((t) => t.status !== "done")
    .slice()
    .sort((a, b) => {
      const u = urgency(a) - urgency(b);
      if (u !== 0) return u;
      const da = a.dueDate ?? "9999-12-31";
      const dbb = b.dueDate ?? "9999-12-31";
      if (da !== dbb) return da < dbb ? -1 : 1;
      const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (p !== 0) return p;
      return a.createdAt < b.createdAt ? 1 : -1;
    })
    .slice(0, limit);
}

export function getHubSummary(today: string = localToday()): HubSummary {
  const openTasks = listTasks({ status: "open" });
  const doneSince = weekStart(today);
  const doneRow = hubDb()
    .prepare(
      "SELECT COUNT(*) AS c FROM hub_tasks WHERE status = 'done' AND completed_at IS NOT NULL AND substr(completed_at, 1, 10) >= ?",
    )
    .get(doneSince) as { c: number };
  const repoRow = hubDb().prepare("SELECT COUNT(*) AS c FROM hub_repos").get() as { c: number };
  const sites = listSites();
  const checked = sites.filter((s) => s.lastCheckedAt);

  return {
    today,
    tasks: {
      open: openTasks.length,
      doing: openTasks.filter((t) => t.status === "doing").length,
      overdue: openTasks.filter((t) => t.dueDate !== null && t.dueDate < today).length,
      dueToday: openTasks.filter((t) => t.dueDate === today).length,
      doneThisWeek: doneRow.c,
    },
    upNext: rankUpNext(openTasks, today),
    projects: listProjects(today).filter((p) => p.status === "active"),
    sites: {
      total: sites.length,
      up: sites.filter((s) => s.lastStatus === "up").length,
      degraded: sites.filter((s) => s.lastStatus === "degraded").length,
      down: sites.filter((s) => s.lastStatus === "down").length,
      unchecked: sites.length - checked.length,
      oldestCheckAt:
        checked.length === sites.length && checked.length > 0
          ? checked.map((s) => s.lastCheckedAt as string).sort()[0]
          : null,
    },
    repoCount: repoRow.c,
  };
}
