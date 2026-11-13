// ═══════════════════════════════════════════════════════════════
// db/migration-files.ts — Locate and read migration SQL at runtime
// ═══════════════════════════════════════════════════════════════
// Kept free of @/lib/db imports so migration helpers and tests can use it
// without opening the runtime database.

import type Database from "better-sqlite3";
import { existsSync, readFileSync, readdirSync } from "fs";

export const BASELINE_MIGRATION_FILE = "001_baseline.sql";

/**
 * Directories that may hold the migration SQL, most specific first.
 *
 * `__dirname` is only a real path when this module runs unbundled (tsx scripts,
 * Jest). Turbopack rewrites it to a "/ROOT/..." placeholder in the Next.js
 * server bundle, so the server falls back to the working directory, which is
 * the repository root for `next dev` / `next start`.
 */
export function migrationsDirCandidates(): string[] {
  return [__dirname + "/migrations", process.cwd() + "/src/lib/db/migrations"];
}

/** First candidate that contains the baseline SQL, or null when none does. */
export function resolveMigrationsDir(
  candidates: string[] = migrationsDirCandidates(),
): string | null {
  for (const dir of candidates) {
    if (existsSync(dir + "/" + BASELINE_MIGRATION_FILE)) {
      return dir;
    }
  }
  return null;
}

function missingMigrationError(fileName: string, migrationsDir: string | null): Error {
  const searched = migrationsDir ?? migrationsDirCandidates().join(", ");
  return new Error(
    `Control Hub database migration "${fileName}" was not found (searched: ${searched}). ` +
      "The schema was left unchanged. Start the server from the Control Hub repository root " +
      "(src/lib/db/migrations must be on disk), or run `npm run db:migrate` there.",
  );
}

/**
 * Read one migration file. Throws when the directory or file is missing so a
 * caller can never record a migration as applied without having run its SQL.
 */
export function readMigrationSql(migrationsDir: string | null, fileName: string): string {
  const path = migrationsDir === null ? null : migrationsDir + "/" + fileName;
  if (path === null || !existsSync(path)) {
    throw missingMigrationError(fileName, migrationsDir);
  }
  return readFileSync(path, "utf-8");
}

/** Sorted `.sql` file names in the migrations directory. Throws when it is missing. */
export function listMigrationFiles(migrationsDir: string | null): string[] {
  if (migrationsDir === null || !existsSync(migrationsDir)) {
    throw missingMigrationError("*.sql", migrationsDir);
  }
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * True when the baseline's core tables are present. Incremental migrations
 * only make sense on top of them, so none may advance schema_version without.
 */
export function hasCoreSchema(database: Database.Database): boolean {
  const row = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('missions', 'agent_profiles') LIMIT 1",
    )
    .get() as { name: string } | undefined;
  return Boolean(row);
}
