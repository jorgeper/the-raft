import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResults, ThreadHit } from "../lib/api";

vi.mock("../lib/api", async (orig) => {
  const real = await orig<typeof import("../lib/api")>();
  return { ...real, search: vi.fn() };
});

import * as api from "../lib/api";
import { store } from "../lib/store.svelte";
import ResultsList from "./ResultsList.svelte";

const search = vi.mocked(api.search);

function thread(i: number, o: Partial<ThreadHit> = {}): ThreadHit {
  return {
    thrid: i, latest_date: 1_700_000_000 - i, senders: [`Sender ${i}`], message_count: 1,
    subject: `Subject ${i}`, snippet: `snippet ${i}`, has_attachment: false, matched: [], ...o,
  };
}
function results(n: number, o: Partial<SearchResults> = {}): SearchResults {
  return {
    threads: Array.from({ length: n }, (_, i) => thread(i)),
    total_messages: n, elapsed_ms: 7, chips: [], hints: [], terms: [], ...o,
  };
}

const ROW = 64;
const VIEW = 640; // 10 rows

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => VIEW });
  store.results = null;
  store.resultsQuery = "";
  search.mockReset();
});
afterEach(() => cleanup());

const rowsIn = (c: HTMLElement) => [...c.querySelectorAll('[role="option"]')];
const rowText = (el: Element) => el.querySelector(".subject")!.textContent!;

async function scrollTo(c: HTMLElement, top: number) {
  const s = c.querySelector<HTMLElement>(".scroller")!;
  s.scrollTop = top;
  await fireEvent.scroll(s);
  await tick();
}

