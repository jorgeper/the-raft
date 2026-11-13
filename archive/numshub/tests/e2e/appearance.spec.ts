// E13a–E13c (SPEC6 §6): the Appearance section, overlay application, and the
// user-theme flow through the mock.

import { expect, test } from "@playwright/test";

test("E13a: pickers render, persist, and survive a reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("settings-root")).toBeVisible();
  await page.getByTestId("nav-appearance").click();

  await expect(page.getByTestId("appearance-preview")).toBeVisible();
  await expect(page.getByTestId("preview-canvas")).toBeVisible();
  await expect(page.getByTestId("effect-picker").locator("button")).toHaveCount(15);
  await expect(page.getByTestId("theme-picker").locator("button")).toHaveCount(12);

  // Defaults selected.
  await expect(page.getByTestId("effect-classic-bars")).toHaveClass(/selected/);
  await expect(page.getByTestId("theme-indigo")).toHaveClass(/selected/);

  await page.getByTestId("effect-pulse-orb").click();
  await page.getByTestId("theme-dracula").click();
  await expect(page.getByTestId("effect-pulse-orb")).toHaveClass(/selected/);
  await expect(page.getByTestId("theme-dracula")).toHaveClass(/selected/);

  // Survives a reload (mock persists settings per-tab).
  await page.reload();
  await page.getByTestId("nav-appearance").click();
  await expect(page.getByTestId("effect-pulse-orb")).toHaveClass(/selected/);
  await expect(page.getByTestId("theme-dracula")).toHaveClass(/selected/);
});

test("E13b: the overlay applies the effect and theme from the show payload", async ({
  page,
}) => {
  await page.goto("/?window=overlay");
  await expect(page.getByTestId("overlay-pill")).toBeAttached();

  await page.evaluate(() =>
    window.__mock!.emit("show-overlay", {
      state: "recording",
      live: false,
      effect: "pulse-orb",
      theme: "dracula",
    }),
  );
  const pill = page.getByTestId("overlay-pill");
  await expect(pill).toHaveAttribute("data-effect", "pulse-orb");
  await expect(page.getByTestId("waveform")).toBeVisible(); // the canvas

  // Dracula's --nh-fx-primary lands on the pill root.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.querySelector("[data-testid=overlay-pill]")!;
        return getComputedStyle(el).getPropertyValue("--nh-fx-primary").trim();
      }),
    )
    .toBe("#bd93f9");

  // The canvas actually animates (pixels change between frames).
  const snap = () =>
    page.evaluate(
      () => (document.querySelector("[data-testid=waveform]") as HTMLCanvasElement).toDataURL(),
    );
  await page.evaluate(() => {
    for (let i = 0; i < 6; i++) window.__mock!.emit("mic-level", 0.9);
  });
  const first = await snap();
  await expect.poll(snap, { timeout: 4000 }).not.toBe(first);
});

test("E13c: user themes list, rejected entries disabled, applying persists", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("nav-appearance").click();

  const valid = page.getByTestId("theme-user:midnight-ocean");
  const broken = page.getByTestId("theme-user:broken-remote");
  await expect(valid).toBeEnabled();
  await expect(broken).toBeDisabled();
  await expect(broken).toHaveAttribute("title", /offline/);

  await valid.click();
  await expect(valid).toHaveClass(/selected/);
  const persisted = await page.evaluate(() => {
    const saves = window.__mock!.calls().filter((c) => c.command === "set_settings");
    const last = saves[saves.length - 1]?.args?.settings as
      | { overlay_theme?: string }
      | undefined;
    return last?.overlay_theme;
  });
  expect(persisted).toBe("user:midnight-ocean");

  // Reload button re-queries the mock.
  await page.getByTestId("reload-themes").click();
  await expect(valid).toBeVisible();
});
