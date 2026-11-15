/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Hub projects/tasks/sites/repos repositories against a real in-memory
 * SQLite (bypassing the global better-sqlite3 mock), with the Control Hub
 * baseline schema applied so the missions join is exercised too.
 */

import { execBaselineSchema } from "../helpers/baseline-db";

let testDb: import("better-sqlite3").Database | null = null;

function loadRealBetterSqlite3(): typeof import("better-sqlite3") {
  return require("better-sqlite3/lib/index.js") as typeof import("better-sqlite3");
}

jest.mock("@/lib/db", () => {
  const actualCrypto = jest.requireActual("crypto") as typeof import("crypto");
  return {
    db: () => testDb!,
    inTransaction: <T,>(fn: () => T) => testDb!.transaction(fn)(),
    uuid: () => actualCrypto.randomUUID(),
    now: () => new Date().toISOString(),
    ensureDb: () => undefined,
  };
});

type Repo = typeof import("@/lib/hub/hub-repository");
const repo = (): Repo => require("@/lib/hub/hub-repository") as Repo;

beforeEach(() => {
  const Database = loadRealBetterSqlite3();
  testDb = new (Database as unknown as new (path: string) => import("better-sqlite3").Database)(":memory:");
  testDb.pragma("foreign_keys = ON");
  execBaselineSchema(testDb);
});

afterEach(() => {
  testDb?.close();
  testDb = null;
});

describe("hub schema", () => {
  it("creates the hub tables on first use and is idempotent", () => {
    const { ensureHubSchema } = require("@/lib/hub/hub-schema") as typeof import("@/lib/hub/hub-schema");
    ensureHubSchema(testDb!);
    ensureHubSchema(testDb!);
    testDb!.exec((require("@/lib/hub/hub-schema") as typeof import("@/lib/hub/hub-schema")).HUB_SCHEMA_SQL);
    const tables = testDb!
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'hub_%' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(["hub_projects", "hub_repos", "hub_sites", "hub_tasks"]);
  });
});

describe("projects", () => {
  it("creates with defaults and trims text", () => {
    const p = repo().createProject({ name: "  Website relaunch  ", description: " new site " });
    expect(p).toMatchObject({ name: "Website relaunch", description: "new site", color: "cyan", status: "active" });
    expect(repo().getProject(p.id)?.name).toBe("Website relaunch");
  });

  it("updates only the given fields", () => {
    const p = repo().createProject({ name: "A", color: "pink" });
    const u = repo().updateProject(p.id, { status: "paused" });
    expect(u).toMatchObject({ name: "A", color: "pink", status: "paused" });
    expect(repo().updateProject("missing", { name: "x" })).toBeNull();
  });

  it("lists with task counts, overdue and next due, active before paused before done", () => {
    const r = repo();
    const done = r.createProject({ name: "Finished", status: "done" });
    const paused = r.createProject({ name: "On hold", status: "paused" });
    const active = r.createProject({ name: "Active" });
    r.createTask({ title: "late", projectId: active.id, dueDate: "2026-01-01" });
    r.createTask({ title: "soon", projectId: active.id, dueDate: "2026-02-01" });
    r.createTask({ title: "finished", projectId: active.id, status: "done" });
    r.createTask({ title: "elsewhere", projectId: paused.id });

    const list = r.listProjects("2026-01-15");
    expect(list.map((p) => p.id)).toEqual([active.id, paused.id, done.id]);
    expect(list[0]).toMatchObject({
      openTasks: 2,
      doneTasks: 1,
      totalTasks: 3,
      overdueTasks: 1,
      nextDue: "2026-01-01",
      siteCount: 0,
      repoCount: 0,
    });
  });

  it("deleting a project keeps its tasks, sites and repos but unassigns them", () => {
    const r = repo();
    const sites = require("@/lib/hub/sites-repository") as typeof import("@/lib/hub/sites-repository");
    const repos = require("@/lib/hub/repos-repository") as typeof import("@/lib/hub/repos-repository");
    const p = r.createProject({ name: "Temp" });
    const t = r.createTask({ title: "keep me", projectId: p.id });
    const s = sites.createSite({ name: "Site", url: "https://example.com", projectId: p.id });
    const g = repos.createRepo("octo/app", p.id);

    expect(r.deleteProject(p.id)).toBe(true);
    expect(r.getProject(p.id)).toBeNull();
    expect(r.getTask(t.id)?.projectId).toBeNull();
    expect(sites.getSite(s.id)?.projectId).toBeNull();
    expect(repos.getRepo(g.id)?.projectId).toBeNull();
    expect(r.deleteProject(p.id)).toBe(false);
  });
});

