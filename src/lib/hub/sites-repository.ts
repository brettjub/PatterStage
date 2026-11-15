// ═══════════════════════════════════════════════════════════════
// sites-repository.ts — Watched websites + their last health check
// ═══════════════════════════════════════════════════════════════

import { now, uuid } from "@/lib/db";
import { hubDb, UnknownProjectError, projectExists } from "@/lib/hub/hub-repository";
import type { SiteCreateInput, SiteUpdateInput } from "@/lib/hub/hub-validation";
import type { HubSite, SiteHealth } from "@/types/hub";

interface SiteRow {
  id: string;
  name: string;
  url: string;
  project_id: string | null;
  project_name: string | null;
  last_status: string | null;
  last_http_status: number | null;
  last_response_ms: number | null;
  last_error: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

const HEALTH: readonly SiteHealth[] = ["up", "degraded", "down"];

function rowToSite(row: SiteRow): HubSite {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    projectId: row.project_id,
    projectName: row.project_name,
    lastStatus: (HEALTH as readonly string[]).includes(row.last_status ?? "")
      ? (row.last_status as SiteHealth)
      : null,
    lastHttpStatus: row.last_http_status,
    lastResponseMs: row.last_response_ms,
    lastError: row.last_error,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SITE_SELECT = /* sql */ `
  SELECT s.*, p.name AS project_name
  FROM hub_sites s
  LEFT JOIN hub_projects p ON p.id = s.project_id
`;

export function listSites(projectId?: string): HubSite[] {
  const database = hubDb();
  const rows = projectId
    ? database.prepare(SITE_SELECT + " WHERE s.project_id = ? ORDER BY s.name COLLATE NOCASE").all(projectId)
    : database.prepare(SITE_SELECT + " ORDER BY s.name COLLATE NOCASE").all();
  return (rows as SiteRow[]).map(rowToSite);
}

export function getSite(id: string): HubSite | null {
  const row = hubDb().prepare(SITE_SELECT + " WHERE s.id = ?").get(id) as SiteRow | undefined;
  return row ? rowToSite(row) : null;
}

export function createSite(input: SiteCreateInput): HubSite {
  if (input.projectId && !projectExists(input.projectId)) throw new UnknownProjectError(input.projectId);
  const id = uuid();
  const ts = now();
  hubDb()
    .prepare(/* sql */ `
      INSERT INTO hub_sites (id, name, url, project_id, created_at, updated_at)
      VALUES (@id, @name, @url, @projectId, @ts, @ts)
    `)
    .run({ id, name: input.name.trim(), url: input.url.trim(), projectId: input.projectId ?? null, ts });
  return getSite(id)!;
}

export function updateSite(id: string, input: SiteUpdateInput): HubSite | null {
  const existing = getSite(id);
  if (!existing) return null;
  if (input.projectId && !projectExists(input.projectId)) throw new UnknownProjectError(input.projectId);
  const urlChanged = input.url !== undefined && input.url.trim() !== existing.url;
  hubDb()
    .prepare(/* sql */ `
      UPDATE hub_sites
      SET name = @name, url = @url, project_id = @projectId, updated_at = @ts,
          last_status      = CASE WHEN @urlChanged THEN NULL ELSE last_status END,
          last_http_status = CASE WHEN @urlChanged THEN NULL ELSE last_http_status END,
          last_response_ms = CASE WHEN @urlChanged THEN NULL ELSE last_response_ms END,
          last_error       = CASE WHEN @urlChanged THEN NULL ELSE last_error END,
          last_checked_at  = CASE WHEN @urlChanged THEN NULL ELSE last_checked_at END
      WHERE id = @id
    `)
    .run({
      id,
      name: input.name?.trim() ?? existing.name,
      url: input.url?.trim() ?? existing.url,
      projectId: input.projectId !== undefined ? input.projectId : existing.projectId,
      urlChanged: urlChanged ? 1 : 0,
      ts: now(),
    });
  return getSite(id);
}

export function deleteSite(id: string): boolean {
  return hubDb().prepare("DELETE FROM hub_sites WHERE id = ?").run(id).changes > 0;
}

export interface SiteCheckResult {
  status: SiteHealth;
  httpStatus: number | null;
  responseMs: number | null;
  error: string | null;
  checkedAt: string;
}

export function recordSiteCheck(id: string, result: SiteCheckResult): void {
  hubDb()
    .prepare(/* sql */ `
      UPDATE hub_sites
      SET last_status = @status, last_http_status = @httpStatus, last_response_ms = @responseMs,
          last_error = @error, last_checked_at = @checkedAt
      WHERE id = @id
    `)
    .run({ id, ...result });
}
