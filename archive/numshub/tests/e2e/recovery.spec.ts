// E11a–E11d (SPEC4): recovery paths back into the setup wizard when
// permissions drift after setup. The mock starts as a healthy configured app;
// tests break it with __mock.revoke.

import { expect, test } from "@playwright/test";

test("E11a: capture-dead banner shows on every section and Fix lands on the broken gate", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("settings-root")).toBeVisible();
  await expect(page.getByTestId("capture-banner")).not.toBeAttached();

  await page.evaluate(() => window.__mock!.revoke("capture"));
  await expect(page.getByTestId("capture-banner")).toBeVisible({ timeout: 5000 });

  // Visible across sections, not just General.
  await page.getByTestId("nav-models").click();
  await expect(page.getByTestId("capture-banner")).toBeVisible();

  // Fix in setup → wizard opens at the accessibility gate (resolved live).
  await page.getByTestId("capture-banner-fix").click();
  const wizard = page.getByTestId("onboarding");
  await expect(wizard).toBeVisible();
  await expect(wizard).toHaveAttribute("data-step", "accessibility");

  // Re-arming the listener advances the wizard — the gate re-check is live.
  await page.evaluate(() => window.__mock!.grant("capture"));
  await expect(wizard).not.toHaveAttribute("data-step", "accessibility", { timeout: 5000 });
});

test("E11b: healthy app shows no banner", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("settings-root")).toBeVisible();
  // Give the poll a full cycle to (wrongly) show something.
  await page.waitForTimeout(2500);
  await expect(page.getByTestId("capture-banner")).not.toBeAttached();
});

test("E11c: hotkey-recorder failure offers Fix in setup", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("settings-root")).toBeVisible();
  await page.evaluate(() => window.__mock!.revoke("capture"));

  await page.getByTestId("nav-hotkey").click();
  await page.getByTestId("hotkey-chip").click();
  await expect(page.getByTestId("hotkey-error")).toContainText("Accessibility");

  await page.getByTestId("hotkey-fix-setup").click();
  const wizard = page.getByTestId("onboarding");
  await expect(wizard).toBeVisible();
  await expect(wizard).toHaveAttribute("data-step", "accessibility");
});

test("E11d: a previously deferred accessibility gate is re-checked, not bypassed", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("settings-root")).toBeVisible();
  await page.evaluate(() => {
    window.__mock!.seedDeferrals(["accessibility"]);
    window.__mock!.revoke("accessibility");
    window.__mock!.revoke("capture");
  });

  await expect(page.getByTestId("capture-banner")).toBeVisible({ timeout: 5000 });
  await page.getByTestId("capture-banner-fix").click();

  // Without deferral-clearing, gate resolution would jump past accessibility.
  const wizard = page.getByTestId("onboarding");
  await expect(wizard).toBeVisible();
  await expect(wizard).toHaveAttribute("data-step", "accessibility");
});
