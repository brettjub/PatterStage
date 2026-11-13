/* eslint-disable @typescript-eslint/no-require-imports */
/** @jest-environment node */

jest.unmock("better-sqlite3");

import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { ensureProfilesToolsParity } from "@/lib/db/profiles-tools-parity-ensure";
import {
  BASELINE_SCHEMA_VERSION,
  exportLegacySnapshot,
  rebuildToBaseline,
} from "@/lib/db/upgrade";

function loadRealBetterSqlite3(): typeof import("better-sqlite3") {
  return require("better-sqlite3/lib/index.js") as typeof import("better-sqlite3");
}

const repoRoot = join(__dirname, "..", "..");
const migrationsDir = join(repoRoot, "src", "lib", "db", "migrations");
const baselinePath = join(migrationsDir, "001_baseline.sql");
const baselineSql = readFileSync(baselinePath, "utf-8");

type Db = import("better-sqlite3").Database;

function openFileDb(path: string): Db {
  const Database = loadRealBetterSqlite3();
  return new (Database as unknown as new (path: string) => Db)(path);
}

function schemaVersion(database: Db): number | null {
  const row = database.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  return row ? parseInt(row.value, 10) : null;
}

function tableNames(database: Db): string[] {
  const rows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/**
 * The state left by a server that could not find the baseline SQL: only
 * agent_root/skills exist, yet schema_version says 5.
 */
function createWedgedDbFile(path: string): void {
  const database = openFileDb(path);
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO meta (key, value) VALUES ('schema_version', '5');
  `);
  // The unguarded incremental helpers ran this on the empty database.
  ensureProfilesToolsParity(database);
  database.prepare("UPDATE agent_root SET display_name = ? WHERE id = 1").run("Kept");
  database.close();
}

describe("rebuildToBaseline integration", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ch-db-upgrade-"));
    dbPath = join(tempDir, "control-hub.db");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Windows may keep WAL handles briefly after close
    }
  });

  it("preserves models, credentials, cron_jobs, and sessions across baseline rebuild", () => {
    const Database = loadRealBetterSqlite3();
    const legacy = new (Database as unknown as new (path: string) => import("better-sqlite3").Database)(
      dbPath
    );
    legacy.pragma("foreign_keys = ON");
    legacy.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta (key, value) VALUES ('schema_version', '32');
    `);
    legacy.exec(baselineSql);
    legacy
      .prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'")
      .run("32");

    const ts = new Date().toISOString();
    legacy
      .prepare(
        "INSERT INTO credentials (id, label, provider, api_key, key_hint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run("cred-1", "Test", "anthropic", "sk-test-key", "sk...key", ts, ts);

    legacy
      .prepare(
        "INSERT INTO models (id, name, provider, model_id, import_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run("model-1", "claude", "anthropic", "claude-3", "imp-1", ts, ts);

    legacy
      .prepare(
        `INSERT INTO cron_jobs (
          id, name, prompt, schedule, schedule_display, profile_name, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run("cron-1", "Daily", "run task", "0 9 * * *", "9am daily", "default", "ch", ts, ts);

    legacy
      .prepare(
        `INSERT INTO missions (id, name, prompt, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("m-legacy", "Legacy Mission", "do work", "queued", ts, ts);

    legacy
      .prepare(
        `INSERT INTO sessions (id, agent_type, source, mission_id, started_at, status)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("sess-1", "hermes", "mission", "m-legacy", ts, "active");

    const snapshot = exportLegacySnapshot(legacy);
    expect(snapshot.missions).toHaveLength(1);
    expect(snapshot.tables.credentials).toHaveLength(1);
    expect(snapshot.tables.models).toHaveLength(1);
    expect(snapshot.tables.cron_jobs).toHaveLength(1);
    expect(snapshot.tables.sessions).toHaveLength(1);

    rebuildToBaseline(legacy, dbPath, baselineSql);

    const reopened = new (Database as unknown as new (path: string) => import("better-sqlite3").Database)(
      dbPath
    );
    reopened.pragma("foreign_keys = ON");

    const version = reopened
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string };
    expect(parseInt(version.value, 10)).toBe(BASELINE_SCHEMA_VERSION);

    expect(
      (reopened.prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n
    ).toBeGreaterThanOrEqual(1);
    expect(
      (reopened.prepare("SELECT COUNT(*) AS n FROM models").get() as { n: number }).n
    ).toBeGreaterThanOrEqual(1);
    expect(
      (reopened.prepare("SELECT COUNT(*) AS n FROM cron_jobs").get() as { n: number }).n
    ).toBe(1);
    expect(reopened.prepare("SELECT id FROM missions WHERE id = ?").get("m-legacy")).toBeDefined();
    expect(
      (reopened.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n
    ).toBe(1);

    reopened.close();
  });
});

describe("npm run db:migrate (scripts/tooling/migrate-db.mjs)", () => {
  let tempDir: string;
  let dbPath: string;

  function runMigrateScript(): { status: number | null; output: string } {
    const result = spawnSync(
      process.execPath,
      [join(repoRoot, "scripts", "tooling", "migrate-db.mjs")],
      { cwd: repoRoot, env: { ...process.env, CH_DATA_DIR: tempDir }, encoding: "utf-8" },
    );
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ch-db-migrate-"));
    dbPath = join(tempDir, "control-hub.db");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("applies the baseline to a missing database", () => {
    const { status, output } = runMigrateScript();

    expect(output).toContain("schema_version before: 0");
    expect(status).toBe(0);
    const database = openFileDb(dbPath);
    expect(schemaVersion(database)).toBe(BASELINE_SCHEMA_VERSION);
    expect(tableNames(database)).toEqual(expect.arrayContaining(["missions", "agent_profiles"]));
    database.close();
  });

  it("repairs a database with schema_version > 0 but no core tables", () => {
    createWedgedDbFile(dbPath);

    const { status, output } = runMigrateScript();

    expect(output).toContain("schema_version before: 5");
    expect(output).toContain("repairing with the baseline schema");
    expect(status).toBe(0);
    const database = openFileDb(dbPath);
    expect(schemaVersion(database)).toBe(BASELINE_SCHEMA_VERSION);
    expect(tableNames(database)).toEqual(
      expect.arrayContaining(["missions", "agent_profiles", "cron_jobs", "mission_categories"]),
    );
    expect(
      (database.prepare("SELECT COUNT(*) AS n FROM mission_categories").get() as { n: number }).n,
    ).toBeGreaterThan(0);
    expect(database.prepare("SELECT display_name FROM agent_root WHERE id = 1").get()).toEqual({
      display_name: "Kept",
    });
    database.close();

    // A second run finds nothing left to do.
    const second = runMigrateScript();
    expect(second.status).toBe(0);
    expect(second.output).toContain("schema_version before: 3");
    expect(second.output).not.toContain("repairing");
  });
});

describe("getDb() against a runtime data directory", () => {
  const originalDataDir = process.env.CH_DATA_DIR;
  let tempDir: string;
  let dbPath: string;
  /** What the server's migration lookup finds; null simulates the bundled build losing the SQL. */
  let resolvedMigrationsDir: string | null;
  let dbModule: typeof import("@/lib/db");

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ch-db-runtime-"));
    dbPath = join(tempDir, "control-hub.db");
    resolvedMigrationsDir = migrationsDir;
    process.env.CH_DATA_DIR = tempDir;
    jest.isolateModules(() => {
      // Real driver + real @/lib/db (both are mocked globally in jest.setup.ts).
      jest.doMock("better-sqlite3", () => loadRealBetterSqlite3());
      jest.doMock("@/lib/db/migration-files", () => ({
        ...jest.requireActual<typeof import("@/lib/db/migration-files")>("@/lib/db/migration-files"),
        resolveMigrationsDir: () => resolvedMigrationsDir,
      }));
      dbModule = jest.requireActual<typeof import("@/lib/db")>("@/lib/db");
    });
  });

  afterEach(() => {
    try {
      dbModule.getDb().close();
    } catch {
      // never opened, or migrations failed
    }
    if (originalDataDir === undefined) {
      delete process.env.CH_DATA_DIR;
    } else {
      process.env.CH_DATA_DIR = originalDataDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates the full schema when the database does not exist yet", () => {
    const database = dbModule.getDb();

    expect(schemaVersion(database)).toBe(5);
    expect(tableNames(database)).toEqual(
      expect.arrayContaining(["missions", "agent_profiles", "cron_jobs", "mission_categories"]),
    );
    expect(() =>
      database.prepare("SELECT queued_for_run FROM missions").all(),
    ).not.toThrow();
    expect(dbModule.getSchemaHealth()).toMatchObject({
      schemaVersion: 5,
      hasMissionCategoriesTable: true,
    });
  });

  it("repairs a database with schema_version > 0 but no core tables", () => {
    createWedgedDbFile(dbPath);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const database = dbModule.getDb();

    expect(schemaVersion(database)).toBe(5);
    expect(tableNames(database)).toEqual(expect.arrayContaining(["missions", "agent_profiles"]));
    expect(database.prepare("SELECT display_name FROM agent_root WHERE id = 1").get()).toEqual({
      display_name: "Kept",
    });
    warn.mockRestore();
  });

  it("fails loudly without recording a schema_version when the baseline SQL is missing", () => {
    resolvedMigrationsDir = null;

    expect(() => dbModule.getDb()).toThrow(/001_baseline\.sql.*was not found/);
    // Not cached: every caller sees the failure instead of a schema-less handle.
    expect(() => dbModule.ensureDb()).toThrow(/was not found/);

    const inspect = openFileDb(dbPath);
    expect(schemaVersion(inspect)).toBeNull();
    expect(tableNames(inspect)).toEqual(["meta"]);
    inspect.close();

    // Once the SQL is reachable the same process recovers on the next call.
    resolvedMigrationsDir = migrationsDir;
    expect(schemaVersion(dbModule.getDb())).toBe(5);
  });
});
