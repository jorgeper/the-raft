// E9a–E9e (SPEC2 §4): the gated onboarding wizard, driven through the mock's
// permission state machine. Steps are shown one at a time and unlock strictly
// on verified state.

import { expect, test } from "@playwright/test";

test("E9a: microphone gate — locked until the permission is really granted", async ({
  page,
}) => {
  await page.goto("/?onboarding=1");
  const wizard = page.getByTestId("onboarding");
  await expect(wizard).toHaveAttribute("data-step", "welcome");
  await page.getByTestId("onboarding-next").click();

  await expect(wizard).toHaveAttribute("data-step", "microphone");
  // Later steps are not in the DOM — one screen at a time.
  await expect(page.getByTestId("ax-request")).not.toBeAttached();
  await expect(page.getByTestId("menubar-open")).not.toBeAttached();
  // Continue is disabled; clicking the request button alone changes nothing.
  await expect(page.getByTestId("onboarding-next")).toBeDisabled();
  await page.getByTestId("mic-request").click();
  await expect(page.getByTestId("onboarding-next")).toBeDisabled();

  // The REAL grant unlocks and auto-advances via the poll.
  await page.evaluate(() => window.__mock!.grant("microphone"));
  await expect(wizard).toHaveAttribute("data-step", "accessibility", { timeout: 5000 });
});

test("E9b: accessibility is a two-fact gate — permission alone stays locked", async ({
  page,
}) => {
  await page.goto("/?onboarding=1&grant=microphone");
  const wizard = page.getByTestId("onboarding");
  await expect(wizard).toHaveAttribute("data-step", "accessibility");

  await page.evaluate(() => window.__mock!.grant("accessibility"));
  // Permission is granted but the listener isn't armed: still locked.
  await expect(page.getByTestId("arming-note")).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId("onboarding-next")).toBeDisabled();
  await expect(wizard).toHaveAttribute("data-step", "accessibility");

  // capture-ready flips → gate met → auto-advance to menubar.
  await page.evaluate(() => window.__mock!.grant("capture"));
  await expect(wizard).toHaveAttribute("data-step", "menubar", { timeout: 5000 });
});

test("E9c: menu-bar gate — grant auto-advances; deferral records and advances", async ({
  page,
}) => {
  await page.goto("/?onboarding=1&grant=microphone,accessibility,capture");
  const wizard = page.getByTestId("onboarding");
  await expect(wizard).toHaveAttribute("data-step", "menubar");
  await expect(page.getByTestId("onboarding-next")).toBeDisabled();

  await page.evaluate(() => window.__mock!.grant("menubar"));
  await expect(wizard).toHaveAttribute("data-step", "model", { timeout: 5000 });
});

test("E9c-defer: deferring the menu-bar gate persists the deferral", async ({ page }) => {
  await page.goto("/?onboarding=1&grant=microphone,accessibility,capture");
  const wizard = page.getByTestId("onboarding");
  await expect(wizard).toHaveAttribute("data-step", "menubar");

  await page.getByTestId("menubar-defer").click();
  await expect(wizard).toHaveAttribute("data-step", "model");
  const savedSettingsJson = await page.evaluate(() => {
    const saves = window.__mock!.calls().filter((c) => c.command === "set_settings");
    return JSON.stringify(saves[saves.length - 1]?.args?.settings ?? {});
  });
  // The deferral list in the persisted settings must record the menubar gate.
  expect(savedSettingsJson).toContain('"menubar"');
});

test("E9d: model gate — Continue absent until a model is downloaded AND active", async ({
  page,
}) => {
  await page.goto("/?onboarding=1&grant=microphone,accessibility,capture,menubar");
  const wizard = page.getByTestId("onboarding");
  await expect(wizard).toHaveAttribute("data-step", "model");
  await expect(page.getByTestId("onboarding-next")).not.toBeAttached();

  await page.getByTestId("pick-quickstart").click();
  // Download simulates, activates, then the verified gate opens.
  await expect(page.getByTestId("onboarding-next")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("onboarding-next").click();
  await expect(wizard).toHaveAttribute("data-step", "try");
});

test("E9e: resume opens at the first unmet gate; Finish completes exactly once", async ({
  page,
}) => {
  // Mic + accessibility + capture pre-granted -> resume lands on menubar.
  await page.goto("/?onboarding=1&grant=microphone,accessibility,capture");
  const wizard = page.getByTestId("onboarding");
  await expect(wizard).toHaveAttribute("data-step", "menubar");
  await expect(page.getByTestId("mic-request")).not.toBeAttached();

  // Finish the remaining gates.
  await page.evaluate(() => window.__mock!.grant("menubar"));
  await expect(wizard).toHaveAttribute("data-step", "model", { timeout: 5000 });
  await page.getByTestId("pick-quickstart").click();
  await expect(page.getByTestId("onboarding-next")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("onboarding-next").click();

  // Try-it readiness panel is all green, then Finish.
  await expect(wizard).toHaveAttribute("data-step", "try");
  for (const row of ["microphone", "accessibility", "menubar", "model"]) {
    await expect(page.getByTestId(`ready-${row}`).getByText("Ready")).toBeVisible();
  }
  await page.getByTestId("onboarding-finish").click();

  // onboarding_complete set exactly once, and the settings UI takes over.
  await expect(page.getByTestId("settings-root")).toBeVisible();
  const completions = await page.evaluate(
    () =>
      window
        .__mock!.calls()
        .filter(
          (c) =>
            c.command === "set_settings" &&
            (c.args?.settings as { onboarding_complete?: boolean })?.onboarding_complete === true,
        ).length,
  );
  expect(completions).toBe(1);
});
