/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Bulk import / sync rules (src/lib/hub/hub-import.ts) on a real in-memory
 * SQLite, including a database that predates the external_* columns.
 */

import { NextRequest } from "next/server";

let testDb: import("better-sqlite3").Database | null = null;

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
jest.mock("@/lib/api-logger", () => ({ logApiError: jest.fn() }));

type ImportMod = typeof import("@/lib/hub/hub-import");
const mod = (): ImportMod => require("@/lib/hub/hub-import") as ImportMod;
const repo = () => require("@/lib/hub/hub-repository") as typeof import("@/lib/hub/hub-repository");

function openDb() {
  const Database = require("better-sqlite3/lib/index.js") as typeof import("better-sqlite3");
  testDb = new (Database as unknown as new (path: string) => import("better-sqlite3").Database)(":memory:");
  testDb.pragma("foreign_keys = ON");
}

beforeEach(openDb);
afterEach(() => {
  testDb?.close();
  testDb = null;
  delete process.env.CH_READ_ONLY;
});

function run(input: Record<string, unknown>, dryRun = false) {
  const parsed = mod().hubImportSchema.parse(input);
  return mod().applyHubImport(parsed, { dryRun });
}

const SAMPLE = {
  projects: [{ key: "proj-site", name: "Website", color: "purple" }],
  tasks: [
    { key: "gmail:t1", title: "Reply to Dana", project: "proj-site", priority: "high", dueDate: "2026-12-01" },
    { key: "gcal:e1", title: "Prep fit call", dueDate: "2026-11-18" },
  ],
  sites: [{ key: "render:srv-1", name: "Site", url: "https://site.example.com", project: "proj-site" }],
  repos: [{ fullName: "https://github.com/octo/site", project: "proj-site" }],
};

