// E6 + E8 (SPEC §8.3): the overlay pill driven by synthetic events.

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?window=overlay");
  // The mock registers listeners once the overlay app mounts.
  await expect(page.getByTestId("overlay-pill")).toBeAttached();
});

test("E6: waveform animates from level events and switches to transcribing", async ({
  page,
}) => {
  const pill = page.getByTestId("overlay-pill");
  await expect(pill).toHaveAttribute("data-state", "hidden");

  await page.evaluate(() => window.__mock!.emit("show-overlay", { state: "recording" }));
  await expect(pill).toHaveAttribute("data-state", "recording");
  await expect(page.getByTestId("waveform")).toBeVisible();
  await expect(page.getByTestId("rec-dot")).toBeVisible();
  await expect(page.getByTestId("timer")).toBeVisible();

  // Baseline: silence -> all bars at minimum height.
  const barHeights = () =>
    page.$$eval("[data-testid=waveform] i", (bars) =>
      bars.map((b) => parseFloat((b as HTMLElement).style.height)),
    );
  const before = await barHeights();

  // Feed loud levels; the rightmost bars must grow.
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) window.__mock!.emit("mic-level", 0.9);
  });
  await expect
    .poll(async () => {
      const after = await barHeights();
      return after[after.length - 1];
    })
    .toBeGreaterThan(before[before.length - 1]);

  // Switch to transcribing: thinking shimmer replaces the live waveform.
  await page.evaluate(() => window.__mock!.emit("show-overlay", { state: "transcribing" }));
  await expect(pill).toHaveAttribute("data-state", "transcribing");
  await expect(page.getByTestId("thinking-wave")).toBeVisible();
  await expect(page.getByTestId("waveform")).not.toBeAttached();

  // Hide.
  await page.evaluate(() => window.__mock!.emit("hide-overlay", null));
  await expect(pill).toHaveAttribute("data-state", "hidden");
});

test("E6b: cancel button fires the cancel IPC", async ({ page }) => {
  await page.evaluate(() => window.__mock!.emit("show-overlay", { state: "recording" }));
  await page.getByTestId("cancel-btn").click();
  const cancelled = await page.evaluate(() =>
    window.__mock!.calls().some((c) => c.command === "cancel_dictation"),
  );
  expect(cancelled).toBe(true);
});

test("E8: no-model prompt renders and Choose Model opens settings", async ({ page }) => {
  const pill = page.getByTestId("overlay-pill");
  await page.evaluate(() => window.__mock!.emit("show-overlay", { state: "no-model" }));
  await expect(pill).toHaveAttribute("data-state", "no-model");
  await expect(pill).toContainText("Pick a model to start dictating");

  await page.getByTestId("choose-model-btn").click();
  const opened = await page.evaluate(
    () =>
      window.__mock!.calls().find((c) => c.command === "open_settings")?.args?.section ?? null,
  );
  expect(opened).toBe("models");
});
