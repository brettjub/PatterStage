#!/usr/bin/env node
/**
 * Apply SQLite migrations to the runtime Control Hub database (CH_DATA_DIR).
 * Usage: npm run db:migrate
 * Reads CH_DATA_DIR from env or .env.local when present.
 */

import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import {
  applyProfilesToolsParityUpgrade,
  ensureProfilesToolsParity,
} from "./db-schema-ensure.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(ROOT, "src/lib/db/migrations");

function loadEnvLocal() {
  const envPath = join(ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf-8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function getChDataDir() {
  const raw =
    process.env.CH_DATA_DIR ||
    process.env.CONTROL_HUB_DATA_DIR ||
    join(homedir(), "control-hub", "data");
  return String(raw).replace(/[/\\]+$/, "");
}

function getMeta(database, key) {
  const row = database.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setMeta(database, key, value) {
  database
    .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
    .run(key, value);
}

function getSchemaVersion(database) {
  const v = getMeta(database, "schema_version");
  return v ? parseInt(v, 10) : 0;
}

function setSchemaVersion(database, version) {
  setMeta(database, "schema_version", String(version));
}

loadEnvLocal();
const dataDir = getChDataDir();
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}
const dbPath = join(dataDir, "control-hub.db");

console.log(`Database: ${dbPath}`);

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

let currentVersion = getSchemaVersion(db);
console.log(`schema_version before: ${currentVersion}`);

const hasCoreSchema = Boolean(
  db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('missions', 'agent_profiles') LIMIT 1")
    .get(),
);

if (currentVersion > 0 && !hasCoreSchema) {
  db.close();
  throw new Error("Control Hub database schema is incomplete; keep this file as a backup and use a fresh CH_DATA_DIR");
}

if (currentVersion === 0 && !hasCoreSchema) {
  const baselinePath = join(MIGRATIONS_DIR, "001_baseline.sql");
  db.exec(readFileSync(baselinePath, "utf-8"));
  setSchemaVersion(db, 3);
  currentVersion = 3;
  console.log("Applied baseline schema -> schema_version 3");
}

const afterUpgrade = applyProfilesToolsParityUpgrade(db, MIGRATIONS_DIR);
if (afterUpgrade > currentVersion) {
  console.log(`Applied v2 -> v3 parity upgrade -> schema_version ${afterUpgrade}`);
} else {
  ensureProfilesToolsParity(db);
}

const catTable = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='mission_categories'",
  )
  .get();
if (catTable) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM mission_categories").get();
  if ((count?.c ?? 0) === 0) {
    const seedPath = join(ROOT, "src/lib/db/seeds/001_mission_categories.sql");
    if (existsSync(seedPath)) {
      db.exec(readFileSync(seedPath, "utf-8"));
      console.log("Seeded default mission categories from 001_mission_categories.sql");
    }
  }
  const after = db.prepare("SELECT COUNT(*) AS c FROM mission_categories").get();
  console.log(`mission_categories rows: ${after?.c ?? 0}`);
}

console.log(`schema_version after: ${getSchemaVersion(db)}`);
db.close();
console.log("Done.");
