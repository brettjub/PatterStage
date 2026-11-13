import type Database from "better-sqlite3";
import { getSchemaVersion, setSchemaVersion } from "@/lib/db-schema";
import { hasCoreSchema, listMigrationFiles, readMigrationSql } from "./migration-files";
import {
  ensureProfilesToolsParity,
  PROFILES_TOOLS_PARITY_SCHEMA_VERSION,
} from "./profiles-tools-parity-ensure";

/**
 * Apply 002_profiles_tools_parity.sql when meta schema_version is below 3.
 * File prefix 002 is a migration sequence id, not the target schema version.
 *
 * No-op (schema_version untouched) when the core schema is absent: the baseline
 * must be applied first. Throws without bumping when the SQL cannot be found.
 */
export function applyProfilesToolsParityUpgrade(
  database: Database.Database,
  migrationsDir: string | null,
): number {
  const current = getSchemaVersion(database);
  if (!hasCoreSchema(database)) {
    return current;
  }
  if (current >= PROFILES_TOOLS_PARITY_SCHEMA_VERSION) {
    ensureProfilesToolsParity(database);
    return current;
  }

  for (const file of listMigrationFiles(migrationsDir)) {
    const num = parseInt(file.split("_")[0], 10);
    if (isNaN(num) || num <= 1) continue;
    const sql = readMigrationSql(migrationsDir, file);
    try {
      database.exec(sql);
    } catch {
      // Partial v2 DBs may already have some ALTERs; idempotent ensure below.
    }
  }

  ensureProfilesToolsParity(database);
  setSchemaVersion(database, PROFILES_TOOLS_PARITY_SCHEMA_VERSION);
  return PROFILES_TOOLS_PARITY_SCHEMA_VERSION;
}
