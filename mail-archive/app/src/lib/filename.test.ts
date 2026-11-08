import { describe, expect, it } from "vitest";
import { safeFilename } from "./filename";

describe("safeFilename", () => {
  it("replaces separators so the name survives", () => {
    expect(safeFilename("Invoice 03/2024.pdf")).toBe("Invoice 03_2024.pdf");
    expect(safeFilename("/Users/Shared/x.command")).toBe("_Users_Shared_x.command");
    expect(safeFilename("..\\..\\evil.exe")).toBe("_.._evil.exe");
    expect(safeFilename("a:b")).toBe("a_b");
  });
  it("strips control, bidi and other format characters", () => {
    expect(safeFilename("report‮fdp.exe")).toBe("reportfdp.exe");
    expect(safeFilename("a\u0000b\nc​d﻿.txt")).toBe("abcd.txt");
    expect(safeFilename("x y")).toBe("xy");
  });
  it("drops leading dots and falls back for empty names", () => {
    expect(safeFilename(".bashrc")).toBe("bashrc");
    expect(safeFilename("...")).toBe("attachment");
    expect(safeFilename(null)).toBe("attachment");
    expect(safeFilename("‮")).toBe("attachment");
  });
  it("caps length and keeps the extension", () => {
    const n = safeFilename("a".repeat(300) + ".pdf");
    expect(Array.from(n).length).toBe(120);
    expect(n.endsWith(".pdf")).toBe(true);
    expect(Array.from(safeFilename("b".repeat(300))).length).toBe(120);
    expect(Array.from(safeFilename("c".repeat(10) + "." + "d".repeat(30))).length).toBe(41);
  });
});
