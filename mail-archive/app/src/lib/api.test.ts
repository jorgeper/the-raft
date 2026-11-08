import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import * as api from "./api";
// Golden JSON written by the Rust side (src-tauri/src/ipc_contract.rs).
import searchWire from "./ipc-fixtures/search.json?raw";

const invokeMock = vi.mocked(invoke);
beforeEach(() => invokeMock.mockReset());

describe("IPC wire format", () => {
  it("keeps real-sized Gmail thread ids exact from Rust's JSON to get_thread", async () => {
    // Tauri hands command results to JS through JSON.parse.
    invokeMock.mockResolvedValueOnce(JSON.parse(searchWire));
    const res = await api.search("hello", 0, 200);
    expect(res.threads.map((t) => t.thrid)).toEqual(["1868012345678901235", "1868012345678901234"]);

    invokeMock.mockResolvedValueOnce([]);
    await api.getThread(res.threads[1].thrid, res.terms);
    expect(invokeMock).toHaveBeenLastCalledWith("get_thread", { thrid: "1868012345678901234", terms: ["hello"] });
    // Arguments go back through JSON.stringify; the id must survive it exactly.
    expect(JSON.stringify(invokeMock.mock.lastCall![1])).toContain('"thrid":"1868012345678901234"');
  });
});
