import { expect, test } from "@playwright/test";

test.describe("fork PR smoke gate", () => {
  test("application starts and serves the Home experience", async ({ page }) => {
    const health = await page.request.get("/api/health");
    expect(health.ok()).toBeTruthy();

    await page.goto("/");
    await expect(page.locator('[data-component="TopBar"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "What shall we cook tonight?" })).toBeVisible();
  });

  test("core Home navigation opens the Characters panel", async ({ page }) => {
    await page.goto("/");

    const charactersButton = page.locator('[data-tour="panel-characters"]');
    await expect(charactersButton).toBeVisible();
    await charactersButton.click();

    await expect(page.locator('[data-component="RightPanelDesktop"]')).toBeVisible();
  });
});
