import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  rebuildIndex: vi.fn(),
  onProgress: vi.fn(),
  libraryStatus: vi.fn(),
}));

import * as api from "../lib/api";
import RebuildDialog from "./RebuildDialog.svelte";

// The modal is tested through RebuildDialog's confirm step: two buttons.
let outside: HTMLInputElement;
beforeEach(() => {
  vi.mocked(api.onProgress).mockReset().mockResolvedValue(() => {});
  outside = document.createElement("input");
  outside.id = "behind";
  document.body.appendChild(outside);
  outside.focus();
});
afterEach(() => {
  cleanup();
  outside.remove();
});

const dialog = () => screen.getByRole("dialog");
const inDialog = () => dialog().contains(document.activeElement);

describe("Modal focus", () => {
  it("takes focus when it opens", async () => {
    render(RebuildDialog, { confirm: true, onclose: () => {} });
    await tick();
    expect(inDialog()).toBe(true);
    expect(document.activeElement).toBe(screen.getByText("Cancel"));
  });

  it("traps Tab and Shift+Tab inside the dialog", async () => {
    render(RebuildDialog, { confirm: true, onclose: () => {} });
    await tick();
    const [cancel, rebuild] = [screen.getByText("Cancel"), screen.getByText("Rebuild")];
    rebuild.focus();
    await fireEvent.keyDown(rebuild, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    await fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(rebuild);
  });

  it("pulls focus back when something behind it takes it", async () => {
    render(RebuildDialog, { confirm: true, onclose: () => {} });
    await tick();
    outside.focus();
    expect(inDialog()).toBe(true);
  });

  it("gives focus back to where it was when it closes", async () => {
    const r = render(RebuildDialog, { confirm: true, onclose: () => {} });
    await tick();
    expect(inDialog()).toBe(true);
    r.unmount();
    await tick();
    expect(document.activeElement).toBe(outside);
  });
});