describe("applyHubImport", () => {
  it("creates everything and links items to projects by key", () => {
    const res = run(SAMPLE);
    expect(res.counts.project.create).toBe(1);
    expect(res.counts.task.create).toBe(2);
    expect(res.counts.site.create).toBe(1);
    expect(res.counts.repo.create).toBe(1);

    const tasks = repo().listTasks();
    const reply = tasks.find((t) => t.title === "Reply to Dana")!;
    expect(reply).toMatchObject({ projectName: "Website", priority: "high", externalKey: "gmail:t1" });
    expect(tasks.find((t) => t.title === "Prep fit call")!.projectId).toBeNull();
  });

  it("dry run reports the same plan but saves nothing", () => {
    const preview = run(SAMPLE, true);
    expect(preview.dryRun).toBe(true);
    expect(preview.counts.task.create).toBe(2);
    expect(repo().listTasks()).toHaveLength(0);
    expect(repo().listProjects()).toHaveLength(0);
  });

  it("re-importing the same data changes nothing and creates no duplicates", () => {
    run(SAMPLE);
    const again = run(SAMPLE);
    expect(again.counts.task).toEqual({ create: 0, update: 0, unchanged: 2, skip: 0 });
    expect(again.counts.project.unchanged).toBe(1);
    expect(again.counts.site.unchanged).toBe(1);
    expect(again.counts.repo.unchanged).toBe(1);
    expect(repo().listTasks()).toHaveLength(2);
  });

  it("keeps your local edits until the source changes", () => {
    run(SAMPLE);
    const task = repo().listTasks().find((t) => t.externalKey === "gmail:t1")!;
    repo().updateTask(task.id, { title: "Call Dana instead", dueDate: "2026-12-05" });

    run(SAMPLE);
    expect(repo().getTask(task.id)).toMatchObject({ title: "Call Dana instead", dueDate: "2026-12-05" });

    const changed = { ...SAMPLE, tasks: [{ ...SAMPLE.tasks[0], dueDate: "2026-12-10" }] };
    const res = run(changed);
    expect(res.items.find((i) => i.key === "gmail:t1")!.action).toBe("update");
    expect(repo().getTask(task.id)).toMatchObject({ title: "Reply to Dana", dueDate: "2026-12-10" });
  });

  it("never reopens a task you finished, and can mark one done", () => {
    run(SAMPLE);
    const [a, b] = ["gmail:t1", "gcal:e1"].map((k) => repo().listTasks().find((t) => t.externalKey === k)!);
    repo().updateTask(a.id, { status: "done" });

    const res = run({
      tasks: [
        { ...SAMPLE.tasks[0], title: "Reply to Dana (new info)" },
        { ...SAMPLE.tasks[1], status: "done" },
      ],
    });
    expect(res.items.find((i) => i.key === "gmail:t1")).toMatchObject({ action: "unchanged", reason: "You already finished it" });
    expect(repo().getTask(a.id)!.status).toBe("done");
    expect(repo().getTask(b.id)).toMatchObject({ status: "done" });
    expect(repo().getTask(b.id)!.completedAt).not.toBeNull();
  });

  it("skips new tasks that are already done at the source", () => {
    const res = run({ tasks: [{ key: "x:1", title: "Old", status: "done" }] });
    expect(res.counts.task.skip).toBe(1);
    expect(repo().listTasks()).toHaveLength(0);
  });

  it("adopts a project you created by hand with the same name", () => {
    const mine = repo().createProject({ name: "website", color: "green" });
    const res = run(SAMPLE);
    expect(res.counts.project.unchanged).toBe(1);
    expect(repo().listProjects()).toHaveLength(1);
    expect(repo().getProject(mine.id)!.color).toBe("green");
    expect(repo().listTasks().find((t) => t.externalKey === "gmail:t1")!.projectId).toBe(mine.id);
  });

  it("resolves project references by existing key or name, and reports unknown ones", () => {
    run({ projects: [{ key: "proj-a", name: "Alpha" }] });
    const res = run({
      tasks: [
        { key: "k1", title: "By key", project: "proj-a" },
        { key: "k2", title: "By name", project: "alpha" },
        { key: "k3", title: "Unknown", project: "proj-zzz" },
      ],
    });
    const tasks = repo().listTasks();
    expect(tasks.find((t) => t.title === "By key")!.projectName).toBe("Alpha");
    expect(tasks.find((t) => t.title === "By name")!.projectName).toBe("Alpha");
    expect(tasks.find((t) => t.title === "Unknown")!.projectId).toBeNull();
    expect(res.items.find((i) => i.key === "k3")!.reason).toMatch(/not found/);
  });

  it("matches sites by URL and links an existing unlinked repo to its project", () => {
    const sites = require("@/lib/hub/sites-repository") as typeof import("@/lib/hub/sites-repository");
    const repos = require("@/lib/hub/repos-repository") as typeof import("@/lib/hub/repos-repository");
    sites.createSite({ name: "Mine", url: "https://site.example.com" });
    repos.createRepo("octo/site");
    const res = run(SAMPLE);
    expect(res.counts.site.unchanged).toBe(1);
    expect(sites.listSites()).toHaveLength(1);
    expect(res.items.find((i) => i.kind === "repo")).toMatchObject({ action: "update", reason: "Linked to its project" });
    expect(repos.listRepos()[0].projectName).toBe("Website");
  });

  it("adds the new columns to a hub database created before they existed", () => {
    testDb!.exec(`
      CREATE TABLE hub_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT 'cyan', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE hub_tasks (id TEXT PRIMARY KEY, project_id TEXT, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo', priority TEXT NOT NULL DEFAULT 'normal', due_date TEXT, mission_id TEXT,
        completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO hub_tasks (id, title, created_at, updated_at) VALUES ('old', 'Old task', '2026-01-01', '2026-01-01');
    `);
    const res = run(SAMPLE);
    expect(res.counts.task.create).toBe(2);
    expect(repo().getTask("old")).toMatchObject({ title: "Old task", externalKey: null });
  });

  it("fieldHash ignores key order and treats undefined as null", () => {
    expect(mod().fieldHash({ a: 1, b: undefined })).toBe(mod().fieldHash({ b: null, a: 1 }));
    expect(mod().fieldHash({ a: 1 })).not.toBe(mod().fieldHash({ a: 2 }));
  });
});

describe("/api/hub/import", () => {
  const route = () => require("@/app/api/hub/import/route") as typeof import("@/app/api/hub/import/route");
  const post = (body: unknown) =>
    new NextRequest("http://localhost/api/hub/import", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });

  it("previews, then imports", async () => {
    const preview = await route().POST(post({ ...SAMPLE, dryRun: true }));
    expect(preview.status).toBe(200);
    expect((await preview.json()).data.dryRun).toBe(true);
    expect(repo().listTasks()).toHaveLength(0);

    const res = await route().POST(post(SAMPLE));
    const body = await res.json();
    expect(body.data.counts.task.create).toBe(2);
  });

  it("explains invalid items", async () => {
    const res = await route().POST(post({ tasks: [{ key: "a", title: "x", dueDate: "tomorrow" }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("tasks.0.dueDate: must be a date like 2026-01-31");
  });

  it("allows previews but refuses imports in read-only mode", async () => {
    process.env.CH_READ_ONLY = "true";
    expect((await route().POST(post({ ...SAMPLE, dryRun: true }))).status).toBe(200);
    expect((await route().POST(post(SAMPLE))).status).toBe(503);
  });

  it("tells local jobs where to send imports", async () => {
    const res = await route().GET();
    expect((await res.json()).data.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/hub\/import$/);
    expect(mod().localImportEndpoint("42069")).toBe("http://127.0.0.1:42069/api/hub/import");
    expect(mod().localImportEndpoint("evil.example.com")).toBe("http://127.0.0.1:3000/api/hub/import");
  });
});
