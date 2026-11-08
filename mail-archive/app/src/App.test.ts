import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/api", async (orig) => {
  const real = await orig<typeof import("./lib/api")>();
  return { ...real, search: vi.fn().mockResolvedValue({}), autocomplete: vi.fn(), getThread: vi.fn(), onOpenFailed: vi.fn().mockResolvedValue(() => {}), libraryStatus: vi.fn(), onMenuImport: vi.fn().mockResolvedValue(() => {}), onMenuRebuild: vi.fn().mockResolvedValue(() => {}), onProgress: vi.fn().mockResolvedValue(() => {}) };
});
// The import dialog's file picker never answers, so the dialog stays open.
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn(() => new Promise(() => {})) }));

import * as api from "./lib/api";
import { formatFull } from "./lib/format";
import App from "./App.svelte";
import { store } from "./lib/store.svelte";
import { clearThreadCache } from "./lib/threads";

const READY = { path: "/lib", configured: true, message_count: 10, needs_rebuild: false, open_error: null };

beforeEach(() => {
  store.status = { ...READY };
  vi.mocked(api.libraryStatus).mockResolvedValue({ ...READY });
});

afterEach(() => {
  cleanup();
  store.status = null;
  store.busy = false;
  store.error = null;
  store.results = null;
  store.query = "";
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

function seed(n: number) {
  store.results = {
    threads: Array.from({ length: n }, (_, i) => ({
      thrid: String(100 + i), latest_date: 1_700_000_000, senders: [`Sender ${i}`], message_count: 1,
      subject: `Subject ${i}`, snippet: "", has_attachment: false, matched: [],
    })),
    total_messages: n, capped: false, elapsed_ms: 1, chips: [], hints: [], terms: ["foo"],
  };
  store.resultsQuery = store.query;
}

describe("App keyboard and prefetch", () => {
  beforeEach(() => {
    clearThreadCache();
    vi.mocked(api.getThread).mockReset();
    vi.mocked(api.getThread).mockResolvedValue([]);
    // Keep SearchBox's initial search from replacing the seeded results.
    vi.mocked(api.search).mockImplementation(() => new Promise(() => {}));
  });

  it("opens the selected thread and prefetches the next one, with terms", async () => {
    seed(5);
    const { container } = render(App);
    await tick();
    const calls = () => vi.mocked(api.getThread).mock.calls.map((c) => c[0]);
    expect(calls()).toEqual(["100", "101"]);
    expect(vi.mocked(api.getThread).mock.calls[1][1]).toEqual(["foo"]);

    const list = container.querySelector<HTMLElement>(".scroller")!;
    list.focus();
    await fireEvent.keyDown(list, { key: "ArrowDown" });
    await tick();
    // row 1 selected: thread 101 comes from the cache, 102 is prefetched
    expect(calls()).toEqual(["100", "101", "102"]);
    await fireEvent.keyDown(list, { key: "ArrowDown" });
    await tick();
    expect(calls()).toEqual(["100", "101", "102", "103"]);
    expect(container.querySelector('[aria-selected="true"] .subject')!.textContent).toBe("Subject 2");
  });

  it("does not prefetch past the last row", async () => {
    seed(2);
    const { container } = render(App);
    await tick();
    const list = container.querySelector<HTMLElement>(".scroller")!;
    list.focus();
    await fireEvent.keyDown(list, { key: "ArrowDown" });
    await fireEvent.keyDown(list, { key: "ArrowDown" });
    await tick();
    expect(vi.mocked(api.getThread).mock.calls.map((c) => c[0])).toEqual(["100", "101"]);
    expect(container.querySelector('[aria-selected="true"] .subject')!.textContent).toBe("Subject 1");
  });

  it("Enter focuses the pane, Escape returns to the list, / focuses search", async () => {
    seed(3);
    const { container } = render(App);
    await tick();
    const list = container.querySelector<HTMLElement>(".scroller")!;
    list.focus();
    await fireEvent.keyDown(list, { key: "Enter" });
    expect(document.activeElement).toBe(container.querySelector("article.pane"));
    await fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.activeElement).toBe(list);
    await fireEvent.keyDown(list, { key: "/" });
    expect(document.activeElement).toBe(container.querySelector("#search-area input"));
  });

  it("ArrowDown or Enter in the search box moves to the list with row 0 selected", async () => {
    seed(3);
    const { container } = render(App);
    await tick();
    const input = container.querySelector<HTMLInputElement>("#search-area input")!;
    const list = container.querySelector<HTMLElement>(".scroller")!;
    const selectedSubject = () => container.querySelector('[aria-selected="true"] .subject')!.textContent;
    for (const key of ["ArrowDown", "Enter"]) {
      input.focus();
      await fireEvent.keyDown(input, { key });
      await tick();
      expect(document.activeElement).toBe(list);
      expect(selectedSubject()).toBe("Subject 0");
    }
    // The selection made in the list is kept on the next trip from the box.
    await fireEvent.keyDown(list, { key: "ArrowDown" });
    input.focus();
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await tick();
    expect(document.activeElement).toBe(list);
    expect(selectedSubject()).toBe("Subject 1");
  });

  it("with suggestions open, ArrowDown and Enter stay in the search box", async () => {
    seed(3);
    vi.mocked(api.autocomplete).mockResolvedValue(["Receipts", "Work"]);
    const { container } = render(App);
    await tick();
    const input = container.querySelector<HTMLInputElement>("#search-area input")!;
    input.focus();
    await fireEvent.input(input, { target: { value: "label:" } });
    await vi.waitFor(() => expect(container.querySelector("#suggestions")).not.toBeNull());
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(document.activeElement).toBe(input);
    expect(container.querySelector('#suggestions [aria-selected="true"]')!.textContent).toBe("Work");
    await fireEvent.keyDown(input, { key: "Enter" });
    await tick();
    expect(document.activeElement).toBe(input);
    expect(store.query).toContain("Work");
  });

  it("Escape in the search box clears its text", async () => {
    seed(1);
    store.query = "from:ana";
    const { container } = render(App);
    await tick();
    const input = container.querySelector<HTMLInputElement>("#search-area input")!;
    input.focus();
    await fireEvent.keyDown(input, { key: "Escape" });
    expect(store.query).toBe("");
  });

  it("cmd-C in the list copies subject, sender and date", async () => {
    seed(2);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container } = render(App);
    await tick();
    const list = container.querySelector<HTMLElement>(".scroller")!;
    list.focus();
    await fireEvent.keyDown(list, { key: "c", metaKey: true });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toBe(`Subject 0 — Sender 0 — ${formatFull(1_700_000_000)}`);
  });
});

