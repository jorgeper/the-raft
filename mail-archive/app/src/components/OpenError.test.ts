import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  setLibraryPath: vi.fn(),
  libraryStatus: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { open } from "@tauri-apps/plugin-dialog";
import * as api from "../lib/api";
import { store } from "../lib/store.svelte";
import OpenError from "./OpenError.svelte";

const REASON = "Library is in use by another process (mail-cli?).";
const OK = { path: "/lib", configured: true, message_count: 3, needs_rebuild: false, open_error: null };

beforeEach(() => {
  vi.mocked(api.setLibraryPath).mockReset().mockResolvedValue(null);
  vi.mocked(api.libraryStatus).mockReset().mockResolvedValue(OK);
  vi.mocked(open).mockReset();
  store.status = null;
});
afterEach(cleanup);

describe("OpenError", () => {
  it("shows the fixed text and the two buttons, not the first-run screen", () => {
    render(OpenError, { path: "/lib", reason: REASON });
    expect(screen.getByTestId("open-error").textContent).toBe(REASON);
    expect(screen.getByText("Try again")).toBeTruthy();
    expect(screen.getByText("Open or create a different library…")).toBeTruthy();
    expect(screen.getByText(/does not delete or change this one/)).toBeTruthy();
    expect(screen.queryByText("Import Takeout…")).toBeNull();
  });

  it("Try again re-opens the same path, then refreshes the status", async () => {
    render(OpenError, { path: "/lib", reason: REASON });
    await fireEvent.click(screen.getByText("Try again"));
    await vi.waitFor(() => expect(store.status).toEqual(OK));
    expect(api.setLibraryPath).toHaveBeenCalledWith("/lib");
  });

  it("Try again shows the reason it still fails", async () => {
    vi.mocked(api.setLibraryPath).mockRejectedValue(REASON);
    render(OpenError, { path: "/lib", reason: "x" });
    await fireEvent.click(screen.getByText("Try again"));
    await vi.waitFor(() => expect(screen.getAllByText(REASON).length).toBe(1));
    expect(api.libraryStatus).not.toHaveBeenCalled();
  });

  it("the other button opens a folder dialog and switches to that path", async () => {
    vi.mocked(open).mockResolvedValue("/other");
    render(OpenError, { path: "/lib", reason: REASON });
    await fireEvent.click(screen.getByText("Open or create a different library…"));
    await vi.waitFor(() => expect(api.setLibraryPath).toHaveBeenCalledWith("/other"));
    expect(vi.mocked(open).mock.calls[0][0]).toMatchObject({ directory: true });
  });
});
