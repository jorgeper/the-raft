import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", async (orig) => {
  const real = await orig<typeof import("../lib/api")>();
  return { ...real, autocomplete: vi.fn() };
});

import * as api from "../lib/api";
import ChipRow from "./ChipRow.svelte";

const autocomplete = vi.mocked(api.autocomplete);

beforeEach(() => {
  autocomplete.mockReset();
  autocomplete.mockResolvedValue(["Inbox", "Receipts 2019"]);
});
afterEach(cleanup);

function mountRow() {
  const oninsert = vi.fn();
  const onremove = vi.fn();
  render(ChipRow, { chips: [], hints: [], onremove, oninsert });
  return { oninsert, onremove };
}

describe("ChipRow", () => {
  it("+ label loads the menu and inserts the picked label", async () => {
    const { oninsert } = mountRow();
    await fireEvent.click(screen.getByRole("button", { name: "+ label" }));
    expect(autocomplete).toHaveBeenCalledWith("label", "");
    const item = await screen.findByRole("menuitem", { name: "Receipts 2019" });
    await fireEvent.click(item);
    expect(oninsert).toHaveBeenCalledWith("label:Receipts 2019");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("+ date emits after:/before: and resets the input", async () => {
    const { oninsert } = mountRow();
    const after = screen.getByLabelText("After date") as HTMLInputElement;
    await fireEvent.change(after, { target: { value: "2020-01-31" } });
    expect(oninsert).toHaveBeenLastCalledWith("after:2020-01-31");
    expect(after.value).toBe("");
    const before = screen.getByLabelText("Before date") as HTMLInputElement;
    await fireEvent.change(before, { target: { value: "2021-02-01" } });
    expect(oninsert).toHaveBeenLastCalledWith("before:2021-02-01");
    expect(before.value).toBe("");
    await tick();
    expect(oninsert).toHaveBeenCalledTimes(2);
  });
});
