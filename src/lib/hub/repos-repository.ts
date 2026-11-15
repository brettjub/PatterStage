// ═══════════════════════════════════════════════════════════════
// repos-repository.ts — GitHub repositories the hub watches
// ═══════════════════════════════════════════════════════════════

import { now, uuid } from "@/lib/db";
import { hubDb, UnknownProjectError, projectExists } from "@/lib/hub/hub-repository";
import type { HubRepo } from "@/types/hub";

interface RepoRow {
  id: string;
  full_name: string;
  project_id: string | null;
  project_name: string | null;
  created_at: string;
}

function rowToRepo(row: RepoRow): HubRepo {
  return {
    id: row.id,
    fullName: row.full_name,
    projectId: row.project_id,
    projectName: row.project_name,
    createdAt: row.created_at,
  };
}

const REPO_SELECT = /* sql */ `
  SELECT r.*, p.name AS project_name
  FROM hub_repos r
  LEFT JOIN hub_projects p ON p.id = r.project_id
`;

export class DuplicateRepoError extends Error {
  constructor(fullName: string) {
    super(`${fullName} is already on your list`);
    this.name = "DuplicateRepoError";
  }
}

export function listRepos(projectId?: string): HubRepo[] {
  const database = hubDb();
  const rows = projectId
    ? database.prepare(REPO_SELECT + " WHERE r.project_id = ? ORDER BY r.full_name COLLATE NOCASE").all(projectId)
    : database.prepare(REPO_SELECT + " ORDER BY r.full_name COLLATE NOCASE").all();
  return (rows as RepoRow[]).map(rowToRepo);
}

export function getRepo(id: string): HubRepo | null {
  const row = hubDb().prepare(REPO_SELECT + " WHERE r.id = ?").get(id) as RepoRow | undefined;
  return row ? rowToRepo(row) : null;
}

export function createRepo(fullName: string, projectId: string | null = null): HubRepo {
  if (projectId && !projectExists(projectId)) throw new UnknownProjectError(projectId);
  const database = hubDb();
  const dup = database.prepare("SELECT 1 FROM hub_repos WHERE full_name = ? COLLATE NOCASE").get(fullName);
  if (dup) throw new DuplicateRepoError(fullName);
  const id = uuid();
  database
    .prepare("INSERT INTO hub_repos (id, full_name, project_id, created_at) VALUES (?, ?, ?, ?)")
    .run(id, fullName, projectId, now());
  return getRepo(id)!;
}

export function updateRepoProject(id: string, projectId: string | null): HubRepo | null {
  if (projectId && !projectExists(projectId)) throw new UnknownProjectError(projectId);
  const changed = hubDb().prepare("UPDATE hub_repos SET project_id = ? WHERE id = ?").run(projectId, id).changes;
  return changed > 0 ? getRepo(id) : null;
}

export function deleteRepo(id: string): boolean {
  return hubDb().prepare("DELETE FROM hub_repos WHERE id = ?").run(id).changes > 0;
}
