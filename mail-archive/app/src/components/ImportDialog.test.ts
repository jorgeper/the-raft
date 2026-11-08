import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  importScan: vi.fn(),
  importApply: vi.fn(),
  importCancel: vi.fn(),
  importDiscard: vi.fn(),
  onProgress: vi.fn(),
  libraryStatus: vi.fn(),
  search: vi.fn(),
  getThread: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { open } from "@tauri-apps/plugin-dialog";
import * as api from "../lib/api";
import { store } from "../lib/store.svelte";
import { clearThreadCache, loadThread } from "../lib/threads";
import ImportDialog from "./ImportDialog.svelte";

let emit!: (p: api.Progress) => void;
const report = (o: Partial<api.ScanReport> = {}): api.ScanReport => ({
  kind: "Full", source_label: "All mail", total: 417282, new: 3812, label_changes: 1140, unchanged: 412330,
  removed: 96, removed_fraction: 0.0002, matched_by_content: 0, matched_by_header: 0, parse_errors: 0,
  duplicates_in_source: 0, looks_older: false, ...o,
});
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};
const progress = (o: Partial<api.Progress> = {}): api.Progress => ({
  phase: "scan", processed: 1000, bytes: 100, total_bytes: 400, rate_per_sec: 100, errors: 0, ...o,
});
const STATUS = { path: "/lib", configured: true, message_count: 99, needs_rebuild: false, open_error: null };

beforeEach(() => {
  vi.mocked(open).mockReset().mockResolvedValue(["/t/a.zip", "/t/b.mbox"]);
  vi.mocked(api.importScan).mockReset();
  vi.mocked(api.importApply).mockReset();
  vi.mocked(api.importCancel).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.importDiscard).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.libraryStatus).mockReset().mockResolvedValue(STATUS);
  vi.mocked(api.onProgress).mockReset().mockImplementation(async (cb) => {
    emit = cb;
    return () => {};
  });
  store.status = null;
  store.refresh = 0;
});
afterEach(cleanup);