describe("modal dialogs", () => {
  it("keep the search box behind them from taking keystrokes", async () => {
    store.status = { ...READY, message_count: 0 };
    vi.mocked(api.libraryStatus).mockResolvedValue({ ...READY, message_count: 0 });
    const { container, getByText, getByRole } = render(App);
    await tick();
    const input = container.querySelector<HTMLInputElement>("#search-area input")!;
    input.focus();
    await fireEvent.click(getByText("Import Takeout…"));
    await tick();
    const dialog = getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    // Focus cannot be moved back to the search box while the dialog is up.
    input.focus();
    expect(document.activeElement).not.toBe(input);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe("copy event (Edit > Copy)", () => {
  beforeEach(() => {
    clearThreadCache();
    vi.mocked(api.getThread).mockReset().mockResolvedValue([]);
    vi.mocked(api.search).mockImplementation(() => new Promise(() => {}));
  });
  const copyEvent = () => {
    const ev = new Event("copy", { bubbles: true, cancelable: true });
    const setData = vi.fn();
    Object.defineProperty(ev, "clipboardData", { value: { setData } });
    return { ev, setData };
  };

  it("copies the selected row when the list has focus and nothing is selected", async () => {
    seed(2);
    const { container } = render(App);
    await tick();
    container.querySelector<HTMLElement>(".scroller")!.focus();
    const { ev, setData } = copyEvent();
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(setData).toHaveBeenCalledWith("text/plain", `Subject 0 — Sender 0 — ${formatFull(1_700_000_000)}`);
  });

  it("leaves a real text selection alone", async () => {
    seed(2);
    const { container } = render(App);
    await tick();
    container.querySelector<HTMLElement>(".scroller")!.focus();
    const p = document.createElement("p");
    p.textContent = "selected words";
    document.body.appendChild(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const { ev, setData } = copyEvent();
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(setData).not.toHaveBeenCalled();
    window.getSelection()!.removeAllRanges();
    p.remove();
  });

  it("does nothing from the search box", async () => {
    seed(2);
    const { container } = render(App);
    await tick();
    container.querySelector<HTMLInputElement>("#search-area input")!.focus();
    const { ev, setData } = copyEvent();
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(setData).not.toHaveBeenCalled();
  });

  it("one Cmd+C never copies twice (keydown, then a copy event)", async () => {
    seed(2);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container } = render(App);
    await tick();
    const list = container.querySelector<HTMLElement>(".scroller")!;
    list.focus();
    await fireEvent.keyDown(list, { key: "c", metaKey: true });
    const { ev, setData } = copyEvent();
    window.dispatchEvent(ev);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("open-failed note", () => {
  it("shows a transient note when a link could not be opened", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.search).mockImplementation(() => new Promise(() => {}));
      let fire!: () => void;
      vi.mocked(api.onOpenFailed).mockImplementation(async (cb) => {
        fire = cb;
        return () => {};
      });
      const { container } = render(App);
      await tick();
      expect(container.textContent).not.toContain("Could not open the link");
      fire();
      await tick();
      expect(container.textContent).toContain("Could not open the link");
      await vi.advanceTimersByTimeAsync(4000);
      expect(container.textContent).not.toContain("Could not open the link");
    } finally {
      vi.useRealTimers();
    }
  });
});