describe("tasks", () => {
  it("creates with defaults and joins the project name and colour", () => {
    const r = repo();
    const p = r.createProject({ name: "Blog", color: "green" });
    const t = r.createTask({ title: " Write post ", projectId: p.id, dueDate: "2026-03-01" });
    expect(t).toMatchObject({
      title: "Write post",
      status: "todo",
      priority: "normal",
      dueDate: "2026-03-01",
      projectName: "Blog",
      projectColor: "green",
      completedAt: null,
      missionId: null,
    });
  });

  it("rejects an unknown project", () => {
    const r = repo();
    expect(() => r.createTask({ title: "x", projectId: "nope" })).toThrow(r.UnknownProjectError);
    const t = r.createTask({ title: "x" });
    expect(() => r.updateTask(t.id, { projectId: "nope" })).toThrow(r.UnknownProjectError);
  });

  it("sets completedAt when done and clears it when reopened", () => {
    const r = repo();
    const t = r.createTask({ title: "x" });
    const done = r.updateTask(t.id, { status: "done" })!;
    expect(done.completedAt).not.toBeNull();
    const again = r.updateTask(t.id, { title: "renamed" })!;
    expect(again.completedAt).toBe(done.completedAt);
    expect(r.updateTask(t.id, { status: "todo" })!.completedAt).toBeNull();
  });

  it("can clear the due date and project with null", () => {
    const r = repo();
    const p = r.createProject({ name: "P" });
    const t = r.createTask({ title: "x", projectId: p.id, dueDate: "2026-05-05" });
    const u = r.updateTask(t.id, { dueDate: null, projectId: null })!;
    expect(u.dueDate).toBeNull();
    expect(u.projectId).toBeNull();
  });

  it("filters by project, no project and status", () => {
    const r = repo();
    const p = r.createProject({ name: "P" });
    r.createTask({ title: "in p", projectId: p.id });
    r.createTask({ title: "in p done", projectId: p.id, status: "done" });
    r.createTask({ title: "loose" });
    r.createTask({ title: "loose doing", status: "doing" });

    expect(r.listTasks({ projectId: p.id }).map((t) => t.title).sort()).toEqual(["in p", "in p done"]);
    expect(r.listTasks({ projectId: "none" }).map((t) => t.title).sort()).toEqual(["loose", "loose doing"]);
    expect(r.listTasks({ status: "open" })).toHaveLength(3);
    expect(r.listTasks({ status: "done" }).map((t) => t.title)).toEqual(["in p done"]);
    expect(r.listTasks({ status: "doing" }).map((t) => t.title)).toEqual(["loose doing"]);
  });

  it("orders doing, then todo by due date with undated last, then done", () => {
    const r = repo();
    r.createTask({ title: "done", status: "done" });
    r.createTask({ title: "undated" });
    r.createTask({ title: "later", dueDate: "2026-09-01" });
    r.createTask({ title: "sooner", dueDate: "2026-08-01" });
    r.createTask({ title: "doing", status: "doing" });
    expect(r.listTasks().map((t) => t.title)).toEqual(["doing", "sooner", "later", "undated", "done"]);
  });

  it("shows the linked Hermes mission's name and status", () => {
    const r = repo();
    testDb!
      .prepare("INSERT INTO missions (id, name, prompt, status) VALUES (?, ?, ?, ?)")
      .run("m1", "Research competitors", "do it", "dispatched");
    const t = r.createTask({ title: "Research" });
    const linked = r.updateTask(t.id, { missionId: "m1" })!;
    expect(linked).toMatchObject({ missionId: "m1", missionName: "Research competitors", missionStatus: "dispatched" });
  });

  it("works on a database without the missions table", () => {
    testDb!.exec("DROP TABLE IF EXISTS missions");
    const t = repo().createTask({ title: "no missions" });
    expect(t.missionStatus).toBeNull();
  });

  it("deletes", () => {
    const r = repo();
    const t = r.createTask({ title: "x" });
    expect(r.deleteTask(t.id)).toBe(true);
    expect(r.getTask(t.id)).toBeNull();
    expect(r.deleteTask(t.id)).toBe(false);
  });
});

