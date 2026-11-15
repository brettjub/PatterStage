// ═══════════════════════════════════════════════════════════════
// hub-schema.ts — SQLite tables for the personal hub
// ═══════════════════════════════════════════════════════════════
//
// The hub tables are created at runtime with CREATE ... IF NOT EXISTS
// the first time a hub repository touches a database connection. The
// SQL lives here (not in src/lib/db/migrations/*.sql) so it is bundled
// with the server code: the built app cannot read migration files from
// disk, and fresh installs work without running `npm run db:migrate`.
// Every statement is idempotent, so running it against an existing
// database is a no-op.

import type Database from "better-sqlite3";

export const HUB_SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS hub_projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT 'cyan',
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_tasks (
  id           TEXT PRIMARY KEY,
  project_id   TEXT REFERENCES hub_projects(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'todo',
  priority     TEXT NOT NULL DEFAULT 'normal',
  due_date     TEXT,
  mission_id   TEXT,
  completed_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_tasks_project ON hub_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_hub_tasks_status  ON hub_tasks(status);

CREATE TABLE IF NOT EXISTS hub_sites (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  url              TEXT NOT NULL,
  project_id       TEXT REFERENCES hub_projects(id) ON DELETE SET NULL,
  last_status      TEXT,
  last_http_status INTEGER,
  last_response_ms INTEGER,
  last_error       TEXT,
  last_checked_at  TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_repos (
  id         TEXT PRIMARY KEY,
  full_name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  project_id TEXT REFERENCES hub_projects(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
`;

/**
 * Columns added after the first release of the hub tables. Older databases
 * get them through ALTER TABLE; new ones too (the CREATE statements above
 * stay minimal so there is one code path).
 *
 * external_key  — stable id from the source an item was imported from
 *                 (e.g. "gmail:<threadId>"), so re-imports update in place.
 * external_hash — hash of the fields last imported; a re-import only
 *                 overwrites local edits when the source itself changed.
 */
const ADDED_COLUMNS: { table: string; column: string; type: string }[] = [
  { table: "hub_projects", column: "external_key", type: "TEXT" },
  { table: "hub_projects", column: "external_hash", type: "TEXT" },
  { table: "hub_tasks", column: "external_key", type: "TEXT" },
  { table: "hub_tasks", column: "external_hash", type: "TEXT" },
  { table: "hub_sites", column: "external_key", type: "TEXT" },
  { table: "hub_sites", column: "external_hash", type: "TEXT" },
];

const HUB_INDEX_SQL = /* sql */ `
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_projects_ext ON hub_projects(external_key) WHERE external_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_tasks_ext    ON hub_tasks(external_key)    WHERE external_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_sites_ext    ON hub_sites(external_key)    WHERE external_key IS NOT NULL;
`;

function columnExists(database: Database.Database, table: string, column: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

const ensured = new WeakSet<Database.Database>();

/** Create the hub tables and columns on `database` if they are missing. Cheap after the first call. */
export function ensureHubSchema(database: Database.Database): void {
  if (ensured.has(database)) return;
  database.exec(HUB_SCHEMA_SQL);
  for (const { table, column, type } of ADDED_COLUMNS) {
    if (!columnExists(database, table, column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }
  database.exec(HUB_INDEX_SQL);
  ensured.add(database);
}
