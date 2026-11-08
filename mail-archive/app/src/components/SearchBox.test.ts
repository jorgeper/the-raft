import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResults } from "../lib/api";

vi.mock("../lib/api", async (orig) => {
  const real = await orig<typeof import("../lib/api")>();
  return { ...real, search: vi.fn(), autocomplete: vi.fn() };
});

import * as api from "../lib/api";
import { store } from "../lib/store.svelte";
import SearchBox from "./SearchBox.svelte";

const search = vi.mocked(api.search);
const autocomplete = vi.mocked(api.autocomplete);

function results(partial: Partial<SearchResults> = {}): SearchResults {
  return { threads: [], total_messages: 0, elapsed_ms: 1, chips: [], hints: [], terms: [], ...partial };
}

async function type(box: HTMLElement, value: string) {
  await fireEvent.input(box, { target: { value } });
  await tick();
}

async function flushTimers(ms = 100) {
  await vi.advanceTimersByTimeAsync(ms);
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  store.query = "";
  store.results = null;
  store.resultsQuery = "";
  store.busy = false;
  store.error = null;
  search.mockReset();
  autocomplete.mockReset();
  search.mockResolvedValue(results());
  autocomplete.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SearchBox", () => {
  it("runs exactly one debounced search, 100 ms after the last keystroke", async () => {
    render(SearchBox);
    await flushTimers(); // the initial empty-query search
    search.mockClear();

    const box = screen.getByRole("combobox");
    await type(box, "h");
    await flushTimers(60);
    await type(box, "he");
    await flushTimers(60);
    await type(box, "hello");
    await flushTimers(99);
    expect(search).not.toHaveBeenCalled();
    await flushTimers(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("hello", 0, expect.any(Number));
  });

  it("renders the returned chips and hints", async () => {
    search.mockResolvedValue(
      results({
        chips: [{ start: 0, end: 8, label: "from: bob" }],
        hints: [{ start: 9, end: 12, message: "Invalid date" }],
      }),
    );
    render(SearchBox);
    await type(screen.getByRole("combobox"), "from:bob");
    await flushTimers();
    expect(screen.getByText("from: bob")).toBeTruthy();
    expect(screen.getByTestId("hints").textContent).toContain("Invalid date");
  });

  it("removes a chip's span from the query when its X is clicked", async () => {
    const q = "a from:josé b";
    search.mockResolvedValue(results({ chips: [{ start: 2, end: 11, label: "from: josé" }] }));
    render(SearchBox);
    const box = screen.getByRole("combobox") as HTMLInputElement;
    await type(box, q);
    await flushTimers();
    await fireEvent.click(screen.getByRole("button", { name: "Remove from: josé" }));
    await tick();
    expect(store.query).toBe("a b");
    expect(box.value).toBe("a b");
  });

  it("drops an older response that resolves after a newer one", async () => {
    const first = deferred<SearchResults>();
    const second = deferred<SearchResults>();
    render(SearchBox);
    await flushTimers();
    search.mockReset();
    search.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const box = screen.getByRole("combobox");
    await type(box, "one");
    await flushTimers();
    await type(box, "two");
    await flushTimers();
    expect(search).toHaveBeenCalledTimes(2);

    second.resolve(results({ total_messages: 2, chips: [{ start: 0, end: 3, label: "NEW" }] }));
    await flushTimers(0);
    first.resolve(results({ total_messages: 1, chips: [{ start: 0, end: 3, label: "OLD" }] }));
    await flushTimers(0);

    expect(store.results?.total_messages).toBe(2);
    expect(store.resultsQuery).toBe("two");
    expect(screen.queryByText("OLD")).toBeNull();
    expect(screen.getByText("NEW")).toBeTruthy();
  });

  it("accepts an autocomplete suggestion with Tab and with Enter", async () => {
    autocomplete.mockResolvedValue(["Receipts 2019", "Receipts"]);
    render(SearchBox);
    const box = screen.getByRole("combobox") as HTMLInputElement;

    await type(box, "x label:Rec");
    await flushTimers(0);
    expect(autocomplete).toHaveBeenLastCalledWith("label", "Rec");
    expect(screen.getAllByRole("option").length).toBe(2);
    await fireEvent.keyDown(box, { key: "Tab" });
    await tick();
    expect(store.query).toBe('x label:"Receipts 2019" ');
    expect(screen.queryAllByRole("option").length).toBe(0);

    autocomplete.mockResolvedValue(["Ana Díaz <ana@example.org>"]);
    await type(box, "from:an");
    await flushTimers(0);
    expect(autocomplete).toHaveBeenLastCalledWith("address", "an");
    await fireEvent.keyDown(box, { key: "Enter" });
    await tick();
    expect(store.query).toBe("from:ana@example.org ");
  });

  it("shows a busy library quietly, not as an error", async () => {
    search.mockRejectedValue("library is busy");
    render(SearchBox);
    await type(screen.getByRole("combobox"), "x");
    await flushTimers();
    expect(store.busy).toBe(true);
    expect(store.error).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Library is busy");
  });

  it("retries every 2 s while busy, then shows results and clears busy", async () => {
    search.mockRejectedValueOnce("library is busy").mockRejectedValueOnce("library is busy");
    search.mockResolvedValue(results({ total_messages: 7 }));
    render(SearchBox);
    await type(screen.getByRole("combobox"), "x");
    await flushTimers(); // first attempt: busy
    expect(store.busy).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("results will refresh");
    expect(search).toHaveBeenCalledTimes(1);

    await flushTimers(1999);
    expect(search).toHaveBeenCalledTimes(1);
    await flushTimers(1); // retry 1: still busy
    expect(search).toHaveBeenCalledTimes(2);
    expect(store.busy).toBe(true);
    await flushTimers(2000); // retry 2: success
    expect(search).toHaveBeenCalledTimes(3);
    expect(store.results?.total_messages).toBe(7);
    expect(store.busy).toBe(false);
    expect(screen.queryByRole("status")).toBeNull();

    await flushTimers(10000); // timer cleared on success
    expect(search).toHaveBeenCalledTimes(3);
  });

  it("stops retrying when the component is destroyed", async () => {
    search.mockRejectedValue("library is busy");
    const { unmount } = render(SearchBox);
    await type(screen.getByRole("combobox"), "x");
    await flushTimers();
    unmount();
    search.mockClear();
    await flushTimers(10000);
    expect(search).not.toHaveBeenCalled();
  });

  it("shows a non-busy error in the status line and keeps old results", async () => {
    search.mockResolvedValueOnce(results({ total_messages: 3 }));
    render(SearchBox);
    const box = screen.getByRole("combobox");
    await type(box, "a");
    await flushTimers();
    search.mockRejectedValue("library not open");
    await type(box, "ab");
    await flushTimers();
    expect(screen.getByRole("status").textContent).toBe("library not open");
    expect(store.busy).toBe(false);
    expect(store.results?.total_messages).toBe(3);
  });

  it("clears suggestions on every input so Tab cannot apply stale spans", async () => {
    const slow = deferred<string[]>();
    autocomplete.mockResolvedValueOnce(["Receipts"]).mockReturnValueOnce(slow.promise);
    render(SearchBox);
    const box = screen.getByRole("combobox") as HTMLInputElement;
    await type(box, "label:Rec");
    await flushTimers(0);
    expect(screen.getAllByRole("option").length).toBe(1);

    await type(box, "zzzzzzzz label:Rec"); // list must vanish immediately
    expect(screen.queryAllByRole("option").length).toBe(0);
    await fireEvent.keyDown(box, { key: "Tab" });
    expect(store.query).toBe("zzzzzzzz label:Rec");
    slow.resolve(["Receipts"]);
    await flushTimers(0);
    expect(screen.getAllByRole("option").length).toBe(1);
  });

  it("does not accept a suggestion while an IME is composing", async () => {
    autocomplete.mockResolvedValue(["Receipts"]);
    render(SearchBox);
    const box = screen.getByRole("combobox");
    await type(box, "label:R");
    await flushTimers(0);
    await fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    await fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    expect(store.query).toBe("label:R");
    expect(screen.getAllByRole("option").length).toBe(1);
  });

  it("wires ARIA combobox attributes only while the list exists", async () => {
    autocomplete.mockResolvedValue(["A", "B"]);
    render(SearchBox);
    const box = screen.getByRole("combobox");
    expect(box.getAttribute("aria-controls")).toBeNull();
    expect(box.getAttribute("aria-activedescendant")).toBeNull();
    await type(box, "label:");
    await flushTimers(0);
    expect(box.getAttribute("aria-controls")).toBe("suggestions");
    expect(box.getAttribute("aria-activedescendant")).toBe("suggestion-0");
    await fireEvent.keyDown(box, { key: "ArrowDown" });
    await tick();
    expect(box.getAttribute("aria-activedescendant")).toBe("suggestion-1");
    expect(document.getElementById("suggestion-1")?.getAttribute("aria-selected")).toBe("true");
    await fireEvent.keyDown(box, { key: "Escape" });
    await tick();
    expect(box.getAttribute("aria-controls")).toBeNull();
  });
});
