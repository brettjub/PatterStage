import { test, expect } from "@playwright/test";

test.describe("Agents page", () => {
  test("loads agent profiles list", async ({ page }) => {
    await page.goto("/operations/agents");
    await expect(
      page.getByRole("heading", { name: "Agent Profiles" })
    ).toBeVisible();
  });

  test("profile sync controls are visible", async ({ page }) => {
    await page.goto("/operations/agents");
    // Exact names: the drift banner adds a "Push all to Hermes" button when
    // SQLite profiles differ from the Hermes disk, which a loose match also hits.
    await expect(
      page.getByRole("button", { name: "Push all", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Pull all", exact: true })
    ).toBeVisible();
  });

  test("New Profile button is visible", async ({ page }) => {
    await page.goto("/operations/agents");
    await expect(
      page.getByRole("button", { name: /New Profile/i })
    ).toBeVisible();
  });

  test("opens create modal on New Profile click", async ({ page }) => {
    await page.goto("/operations/agents");
    await page.getByRole("button", { name: /New Profile/i }).click();
    await expect(page.getByText("New Agent Profile")).toBeVisible();
    await expect(page.getByPlaceholder(/e\.g\. Research Assistant/i)).toBeVisible();
  });

  test("closes create modal on Cancel", async ({ page }) => {
    await page.goto("/operations/agents");
    await page.getByRole("button", { name: /New Profile/i }).click();
    await page.getByRole("button", { name: /Cancel/i }).click();
    await expect(page.getByText("New Agent Profile")).not.toBeVisible();
  });
});
