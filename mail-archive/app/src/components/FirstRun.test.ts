import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), setLibraryPath: vi.fn(), checkLibraryFolder: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { open } from "@tauri-apps/plugin-dialog";
import * as api from "../lib/api";
import FirstRun from "./FirstRun.svelte";

beforeEach(() => {
  vi.mocked(api.setLibraryPath).mockReset().mockResolvedValue(null);
  vi.mocked(open).mockReset();
  vi.mocked(api.checkLibraryFolder).mockReset().mockResolvedValue(false);
});
afterEach(cleanup);

describe("FirstRun", () => {
  it("shows the default path and sets it before importing", async () => {
    const onimport = vi.fn();
    render(FirstRun, { path: "/Users/me/Library/Application Support/mail-archive/library", onimport });
    expect(screen.getByTestId("library-path").textContent).toBe("/Users/me/Library/Application Support/mail-archive/library");
    await fireEvent.click(screen.getByText("Import Takeout…"));
    expect(api.setLibraryPath).toHaveBeenCalledWith("/Users/me/Library/Application Support/mail-archive/library");
    expect(onimport).toHaveBeenCalledTimes(1);
  });

  it("Choose another… opens a folder dialog, applies it and shows the cloud warning", async () => {
    vi.mocked(open).mockResolvedValue("/Users/me/Dropbox/mail");
    vi.mocked(api.setLibraryPath).mockResolvedValue("This folder is synced by Dropbox.");
    const onimport = vi.fn();
    render(FirstRun, { path: "/default", onimport });
    await fireEvent.click(screen.getByText("Choose another…"));
    await vi.waitFor(() => expect(screen.getByText("This folder is synced by Dropbox.")).toBeTruthy());
    expect(vi.mocked(open).mock.calls[0][0]).toMatchObject({ directory: true, multiple: false });
    expect(api.setLibraryPath).toHaveBeenCalledWith("/Users/me/Dropbox/mail");
    expect(screen.getByTestId("library-path").textContent).toBe("/Users/me/Dropbox/mail");
    expect(onimport).not.toHaveBeenCalled();
  });

  it("a cancelled dialog changes nothing", async () => {
    vi.mocked(open).mockResolvedValue(null);
    render(FirstRun, { path: "/default", onimport: vi.fn() });
    await fireEvent.click(screen.getByText("Choose another…"));
    await Promise.resolve();
    expect(api.setLibraryPath).not.toHaveBeenCalled();
    expect(screen.getByTestId("library-path").textContent).toBe("/default");
  });

  it("shows an error and does not import when the path cannot be set", async () => {
    vi.mocked(api.setLibraryPath).mockRejectedValue("Library could not be opened.");
    const onimport = vi.fn();
    render(FirstRun, { path: "/default", onimport });
    await fireEvent.click(screen.getByText("Import Takeout…"));
    await vi.waitFor(() => expect(screen.getByText("Library could not be opened.")).toBeTruthy());
    expect(onimport).not.toHaveBeenCalled();
  });

  it("asks before using a foreign non-empty folder", async () => {
    vi.mocked(open).mockResolvedValue("/Users/me/Documents");
    vi.mocked(api.checkLibraryFolder).mockResolvedValue(true);
    render(FirstRun, { path: "/default", onimport: vi.fn() });
    await fireEvent.click(screen.getByText("Choose another…"));
    await vi.waitFor(() => screen.getByText(/does not look like a Mail Archive library/));
    expect(api.setLibraryPath).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Use this folder")).toBeNull();
    expect(api.setLibraryPath).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByText("Choose another…"));
    await vi.waitFor(() => screen.getByText("Use this folder"));
    await fireEvent.click(screen.getByText("Use this folder"));
    await vi.waitFor(() => expect(api.setLibraryPath).toHaveBeenCalledWith("/Users/me/Documents"));
  });
});
