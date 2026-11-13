/**
 * Idempotent schema fixes after SQL migrations (v2 -> v3 parity).
 * Used when a DB partially applied an older migration chain.
 * Mirrors src/lib/db/run-migrations.ts and src/lib/db/apply-profiles-tools-upgrade.ts.
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

export function tableExists(database, name) {
  return Boolean(
    database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name),
  );
}

export function columnExists(database, tableName, columnName) {
  if (!tableExists(database, tableName)) return false;
  return database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

export const PROFILES_TOOLS_PARITY_SCHEMA_VERSION = 3;

/** schema_version recorded by 001_baseline.sql. */
export const BASELINE_SCHEMA_VERSION = 3;

/** True when the baseline's core tables are present. */
export function hasCoreSchema(database) {
  return tableExists(database, "missions") || tableExists(database, "agent_profiles");
}

/**
 * Apply the (idempotent) baseline atomically and record its schema version.
 * Also repairs a DB whose schema_version was bumped without the core tables:
 * tables that already exist are kept, the missing ones are created.
 * Returns false when the core schema was already there (nothing applied).
 */
export function applyBaselineSchema(database, baselineSql) {
  // The baseline sets WAL itself; SQLite cannot change journal mode inside a transaction.
  database.pragma("journal_mode = WAL");
  const apply = database.transaction(() => {
    // Another process may have initialised the file while this one waited for the write lock.
    if (hasCoreSchema(database)) return false;
    database.exec(baselineSql);
    setSchemaVersionOnMeta(database, BASELINE_SCHEMA_VERSION);
    return true;
  });
  return apply.immediate();
}

export function isProfilesToolsParityComplete(database) {
  return tableExists(database, "agent_root") && tableExists(database, "skills");
}

export function ensureProfilesToolsParity(database) {
  if (tableExists(database, "tool_plugins")) {
    database.exec("DROP TABLE IF EXISTS tool_plugins");
  }

  if (!tableExists(database, "agent_root")) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS agent_root (
        id                  INTEGER PRIMARY KEY CHECK (id = 1),
        display_name        TEXT NOT NULL DEFAULT 'Bob',
        description         TEXT NOT NULL DEFAULT '',
        personality         TEXT NOT NULL DEFAULT 'technical',
        config_yaml         TEXT NOT NULL DEFAULT '',
        soul_md             TEXT NOT NULL DEFAULT '',
        agents_md           TEXT NOT NULL DEFAULT '',
        hermes_md           TEXT NOT NULL DEFAULT '',
        user_md             TEXT NOT NULL DEFAULT '',
        memory_md           TEXT NOT NULL DEFAULT '',
        disabled_skills     TEXT NOT NULL DEFAULT '[]',
        platform_toolsets   TEXT NOT NULL DEFAULT '{}',
        synced_at           TEXT,
        sync_error          TEXT,
        updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO agent_root (id, display_name, description)
      VALUES (1, 'Bob', 'Local Hermes default agent at HERMES_HOME');
    `);
  }

  if (!tableExists(database, "skills")) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        skill_key       TEXT PRIMARY KEY,
        display_name    TEXT NOT NULL DEFAULT '',
        description     TEXT NOT NULL DEFAULT '',
        category        TEXT NOT NULL DEFAULT '',
        content         TEXT NOT NULL DEFAULT '',
        source          TEXT NOT NULL DEFAULT 'custom',
        synced_at       TEXT,
        sync_error      TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
      CREATE INDEX IF NOT EXISTS idx_skills_source ON skills(source);
    `);
  }

  if (tableExists(database, "agent_profiles")) {
    if (!columnExists(database, "agent_profiles", "user_md")) {
      database.exec("ALTER TABLE agent_profiles ADD COLUMN user_md TEXT NOT NULL DEFAULT ''");
    }
    if (!columnExists(database, "agent_profiles", "memory_md")) {
      database.exec("ALTER TABLE agent_profiles ADD COLUMN memory_md TEXT NOT NULL DEFAULT ''");
    }
    if (!columnExists(database, "agent_profiles", "disabled_skills")) {
      database.exec(
        "ALTER TABLE agent_profiles ADD COLUMN disabled_skills TEXT NOT NULL DEFAULT '[]'",
      );
    }
    if (!columnExists(database, "agent_profiles", "platform_toolsets")) {
      database.exec(
        "ALTER TABLE agent_profiles ADD COLUMN platform_toolsets TEXT NOT NULL DEFAULT '{}'",
      );
    }
  }

  if (tableExists(database, "agent_root") && !columnExists(database, "agent_root", "disabled_skills")) {
    database.exec("ALTER TABLE agent_root ADD COLUMN disabled_skills TEXT NOT NULL DEFAULT '[]'");
  }
  if (
    tableExists(database, "agent_root") &&
    !columnExists(database, "agent_root", "platform_toolsets")
  ) {
    database.exec(
      "ALTER TABLE agent_root ADD COLUMN platform_toolsets TEXT NOT NULL DEFAULT '{}'",
    );
  }

  if (tableExists(database, "missions") && !columnExists(database, "missions", "suggested_toolsets")) {
    database.exec(
      "ALTER TABLE missions ADD COLUMN suggested_toolsets TEXT NOT NULL DEFAULT '[]'",
    );
  }

  if (
    tableExists(database, "catalog_templates") &&
    !columnExists(database, "catalog_templates", "suggested_toolsets")
  ) {
    database.exec(
      "ALTER TABLE catalog_templates ADD COLUMN suggested_toolsets TEXT NOT NULL DEFAULT '[]'",
    );
  }
}

function getSchemaVersionFromMeta(database) {
  const row = database.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  return row ? parseInt(row.value, 10) : 0;
}

function setSchemaVersionOnMeta(database, version) {
  database
    .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
    .run("schema_version", String(version));
}

/**
 * Apply incremental SQL (002+) when schema_version < 3, then bump to 3.
 * Migration file prefix 002 is not the stored schema version on main-branch DBs.
 * No-op (schema_version untouched) when the core schema is absent: apply the baseline first.
 */
export function applyProfilesToolsParityUpgrade(database, migrationsDir) {
  const current = getSchemaVersionFromMeta(database);
  if (!hasCoreSchema(database)) {
    return current;
  }
  if (current >= PROFILES_TOOLS_PARITY_SCHEMA_VERSION) {
    ensureProfilesToolsParity(database);
    return current;
  }

  if (existsSync(migrationsDir)) {
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const num = parseInt(file.split("_")[0], 10);
      if (isNaN(num) || num <= 1) continue;
      const sql = readFileSync(join(migrationsDir, file), "utf-8");
      try {
        database.exec(sql);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  Warning applying ${file}: ${msg}`);
        console.warn("  Continuing with idempotent parity ensure...");
      }
    }
  }

  ensureProfilesToolsParity(database);
  setSchemaVersionOnMeta(database, PROFILES_TOOLS_PARITY_SCHEMA_VERSION);
  return PROFILES_TOOLS_PARITY_SCHEMA_VERSION;
}
