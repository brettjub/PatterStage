/* eslint-disable @typescript-eslint/no-require-imports */
/** @jest-environment node */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { applyMissionQueueMigration } from "@/lib/db/apply-mission-queue-migration";
import { applyMissionRepeatMigration } from "@/lib/db/apply-mission-repeat-migration";
import { applyProfilesToolsParityUpgrade } from "@/lib/db/apply-profiles-tools-upgrade";
import { resolveMigrationsDir } from "@/lib/db/migration-files";
import { ensureProfilesToolsParity } from "@/lib/db/profiles-tools-parity-ensure";
import { runSchemaMigrations } from "@/lib/db/run-migrations";

const repoRoot = join(__dirname, "..", "..");
const migrationsDir = join(repoRoot, "src", "lib", "db", "migrations");

function loadRealBetterSqlite3(): typeof import("better-sqlite3") {
  return require("better-sqlite3/lib/index.js") as typeof import("better-sqlite3");
}

describe("baseline schema v2", () => {
  it("includes mission_categories, agent_profiles, and catalog_templates", () => {
    const Database = loadRealBetterSqlite3();
    const db = new (Database as unknown as new (
      path: string,
    ) => import("better-sqlite3").Database)(":memory:");
    db.pragma("foreign_keys = ON");

    const baselinePath = join(migrationsDir, "001_baseline.sql");
    db.exec(readFileSync(baselinePath, "utf-8"));

    for (const table of [
      "mission_categories",
      "agent_profiles",
      "catalog_templates",
      "missions",
    ]) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
      expect(row).toBeTruthy();
    }

    const missionCols = db
      .prepare("PRAGMA table_info(missions)")
      .all() as Array<{ name: string }>;
    expect(missionCols.some((c) => c.name === "category_id")).toBe(true);
    expect(missionCols.some((c) => c.name === "output_format")).toBe(true);
    expect(missionCols.some((c) => c.name === "constraints")).toBe(true);

    const catCols = db
      .prepare("PRAGMA table_info(mission_categories)")
      .all() as Array<{ name: string }>;
    expect(catCols.some((c) => c.name === "seed_key")).toBe(true);
  });
});

// ── Migration runner + incremental helpers ─────────────────────
// Regression cover for the "wedged" runtime DB: the bundled server could not
// find the migration SQL, skipped the baseline, and the incremental helpers
// still bumped schema_version to 5 on a database with no core tables.

type Db = import("better-sqlite3").Database;

const LATEST_SCHEMA_VERSION = 5;
const MISSING_SQL = /was not found/;

