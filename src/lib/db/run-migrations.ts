// ═══════════════════════════════════════════════════════════════
// db/run-migrations.ts — Bring an open database to the current schema
// ═══════════════════════════════════════════════════════════════
// Separate from @/lib/db so it can run against any handle (tests, tooling).

import type Database from "better-sqlite3";
import { getSchemaVersion, setSchemaVersion } from "@/lib/db-schema";
import { applyMissionQueueMigration } from "./apply-mission-queue-migration";
import { applyMissionRepeatMigration } from "./apply-mission-repeat-migration";
import { applyProfilesToolsParityUpgrade } from "./apply-profiles-tools-upgrade";
import { BASELINE_MIGRATION_FILE, hasCoreSchema, readMigrationSql } from "./migration-files";
import { BASELINE_SCHEMA_VERSION } from "./upgrade";

function ensureMetaTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

/**
 * Apply the baseline atomically and record its schema version.
 * All-or-nothing: a failure leaves neither tables nor a version bump behind.
 */
function applyBaselineSchema(database: Database.Database, baselineSql: string): void {
  // The baseline sets WAL itself, and SQLite refuses to change journal mode
  // inside a transaction, so switch before opening one.
  database.pragma("journal_mode = WAL");
  const apply = database.transaction(() => {
    // Another process may have initialised the file while this one waited for the write lock.
    if (hasCoreSchema(database)) return;
    database.exec(baselineSql);
    setSchemaVersion(database, BASELINE_SCHEMA_VERSION);
  });
  apply.immediate();
}

/**
 * Create the baseline schema when the core tables are missing, then apply the
 * incremental migrations. Throws, leaving schema_version untouched, when the
 * SQL a pending step needs cannot be found.
 *
 * A database whose schema_version is above 0 but which has no core tables was
 * left that way by a build that bumped the version without the baseline; it is
 * repaired by applying the baseline in place (existing tables are kept).
 */
export function runSchemaMigrations(
  database: Database.Database,
  migrationsDir: string | null,
): void {
  ensureMetaTable(database);

  if (!hasCoreSchema(database)) {
    const recordedVersion = getSchemaVersion(database);
    const baselineSql = readMigrationSql(migrationsDir, BASELINE_MIGRATION_FILE);
    if (recordedVersion > 0) {
      console.warn(
        `[db] schema_version is ${recordedVersion} but the core tables are missing — re-applying the baseline schema`,
      );
    }
    applyBaselineSchema(database, baselineSql);
  }

  applyProfilesToolsParityUpgrade(database, migrationsDir);
  applyMissionRepeatMigration(database, migrationsDir);
  applyMissionQueueMigration(database, migrationsDir);
}