describe("ResultsList", () => {
  it("shows the header text", async () => {
    store.results = results(3, { total_messages: 1234, elapsed_ms: 42 });
    const { container } = render(ResultsList, { selected: 0, onselect: () => {} });
    await tick();
    expect(container.querySelector(".header")!.textContent).toBe("1234 messages · 42 ms");
  });

  it("renders only the visible rows plus 10 each side", async () => {
    store.results = results(1000);
    const { container } = render(ResultsList, { selected: 0, onselect: () => {} });
    await tick();
    // rows 0..9 visible, +10 below, nothing above
    let rows = rowsIn(container);
    expect(rows.length).toBe(20);
    expect(rowText(rows[0])).toBe("Subject 0");
    expect(rowText(rows[19])).toBe("Subject 19");

    await scrollTo(container, 300 * ROW);
    rows = rowsIn(container);
    // visible 300..309, window 290..319
    expect(rows.length).toBe(30);
    expect(rowText(rows[0])).toBe("Subject 290");
    expect(rowText(rows[29])).toBe("Subject 319");
    expect(container.querySelector<HTMLElement>(".spacer")!.style.height).toBe(`${1000 * ROW}px`);
  });

  it("loads the next page once when within 50 rows of the end", async () => {
    store.results = results(200);
    store.resultsQuery = "from:ana";
    let resolve!: (r: SearchResults) => void;
    search.mockReturnValue(new Promise((r) => (resolve = r)));
    const { container } = render(ResultsList, { selected: 0, onselect: () => {} });
    await tick();
    expect(search).not.toHaveBeenCalled();

    await scrollTo(container, 100 * ROW); // visible end 110, 90 rows left
    expect(search).not.toHaveBeenCalled();

    await scrollTo(container, 145 * ROW); // visible end 155, 45 rows left
    await scrollTo(container, 150 * ROW);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("from:ana", 200, 200);

    resolve({ ...results(0), threads: Array.from({ length: 30 }, (_, i) => thread(200 + i)) });
    await vi.waitFor(() => expect(store.results!.threads.length).toBe(230));
    await scrollTo(container, 190 * ROW);
    await tick();
    expect(search).toHaveBeenCalledTimes(1); // short page: nothing more to load
  });

  it("drops a page that arrives after a newer search replaced the list", async () => {
    const old = results(200);
    store.results = old;
    let resolve!: (r: SearchResults) => void;
    search.mockReturnValue(new Promise((r) => (resolve = r)));
    const { container } = render(ResultsList, { selected: 0, onselect: () => {} });
    await scrollTo(container, 160 * ROW);
    const fresh = results(5);
    store.results = fresh;
    resolve({ ...results(0), threads: [thread(900)] });
    await tick();
    await tick();
    expect(search).toHaveBeenCalledTimes(1);
    expect(store.results.threads.length).toBe(5);
  });

  it("checks a new result set afresh even if a page for the old one is still pending", async () => {
    store.results = results(200);
    store.resultsQuery = "old";
    let resolveOld!: (r: SearchResults) => void;
    search.mockReturnValueOnce(new Promise((r) => (resolveOld = r)));
    const { container } = render(ResultsList, { selected: 0, onselect: () => {} });
    await scrollTo(container, 160 * ROW);
    expect(search).toHaveBeenCalledTimes(1);

    search.mockResolvedValueOnce(results(0));
    store.resultsQuery = "new";
    store.results = results(200, { threads: Array.from({ length: 200 }, (_, i) => thread(1000 + i)) });
    await tick();
    await scrollTo(container, 160 * ROW);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(search).toHaveBeenLastCalledWith("new", 200, 200);
    resolveOld(results(0));
  });

  it("returns to the top when the result set is replaced", async () => {
    store.results = results(1000);
    const { container } = render(ResultsList, { selected: 0, onselect: () => {} });
    await scrollTo(container, 500 * ROW);
    expect(rowText(rowsIn(container)[0])).toBe("Subject 490");
    store.results = results(1000, { threads: Array.from({ length: 1000 }, (_, i) => thread(5000 + i)) });
    await tick();
    await tick();
    expect(container.querySelector<HTMLElement>(".scroller")!.scrollTop).toBe(0);
    expect(rowText(rowsIn(container)[0])).toBe("Subject 5000");
  });

  it("highlights terms with <mark> but renders markup in text as text", async () => {
    store.results = results(1, {
      terms: ["invoice", "b"],
      threads: [thread(0, { subject: "Your <b>Invoice</b> is ready", snippet: "an invoice", senders: ["A"] })],
    });
    const { container } = render(ResultsList, { selected: 0, onselect: () => {} });
    await tick();
    const subject = container.querySelector(".subject")!;
    expect(subject.querySelector("b")).toBeNull(); // not parsed as HTML
    expect(subject.textContent).toBe("Your <b>Invoice</b> is ready");
    const marks = [...subject.querySelectorAll("mark")].map((m) => m.textContent);
    expect(marks).toContain("Invoice");
    expect(container.querySelector(".snippet mark")!.textContent).toBe("invoice");
  });

  it("shows count, attachment and selection, and reports clicks", async () => {
    store.results = results(2, {
      threads: [
        thread(0, { senders: ["Ana", "Bo"], message_count: 3, has_attachment: true }),
        thread(1),
      ],
    });
    const onselect = vi.fn();
    const { container } = render(ResultsList, { selected: 1, onselect });
    await tick();
    const rows = rowsIn(container);
    expect(rows[0].querySelector(".senders")!.textContent).toBe("Ana, Bo (3)");
    expect(rows[0].querySelector(".clip")).not.toBeNull();
    expect(rows[1].querySelector(".clip")).toBeNull();
    expect(rows[1].getAttribute("aria-selected")).toBe("true");
    await fireEvent.click(rows[0]);
    expect(onselect).toHaveBeenCalledWith(0);
  });

  it("scrolls the selected row into view", async () => {
    store.results = results(1000);
    const r = render(ResultsList, { selected: 50, onselect: () => {} });
    await tick();
    const s = r.container.querySelector<HTMLElement>(".scroller")!;
    expect(s.scrollTop).toBe(50 * ROW + ROW - VIEW);
  });
});
