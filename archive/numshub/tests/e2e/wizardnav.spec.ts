// E12a–E12d (SPEC5): wizard back-navigation, review mode, the no-yank rule,
// and the full re-walk from Re-run setup.

import { expect, test } from "@playwright/test";

test("E12a: back shows the met step in review mode and returns on Continue", async ({
  page,
}) => {
  await page.goto("/?onboarding=1&grant=microphone");
  const wizard = page.getByTestId("onboarding");
  await expect(wizard).toHaveAttribute("data-step", "accessibility");

  await page.getByTestId("wizard-back").click();
  await expect(wizard).toHaveAttribute("data-step", "microphone");
  // Review mode: instructions visible, satisfied status, no request button.
  await expect(page.getByText("Numshub needs your microphone")).toBeVisible();
  await expect(page.getByTestId("gate-status")).toHaveText("Granted ✓");
  await expect(page.getByTestId("mic-request")).not.toBeAttached();

  // No yank: sit through two poll cycles.
  await page.waitForTimeout(2500);
  await expect(wizard).toHaveAttribute("data-step", "microphone");

  await page.getByTestId("onboarding-next").click();
  await expect(wizard).toHaveAttribute("data-step", "accessibility");
});

test("E12b: dots navigate within the frontier and are inert past it", async ({ page }) => {
  await page.goto("/?onboarding=1&grant=microphone,accessibility,capture,menubar");
  const wizard = page.getByTestId("onboarding");
  await expect(wizard).toHaveAttribute("data-step", "model");

  await page.getByTestId("dot-microphone").click();
  await expect(wizard).toHaveAttribute("data-step", "microphone");
  await expect(page.getByTestId("gate-status")).toHaveText("Granted ✓");

  // "try" is past the frontier (model unmet) — its dot must do nothing.
  await page.getByTestId("dot-try").click();
  await expect(wizard).toHaveAttribute("data-step", "microphone");

  // Dots inside the frontier work.
  await page.getByTestId("dot-menubar").click();
  await expect(wizard).toHaveAttribute("data-step", "menubar");
});

test("E12c: Re-run setup walks everything from the top in met state", async ({ page }) => {
  await page.goto("/"); // healthy configured app
  await expect(page.getByTestId("settings-root")).toBeVisible();

  await page.getByTestId("rerun-setup").click();
  const wizard = page.getByTestId("onboarding");
  await expect(wizard).toBeVisible();
  await expect(wizard).toHaveAttribute("data-step", "welcome");

  // Walk the whole sequence; every gate is met so Continue steps through.
  await page.getByTestId("onboarding-next").click();
  await expect(wizard).toHaveAttribute("data-step", "microphone");
  await expect(page.getByTestId("gate-status")).toHaveText("Granted ✓");

  await page.getByTestId("onboarding-next").click();
  await expect(wizard).toHaveAttribute("data-step", "accessibility");
  await expect(page.getByTestId("gate-status")).toHaveText("Granted ✓ — hotkey armed");
  // Instructions stay visible on met steps.
  await expect(page.getByText("macOS requires this for two things")).toBeVisible();
  await expect(page.getByTestId("ax-request")).toBeVisible();
  await expect(page.getByTestId("ax-defer")).not.toBeAttached();

  await page.getByTestId("onboarding-next").click();
  await expect(wizard).toHaveAttribute("data-step", "menubar");
  await expect(page.getByTestId("gate-status")).toHaveText("Visible ✓");
  await expect(page.getByText("Allow in the Menu Bar")).toBeVisible();

  await page.getByTestId("onboarding-next").click();
  await expect(wizard).toHaveAttribute("data-step", "model");
  await expect(page.getByTestId("active-model-note")).toContainText("Whisper Tiny");

  await page.getByTestId("onboarding-next").click();
  await expect(wizard).toHaveAttribute("data-step", "try");
  for (const row of ["microphone", "accessibility", "menubar", "model"]) {
    await expect(page.getByTestId(`ready-${row}`).getByText("Ready")).toBeVisible();
  }
  await page.getByTestId("onboarding-finish").click();
  await expect(page.getByTestId("settings-root")).toBeVisible();
});

test("E12d: no yank while reviewing; jump link returns to the frontier", async ({ page }) => {
  await page.goto("/?onboarding=1&grant=microphone");
  const wizard = page.getByTestId("onboarding");
  await expect(wizard).toHaveAttribute("data-step", "accessibility");

  await page.getByTestId("wizard-back").click();
  await expect(wizard).toHaveAttribute("data-step", "microphone");

  // Background grants move the frontier to menubar while we're reading.
  await page.evaluate(() => {
    window.__mock!.grant("accessibility");
    window.__mock!.grant("capture");
  });
  await page.waitForTimeout(2500);
  await expect(wizard).toHaveAttribute("data-step", "microphone");

  // The frontier is now beyond the next step, so the jump link appears.
  await expect(page.getByTestId("wizard-jump")).toBeVisible();
  await page.getByTestId("wizard-jump").click();
  await expect(wizard).toHaveAttribute("data-step", "menubar");
});
