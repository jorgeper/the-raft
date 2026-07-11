// E10a–E10c (SPEC3 §5): live transcription in the overlay + the settings toggle.

import { expect, test } from "@playwright/test";

test("E10a: live mode renders stabilized text above an animating waveform", async ({
  page,
}) => {
  await page.goto("/?window=overlay");
  await expect(page.getByTestId("overlay-pill")).toBeAttached();

  await page.evaluate(() =>
    window.__mock!.emit("show-overlay", { state: "recording", live: true }),
  );
  const pill = page.getByTestId("overlay-pill");
  await expect(pill).toHaveAttribute("data-live", "true");
  await expect(page.getByTestId("live-placeholder")).toHaveText("Listening…");

  // First pass: all tentative.
  await page.evaluate(() => window.__mock!.emit("stream-text", { text: "hello" }));
  await expect(page.getByTestId("live-tentative")).toHaveText("hello");

  // Second pass agrees and grows: "hello" stabilizes, tail stays tentative.
  await page.evaluate(() => window.__mock!.emit("stream-text", { text: "hello world" }));
  await expect(page.getByTestId("live-stable")).toHaveText("hello");
  await expect(page.getByTestId("live-tentative")).toHaveText("world");

  // Stable text must not rewrite on a disagreeing later pass.
  await page.evaluate(() => window.__mock!.emit("stream-text", { text: "hello walled garden" }));
  await expect(page.getByTestId("live-stable")).toHaveText("hello");
  await expect(page.getByTestId("live-tentative")).toHaveText("walled garden");

  // The visualizer canvas is still there, below the text, and still
  // animating (pixels change once levels arrive).
  await expect(page.getByTestId("waveform")).toBeVisible();
  const snap = () =>
    page.evaluate(
      () => (document.querySelector("[data-testid=waveform]") as HTMLCanvasElement).toDataURL(),
    );
  const before = await snap();
  await page.evaluate(() => {
    for (let i = 0; i < 8; i++) window.__mock!.emit("mic-level", 0.95);
  });
  await expect.poll(snap, { timeout: 4000 }).not.toBe(before);

  // A new recording resets the stabilizer.
  await page.evaluate(() =>
    window.__mock!.emit("show-overlay", { state: "recording", live: true }),
  );
  await expect(page.getByTestId("live-placeholder")).toBeVisible();
});

test("E10b: live off renders the compact pill with no text region", async ({ page }) => {
  await page.goto("/?window=overlay");
  await expect(page.getByTestId("overlay-pill")).toBeAttached();

  await page.evaluate(() =>
    window.__mock!.emit("show-overlay", { state: "recording", live: false }),
  );
  const pill = page.getByTestId("overlay-pill");
  await expect(pill).toHaveAttribute("data-live", "false");
  await expect(page.getByTestId("waveform")).toBeVisible();
  await expect(page.getByTestId("live-text")).not.toBeAttached();

  // Even if stream-text arrives (e.g. stale event), nothing renders.
  await page.evaluate(() => window.__mock!.emit("stream-text", { text: "ghost words" }));
  await expect(page.getByTestId("live-text")).not.toBeAttached();
});

test("E10c: the settings toggle exists, defaults on, and persists", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("settings-root")).toBeVisible();

  const toggle = page.getByTestId("live-transcription");
  await expect(toggle).toBeChecked(); // default ON (SPEC3 FR-L1)

  await toggle.uncheck();
  const persisted = await page.evaluate(() => {
    const saves = window.__mock!.calls().filter((c) => c.command === "set_settings");
    const last = saves[saves.length - 1]?.args?.settings as
      | { live_transcription?: boolean }
      | undefined;
    return last?.live_transcription;
  });
  expect(persisted).toBe(false);
  await expect(toggle).not.toBeChecked();
});
