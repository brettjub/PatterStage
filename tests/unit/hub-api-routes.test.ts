/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * /api/hub/* route handlers end to end against a real in-memory SQLite.
 * Site checks are stubbed so no network requests are made.
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
jest.mock("@/lib/hub/site-check", () => {
  const actual = jest.requireActual("@/lib/hub/site-check") as typeof import("@/lib/hub/site-check");
  return {
    ...actual,
    checkSite: jest.fn(async () => ({
      status: "up",
      httpStatus: 200,
      responseMs: 42,
      error: null,
      checkedAt: new Date().toISOString(),
    })),
  };
});

beforeEach(() => {
  const Database = require("better-sqlite3/lib/index.js") as typeof import("better-sqlite3");
  testDb = new (Database as unknown as new (path: string) => import("better-sqlite3").Database)(":memory:");
  testDb.pragma("foreign_keys = ON");
  delete process.env.CH_READ_ONLY;
});

afterEach(() => {
  testDb?.close();
  testDb = null;
  delete process.env.CH_READ_ONLY;
});

function req(path: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest("http://localhost" + path, {
    method,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

type Json = { data?: Record<string, unknown>; error?: string };
async function json(res: Response): Promise<Json> {
  return (await res.json()) as Json;
}

describe("/api/hub/projects", () => {
  const route = () => require("@/app/api/hub/projects/route") as typeof import("@/app/api/hub/projects/route");

  it("creates, lists, updates and deletes", async () => {
    const created = await route().POST(req("/api/hub/projects", "POST", { name: "Launch", color: "pink" }));
    expect(created.status).toBe(201);
    const project = (await json(created)).data!.project as { id: string; name: string };
    expect(project.name).toBe("Launch");

    const list = await json(await route().GET(req("/api/hub/projects")));
    expect((list.data!.projects as unknown[]).length).toBe(1);

    const updated = await route().PUT(req("/api/hub/projects", "PUT", { id: project.id, status: "done" }));
    expect(((await json(updated)).data!.project as { status: string }).status).toBe("done");

    const del = await route().DELETE(req("/api/hub/projects?id=" + project.id, "DELETE"));
    expect(del.status).toBe(200);
    expect((await route().DELETE(req("/api/hub/projects?id=" + project.id, "DELETE"))).status).toBe(404);
  });

  it("explains validation problems in plain words", async () => {
    const res = await route().POST(req("/api/hub/projects", "POST", { name: "   " }));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("name is required");

    const badColor = await route().POST(req("/api/hub/projects", "POST", { name: "x", color: "beige" }));
    expect(badColor.status).toBe(400);
    expect((await json(badColor)).error).toMatch(/^color/);
  });

  it("ignores fields outside the whitelist", async () => {
    const res = await route().POST(
      req("/api/hub/projects", "POST", { name: "x", id: "forced", created_at: "1999" }),
    );
    const project = (await json(res)).data!.project as { id: string; createdAt: string };
    expect(project.id).not.toBe("forced");
    expect(project.createdAt).not.toBe("1999");
  });

  it("returns 400 for invalid JSON and missing ids", async () => {
    expect((await route().POST(req("/api/hub/projects", "POST", "{nope"))).status).toBe(400);
    expect((await route().DELETE(req("/api/hub/projects", "DELETE"))).status).toBe(400);
    expect((await route().PUT(req("/api/hub/projects", "PUT", { name: "x" }))).status).toBe(400);
  });

  it("refuses writes in read-only mode", async () => {
    process.env.CH_READ_ONLY = "true";
    const res = await route().POST(req("/api/hub/projects", "POST", { name: "x" }));
    expect(res.status).toBe(503);
  });
});

describe("/api/hub/tasks", () => {
  const route = () => require("@/app/api/hub/tasks/route") as typeof import("@/app/api/hub/tasks/route");
  const projects = () => require("@/app/api/hub/projects/route") as typeof import("@/app/api/hub/projects/route");

  it("creates a task in a project and filters by status", async () => {
    const p = (await json(await projects().POST(req("/api/hub/projects", "POST", { name: "P" })))).data!
      .project as { id: string };
    const created = await route().POST(
      req("/api/hub/tasks", "POST", { title: "Ship it", projectId: p.id, dueDate: "2026-12-01", priority: "high" }),
    );
    expect(created.status).toBe(201);
    const task = (await json(created)).data!.task as { id: string; projectName: string };
    expect(task.projectName).toBe("P");

    await route().PUT(req("/api/hub/tasks", "PUT", { id: task.id, status: "done" }));
    const open = await json(await route().GET(req("/api/hub/tasks?status=open")));
    const done = await json(await route().GET(req("/api/hub/tasks?status=done&projectId=" + p.id)));
    expect(open.data!.tasks).toEqual([]);
    expect((done.data!.tasks as unknown[]).length).toBe(1);
  });

  it("rejects impossible dates, unknown projects and bad filters", async () => {
    const badDate = await route().POST(req("/api/hub/tasks", "POST", { title: "x", dueDate: "2026-02-31" }));
    expect(badDate.status).toBe(400);
    expect((await json(badDate)).error).toBe("dueDate: is not a real calendar date");

    const badProject = await route().POST(req("/api/hub/tasks", "POST", { title: "x", projectId: "ghost" }));
    expect(badProject.status).toBe(400);
    expect((await json(badProject)).error).toBe("That project no longer exists");

    expect((await route().GET(req("/api/hub/tasks?status=weird"))).status).toBe(400);
  });

  it("returns 404 for a task that does not exist", async () => {
    const res = await route().PUT(req("/api/hub/tasks", "PUT", { id: "ghost", title: "x" }));
    expect(res.status).toBe(404);
  });
});

describe("/api/hub/sites", () => {
  const route = () => require("@/app/api/hub/sites/route") as typeof import("@/app/api/hub/sites/route");
  const check = () => require("@/app/api/hub/sites/check/route") as typeof import("@/app/api/hub/sites/check/route");

  it("checks a site as soon as it is added", async () => {
    const res = await route().POST(req("/api/hub/sites", "POST", { name: "Home", url: "https://example.com" }));
    expect(res.status).toBe(201);
    const site = (await json(res)).data!.site as { lastStatus: string; lastResponseMs: number };
    expect(site).toMatchObject({ lastStatus: "up", lastResponseMs: 42 });
  });

  it("only accepts http(s) addresses", async () => {
    const res = await route().POST(req("/api/hub/sites", "POST", { name: "x", url: "ftp://example.com" }));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("url: must be a full http:// or https:// address");
  });

  it("re-checks on demand and 404s for unknown ids", async () => {
    await route().POST(req("/api/hub/sites", "POST", { name: "Home", url: "https://example.com" }));
    const all = await check().POST(req("/api/hub/sites/check", "POST", {}));
    expect(((await json(all)).data!.sites as unknown[]).length).toBe(1);
    expect((await check().POST(req("/api/hub/sites/check", "POST", { id: "ghost" }))).status).toBe(404);
  });
});

describe("/api/hub/repos", () => {
  const route = () => require("@/app/api/hub/repos/route") as typeof import("@/app/api/hub/repos/route");

  it("accepts a pasted GitHub URL and rejects duplicates with 409", async () => {
    const res = await route().POST(req("/api/hub/repos", "POST", { fullName: "https://github.com/octo/app.git" }));
    expect(res.status).toBe(201);
    expect(((await json(res)).data!.repo as { fullName: string }).fullName).toBe("octo/app");

    const dup = await route().POST(req("/api/hub/repos", "POST", { fullName: "OCTO/app" }));
    expect(dup.status).toBe(409);
  });

  it("rejects names that are not owner/repository", async () => {
    const res = await route().POST(req("/api/hub/repos", "POST", { fullName: "just-a-name" }));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("fullName: must look like owner/repository");
  });
});

describe("/api/hub/summary", () => {
  it("returns the overview for the requested day", async () => {
    const route = require("@/app/api/hub/summary/route") as typeof import("@/app/api/hub/summary/route");
    const res = await route.GET(req("/api/hub/summary?today=2026-04-01"));
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.data!.today).toBe("2026-04-01");
    expect(body.data!.tasks).toEqual({ open: 0, doing: 0, overdue: 0, dueToday: 0, doneThisWeek: 0 });
  });
});
