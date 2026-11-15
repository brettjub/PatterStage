// ═══════════════════════════════════════════════════════════════
// hub-repository.ts — Projects and tasks CRUD (SQLite)
// ═══════════════════════════════════════════════════════════════

import type Database from "better-sqlite3";

import { db, inTransaction, now, uuid } from "@/lib/db";
import { todayLocal } from "@/lib/hub/hub-format";
import { ensureHubSchema } from "@/lib/hub/hub-schema";
import type {
  ProjectCreateInput,
  ProjectUpdateInput,
  TaskCreateInput,
  TaskUpdateInput,
} from "@/lib/hub/hub-validation";
import {
  PROJECT_COLORS,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type HubProject,
  type HubProjectWithStats,
  type HubTask,
  type ProjectColor,
  type ProjectStatus,
  type TaskPriority,
  type TaskStatus,
} from "@/types/hub";

/** Open connection with the hub tables in place. */
export function hubDb(): Database.Database {
  const database = db();
  ensureHubSchema(database);
  return database;
}

/** Today's date (YYYY-MM-DD) in the server's local time zone. */
export const localToday = todayLocal;

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
}

// ── Projects ───────────────────────────────────────────────────

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  color: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ProjectStatsRow extends ProjectRow {
  open_tasks: number;
  done_tasks: number;
  total_tasks: number;
  overdue_tasks: number;
  next_due: string | null;
  site_count: number;
  repo_count: number;
}

