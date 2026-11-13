import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/api", async (orig) => ({
  ...(await orig<typeof import("./lib/api")>()),
  search: vi.fn(),
  autocomplete: vi.fn(),
  getThread: vi.fn(),
  libraryStatus: vi.fn(),
  rebuildIndex: vi.fn(),
  setLibraryPath: vi.fn(),
  onOpenFailed: vi.fn().mockResolvedValue(() => {}),
  onProgress: vi.fn().mockResolvedValue(() => {}),
  onMenuImport: vi.fn(),
  onMenuRebuild: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

import { open } from "@tauri-apps/plugin-dialog";
import * as api from "./lib/api";
import App from "./App.svelte";
import { store } from "./lib/store.svelte";

type Status = api.LibraryStatus;
const base: Status = { path: "/lib", configured: true, message_count: 10, needs_rebuild: false, open_error: null };
let menuImport!: () => void;
let menuRebuild!: () => void;

beforeEach(() => {
  vi.mocked(api.search).mockReset().mockResolvedValue({
    threads: [], total_messages: 0, capped: false, elapsed_ms: 1, chips: [], hints: [], terms: [],
  });
  vi.mocked(api.libraryStatus).mockReset().mockResolvedValue(base);
  vi.mocked(api.rebuildIndex).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.setLibraryPath).mockReset().mockResolvedValue(null);
  vi.mocked(open).mockReset().mockResolvedValue(null);
  vi.mocked(api.onMenuImport).mockReset().mockImplementation(async (cb) => ((menuImport = cb), () => {}));
  vi.mocked(api.onMenuRebuild).mockReset().mockImplementation(async (cb) => ((menuRebuild = cb), () => {}));
  store.status = null;
  store.statusError = null;
  store.query = "";
});
afterEach(cleanup);

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await tick();
  }
};

describe("App screens", () => {
  it("shows FirstRun when nothing is configured, and the open-error screen (not FirstRun) when opening failed", async () => {
    vi.mocked(api.libraryStatus).mockResolvedValue({ ...base, configured: false, path: "/default" });
    const first = render(App);
    await vi.waitFor(() => expect(screen.getByText("Import Takeout…")).toBeTruthy());
    first.unmount();

    vi.mocked(api.libraryStatus).mockResolvedValue({ ...base, open_error: "Library could not be opened." });
    store.status = null;
    render(App);
    await vi.waitFor(() => expect(screen.getByTestId("open-error")).toBeTruthy());
    expect(screen.queryByText("Import Takeout…")).toBeNull();
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("FirstRun leaves once mail was imported", async () => {
    vi.mocked(api.libraryStatus).mockResolvedValue({ ...base, configured: false, message_count: 0, path: "/default" });
    const { container } = render(App);
    await vi.waitFor(() => screen.getByText("Import Takeout…"));
    vi.mocked(api.libraryStatus).mockResolvedValue({ ...base, message_count: 5 });
    store.status = { ...base, message_count: 5 };
    await settle();
    expect(container.querySelector("#search-area")).not.toBeNull();
    expect(screen.queryByText("Import Takeout…")).toBeNull();
  });

  it("the needs_rebuild banner runs rebuild_index and then refreshes the search and status", async () => {
    vi.mocked(api.libraryStatus).mockResolvedValue({ ...base, needs_rebuild: true });
    render(App);
    await vi.waitFor(() => screen.getByText("Search index needs rebuilding"));
    // Let the initial (debounced) search run first, so only a refresh can add another.
    await vi.waitFor(() => expect(api.search).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 150));
    expect(api.search).toHaveBeenCalledTimes(1);
    vi.mocked(api.libraryStatus).mockResolvedValue(base);
    await fireEvent.click(screen.getByText("Rebuild Index"));
    expect(api.rebuildIndex).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(screen.getByText("The search index was rebuilt.")).toBeTruthy());
    await vi.waitFor(() => expect(screen.queryByText("Search index needs rebuilding")).toBeNull());
    await vi.waitFor(() => expect(api.search).toHaveBeenCalledTimes(2));
  });

  it("the menu events open the import dialog and the confirm-first rebuild", async () => {
    const { container } = render(App);
    await vi.waitFor(() => expect(container.querySelector("#search-area")).not.toBeNull());
    await settle();
    menuRebuild();
    await vi.waitFor(() => screen.getByText(/Rebuild the search index/));
    expect(api.rebuildIndex).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();

    menuImport();
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
  });

  it("menu events are ignored on the first-run screen", async () => {
    vi.mocked(api.libraryStatus).mockResolvedValue({ ...base, configured: false, path: "/d" });
    render(App);
    await vi.waitFor(() => screen.getByText("Import Takeout…"));
    await settle();
    menuImport();
    menuRebuild();
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it("an empty library shows an empty state whose button opens the import dialog, and Cmd+I works there", async () => {
    vi.mocked(api.libraryStatus).mockResolvedValue({ ...base, message_count: 0 });
    render(App);
    await vi.waitFor(() => screen.getByText("No mail in this library yet"));
    await fireEvent.click(screen.getByText("Import Takeout…"));
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    await settle();
    menuImport();
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
  });

  it("a non-empty library shows no empty state", async () => {
    const { container } = render(App);
    await vi.waitFor(() => expect(container.querySelector("#results-region")).not.toBeNull());
    expect(screen.queryByText("No mail in this library yet")).toBeNull();
  });
});
