import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/api", async (orig) => {
  const real = await orig<typeof import("./lib/api")>();
  return { ...real, search: vi.fn().mockResolvedValue({}), autocomplete: vi.fn() };
});

import App from "./App.svelte";
import { store } from "./lib/store.svelte";

afterEach(() => {
  cleanup();
  store.busy = false;
  store.error = null;
});

describe("App layout", () => {
  it("dims the panes while results are stale (busy or error)", async () => {
    const { container } = render(App);
    const panes = container.querySelector(".panes")!;
    expect(panes.classList.contains("stale")).toBe(false);
    store.error = "library not open";
    await tick();
    expect(panes.classList.contains("stale")).toBe(true);
    store.error = null;
    store.busy = true;
    await tick();
    expect(panes.classList.contains("stale")).toBe(true);
    store.busy = false;
    await tick();
    expect(panes.classList.contains("stale")).toBe(false);
    expect(container.querySelector("#results-region")).not.toBeNull();
    expect(container.querySelector("#reading-pane-region")).not.toBeNull();
  });
});
