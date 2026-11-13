import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  setLibraryPath: vi.fn(),
  libraryStatus: vi.fn(),
  reopenLibrary: vi.fn(),
  checkLibraryFolder: vi.fn(),
  revealLibrary: vi.fn(),
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
  vi.mocked(api.reopenLibrary).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.checkLibraryFolder).mockReset().mockResolvedValue(false);
  vi.mocked(api.revealLibrary).mockReset().mockResolvedValue(undefined);
  store.status = null;
});
afterEach(cleanup);

describe("OpenError", () => {
  it("shows the fixed text and the two buttons, not the first-run screen", () => {
    render(OpenError, { path: "/lib", reason: REASON });
    expect(screen.getByTestId("open-error").textContent).toBe(REASON);
    expect(screen.getByText("Try again")).toBeTruthy();
    expect(screen.getByText("Choose another library…")).toBeTruthy();
    expect(screen.getByText(/does not delete or change this one/)).toBeTruthy();
    expect(screen.queryByText("Import Takeout…")).toBeNull();
  });

  it("Try again force-reopens the configured library, then refreshes the status", async () => {
    render(OpenError, { path: "/lib", reason: REASON });
    await fireEvent.click(screen.getByText("Try again"));
    await vi.waitFor(() => expect(store.status).toEqual(OK));
    expect(api.reopenLibrary).toHaveBeenCalledTimes(1);
    expect(api.setLibraryPath).not.toHaveBeenCalled();
  });

  it("Show in Finder calls reveal_library", async () => {
    render(OpenError, { path: "/lib", reason: REASON });
    await fireEvent.click(screen.getByText("Show in Finder"));
    expect(api.revealLibrary).toHaveBeenCalledTimes(1);
  });

  it("asks before creating a library in a foreign non-empty folder", async () => {
    vi.mocked(open).mockResolvedValue("/Users/me/Documents");
    vi.mocked(api.checkLibraryFolder).mockResolvedValue(true);
    render(OpenError, { path: "/lib", reason: REASON });
    await fireEvent.click(screen.getByText("Choose another library…"));
    await vi.waitFor(() => screen.getByText(/does not look like a Mail Archive library/));
    expect(api.setLibraryPath).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByText("Cancel"));
    expect(api.setLibraryPath).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByText("Choose another library…"));
    await vi.waitFor(() => screen.getByText("Use this folder"));
    await fireEvent.click(screen.getByText("Use this folder"));
    await vi.waitFor(() => expect(api.setLibraryPath).toHaveBeenCalledWith("/Users/me/Documents"));
  });

  it("Try again shows the reason it still fails", async () => {
    vi.mocked(api.reopenLibrary).mockRejectedValue(REASON);
    render(OpenError, { path: "/lib", reason: "x" });
    await fireEvent.click(screen.getByText("Try again"));
    await vi.waitFor(() => expect(screen.getAllByText(REASON).length).toBe(1));
    expect(api.libraryStatus).not.toHaveBeenCalled();
  });

  it("the other button opens a folder dialog and switches to that path", async () => {
    vi.mocked(open).mockResolvedValue("/other");
    render(OpenError, { path: "/lib", reason: REASON });
    await fireEvent.click(screen.getByText("Choose another library…"));
    await vi.waitFor(() => expect(api.setLibraryPath).toHaveBeenCalledWith("/other"));
    expect(vi.mocked(open).mock.calls[0][0]).toMatchObject({ directory: true });
  });
});
