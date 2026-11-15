// ═══════════════════════════════════════════════════════════════
// hub.ts — Types for the personal hub (projects, tasks, code & sites)
// Shared by API routes and client pages. No server-only imports.
// ═══════════════════════════════════════════════════════════════

import type { AccentColor } from "@/types/hermes";

export const PROJECT_STATUSES = ["active", "paused", "done"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const PROJECT_COLORS = ["cyan", "purple", "green", "pink", "orange"] as const satisfies readonly AccentColor[];
export type ProjectColor = (typeof PROJECT_COLORS)[number];

export interface HubProject {
  id: string;
  name: string;
  description: string;
  color: ProjectColor;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface HubProjectWithStats extends HubProject {
  openTasks: number;
  doneTasks: number;
  totalTasks: number;
  overdueTasks: number;
  /** Earliest due date among open tasks (YYYY-MM-DD), if any. */
  nextDue: string | null;
  siteCount: number;
  repoCount: number;
}

export interface HubTask {
  id: string;
  projectId: string | null;
  projectName: string | null;
  projectColor: ProjectColor | null;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Calendar date YYYY-MM-DD, or null. */
  dueDate: string | null;
  /** Hermes mission created from this task, if any. */
  missionId: string | null;
  missionName: string | null;
  missionStatus: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SiteHealth = "up" | "degraded" | "down";

export interface HubSite {
  id: string;
  name: string;
  url: string;
  projectId: string | null;
  projectName: string | null;
  lastStatus: SiteHealth | null;
  lastHttpStatus: number | null;
  lastResponseMs: number | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HubRepo {
  id: string;
  /** GitHub "owner/name". */
  fullName: string;
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
}

export interface GithubPullSummary {
  number: number;
  title: string;
  url: string;
  author: string | null;
  draft: boolean;
  updatedAt: string;
}

export type CiState = "success" | "failure" | "running" | "cancelled" | "none";

export interface GithubRepoActivity {
  fullName: string;
  url: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string | null;
  pushedAt: string | null;
  openIssues: number | null;
  openPulls: GithubPullSummary[];
  /** True when there are more open PRs than `openPulls` lists. */
  morePulls: boolean;
  lastCommit: {
    sha: string;
    message: string;
    author: string | null;
    date: string | null;
    url: string;
  } | null;
  ci: {
    state: CiState;
    name: string | null;
    url: string | null;
    updatedAt: string | null;
  };
  error: string | null;
}

export type GithubTokenSource = "env" | "hermes" | null;

export interface HubSummary {
  today: string;
  tasks: {
    open: number;
    doing: number;
    overdue: number;
    dueToday: number;
    doneThisWeek: number;
  };
  /** Most urgent open tasks: overdue, then due soonest, then high priority. */
  upNext: HubTask[];
  projects: HubProjectWithStats[];
  sites: {
    total: number;
    up: number;
    degraded: number;
    down: number;
    unchecked: number;
    /** ISO time of the oldest check, or null when any site is unchecked. */
    oldestCheckAt: string | null;
  };
  repoCount: number;
}
