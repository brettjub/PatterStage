// ═══════════════════════════════════════════════════════════════
// hub-import.ts — Bulk import / sync of projects, tasks, sites, repos
// ═══════════════════════════════════════════════════════════════
//
// One JSON format serves both the Import page (paste a draft, preview,
// import) and the scheduled Hermes sync job (POST /api/hub/import).
//
// Matching, so importing the same data twice never duplicates:
//   projects — by `key` (stored as external_key), else by name (adopted)
//   tasks    — by `key`
//   sites    — by `key`, else by URL (adopted)
//   repos    — by owner/name
//
// Local edits win until the source changes: each imported item stores a
// hash of the fields it was imported with. A re-import with the same
// fields leaves the item alone (so renaming a task or moving its due date
// in the hub sticks); different fields mean the source changed, and the
// new values are applied.
//
// Tasks you have marked done are never reopened. An import can mark a
// task done (status "done") when its source item is resolved. Nothing is
// ever deleted by an import.

import { createHash } from "crypto";
import { z } from "zod";

import { inTransaction, now, uuid } from "@/lib/db";
import { hubDb } from "@/lib/hub/hub-repository";
import {
  isoDateSchema,
  repoFullNameSchema,
  siteUrlSchema,
} from "@/lib/hub/hub-validation";
import { PROJECT_COLORS, PROJECT_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from "@/types/hub";

// ── Format ─────────────────────────────────────────────────────

const key = z.string().trim().min(1, "is required").max(300);
const projectRef = z.union([z.string().trim().max(300), z.null()]).optional();

export const importProjectSchema = z.object({
  key,
  name: z.string().trim().min(1, "is required").max(120),
  description: z.string().max(2000).optional(),
  color: z.enum(PROJECT_COLORS).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
});

export const importTaskSchema = z.object({
  key,
  title: z.string().trim().min(1, "is required").max(300),
  notes: z.string().max(10000).optional(),
  project: projectRef,
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: z.union([isoDateSchema, z.null()]).optional(),
  status: z.enum(TASK_STATUSES).optional(),
});

export const importSiteSchema = z.object({
  key: key.optional(),
  name: z.string().trim().min(1, "is required").max(120),
  url: siteUrlSchema,
  project: projectRef,
});

export const importRepoSchema = z.object({
  fullName: repoFullNameSchema,
  project: projectRef,
});

export const hubImportSchema = z.object({
  version: z.literal(1).optional(),
  dryRun: z.boolean().optional(),
  projects: z.array(importProjectSchema).max(500).default([]),
  tasks: z.array(importTaskSchema).max(2000).default([]),
  sites: z.array(importSiteSchema).max(500).default([]),
  repos: z.array(importRepoSchema).max(500).default([]),
});

export type HubImportInput = z.infer<typeof hubImportSchema>;

/** Address a process on this machine (e.g. a Hermes job) uses to reach the import route. */
export function localImportEndpoint(port: string | undefined = process.env.PORT): string {
  const p = port && /^\d{1,5}$/.test(port) ? port : "3000";
  return `http://127.0.0.1:${p}/api/hub/import`;
}

// ── Result ─────────────────────────────────────────────────────

export type ImportKind = "project" | "task" | "site" | "repo";
export type ImportAction = "create" | "update" | "unchanged" | "skip";

export interface ImportItemResult {
  kind: ImportKind;
  /** Position of the item in its input array (projects/tasks/sites/repos). */
  index: number;
  /** The item's key (repos: owner/name). */
  key: string;
  label: string;
  action: ImportAction;
  /** Why it was skipped or left unchanged, in plain words. */
  reason?: string;
  /** Project the item will belong to, if any. */
  projectName?: string | null;
  dueDate?: string | null;
}

export interface ImportResult {
  dryRun: boolean;
  counts: Record<ImportKind, Record<ImportAction, number>>;
  items: ImportItemResult[];
}

function emptyCounts(): ImportResult["counts"] {
  const zero = (): Record<ImportAction, number> => ({ create: 0, update: 0, unchanged: 0, skip: 0 });
  return { project: zero(), task: zero(), site: zero(), repo: zero() };
}

/** Stable hash of the imported fields (order-independent, undefined → null). */
export function fieldHash(fields: Record<string, unknown>): string {
  const normalized = Object.keys(fields)
    .sort()
    .map((k) => [k, fields[k] === undefined ? null : fields[k]]);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 32);
}

