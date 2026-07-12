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

test("second speaker gets own header and 'I am X' toast supports undo", async ({ page }) => {
  await page.goto("/?mock=1");
  await page.getByRole("button", { name: /new conversation/i }).click();
  await page.getByRole("button", { name: /^record$/i }).click();

  // Mock script: spk-2 arrives at 2.4s, spk-1 auto-renames to Alice at 3s.
  await expect(page.getByRole("button", { name: "Speaker 2" })).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole("button", { name: "Alice" })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText("Speaker 1 → Alice")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "Speaker 1" })).toBeVisible();
  await expect(page.getByText("Speaker 1 → Alice")).not.toBeVisible();
});

test("open a saved conversation renders its items including images", async ({ page }) => {
  await page.goto("/?mock=1");
  await page.getByRole("button", { name: /open a saved conversation/i }).click();
  await expect(page.getByRole("textbox", { name: "Conversation title" })).toHaveValue(
    "Reopened conversation",
  );
  await expect(page.locator(".image-card img")).toBeVisible();
});