function openMemoryDb(): Db {
  const Database = loadRealBetterSqlite3();
  const db = new (Database as unknown as new (path: string) => Db)(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

function createMeta(db: Db, schemaVersion?: number): void {
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  if (schemaVersion !== undefined) {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(
      String(schemaVersion),
    );
  }
}

/** Recorded schema_version, or null when none was ever written. */
function recordedVersion(db: Db): number | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  return row ? parseInt(row.value, 10) : null;
}

function tableNames(db: Db): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

function columnNames(db: Db, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/** Columns per table plus index names — enough to compare two databases structurally. */
function schemaShape(db: Db): Record<string, unknown> {
  const shape: Record<string, unknown> = {};
  for (const table of tableNames(db)) {
    shape[table] = db
      .prepare(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('${table}') ORDER BY name`)
      .all();
  }
  shape["(indexes)"] = db
    .prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  return shape;
}

/** A database on the squashed baseline (schema_version 3), as `npm run db:migrate` leaves it. */
function createBaselineDb(): Db {
  const db = openMemoryDb();
  createMeta(db, 3);
  db.exec(readFileSync(join(migrationsDir, "001_baseline.sql"), "utf-8"));
  return db;
}

/**
 * The state the bug produced: no baseline, but the unguarded helpers created
 * agent_root/skills and recorded schema_version 5.
 */
function createWedgedDb(): Db {
  const db = openMemoryDb();
  createMeta(db, LATEST_SCHEMA_VERSION);
  ensureProfilesToolsParity(db);
  return db;
}

const incrementalHelpers: Array<[string, (db: Db, dir: string | null) => number]> = [
  ["applyProfilesToolsParityUpgrade", applyProfilesToolsParityUpgrade],
  ["applyMissionRepeatMigration", applyMissionRepeatMigration],
  ["applyMissionQueueMigration", applyMissionQueueMigration],
];

describe("incremental migration helpers without the core schema", () => {
  it.each(incrementalHelpers)("%s leaves an empty database untouched", (_name, helper) => {
    const db = openMemoryDb();
    createMeta(db);

    expect(helper(db, migrationsDir)).toBe(0);

    expect(recordedVersion(db)).toBeNull();
    expect(tableNames(db)).toEqual(["meta"]);
    db.close();
  });

  it.each(incrementalHelpers)("%s does not advance a recorded schema_version", (_name, helper) => {
    const db = openMemoryDb();
    createMeta(db, 2);

    expect(helper(db, migrationsDir)).toBe(2);

    expect(recordedVersion(db)).toBe(2);
    expect(tableNames(db)).toEqual(["meta"]);
    db.close();
  });
});

describe("incremental migration helpers when the migration SQL is missing", () => {
  let emptyDir: string;

  beforeAll(() => {
    emptyDir = mkdtempSync(join(tmpdir(), "ch-migrations-empty-"));
  });

  afterAll(() => {
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("applyProfilesToolsParityUpgrade throws without bumping a v2 database", () => {
    const db = createBaselineDb();
    createMeta(db, 2);

    expect(() => applyProfilesToolsParityUpgrade(db, null)).toThrow(MISSING_SQL);
    expect(recordedVersion(db)).toBe(2);
    db.close();
  });

  it("applyMissionRepeatMigration throws without bumping", () => {
    const db = createBaselineDb();

    expect(() => applyMissionRepeatMigration(db, null)).toThrow(/003_mission_infinite_repeat\.sql/);
    expect(() => applyMissionRepeatMigration(db, emptyDir)).toThrow(MISSING_SQL);
    expect(recordedVersion(db)).toBe(3);
    db.close();
  });

  it("applyMissionQueueMigration throws without bumping while the column is missing", () => {
    const db = createBaselineDb();

    expect(() => applyMissionQueueMigration(db, null)).toThrow(/004_mission_queue\.sql/);
    expect(() => applyMissionQueueMigration(db, emptyDir)).toThrow(MISSING_SQL);
    expect(recordedVersion(db)).toBe(3);
    expect(columnNames(db, "missions")).not.toContain("queued_for_run");
    db.close();
  });
});

describe("applyMissionQueueMigration", () => {
  it("adds missions.queued_for_run and records schema_version 5", () => {
    const db = createBaselineDb();

    expect(applyMissionQueueMigration(db, migrationsDir)).toBe(5);

    expect(columnNames(db, "missions")).toContain("queued_for_run");
    expect(recordedVersion(db)).toBe(5);
    expect(applyMissionQueueMigration(db, migrationsDir)).toBe(5);
    db.close();
  });

  it("adds the column to a database already recorded at version 5 without it", () => {
    // Left behind when the server bumped the version without finding 004_mission_queue.sql.
    const db = createBaselineDb();
    createMeta(db, 5);
    expect(columnNames(db, "missions")).not.toContain("queued_for_run");

    expect(applyMissionQueueMigration(db, migrationsDir)).toBe(5);

    expect(columnNames(db, "missions")).toContain("queued_for_run");
    expect(recordedVersion(db)).toBe(5);
    db.close();
  });

  it("needs no SQL file once the column exists", () => {
    const db = createBaselineDb();
    applyMissionQueueMigration(db, migrationsDir);

    expect(applyMissionQueueMigration(db, null)).toBe(5);
    db.close();
  });
});

describe("runSchemaMigrations", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("applies the baseline and every incremental migration to an empty database", () => {
    const db = openMemoryDb();

    runSchemaMigrations(db, migrationsDir);

    expect(recordedVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(["missions", "agent_profiles", "cron_jobs", "mission_categories"]),
    );
    expect(columnNames(db, "missions")).toContain("queued_for_run");
    expect(warn).not.toHaveBeenCalled();
    db.close();
  });

  it("is a no-op on an up-to-date database, even when the SQL cannot be found", () => {
    const db = openMemoryDb();
    runSchemaMigrations(db, migrationsDir);
    const before = schemaShape(db);

    expect(() => runSchemaMigrations(db, null)).not.toThrow();

    expect(schemaShape(db)).toEqual(before);
    expect(recordedVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    db.close();
  });

  it("repairs a database with schema_version > 0 but no core tables", () => {
    const wedged = createWedgedDb();
    expect(tableNames(wedged)).toEqual(["agent_root", "meta", "skills"]);
    wedged.prepare("UPDATE agent_root SET display_name = ? WHERE id = 1").run("Kept");
    wedged
      .prepare("INSERT INTO skills (skill_key, display_name) VALUES (?, ?)")
      .run("kept-skill", "Kept skill");

    runSchemaMigrations(wedged, migrationsDir);

    const fresh = openMemoryDb();
    runSchemaMigrations(fresh, migrationsDir);
    expect(schemaShape(wedged)).toEqual(schemaShape(fresh));
    expect(recordedVersion(wedged)).toBe(LATEST_SCHEMA_VERSION);
    expect(wedged.prepare("SELECT display_name FROM agent_root WHERE id = 1").get()).toEqual({
      display_name: "Kept",
    });
    expect(wedged.prepare("SELECT display_name FROM skills").all()).toEqual([
      { display_name: "Kept skill" },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("re-applying the baseline schema"));
    wedged.close();
    fresh.close();
  });

  it("throws on an empty database without recording a schema_version when the baseline is missing", () => {
    const db = openMemoryDb();

    expect(() => runSchemaMigrations(db, null)).toThrow(/001_baseline\.sql.*was not found/);

    expect(recordedVersion(db)).toBeNull();
    expect(tableNames(db)).toEqual(["meta"]);
    db.close();
  });

  it("throws on a wedged database without changing its schema_version when the baseline is missing", () => {
    const db = createWedgedDb();

    expect(() => runSchemaMigrations(db, null)).toThrow(/001_baseline\.sql.*was not found/);

    expect(recordedVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(tableNames(db)).toEqual(["agent_root", "meta", "skills"]);
    db.close();
  });

  it("rolls the baseline back completely when it fails part-way", () => {
    const brokenDir = mkdtempSync(join(tmpdir(), "ch-migrations-broken-"));
    try {
      writeFileSync(
        join(brokenDir, "001_baseline.sql"),
        "CREATE TABLE missions (id TEXT PRIMARY KEY);\nCREATE TABLE broken (;\n",
      );
      const db = openMemoryDb();

      expect(() => runSchemaMigrations(db, brokenDir)).toThrow();

      expect(recordedVersion(db)).toBeNull();
      expect(tableNames(db)).toEqual(["meta"]);
      db.close();
    } finally {
      rmSync(brokenDir, { recursive: true, force: true });
    }
  });
});

describe("resolveMigrationsDir", () => {
  it("finds the repository migrations by default", () => {
    expect(resolveMigrationsDir()).not.toBeNull();
    expect(readFileSync(join(resolveMigrationsDir() as string, "001_baseline.sql"), "utf-8")).toBe(
      readFileSync(join(migrationsDir, "001_baseline.sql"), "utf-8"),
    );
  });

  it("skips candidates without the baseline, such as the bundler's __dirname placeholder", () => {
    expect(resolveMigrationsDir(["/ROOT/src/lib/db/migrations", migrationsDir])).toBe(migrationsDir);
  });

  it("returns null when no candidate holds the baseline", () => {
    expect(resolveMigrationsDir(["/ROOT/src/lib/db/migrations"])).toBeNull();
    expect(resolveMigrationsDir([])).toBeNull();
  });
});
