// E1–E5, E7 (SPEC §8.3): the real settings UI driven through the browser shim.

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("settings-root")).toBeVisible();
});

test("E1: settings window renders all four sections", async ({ page }) => {
  await expect(page.getByTestId("section-general")).toBeVisible();
  for (const section of ["hotkey", "models", "cleanup", "general"] as const) {
    await page.getByTestId(`nav-${section}`).click();
    await expect(page.getByTestId(`section-${section}`)).toBeVisible();
  }
  // General exposes its controls.
  await expect(page.getByTestId("launch-at-login")).toBeAttached();
  await expect(page.getByTestId("activation-mode")).toBeVisible();
  await expect(page.getByTestId("output-method")).toBeVisible();
  await expect(page.getByTestId("keep-history")).toBeAttached();
});

test("E2: model catalog renders registry and walks the download state machine", async ({
  page,
}) => {
  await page.getByTestId("nav-models").click();

  // Renders from the mocked registry.
  const list = page.getByTestId("model-list");
  await expect(list.getByTestId("model-parakeet-tdt-0.6b-v3")).toBeVisible();
  await expect(list.getByTestId("model-whisper-large-v3-turbo")).toBeVisible();
  await expect(list.getByTestId("model-whisper-small")).toBeVisible();
  await expect(list.getByTestId("model-whisper-tiny")).toBeVisible();
  await expect(list.getByText("Recommended", { exact: true })).toBeVisible();
  await expect(page.getByTestId("model-active-whisper-tiny")).toBeVisible();

  // not downloaded -> downloading (progress % + cancel visible)
  await page.getByTestId("download-parakeet-tdt-0.6b-v3").click();
  await expect(page.getByTestId("progress-parakeet-tdt-0.6b-v3")).toBeVisible();
  await expect(page.getByTestId("cancel-parakeet-tdt-0.6b-v3")).toBeVisible();
  await expect(page.getByTestId("progress-label-parakeet-tdt-0.6b-v3")).toContainText("%");

  // -> verifying -> downloaded (Delete appears, radio enabled)
  await expect(page.getByTestId("verifying-parakeet-tdt-0.6b-v3")).toBeVisible();
  await expect(page.getByTestId("delete-parakeet-tdt-0.6b-v3")).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId("model-radio-parakeet-tdt-0.6b-v3")).toBeEnabled();

  // Activate it.
  await page.getByTestId("model-radio-parakeet-tdt-0.6b-v3").check();
  await expect(page.getByTestId("model-active-parakeet-tdt-0.6b-v3")).toBeVisible();
});

test("E2b: failed download shows inline error with Retry, and retry succeeds", async ({
  page,
}) => {
  await page.getByTestId("nav-models").click();
  await page.evaluate(() => window.__mock!.failNextDownload("whisper-small"));

  await page.getByTestId("download-whisper-small").click();
  await expect(page.getByTestId("error-whisper-small")).toContainText("checksum mismatch");
  const retry = page.getByTestId("download-whisper-small");
  await expect(retry).toHaveText("Retry");

  await retry.click();
  await expect(page.getByTestId("delete-whisper-small")).toBeVisible({ timeout: 5000 });
});

test("E2c: cancelling a download returns the model to not-downloaded", async ({ page }) => {
  await page.getByTestId("nav-models").click();
  await page.getByTestId("download-whisper-large-v3-turbo").click();
  await expect(page.getByTestId("cancel-whisper-large-v3-turbo")).toBeVisible();
  await page.getByTestId("cancel-whisper-large-v3-turbo").click();
  await expect(page.getByTestId("download-whisper-large-v3-turbo")).toBeVisible();
});

test("E3: hotkey recorder captures a combo and persists it", async ({ page }) => {
  await page.getByTestId("nav-hotkey").click();
  const chip = page.getByTestId("hotkey-chip");
  await expect(chip).toHaveText("Right ⌘"); // default binding

  await chip.click();
  await expect(chip).toContainText("Press keys");
  // The mock emits command_right down/up after ~250 ms (native capture path);
  // the combo commits on key-up and persists via set_settings.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const calls = window.__mock!.calls();
          const saves = calls.filter((c) => c.command === "set_settings");
          const last = saves[saves.length - 1]?.args?.settings as
            | { hotkey?: string }
            | undefined;
          return last?.hotkey ?? null;
        }),
      { timeout: 3000 },
    )
    .toBe("command_right");
  await expect(chip).toHaveText("Right ⌘");
});

test("E3b: a different captured combo updates the label", async ({ page }) => {
  await page.getByTestId("nav-hotkey").click();
  const chip = page.getByTestId("hotkey-chip");
  await chip.click();
  await expect(chip).toContainText("Press keys");
  await page.evaluate(() => window.__mock!.captureKeys("ctrl+space"));
  await expect(chip).toHaveText("⌃ Space", { timeout: 3000 });
});

test("E4: filler chips add, remove, and reset", async ({ page }) => {
  await page.getByTestId("nav-cleanup").click();
  await expect(page.getByTestId("chip-um")).toBeVisible();

  await page.getByTestId("remove-um").click();
  await expect(page.getByTestId("chip-um")).not.toBeAttached();

  await page.getByTestId("filler-input").fill("basically");
  await page.getByTestId("filler-add").click();
  await expect(page.getByTestId("chip-basically")).toBeVisible();

  await page.getByTestId("filler-reset").click();
  await expect(page.getByTestId("chip-um")).toBeVisible();
  await expect(page.getByTestId("chip-basically")).not.toBeAttached();
});

test("E5: history list renders entries and click copies", async ({ page }) => {
  const items = page.getByTestId("history-item");
  await expect(items).toHaveCount(5);
  await expect(items.first()).toContainText("Ship the release notes");

  await items.first().click();
  await expect(items.first()).toContainText("Copied");
  const copied = await page.evaluate(() => {
    const calls = window.__mock!.calls();
    return calls.find((c) => c.command === "copy_text")?.args?.text;
  });
  expect(copied).toBe("Ship the release notes on Wednesday.");
});

test("E7: enhancement toggle reveals fields and Test round-trips", async ({ page }) => {
  await page.getByTestId("nav-cleanup").click();
  await expect(page.getByTestId("enhancement-endpoint")).not.toBeAttached();

  await page.getByTestId("enhancement-toggle").check();
  await expect(page.getByTestId("enhancement-endpoint")).toBeVisible();
  await expect(page.getByTestId("enhancement-model")).toBeVisible();
  await expect(page.getByTestId("enhancement-prompt")).toBeVisible();

  await page.getByTestId("enhancement-test").click();
  await expect(page.getByTestId("enhancement-test-result")).toContainText("Cleaned sample text");
});
