// U9: the theme catalog and the user-theme helpers (SPEC6 §6).

import { describe, expect, it } from "vitest";
import {
  CONTRACT_VARS,
  hasRemoteUrl,
  missingContractVars,
  parseThemeMeta,
} from "../../src/lib/themeMeta";
import { DEFAULT_THEME, getBuiltinTheme, THEMES } from "../../src/overlay/themes";

describe("U9: built-in themes", () => {
  it("has exactly 12 themes with unique ids and the default present", () => {
    expect(THEMES).toHaveLength(12);
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(12);
    expect(ids).toContain(DEFAULT_THEME);
  });

  for (const theme of THEMES) {
    it(`${theme.id}: defines the full contract`, () => {
      expect(missingContractVars(theme.css)).toEqual([]);
      expect(["light", "dark"]).toContain(theme.variant);
      expect(theme.swatch.bg).toBeTruthy();
      expect(theme.swatch.primary).toBeTruthy();
    });
  }

  it("unknown selections fall back to the default theme", () => {
    expect(getBuiltinTheme("nope").id).toBe(DEFAULT_THEME);
    expect(getBuiltinTheme("user:gone").id).toBe(DEFAULT_THEME);
  });
});

describe("U9: theme metadata parsing", () => {
  it("reads name, author, and variant from the leading comment", () => {
    const meta = parseThemeMeta(
      "/* @name: Midnight Ocean\n @author: jorge\n @variant: light */\n.nh-theme {}",
      "ocean.css",
    );
    expect(meta).toEqual({ name: "Midnight Ocean", author: "jorge", variant: "light" });
  });

  it("falls back to the filename when metadata is missing", () => {
    const meta = parseThemeMeta(".nh-theme {}", "my-cool_theme.css");
    expect(meta.name).toBe("my cool theme");
    expect(meta.variant).toBe("dark");
  });

  it("detects remote url() references in any spelling", () => {
    expect(hasRemoteUrl("a { background: url(https://x.example/i.png); }")).toBe(true);
    expect(hasRemoteUrl("a { background: url( 'http://x' ); }")).toBe(true);
    expect(hasRemoteUrl('a { src: url("//cdn.example/f.woff"); }')).toBe(true);
    expect(hasRemoteUrl("a { background: url(data:image/png;base64,AA); }")).toBe(false);
    expect(hasRemoteUrl(".nh-theme { --nh-text: #fff; }")).toBe(false);
  });

  it("reports missing contract variables", () => {
    const missing = missingContractVars(".nh-theme { --nh-text: #fff; }");
    expect(missing).toContain("--nh-pill-bg");
    expect(missing).not.toContain("--nh-text");
    expect(missing.length).toBe(CONTRACT_VARS.length - 1);
  });
});
