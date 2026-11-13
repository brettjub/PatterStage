import type Database from "better-sqlite3";
import { getSchemaVersion, setSchemaVersion } from "@/lib/db-schema";
import { hasCoreSchema, readMigrationSql } from "./migration-files";

export const MISSION_REPEAT_FIX_SCHEMA_VERSION = 4;

/**
 * Apply 003_mission_infinite_repeat.sql when schema_version is below 4.
 *
 * No-op (schema_version untouched) when the core schema is absent. Throws
 * without bumping when the SQL cannot be found.
 */
export function applyMissionRepeatMigration(
  database: Database.Database,
  migrationsDir: string | null,
): number {
  const current = getSchemaVersion(database);
  if (current >= MISSION_REPEAT_FIX_SCHEMA_VERSION || !hasCoreSchema(database)) {
    return current;
  }

  const sql = readMigrationSql(migrationsDir, "003_mission_infinite_repeat.sql");
  try {
    database.exec(sql);
  } catch {
    // Best-effort data repair: legacy DBs may lack the columns it reads.
  }

  setSchemaVersion(database, MISSION_REPEAT_FIX_SCHEMA_VERSION);
  return MISSION_REPEAT_FIX_SCHEMA_VERSION;
}