describe("sites", () => {
  it("records checks and clears them when the URL changes", () => {
    const sites = require("@/lib/hub/sites-repository") as typeof import("@/lib/hub/sites-repository");
    const s = sites.createSite({ name: "Shop", url: "https://shop.example.com" });
    sites.recordSiteCheck(s.id, {
      status: "up",
      httpStatus: 200,
      responseMs: 120,
      error: null,
      checkedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(sites.getSite(s.id)).toMatchObject({ lastStatus: "up", lastHttpStatus: 200, lastResponseMs: 120 });

    const renamed = sites.updateSite(s.id, { name: "Store" })!;
    expect(renamed.lastStatus).toBe("up");
    const moved = sites.updateSite(s.id, { url: "https://store.example.com" })!;
    expect(moved).toMatchObject({ lastStatus: null, lastCheckedAt: null, url: "https://store.example.com" });
  });
});

describe("repos", () => {
  it("rejects duplicates case-insensitively", () => {
    const repos = require("@/lib/hub/repos-repository") as typeof import("@/lib/hub/repos-repository");
    repos.createRepo("Octo/App");
    expect(() => repos.createRepo("octo/app")).toThrow(repos.DuplicateRepoError);
    expect(repos.listRepos().map((r) => r.fullName)).toEqual(["Octo/App"]);
  });
});

describe("summary", () => {
  it("counts open, doing, overdue, due today and done this week, and ranks up-next", () => {
    const r = repo();
    const { getHubSummary } = require("@/lib/hub/hub-summary") as typeof import("@/lib/hub/hub-summary");
    const sites = require("@/lib/hub/sites-repository") as typeof import("@/lib/hub/sites-repository");
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    r.createTask({ title: "plain" });
    r.createTask({ title: "high", priority: "high" });
    r.createTask({ title: "doing", status: "doing" });
    r.createTask({ title: "today", dueDate: today });
    r.createTask({ title: "overdue", dueDate: yesterday });
    r.createTask({ title: "finished", status: "done" });
    r.createProject({ name: "Paused", status: "paused" });
    r.createProject({ name: "Live" });
    const s = sites.createSite({ name: "a", url: "https://a.example.com" });
    sites.createSite({ name: "b", url: "https://b.example.com" });
    sites.recordSiteCheck(s.id, { status: "down", httpStatus: 503, responseMs: 30, error: "HTTP 503", checkedAt: "2026-01-01T00:00:00.000Z" });

    const summary = getHubSummary(today);
    expect(summary.tasks).toEqual({ open: 5, doing: 1, overdue: 1, dueToday: 1, doneThisWeek: 1 });
    expect(summary.upNext.map((t) => t.title)).toEqual(["overdue", "today", "doing", "high", "plain"]);
    expect(summary.projects.map((p) => p.name)).toEqual(["Live"]);
    expect(summary.sites).toMatchObject({ total: 2, down: 1, up: 0, unchecked: 1, oldestCheckAt: null });
  });

  it("weekStart is six days before today", () => {
    const { weekStart } = require("@/lib/hub/hub-summary") as typeof import("@/lib/hub/hub-summary");
    expect(weekStart("2026-03-03")).toBe("2026-02-25");
  });
});
