import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ getThread: vi.fn() }));
import * as api from "./api";
import { cachedThreadCount, clearThreadCache, loadThread, prefetchThread } from "./threads";

const getThread = vi.mocked(api.getThread);
beforeEach(() => {
  clearThreadCache();
  getThread.mockReset();
  getThread.mockResolvedValue([]);
});

describe("thread cache", () => {
  it("serves repeats from cache and keys on terms", async () => {
    await loadThread(1, ["a"]);
    await loadThread(1, ["a"]);
    expect(getThread).toHaveBeenCalledTimes(1);
    await loadThread(1, ["b"]);
    expect(getThread).toHaveBeenCalledTimes(2);
  });
  it("keeps at most 8 threads, evicting the least recently used", async () => {
    for (let i = 0; i < 8; i++) await loadThread(i, []);
    await loadThread(0, []); // refresh 0
    await loadThread(100, []); // evicts 1
    expect(cachedThreadCount()).toBe(8);
    getThread.mockClear();
    await loadThread(0, []);
    expect(getThread).not.toHaveBeenCalled();
    await loadThread(1, []);
    expect(getThread).toHaveBeenCalledTimes(1);
  });
  it("does not cache failures, and prefetch swallows them", async () => {
    getThread.mockRejectedValueOnce("library is busy");
    prefetchThread(5, []);
    await Promise.resolve();
    await Promise.resolve();
    await loadThread(5, []);
    expect(getThread).toHaveBeenCalledTimes(2);
  });
});
