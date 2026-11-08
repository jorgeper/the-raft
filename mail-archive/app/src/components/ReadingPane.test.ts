import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageView, SearchResults, ThreadHit } from "../lib/api";

vi.mock("../lib/api", async (orig) => {
  const real = await orig<typeof import("../lib/api")>();
  return {
    ...real,
    getThread: vi.fn(),
    openAttachment: vi.fn().mockResolvedValue(undefined),
    saveAttachment: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));

import { save } from "@tauri-apps/plugin-dialog";
import * as api from "../lib/api";
import { clearThreadCache } from "../lib/threads";
import { store } from "../lib/store.svelte";
import ReadingPane from "./ReadingPane.svelte";
// Golden JSON written by the Rust side (src-tauri/src/ipc_contract.rs).
import searchWire from "../lib/ipc-fixtures/search.json?raw";

const getThread = vi.mocked(api.getThread);
const saveDialog = vi.mocked(save);

function msg(id: number, date: number, o: Partial<MessageView> = {}): MessageView {
  return {
    id, thrid: "1", from: { name: `Name ${id}`, addr: `u${id}@example.org` }, to: [{ name: null, addr: "me@example.org" }],
    cc: [], date, labels: [], subject: "S", attachments: [], body_url: `mailbody://localhost/${id}`,
    blocked_remote: 0, body_failed: false, ...o,
  };
}
const hit = (o: Partial<ThreadHit> = {}): ThreadHit => ({
  thrid: "1", latest_date: 3, senders: [], message_count: 3, subject: "Thread subject",
  snippet: "", has_attachment: false, matched: [], ...o,
});

beforeEach(() => {
  clearThreadCache();
  getThread.mockReset();
  vi.mocked(api.openAttachment).mockClear();
  vi.mocked(api.saveAttachment).mockClear();
  saveDialog.mockReset();
  store.busy = false;
});
afterEach(() => cleanup());

async function show(messages: MessageView[], t = hit(), terms: string[] = []) {
  getThread.mockResolvedValue(messages);
  const r = render(ReadingPane, { thread: t, terms });
  await vi.waitFor(() => expect(r.container.querySelectorAll(".msg").length).toBe(messages.length));
  return r;
}
const froms = (c: HTMLElement) => [...c.querySelectorAll(".msg .from")].map((e) => e.textContent);

describe("ReadingPane", () => {
  it("passes the exact real-sized thread id string from the search JSON to get_thread", async () => {
    const res = JSON.parse(searchWire) as SearchResults;
    await show([msg(1, 1)], res.threads[1], res.terms);
    expect(getThread).toHaveBeenCalledWith("1868012345678901234", ["hello"]);
  });

  it("asks for the thread with the search terms", async () => {
    await show([msg(1, 1)], hit({ thrid: "9" }), ["foo"]);
    expect(getThread).toHaveBeenCalledWith("9", ["foo"]);
  });

  it("shows a notice instead of the body of a message that could not be rendered", async () => {
    const { container } = await show(
      [msg(1, 100), msg(2, 200, { body_failed: true, blocked_remote: 0 })],
      hit({ matched: [1, 2] }),
    );
    const [ok, bad] = [...container.querySelectorAll(".msg")];
    expect(ok.querySelector("iframe")).not.toBeNull();
    expect(bad.querySelector("iframe")).toBeNull();
    expect(bad.textContent).toContain("This message could not be displayed");
    expect(ok.textContent).not.toContain("could not be displayed");
  });

  it("orders messages oldest to newest", async () => {
    const { container } = await show([msg(3, 300), msg(1, 100), msg(2, 200)]);
    expect(froms(container)).toEqual(["Name 1", "Name 2", "Name 3"]);
  });

  it("expands matched messages, collapses the rest, and expands on click", async () => {
    const { container } = await show([msg(1, 100), msg(2, 200), msg(3, 300)], hit({ matched: [2] }));
    const open = () => [...container.querySelectorAll(".msg")].map((m) => m.querySelector("iframe") !== null);
    expect(open()).toEqual([false, true, false]);
    await fireEvent.click(container.querySelectorAll(".msg .head")[0]);
    expect(open()).toEqual([true, true, false]);
    await fireEvent.click(container.querySelectorAll(".msg .head")[1]);
    expect(open()).toEqual([true, false, false]);
  });

  it("opens the newest message when none matched", async () => {
    const { container } = await show([msg(1, 100), msg(2, 200)], hit({ matched: [] }));
    expect([...container.querySelectorAll(".msg")].map((m) => m.querySelector("iframe") !== null)).toEqual([false, true]);
  });

  it("sandboxes the body iframe with allow-popups only", async () => {
    const { container } = await show([msg(1, 1)], hit({ matched: [1] }));
    const f = container.querySelector("iframe")!;
    expect(f.getAttribute("sandbox")).toBe("allow-popups");
    expect(f.getAttribute("src")).toBe("mailbody://localhost/1");
  });

  it("shows the header details and labels", async () => {
    const { container } = await show(
      [msg(1, 1, { cc: [{ name: "Cy", addr: "cy@example.org" }], labels: ["Work", "Inbox"] })],
      hit({ matched: [1] }),
    );
    const text = container.querySelector(".meta")!.textContent!;
    expect(text).toContain("Name 1 <u1@example.org>");
    expect(text).toContain("me@example.org");
    expect(text).toContain("Cy <cy@example.org>");
    expect([...container.querySelectorAll(".tag")].map((t) => t.textContent)).toEqual(["Work", "Inbox"]);
  });

  it("shows the blocked-remote note only when above zero", async () => {
    let r = await show([msg(1, 1, { blocked_remote: 0 })], hit({ matched: [1] }));
    expect(r.container.textContent).not.toContain("remote images blocked");
    cleanup();
    clearThreadCache();
    r = await show([msg(1, 1, { blocked_remote: 4 })], hit({ matched: [1] }));
    expect(screen.getByText("4 remote images blocked")).toBeTruthy();
  });

  const withAtt = () =>
    msg(7, 1, {
      attachments: [{ part_index: 2, filename: "report.pdf", mime_type: "application/pdf", size: 2048, content_id: null }],
    });

  it("opens an attachment on chip click", async () => {
    await show([withAtt()], hit({ matched: [7] }));
    await fireEvent.click(screen.getByTitle("Open"));
    expect(api.openAttachment).toHaveBeenCalledWith(7, 2);
  });

  it("Save As asks the dialog, then saves to the absolute path it returns", async () => {
    saveDialog.mockResolvedValue("/Users/me/Downloads/report.pdf");
    await show([withAtt()], hit({ matched: [7] }));
    await fireEvent.click(screen.getByLabelText("Save As"));
    await vi.waitFor(() => expect(api.saveAttachment).toHaveBeenCalledWith(7, 2, "/Users/me/Downloads/report.pdf"));
    expect(saveDialog).toHaveBeenCalledWith({ defaultPath: "report.pdf" });
  });

  it("Save As via the secondary button, and cancelling saves nothing", async () => {
    saveDialog.mockResolvedValue(null);
    await show([withAtt()], hit({ matched: [7] }));
    await fireEvent.contextMenu(screen.getByTitle("Open"));
    await tick();
    await vi.waitFor(() => expect(saveDialog).toHaveBeenCalled());
    expect(api.saveAttachment).not.toHaveBeenCalled();
  });

  it("renders a message with a null sender", async () => {
    const { container } = await show([msg(1, 1, { from: null })], hit({ matched: [1] }));
    expect(froms(container)).toEqual(["(unknown sender)"]);
    expect(container.querySelector(".meta")!.textContent).toContain("(unknown sender)");
  });

  it("shows a placeholder instead of bodies while the library is busy, and brings them back", async () => {
    const { container } = await show([msg(1, 1)], hit({ matched: [1] }));
    store.busy = true;
    await tick();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Body unavailable while the library is busy");
    store.busy = false;
    await tick();
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("retries a busy get_thread until it succeeds", async () => {
    vi.useFakeTimers();
    try {
      getThread.mockRejectedValueOnce("library is busy").mockResolvedValue([msg(1, 1)]);
      const r = render(ReadingPane, { thread: hit({ matched: [1] }), terms: [] });
      await vi.advanceTimersByTimeAsync(0);
      expect(r.container.textContent).toContain("Body unavailable while the library is busy");
      await vi.advanceTimersByTimeAsync(2000);
      expect(r.container.querySelector("iframe")).not.toBeNull();
      expect(getThread).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps retrying a busy get_thread every 2 s until it succeeds", async () => {
    vi.useFakeTimers();
    try {
      getThread
        .mockRejectedValueOnce("library is busy")
        .mockRejectedValueOnce("library is busy")
        .mockResolvedValue([msg(1, 1)]);
      const r = render(ReadingPane, { thread: hit({ matched: [1] }), terms: [] });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
      expect(r.container.querySelector("iframe")).toBeNull();
      expect(r.container.textContent).toContain("Body unavailable while the library is busy");
      await vi.advanceTimersByTimeAsync(2000);
      expect(r.container.querySelector("iframe")).not.toBeNull();
      expect(getThread).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not show the previous thread's messages while a new one loads", async () => {
    const { container, rerender } = await show([msg(1, 1)], hit({ thrid: "1", matched: [1] }));
    let resolve!: (m: MessageView[]) => void;
    getThread.mockReturnValue(new Promise((r) => (resolve = r)));
    await rerender({ thread: hit({ thrid: "2", subject: "Second" }), terms: [] });
    await tick();
    expect(container.querySelectorAll(".msg").length).toBe(0);
    expect(container.textContent).toContain("Loading");
    resolve([msg(2, 2)]);
    await vi.waitFor(() => expect(container.querySelectorAll(".msg").length).toBe(1));
    expect(container.textContent).not.toContain("Loading");
  });

  it("offers a sanitized file name to the dialog and on the chip", async () => {
    saveDialog.mockResolvedValue(null);
    const evil = msg(7, 1, {
      attachments: [{ part_index: 0, filename: "../../x\u202Efdp.exe", mime_type: "a/b", size: 1, content_id: null }],
    });
    const { container } = await show([evil], hit({ matched: [7] }));
    expect(container.querySelector(".chip")!.textContent).toContain("_.._xfdp.exe");
    await fireEvent.click(screen.getByLabelText("Save As"));
    await vi.waitFor(() => expect(saveDialog).toHaveBeenCalledWith({ defaultPath: "_.._xfdp.exe" }));
  });

  it("shows an empty state without a thread", () => {
    const { container } = render(ReadingPane, { thread: null, terms: [] });
    expect(container.textContent).toContain("Select a conversation");
    expect(getThread).not.toHaveBeenCalled();
  });
});