// ── Apply ──────────────────────────────────────────────────────

class DryRunRollback extends Error {}

/**
 * Apply (or, with dryRun, preview) an import. A dry run executes the same
 * statements inside a transaction and rolls it back, so the preview is
 * exactly what a real import would do.
 */
export function applyHubImport(input: HubImportInput, options: { dryRun?: boolean } = {}): ImportResult {
  const dryRun = options.dryRun ?? input.dryRun ?? false;
  // Create the hub tables first: inside the transaction a dry run's rollback would undo them.
  hubDb();
  let result: ImportResult | null = null;
  try {
    inTransaction(() => {
      result = runImport(input, dryRun);
      if (dryRun) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return result!;
}

function runImport(input: HubImportInput, dryRun: boolean): ImportResult {
  const database = hubDb();
  const counts = emptyCounts();
  const items: ImportItemResult[] = [];
  const ts = now();
  const record = (item: ImportItemResult) => {
    counts[item.kind][item.action]++;
    items.push(item);
  };

  // Project key → { id, name } for this import (and existing keyed projects).
  const projectByKey = new Map<string, { id: string; name: string }>();

  const findProjectByKey = (k: string) =>
    database.prepare("SELECT id, name, external_hash FROM hub_projects WHERE external_key = ?").get(k) as
      | { id: string; name: string; external_hash: string | null }
      | undefined;

  for (const [index, p] of input.projects.entries()) {
    const hash = fieldHash({ name: p.name, description: p.description, color: p.color, status: p.status });
    const existing = findProjectByKey(p.key);
    if (existing) {
      projectByKey.set(p.key, { id: existing.id, name: existing.name });
      if (existing.external_hash === hash) {
        record({ kind: "project", index, key: p.key, label: existing.name, action: "unchanged", reason: "Already imported" });
        continue;
      }
      database
        .prepare(/* sql */ `
          UPDATE hub_projects SET name = @name,
            description = COALESCE(@description, description),
            color = COALESCE(@color, color),
            status = COALESCE(@status, status),
            external_hash = @hash, updated_at = @ts
          WHERE id = @id`)
        .run({ id: existing.id, name: p.name, description: p.description ?? null, color: p.color ?? null, status: p.status ?? null, hash, ts });
      projectByKey.set(p.key, { id: existing.id, name: p.name });
      record({ kind: "project", index, key: p.key, label: p.name, action: "update", reason: "Changed at the source" });
      continue;
    }
    const sameName = database
      .prepare("SELECT id, name FROM hub_projects WHERE external_key IS NULL AND name = ? COLLATE NOCASE")
      .get(p.name) as { id: string; name: string } | undefined;
    if (sameName) {
      // A project you created by hand with the same name: link it, keep your settings.
      database
        .prepare("UPDATE hub_projects SET external_key = ?, external_hash = ? WHERE id = ?")
        .run(p.key, hash, sameName.id);
      projectByKey.set(p.key, sameName);
      record({ kind: "project", index, key: p.key, label: sameName.name, action: "unchanged", reason: "Matched your existing project" });
      continue;
    }
    const id = uuid();
    database
      .prepare(/* sql */ `
        INSERT INTO hub_projects (id, name, description, color, status, external_key, external_hash, created_at, updated_at)
        VALUES (@id, @name, @description, @color, @status, @key, @hash, @ts, @ts)`)
      .run({
        id,
        name: p.name,
        description: (p.description ?? "").trim(),
        color: p.color ?? "cyan",
        status: p.status ?? "active",
        key: p.key,
        hash,
        ts,
      });
    projectByKey.set(p.key, { id, name: p.name });
    record({ kind: "project", index, key: p.key, label: p.name, action: "create" });
  }

  /** Resolve a project reference: a key from this import or an existing project's key or name. */
  const resolveProject = (ref: string | null | undefined): { id: string; name: string } | null | "missing" => {
    if (ref === undefined || ref === null || ref === "") return null;
    const fromImport = projectByKey.get(ref);
    if (fromImport) return fromImport;
    const byKey = findProjectByKey(ref);
    if (byKey) return { id: byKey.id, name: byKey.name };
    const byName = database
      .prepare("SELECT id, name FROM hub_projects WHERE name = ? COLLATE NOCASE")
      .get(ref) as { id: string; name: string } | undefined;
    return byName ?? "missing";
  };

  // ── Tasks ────────────────────────────────────────────────────
  for (const [index, t] of input.tasks.entries()) {
    const project = resolveProject(t.project);
    const projectId = project && project !== "missing" ? project.id : null;
    const projectName = project && project !== "missing" ? project.name : null;
    const hash = fieldHash({
      title: t.title,
      notes: t.notes,
      project: t.project ?? null,
      priority: t.priority,
      dueDate: t.dueDate ?? null,
      status: t.status,
    });
    const existing = database
      .prepare("SELECT id, title, status, external_hash FROM hub_tasks WHERE external_key = ?")
      .get(t.key) as { id: string; title: string; status: string; external_hash: string | null } | undefined;
    const base = { kind: "task" as const, index, key: t.key, projectName, dueDate: t.dueDate ?? null };

    if (!existing) {
      if (t.status === "done") {
        record({ ...base, label: t.title, action: "skip", reason: "Already done at the source" });
        continue;
      }
      database
        .prepare(/* sql */ `
          INSERT INTO hub_tasks
            (id, project_id, title, notes, status, priority, due_date, external_key, external_hash, created_at, updated_at)
          VALUES (@id, @projectId, @title, @notes, @status, @priority, @dueDate, @key, @hash, @ts, @ts)`)
        .run({
          id: uuid(),
          projectId,
          title: t.title,
          notes: t.notes ?? "",
          status: t.status ?? "todo",
          priority: t.priority ?? "normal",
          dueDate: t.dueDate ?? null,
          key: t.key,
          hash,
          ts,
        });
      record({
        ...base,
        label: t.title,
        action: "create",
        reason: project === "missing" ? `Project "${t.project}" not found; added without a project` : undefined,
      });
      continue;
    }

    if (existing.status === "done") {
      record({ ...base, label: existing.title, action: "unchanged", reason: "You already finished it" });
      continue;
    }
    if (existing.external_hash === hash) {
      record({ ...base, label: existing.title, action: "unchanged", reason: "No changes at the source" });
      continue;
    }
    const markDone = t.status === "done";
    database
      .prepare(/* sql */ `
        UPDATE hub_tasks SET title = @title, notes = COALESCE(@notes, notes),
          project_id = CASE WHEN @projectGiven THEN @projectId ELSE project_id END,
          priority = COALESCE(@priority, priority), due_date = @dueDate,
          status = COALESCE(@status, status),
          completed_at = CASE WHEN @markDone THEN @ts ELSE completed_at END,
          external_hash = @hash, updated_at = @ts
        WHERE id = @id`)
      .run({
        id: existing.id,
        title: t.title,
        notes: t.notes ?? null,
        projectGiven: t.project !== undefined && project !== "missing" ? 1 : 0,
        projectId,
        priority: t.priority ?? null,
        dueDate: t.dueDate ?? null,
        status: t.status ?? null,
        markDone: markDone ? 1 : 0,
        hash,
        ts,
      });
    record({ ...base, label: t.title, action: "update", reason: markDone ? "Done at the source" : "Changed at the source" });
  }

  // ── Sites ────────────────────────────────────────────────────
  for (const [index, s] of input.sites.entries()) {
    const project = resolveProject(s.project);
    const projectId = project && project !== "missing" ? project.id : null;
    const projectName = project && project !== "missing" ? project.name : null;
    const siteKey = s.key ?? null;
    const hash = fieldHash({ name: s.name, url: s.url, project: s.project ?? null });
    const existing = (siteKey
      ? database.prepare("SELECT id, name, url, external_hash FROM hub_sites WHERE external_key = ?").get(siteKey)
      : undefined) as { id: string; name: string; url: string; external_hash: string | null } | undefined;
    const byUrl = existing
      ? undefined
      : (database.prepare("SELECT id, name, external_key FROM hub_sites WHERE url = ?").get(s.url) as
          | { id: string; name: string; external_key: string | null }
          | undefined);
    const base = { kind: "site" as const, index, key: siteKey ?? s.url, projectName };

    if (existing) {
      if (existing.external_hash === hash) {
        record({ ...base, label: existing.name, action: "unchanged", reason: "Already imported" });
        continue;
      }
      database
        .prepare(/* sql */ `
          UPDATE hub_sites SET name = @name, url = @url,
            project_id = CASE WHEN @projectGiven THEN @projectId ELSE project_id END,
            last_status      = CASE WHEN url = @url THEN last_status ELSE NULL END,
            last_checked_at  = CASE WHEN url = @url THEN last_checked_at ELSE NULL END,
            external_hash = @hash, updated_at = @ts
          WHERE id = @id`)
        .run({
          id: existing.id,
          name: s.name,
          url: s.url,
          projectGiven: s.project !== undefined && project !== "missing" ? 1 : 0,
          projectId,
          hash,
          ts,
        });
      record({ ...base, label: s.name, action: "update", reason: "Changed at the source" });
      continue;
    }
    if (byUrl) {
      if (siteKey && !byUrl.external_key) {
        database.prepare("UPDATE hub_sites SET external_key = ?, external_hash = ? WHERE id = ?").run(siteKey, hash, byUrl.id);
      }
      record({ ...base, label: byUrl.name, action: "unchanged", reason: "Already watching this address" });
      continue;
    }
    database
      .prepare(/* sql */ `
        INSERT INTO hub_sites (id, name, url, project_id, external_key, external_hash, created_at, updated_at)
        VALUES (@id, @name, @url, @projectId, @key, @hash, @ts, @ts)`)
      .run({ id: uuid(), name: s.name, url: s.url, projectId, key: siteKey, hash, ts });
    record({ ...base, label: s.name, action: "create" });
  }

  // ── Repos ────────────────────────────────────────────────────
  for (const [index, r] of input.repos.entries()) {
    const project = resolveProject(r.project);
    const projectId = project && project !== "missing" ? project.id : null;
    const projectName = project && project !== "missing" ? project.name : null;
    const existing = database
      .prepare("SELECT id, project_id FROM hub_repos WHERE full_name = ? COLLATE NOCASE")
      .get(r.fullName) as { id: string; project_id: string | null } | undefined;
    const base = { kind: "repo" as const, index, key: r.fullName, label: r.fullName, projectName };
    if (existing) {
      if (!existing.project_id && projectId) {
        database.prepare("UPDATE hub_repos SET project_id = ? WHERE id = ?").run(projectId, existing.id);
        record({ ...base, action: "update", reason: "Linked to its project" });
      } else {
        record({ ...base, action: "unchanged", reason: "Already watching" });
      }
      continue;
    }
    database
      .prepare("INSERT INTO hub_repos (id, full_name, project_id, created_at) VALUES (?, ?, ?, ?)")
      .run(uuid(), r.fullName, projectId, ts);
    record({ ...base, action: "create" });
  }

  return { dryRun, counts, items };
}
