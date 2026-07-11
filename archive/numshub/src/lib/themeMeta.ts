// Theme metadata + contract helpers (SPEC6 FR-A3/FR-A4, U9-tested).
// Shared by the built-in registry, the user-theme picker, and the tests.

export const CONTRACT_VARS = [
  "--nh-pill-bg",
  "--nh-pill-border",
  "--nh-text",
  "--nh-tentative-opacity",
  "--nh-placeholder",
  "--nh-timer",
  "--nh-rec-dot",
  "--nh-fx-primary",
  "--nh-fx-accent",
  "--nh-fx-glow",
  "--nh-font",
] as const;

export interface ThemeMeta {
  name: string;
  author: string | null;
  variant: "light" | "dark";
}

/** Parse the leading metadata comment (marky-mark format); filename fallback. */
export function parseThemeMeta(css: string, filename: string): ThemeMeta {
  const comment = css.match(/^\s*\/\*([\s\S]*?)\*\//)?.[1] ?? "";
  const tag = (name: string) =>
    comment.match(new RegExp(`@${name}:\\s*([^\\n*]+)`))?.[1].trim() ?? null;
  const fallback = filename.replace(/\.css$/i, "").replace(/[-_]+/g, " ").trim();
  const variant = tag("variant")?.toLowerCase() === "light" ? "light" : "dark";
  return {
    name: tag("name") ?? (fallback || "Untitled theme"),
    author: tag("author"),
    variant,
  };
}

/** SPEC §1 no-network guarantee: reject themes referencing remote URLs. */
export function hasRemoteUrl(css: string): boolean {
  return /url\(\s*['"]?\s*(https?:)?\/\//i.test(css);
}

/** Which contract variables (if any) a theme forgot to define. */
export function missingContractVars(css: string): string[] {
  return CONTRACT_VARS.filter((v) => !css.includes(`${v}:`));
}