function rowToProject(row: ProjectRow): HubProject {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: pick<ProjectColor>(row.color, PROJECT_COLORS, "cyan"),
    status: pick<ProjectStatus>(row.status, PROJECT_STATUSES, "active"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PROJECT_STATUS_ORDER = "CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END";

/** All projects with task, site and repo counts. Active first, then paused, then done. */
export function listProjects(today: string = localToday()): HubProjectWithStats[] {
  const rows = hubDb()
    .prepare(/* sql */ `
      SELECT p.*,
        (SELECT COUNT(*) FROM hub_tasks t WHERE t.project_id = p.id AND t.status != 'done') AS open_tasks,
        (SELECT COUNT(*) FROM hub_tasks t WHERE t.project_id = p.id AND t.status = 'done')  AS done_tasks,
        (SELECT COUNT(*) FROM hub_tasks t WHERE t.project_id = p.id)                        AS total_tasks,
        (SELECT COUNT(*) FROM hub_tasks t WHERE t.project_id = p.id AND t.status != 'done'
            AND t.due_date IS NOT NULL AND t.due_date < @today)                             AS overdue_tasks,
        (SELECT MIN(t.due_date) FROM hub_tasks t WHERE t.project_id = p.id AND t.status != 'done'
            AND t.due_date IS NOT NULL)                                                     AS next_due,
        (SELECT COUNT(*) FROM hub_sites s WHERE s.project_id = p.id)                        AS site_count,
        (SELECT COUNT(*) FROM hub_repos r WHERE r.project_id = p.id)                        AS repo_count
      FROM hub_projects p
      ORDER BY ${PROJECT_STATUS_ORDER}, p.updated_at DESC
    `)
    .all({ today }) as ProjectStatsRow[];
  return rows.map((row) => ({
    ...rowToProject(row),
    openTasks: row.open_tasks,
    doneTasks: row.done_tasks,
    totalTasks: row.total_tasks,
    overdueTasks: row.overdue_tasks,
    nextDue: row.next_due,
    siteCount: row.site_count,
    repoCount: row.repo_count,
  }));
}

export function getProject(id: string): HubProject | null {
  const row = hubDb().prepare("SELECT * FROM hub_projects WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
  return row ? rowToProject(row) : null;
}

export function projectExists(id: string): boolean {
  return Boolean(hubDb().prepare("SELECT 1 FROM hub_projects WHERE id = ?").get(id));
}

export function createProject(input: ProjectCreateInput): HubProject {
  const id = uuid();
  const ts = now();
  hubDb()
    .prepare(/* sql */ `
      INSERT INTO hub_projects (id, name, description, color, status, created_at, updated_at)
      VALUES (@id, @name, @description, @color, @status, @ts, @ts)
    `)
    .run({
      id,
      name: input.name.trim(),
      description: (input.description ?? "").trim(),
      color: input.color ?? "cyan",
      status: input.status ?? "active",
      ts,
    });
  return getProject(id)!;
}

export function updateProject(id: string, input: ProjectUpdateInput): HubProject | null {
  const existing = getProject(id);
  if (!existing) return null;
  hubDb()
    .prepare(/* sql */ `
      UPDATE hub_projects
      SET name = @name, description = @description, color = @color, status = @status, updated_at = @ts
      WHERE id = @id
    `)
    .run({
      id,
      name: input.name?.trim() ?? existing.name,
      description: input.description !== undefined ? input.description.trim() : existing.description,
      color: input.color ?? existing.color,
      status: input.status ?? existing.status,
      ts: now(),
    });
  return getProject(id);
}

/**
 * Delete a project. Its tasks, sites and repos are kept and become
 * unassigned (project_id = NULL) rather than being deleted with it.
 */
export function deleteProject(id: string): boolean {
  const database = hubDb();
  return inTransaction(() => {
    for (const table of ["hub_tasks", "hub_sites", "hub_repos"]) {
      database.prepare(`UPDATE ${table} SET project_id = NULL WHERE project_id = ?`).run(id);
    }
    return database.prepare("DELETE FROM hub_projects WHERE id = ?").run(id).changes > 0;
  });
}

// ── Tasks ──────────────────────────────────────────────────────

interface TaskRow {
  id: string;
  project_id: string | null;
  project_name: string | null;
  project_color: string | null;
  title: string;
  notes: string;
  status: string;
  priority: string;
  due_date: string | null;
  external_key: string | null;
  mission_id: string | null;
  mission_name: string | null;
  mission_status: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTask(row: TaskRow): HubTask {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    projectColor: row.project_color
      ? pick<ProjectColor>(row.project_color, PROJECT_COLORS, "cyan")
      : null,
    title: row.title,
    notes: row.notes,
    status: pick<TaskStatus>(row.status, TASK_STATUSES, "todo"),
    priority: pick<TaskPriority>(row.priority, TASK_PRIORITIES, "normal"),
    dueDate: row.due_date,
    externalKey: row.external_key ?? null,
    missionId: row.mission_id,
    missionName: row.mission_name,
    missionStatus: row.mission_status,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const hasMissionsTable = new WeakMap<Database.Database, boolean>();

/**
 * The Control Hub `missions` table normally exists, but the hub must keep
 * working on a database without it (tests, partially migrated installs).
 */
function missionJoin(database: Database.Database): { cols: string; join: string } {
  let present = hasMissionsTable.get(database);
  if (present === undefined) {
    present = Boolean(
      database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'missions'").get(),
    );
    hasMissionsTable.set(database, present);
  }
  return present
    ? {
        cols: "m.name AS mission_name, m.status AS mission_status",
        join: "LEFT JOIN missions m ON m.id = t.mission_id AND m.deleted_at IS NULL",
      }
    : { cols: "NULL AS mission_name, NULL AS mission_status", join: "" };
}

function taskSelect(database: Database.Database): string {
  const mission = missionJoin(database);
  return /* sql */ `
    SELECT t.*, p.name AS project_name, p.color AS project_color, ${mission.cols}
    FROM hub_tasks t
    LEFT JOIN hub_projects p ON p.id = t.project_id
    ${mission.join}
  `;
}

/** Order: in progress, then to do, then done; within open tasks overdue/soonest due first, high priority first. */
const TASK_ORDER = /* sql */ `
  CASE t.status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
  CASE WHEN t.status = 'done' THEN t.completed_at END DESC,
  CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
  t.due_date,
  CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
  t.created_at DESC
`;

export type TaskStatusFilter = "open" | "done" | "all" | TaskStatus;

export interface TaskListFilter {
  /** A project id, or "none" for tasks without a project. Omit for all. */
  projectId?: string;
  status?: TaskStatusFilter;
}

export function listTasks(filter: TaskListFilter = {}): HubTask[] {
  const database = hubDb();
  const where: string[] = [];
  const params: Record<string, string> = {};
  if (filter.projectId === "none") {
    where.push("t.project_id IS NULL");
  } else if (filter.projectId) {
    where.push("t.project_id = @projectId");
    params.projectId = filter.projectId;
  }
  const status = filter.status ?? "all";
  if (status === "open") where.push("t.status != 'done'");
  else if (status !== "all") {
    where.push("t.status = @status");
    params.status = status;
  }
  const sql =
    taskSelect(database) +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY " +
    TASK_ORDER;
  return (database.prepare(sql).all(params) as TaskRow[]).map(rowToTask);
}

export function getTask(id: string): HubTask | null {
  const database = hubDb();
  const row = database.prepare(taskSelect(database) + " WHERE t.id = ?").get(id) as
    | TaskRow
    | undefined;
  return row ? rowToTask(row) : null;
}

export class UnknownProjectError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`);
    this.name = "UnknownProjectError";
  }
}

function assertProject(projectId: string | null | undefined): void {
  if (projectId && !projectExists(projectId)) throw new UnknownProjectError(projectId);
}

export function createTask(input: TaskCreateInput): HubTask {
  assertProject(input.projectId);
  const id = uuid();
  const ts = now();
  const status = input.status ?? "todo";
  hubDb()
    .prepare(/* sql */ `
      INSERT INTO hub_tasks
        (id, project_id, title, notes, status, priority, due_date, completed_at, created_at, updated_at)
      VALUES
        (@id, @projectId, @title, @notes, @status, @priority, @dueDate, @completedAt, @ts, @ts)
    `)
    .run({
      id,
      projectId: input.projectId ?? null,
      title: input.title.trim(),
      notes: input.notes ?? "",
      status,
      priority: input.priority ?? "normal",
      dueDate: input.dueDate ?? null,
      completedAt: status === "done" ? ts : null,
      ts,
    });
  touchProject(input.projectId ?? null, ts);
  return getTask(id)!;
}

export function updateTask(id: string, input: TaskUpdateInput): HubTask | null {
  const existing = getTask(id);
  if (!existing) return null;
  if (input.projectId !== undefined) assertProject(input.projectId);
  const ts = now();
  const status = input.status ?? existing.status;
  let completedAt = existing.completedAt;
  if (status === "done" && existing.status !== "done") completedAt = ts;
  if (status !== "done") completedAt = null;
  const projectId = input.projectId !== undefined ? input.projectId : existing.projectId;
  hubDb()
    .prepare(/* sql */ `
      UPDATE hub_tasks
      SET project_id = @projectId, title = @title, notes = @notes, status = @status,
          priority = @priority, due_date = @dueDate, mission_id = @missionId,
          completed_at = @completedAt, updated_at = @ts
      WHERE id = @id
    `)
    .run({
      id,
      projectId,
      title: input.title?.trim() ?? existing.title,
      notes: input.notes !== undefined ? input.notes : existing.notes,
      status,
      priority: input.priority ?? existing.priority,
      dueDate: input.dueDate !== undefined ? input.dueDate : existing.dueDate,
      missionId: input.missionId !== undefined ? input.missionId : existing.missionId,
      completedAt,
      ts,
    });
  touchProject(projectId, ts);
  return getTask(id);
}

export function deleteTask(id: string): boolean {
  return hubDb().prepare("DELETE FROM hub_tasks WHERE id = ?").run(id).changes > 0;
}

/** Bump a project's updated_at so recently worked-on projects sort first. */
function touchProject(projectId: string | null, ts: string): void {
  if (!projectId) return;
  hubDb().prepare("UPDATE hub_projects SET updated_at = ? WHERE id = ?").run(ts, projectId);
}
