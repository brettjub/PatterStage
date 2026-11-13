// ═══════════════════════════════════════════════════════════════
// db.ts — SQLite connection + migration runner
// Database: ~/control-hub/data/control-hub.db
// ═══════════════════════════════════════════════════════════════

import Database, { type Database as _DatabaseType } from "better-sqlite3";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { CH_DATA_DIR } from "./paths";
import { getSchemaVersion } from "./db-schema";
import { needsBaselineRebuild, rebuildToBaseline } from "./db/upgrade";
import {
  BASELINE_MIGRATION_FILE,
  readMigrationSql,
  resolveMigrationsDir,
} from "./db/migration-files";
import { runSchemaMigrations } from "./db/run-migrations";

// ── Ensure data directory exists ───────────────────────────────

const dataDir = CH_DATA_DIR;
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const DB_PATH = join(dataDir, "control-hub.db");

// ── Connection factory ─────────────────────────────────────────

let _db: Database.Database | null = null;

function openConnection(): Database.Database {
  const connection = new Database(DB_PATH);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  connection.pragma("busy_timeout = 5000");
  return connection;
}

/**
 * Open (or reuse) the SQLite database connection. Runs migrations on first open.
 *
 * Throws when the schema cannot be brought up to date. The handle is only
 * cached once migrations succeed, so the next call retries instead of serving
 * queries against a half-initialised database.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  const connection = openConnection();
  try {
    _db = runMigrations(connection);
  } catch (err) {
    connection.close();
    throw err;
  }

  return _db;
}

/** Alias — most code uses db() not getDb() */
export const db = getDb;

/** Result row from gateway_platforms table */
interface GatewayPlatformRow {
  platform: string;
  enabled: number;
  bot_token_present: number;
  last_synced_at: string;
}

/**
 * Read all gateway platform records from the DB.
 * Returns empty array if table doesn't exist or query fails.
 */
export function getGatewayPlatforms(): GatewayPlatformRow[] {
  try {
    return getDb()
      .prepare("SELECT platform, enabled, bot_token_present, last_synced_at FROM gateway_platforms")
      .all() as GatewayPlatformRow[];
  } catch {
    return [];
  }
}

// ── Shorthand helpers ─────────────────────────────────────────

/**
 * Wrap `fn` in a SQLite transaction. Commits on success, rolls back on throw.
 * shorthand for `db().transaction(fn)()`.
 */
export function inTransaction<T>(fn: () => T): T {
  const database = db();
  return database.transaction(fn)();
}

/** Generate a cryptographically random UUID v4 string. */
export function uuid(): string {
  return crypto.randomUUID();
}

/** Return the current UTC time as an ISO-8601 string. */
export function now(): string {
  return new Date().toISOString();
}

// ── Migration runner ───────────────────────────────────────────

/** Migrate `database` and return the handle to use (a legacy rebuild replaces the file). */
function runMigrations(database: Database.Database): Database.Database {
  const migrationsDir = resolveMigrationsDir();

  if (needsBaselineRebuild(database)) {
    const baselineSql = readMigrationSql(migrationsDir, BASELINE_MIGRATION_FILE);
    rebuildToBaseline(database, DB_PATH, baselineSql);
    return openConnection();
  }

  runSchemaMigrations(database, migrationsDir);
  return database;
}

// ── Bootstrap: ensure DB + schema exist ───────────────────────
// Call this at module load time for API routes that need the DB
// immediately (before first query).

let _bootstrapped = false;

/**
 * Ensure the database is open and migrations have run.
 * Idempotent — safe to call multiple times.
 */
export function ensureDb(): void {
  if (_bootstrapped) return;
  db(); // forces open + migrate; throws (and stays un-bootstrapped) when migrations fail
  _bootstrapped = true;
}

export interface SchemaHealth {
  schemaVersion: number;
  hasMissionCategoriesTable: boolean;
  categoryCount: number;
}

/** Report schema version and mission_categories table state (after ensureDb). */
export function getSchemaHealth(): SchemaHealth {
  ensureDb();
  const database = getDb();
  const schemaVersion = getSchemaVersion(database);
  const tableRow = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mission_categories'",
    )
    .get() as { name: string } | undefined;
  const hasMissionCategoriesTable = Boolean(tableRow);
  let categoryCount = 0;
  if (hasMissionCategoriesTable) {
    const row = database
      .prepare("SELECT COUNT(*) AS c FROM mission_categories")
      .get() as { c: number };
    categoryCount = row.c ?? 0;
  }
  if (schemaVersion >= 2 && !hasMissionCategoriesTable) {
    console.error(
      "[db] schema_version >= 2 but mission_categories table is missing — database may be corrupt",
    );
  }
  return { schemaVersion, hasMissionCategoriesTable, categoryCount };
}
