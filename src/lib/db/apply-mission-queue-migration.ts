import type Database from "better-sqlite3";
import { getSchemaVersion, setSchemaVersion } from "@/lib/db-schema";
import { readMigrationSql } from "./migration-files";

export const MISSION_QUEUE_SCHEMA_VERSION = 5;

function missionsColumns(database: Database.Database): string[] {
  const rows = database.prepare("PRAGMA table_info(missions)").all() as { name: string }[];
  return rows.map((r) => r.name);
}

/**
 * Ensure missions.queued_for_run exists (004_mission_queue.sql) and record schema_version 5.
 *
 * The column is checked on every call, not only below version 5: builds that
 * could not find the SQL file recorded version 5 without adding it, and this
 * repairs those databases on the next start.
 *
 * No-op (schema_version untouched) when the missions table is absent. Throws
 * without bumping when the column is missing and the SQL cannot be found or applied.
 */
export function applyMissionQueueMigration(
  database: Database.Database,
  migrationsDir: string | null,
): number {
  const current = getSchemaVersion(database);
  const columns = missionsColumns(database);
  if (columns.length === 0) {
    return current;
  }

  if (!columns.includes("queued_for_run")) {
    const sql = readMigrationSql(migrationsDir, "004_mission_queue.sql");
    try {
      database.exec(sql);
    } catch (err) {
      // Another process may have added the column first; anything else is a real failure.
      if (!missionsColumns(database).includes("queued_for_run")) {
        throw err;
      }
    }
  }

  if (current >= MISSION_QUEUE_SCHEMA_VERSION) {
    return current;
  }
  setSchemaVersion(database, MISSION_QUEUE_SCHEMA_VERSION);
  return MISSION_QUEUE_SCHEMA_VERSION;
}
