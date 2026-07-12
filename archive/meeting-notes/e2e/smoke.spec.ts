import { test, expect } from "@playwright/test";

test("record flow renders live timeline (mock backend)", async ({ page }) => {
  await page.goto("/?mock=1");
  await expect(page.getByText("100% local")).toBeVisible();

  await page.getByRole("button", { name: /new conversation/i }).click();
  await expect(page.getByText(/press record and start talking/i)).toBeVisible();

  await page.getByRole("button", { name: /^record$/i }).click();
  await expect(page.locator(".bubble.partial")).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".bubble.final")).toHaveCount(2, { timeout: 10000 });

  await page.getByRole("button", { name: /stop/i }).click();
  await expect(page.getByRole("button", { name: /save/i })).toBeVisible();
  await expect(page.getByText("recording ended")).toBeVisible();
});

test("open a saved conversation renders its items", async ({ page }) => {
  await page.goto("/?mock=1");
  await page.getByRole("button", { name: /open a saved conversation/i }).click();
  await expect(page.getByRole("textbox", { name: "Conversation title" })).toHaveValue(
    "Reopened conversation",
  );
});
