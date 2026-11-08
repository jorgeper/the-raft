import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  rebuildIndex: vi.fn(),
  onProgress: vi.fn(),
  libraryStatus: vi.fn(),
}));

import * as api from "../lib/api";
import { store } from "../lib/store.svelte";
import RebuildDialog from "./RebuildDialog.svelte";

let emit!: (p: api.Progress) => void;
const STATUS = { path: "/lib", configured: true, message_count: 5, needs_rebuild: false, open_error: null };

beforeEach(() => {
  vi.mocked(api.rebuildIndex).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.libraryStatus).mockReset().mockResolvedValue(STATUS);
  vi.mocked(api.onProgress).mockReset().mockImplementation(async (cb) => {
    emit = cb;
    return () => {};
  });
  store.status = null;
  store.refresh = 0;
});
afterEach(cleanup);

describe("RebuildDialog", () => {
  it("asks first, and Cancel runs nothing", async () => {
    const onclose = vi.fn();
    render(RebuildDialog, { confirm: true, onclose });
    expect(api.rebuildIndex).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByText("Cancel"));
    expect(onclose).toHaveBeenCalled();
    expect(api.rebuildIndex).not.toHaveBeenCalled();
  });

  it("confirming runs the rebuild with progress, then refreshes", async () => {
    let finish!: () => void;
    vi.mocked(api.rebuildIndex).mockReturnValue(new Promise<void>((r) => (finish = r)));
    render(RebuildDialog, { confirm: true, onclose: vi.fn() });
    await fireEvent.click(screen.getByText("Rebuild"));
    expect(api.rebuildIndex).toHaveBeenCalledTimes(1);
    emit({ phase: "rebuild", processed: 500, bytes: 10, total_bytes: 100, rate_per_sec: 50, errors: 0 });
    await vi.waitFor(() => expect(screen.getByTestId("progress").textContent).toContain("500 messages"));
    finish();
    await vi.waitFor(() => expect(screen.getByText("The search index was rebuilt.")).toBeTruthy());
    await vi.waitFor(() => expect(store.status).toEqual(STATUS));
    expect(store.refresh).toBe(1);
  });

  it("without confirm it starts at once (banner) and shows errors", async () => {
    vi.mocked(api.rebuildIndex).mockRejectedValue("library error");
    render(RebuildDialog, { confirm: false, onclose: vi.fn() });
    expect(api.rebuildIndex).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toBe("library error"));
  });
});
