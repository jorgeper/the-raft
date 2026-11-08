import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ getThread: vi.fn() }));
import * as api from "./api";
import { cachedThreadCount, clearThreadCache, loadThread, prefetchThread } from "./threads";
import type { SearchResults } from "./api";
// Golden JSON written by the Rust side (src-tauri/src/ipc_contract.rs).
import searchWire from "./ipc-fixtures/search.json?raw";

const [second, first] = (JSON.parse(searchWire) as SearchResults).threads;

const getThread = vi.mocked(api.getThread);
beforeEach(() => {
  clearThreadCache();
  getThread.mockReset();
  getThread.mockResolvedValue([]);
});

describe("thread cache", () => {
  it("serves repeats from cache and keys on terms", async () => {
    await loadThread("1", ["a"]);
    await loadThread("1", ["a"]);
    expect(getThread).toHaveBeenCalledTimes(1);
    await loadThread("1", ["b"]);
    expect(getThread).toHaveBeenCalledTimes(2);
  });
  it("keeps at most 8 threads, evicting the least recently used", async () => {
    for (let i = 0; i < 8; i++) await loadThread(String(i), []);
    await loadThread("0", []); // refresh 0
    await loadThread("100", []); // evicts 1
    expect(cachedThreadCount()).toBe(8);
    getThread.mockClear();
    await loadThread("0", []);
    expect(getThread).not.toHaveBeenCalled();
    await loadThread("1", []);
    expect(getThread).toHaveBeenCalledTimes(1);
  });
  it("does not cache failures, and prefetch swallows them", async () => {
    getThread.mockRejectedValueOnce("library is busy");
    prefetchThread("5", []);
    await Promise.resolve();
    await Promise.resolve();
    await loadThread("5", []);
    expect(getThread).toHaveBeenCalledTimes(2);
  });

  it("keys on the exact id string: real ids that collide as JS numbers stay apart", async () => {
    await loadThread(first.thrid, []);
    await loadThread(second.thrid, []);
    expect(getThread.mock.calls.map((c) => c[0])).toEqual(["1868012345678901234", "1868012345678901235"]);
  });

  it("prefetch fills the cache for that exact id only", async () => {
    prefetchThread(first.thrid, ["hello"]);
    await loadThread(first.thrid, ["hello"]);
    expect(getThread).toHaveBeenCalledTimes(1);
    expect(getThread).toHaveBeenCalledWith("1868012345678901234", ["hello"]);
    await loadThread(second.thrid, ["hello"]);
    expect(getThread).toHaveBeenCalledTimes(2);
  });
});
