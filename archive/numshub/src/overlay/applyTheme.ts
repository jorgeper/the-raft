// Resolves a theme id (built-in or `user:<id>`) to CSS and injects it into
// the document (SPEC6). One style tag per document; re-applying replaces it.

import { api } from "../ipc/api";
import { getBuiltinTheme } from "./themes";

const STYLE_ID = "nh-theme-style";

export async function resolveThemeCss(themeId: string): Promise<string> {
  if (themeId.startsWith("user:")) {
    try {
      const user = (await api.listUserThemes()).find(
        (t) => t.id === themeId && !t.reason && t.css,
      );
      if (user) return user.css;
    } catch (e) {
      console.error("loading user theme failed:", e);
    }
    // Deleted/broken user theme: fall back to the default built-in.
    return getBuiltinTheme("").css;
  }
  return getBuiltinTheme(themeId).css;
}

export async function applyTheme(themeId: string): Promise<void> {
  const css = await resolveThemeCss(themeId);
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement("style");
    tag.id = STYLE_ID;
    document.head.appendChild(tag);
  }
  tag.textContent = css;
}
