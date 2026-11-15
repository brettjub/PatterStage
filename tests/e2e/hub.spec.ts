import { test, expect, type APIRequestContext } from "@playwright/test";

// My Hub: projects, tasks, and the dashboard's "Up next" panel.
// Each test creates uniquely named records and removes them afterwards.

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function cleanup(request: APIRequestContext, projectName: string, taskPrefix: string) {
  const tasks = await (await request.get("/api/hub/tasks")).json();
  for (const t of tasks.data.tasks as { id: string; title: string }[]) {
    if (t.title.startsWith(taskPrefix)) await request.delete("/api/hub/tasks?id=" + t.id);
  }
  const projects = await (await request.get("/api/hub/projects")).json();
  for (const p of projects.data.projects as { id: string; name: string }[]) {
    if (p.name === projectName) await request.delete("/api/hub/projects?id=" + p.id);
  }
}

test.describe("My Hub", () => {
  test("create a project, add a task to it, complete it", async ({ page, request }) => {
    const id = stamp();
    const projectName = "E2E project " + id;
    const taskTitle = "E2E task " + id;
    try {
      await page.goto("/hub/projects");
      await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "New project" }).click();
      await page.getByPlaceholder("e.g. Website relaunch").fill(projectName);
      await page.getByRole("button", { name: "Create project" }).click();

      const card = page.getByTestId("hub-project-card").filter({ hasText: projectName });
      await expect(card).toBeVisible();
      await card.getByRole("link", { name: /Open tasks/ }).click();

      await expect(page).toHaveURL(/\/hub\/tasks\?project=/);
      await expect(page.getByRole("heading", { name: "Tasks · " + projectName })).toBeVisible();
      const quickAdd = page.getByLabel("New task title");
      await quickAdd.fill(taskTitle);
      await quickAdd.press("Enter");

      const row = page.getByTestId("hub-task-row").filter({ hasText: taskTitle });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: `Mark "${taskTitle}" as done` }).click();
      await expect(row).toHaveCount(0);

      await page.getByRole("tab", { name: /Done/ }).click();
      await expect(page.getByTestId("hub-task-row").filter({ hasText: taskTitle })).toBeVisible();

      await page.goto("/hub/projects");
      await expect(page.getByTestId("hub-project-card").filter({ hasText: projectName })).toContainText("100%");
    } finally {
      await cleanup(request, projectName, taskTitle);
    }
  });

  test("dashboard Up next shows overdue tasks first and quick-adds", async ({ page, request }) => {
    const id = stamp();
    const prefix = "E2E dash " + id;
    try {
      const yesterday = new Date(Date.now() - 86_400_000);
      const due =
        yesterday.getFullYear() +
        "-" +
        String(yesterday.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(yesterday.getDate()).padStart(2, "0");
      const created = await request.post("/api/hub/tasks", { data: { title: prefix + " overdue", dueDate: due } });
      expect(created.status()).toBe(201);

      await page.goto("/");
      const upNext = page.getByTestId("hub-up-next");
      await expect(upNext.getByTestId("hub-task-row").first()).toContainText(prefix + " overdue");
      await expect(upNext.getByText("1d overdue").first()).toBeVisible();

      await upNext.getByLabel("New task title").fill(prefix + " quick");
      await upNext.getByLabel("New task title").press("Enter");
      await expect(upNext.getByTestId("hub-task-row").filter({ hasText: prefix + " quick" })).toBeVisible();
    } finally {
      await cleanup(request, "", prefix);
    }
  });

  test("import page previews, lets you untick items, and imports", async ({ page, request }) => {
    const id = stamp();
    const prefix = "E2E import " + id;
    const data = {
      projects: [{ key: "e2e-proj-" + id, name: prefix + " project" }],
      tasks: [
        { key: "e2e:" + id + ":a", title: prefix + " keep", project: "e2e-proj-" + id },
        { key: "e2e:" + id + ":b", title: prefix + " drop" },
      ],
    };
    try {
      await page.goto("/hub/import");
      await expect(page.getByRole("heading", { name: "Import & Sync", exact: true })).toBeVisible();
      await page.getByLabel("Import data (JSON)").fill(JSON.stringify(data));
      await page.getByRole("button", { name: "Preview" }).click();
      const preview = page.getByTestId("hub-import-preview");
      await expect(preview).toContainText("3 of 3 new or changed items selected");
      await preview.getByRole("checkbox", { name: "Import " + prefix + " drop" }).uncheck();
      await preview.getByRole("button", { name: "Import 2 items" }).click();
      await expect(page.getByText("Imported: 2 added, 0 updated")).toBeVisible();

      const tasks = (await (await request.get("/api/hub/tasks")).json()).data.tasks as { title: string; projectName: string | null }[];
      const mine = tasks.filter((t) => t.title.startsWith(prefix));
      expect(mine.map((t) => t.title)).toEqual([prefix + " keep"]);
      expect(mine[0].projectName).toBe(prefix + " project");

      await expect(page.getByRole("heading", { name: /Hermes sync/i })).toBeVisible();
      await expect(page.getByRole("button", { name: "Schedule sync" })).toBeEnabled();
    } finally {
      await cleanup(request, prefix + " project", prefix);
    }
  });

  test("code & sites page loads and rejects a bad URL", async ({ page }) => {
    await page.goto("/hub/code");
    await expect(page.getByRole("heading", { name: "Code & Sites", exact: true })).toBeVisible();
    await page.getByLabel("Site name").fill("Bad");
    await page.getByLabel("Site address").fill("not-a-url");
    await page.getByRole("button", { name: "Add site" }).click();
    await expect(page.getByText("url: must be a full http:// or https:// address")).toBeVisible();
  });
});