describe("ImportDialog", () => {
  it("picks zip/mbox files (multi-select), scans with progress and an ETA, then shows the exact summary", async () => {
    const scan = deferred<api.ScanReport>();
    vi.mocked(api.importScan).mockReturnValue(scan.promise);
    render(ImportDialog, { onclose: vi.fn() });
    await vi.waitFor(() => expect(api.importScan).toHaveBeenCalledWith(["/t/a.zip", "/t/b.mbox"]));
    const opts = vi.mocked(open).mock.calls[0][0] as { multiple: boolean; filters: { extensions: string[] }[] };
    expect(opts.multiple).toBe(true);
    expect(opts.filters[0].extensions).toEqual(["zip", "mbox"]);

    emit(progress({ processed: 12345 }));
    await vi.waitFor(() => expect(screen.getByTestId("progress").textContent).toContain("12,345 messages"));
    expect(screen.getByTestId("progress").textContent).toContain("100/s");
    expect(screen.getByTestId("progress").textContent).toMatch(/less than a minute left|about \d+ min left/);

    emit(progress({ total_bytes: null }));
    await vi.waitFor(() => expect(screen.getByTestId("progress").textContent).not.toContain("left"));

    scan.resolve(report());
    await vi.waitFor(() =>
      expect(screen.getByTestId("summary").textContent).toBe(
        "412,330 already in library · 3,812 new · 1,140 label changes · 96 no longer in Gmail (kept)",
      ),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows warnings for an older export and for a high removed fraction, plus parse errors", async () => {
    vi.mocked(api.importScan).mockResolvedValue(
      report({ looks_older: true, removed: 30000, removed_fraction: 0.07, parse_errors: 2 }),
    );
    render(ImportDialog, { onclose: vi.fn() });
    await vi.waitFor(() => expect(screen.getAllByRole("alert").length).toBe(2));
    const text = screen.getAllByRole("alert").map((e) => e.textContent).join("|");
    expect(text).toContain("adds new mail only");
    expect(text).toContain("30,000 messages (7% of your library)");
    expect(screen.getByText("2 messages could not be read and will be skipped.")).toBeTruthy();
  });

  it("no removed warning at exactly 5%", async () => {
    vi.mocked(api.importScan).mockResolvedValue(report({ removed_fraction: 0.05 }));
    render(ImportDialog, { onclose: vi.fn() });
    await vi.waitFor(() => screen.getByTestId("summary"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Cancel while scanning calls import_cancel and closes when the scan stops", async () => {
    const scan = deferred<api.ScanReport>();
    vi.mocked(api.importScan).mockReturnValue(scan.promise);
    const onclose = vi.fn();
    render(ImportDialog, { onclose });
    await vi.waitFor(() => screen.getByText("Cancel"));
    await fireEvent.click(screen.getByText("Cancel"));
    expect(api.importCancel).toHaveBeenCalledTimes(1);
    expect(onclose).not.toHaveBeenCalled();
    scan.reject("cancelled");
    await vi.waitFor(() => expect(onclose).toHaveBeenCalledTimes(1));
  });

  it("closes without scanning when the file dialog is cancelled", async () => {
    vi.mocked(open).mockResolvedValue(null);
    const onclose = vi.fn();
    render(ImportDialog, { onclose });
    await vi.waitFor(() => expect(onclose).toHaveBeenCalled());
    expect(api.importScan).not.toHaveBeenCalled();
  });

  it("Import applies with progress, shows the done summary, then refreshes search, cache and status", async () => {
    vi.mocked(api.importScan).mockResolvedValue(report());
    const apply = deferred<api.ImportSummary>();
    vi.mocked(api.importApply).mockReturnValue(apply.promise);
    vi.mocked(api.search).mockResolvedValue({} as api.SearchResults);
    vi.mocked(api.getThread).mockReset().mockResolvedValue([]);
    clearThreadCache();
    await loadThread("1", []);
    await loadThread("1", []);
    expect(api.getThread).toHaveBeenCalledTimes(1); // cached
    render(ImportDialog, { onclose: vi.fn() });
    await vi.waitFor(() => screen.getByText("Import"));
    await fireEvent.click(screen.getByText("Import"));
    await vi.waitFor(() => expect(api.importApply).toHaveBeenCalled());
    emit(progress({ phase: "apply", processed: 2000 }));
    await vi.waitFor(() => expect(screen.getByTestId("progress").textContent).toContain("2,000 messages"));
    expect(store.refresh).toBe(0);

    apply.resolve({ import_id: 3, added: 3812, relabelled: 1140, removed_marked: 96, parse_errors: 0, elapsed_secs: 5 });
    await vi.waitFor(() =>
      expect(screen.getByTestId("done").textContent).toBe("3,812 added · 1,140 label changes · 96 marked no longer in Gmail"),
    );
    await vi.waitFor(() => expect(store.status).toEqual(STATUS));
    expect(store.refresh).toBe(1);
    // The import dropped the cached thread: loading it asks again.
    await loadThread("1", []);
    expect(api.getThread).toHaveBeenCalledTimes(2);
  });

  it("Cancel while applying calls import_cancel and reports it", async () => {
    vi.mocked(api.importScan).mockResolvedValue(report());
    const apply = deferred<api.ImportSummary>();
    vi.mocked(api.importApply).mockReturnValue(apply.promise);
    render(ImportDialog, { onclose: vi.fn() });
    await vi.waitFor(() => screen.getByText("Import"));
    await fireEvent.click(screen.getByText("Import"));
    await vi.waitFor(() => screen.getByText("Cancel"));
    await fireEvent.click(screen.getByText("Cancel"));
    expect(api.importCancel).toHaveBeenCalledTimes(1);
    apply.reject("cancelled");
    await vi.waitFor(() => expect(screen.getByText("Import cancelled. Nothing was changed.")).toBeTruthy());
    // The library may have changed in committed batches, so it still refreshes.
    await vi.waitFor(() => expect(store.refresh).toBe(1));
  });

  it("Cancel on the summary discards the pending scan and closes", async () => {
    vi.mocked(api.importScan).mockResolvedValue(report());
    const onclose = vi.fn();
    render(ImportDialog, { onclose });
    await vi.waitFor(() => screen.getByTestId("summary"));
    await fireEvent.click(screen.getByText("Cancel"));
    expect(api.importDiscard).toHaveBeenCalledTimes(1);
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(api.importApply).not.toHaveBeenCalled();
  });

  it("a scan that finishes after Cancel was pressed still shows its summary", async () => {
    const scan = deferred<api.ScanReport>();
    vi.mocked(api.importScan).mockReturnValue(scan.promise);
    const onclose = vi.fn();
    render(ImportDialog, { onclose });
    await vi.waitFor(() => screen.getByText("Cancel"));
    await fireEvent.click(screen.getByText("Cancel"));
    scan.resolve(report());
    await vi.waitFor(() => screen.getByTestId("summary"));
    expect(onclose).not.toHaveBeenCalled();
    // Import still works from here.
    vi.mocked(api.importApply).mockReturnValue(new Promise(() => {}));
    await fireEvent.click(screen.getByText("Import"));
    expect(api.importApply).toHaveBeenCalledTimes(1);
  });

  it("a failed apply shows its own error text, not 'cancelled'", async () => {
    vi.mocked(api.importScan).mockResolvedValue(report());
    vi.mocked(api.importApply).mockRejectedValue("the library changed since it was scanned; scan again");
    render(ImportDialog, { onclose: vi.fn() });
    await vi.waitFor(() => screen.getByText("Import"));
    await fireEvent.click(screen.getByText("Import"));
    await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toContain("scan again"));
  });

  it("shows a scan error", async () => {
    vi.mocked(api.importScan).mockRejectedValue("could not read the import source");
    render(ImportDialog, { onclose: vi.fn() });
    await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toBe("could not read the import source"));
  });
});
