// The built-in theme catalog (SPEC6 FR-A3): 12 themes, each defining the full
// CSS-variable contract on `.nh-theme` (the pill root and the settings
// preview both carry that class). Swatches feed the picker grid.

export interface ThemeDef {
  id: string;
  name: string;
  variant: "light" | "dark";
  css: string;
  swatch: { bg: string; primary: string; accent: string; text: string };
}

function theme(
  id: string,
  name: string,
  variant: "light" | "dark",
  vars: Record<string, string>,
): ThemeDef {
  const css = `.nh-theme {\n${Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n")}\n}`;
  return {
    id,
    name,
    variant,
    css,
    swatch: {
      bg: vars["--nh-pill-bg"],
      primary: vars["--nh-fx-primary"],
      accent: vars["--nh-fx-accent"],
      text: vars["--nh-text"],
    },
  };
}

const SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
const MONO = `ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace`;
const SERIF = `"Iowan Old Style", "Palatino", Georgia, serif`;

export const DEFAULT_THEME = "indigo";

export const THEMES: ThemeDef[] = [
  theme("indigo", "Indigo", "dark", {
    "--nh-pill-bg": "rgba(22, 22, 26, 0.86)",
    "--nh-pill-border": "rgba(255, 255, 255, 0.14)",
    "--nh-text": "#f5f5f7",
    "--nh-tentative-opacity": "0.55",
    "--nh-placeholder": "rgba(245, 245, 247, 0.45)",
    "--nh-timer": "rgba(245, 245, 247, 0.75)",
    "--nh-rec-dot": "#ff453a",
    "--nh-fx-primary": "#8a93ff",
    "--nh-fx-accent": "#b8beff",
    "--nh-fx-glow": "rgba(122, 132, 255, 0.8)",
    "--nh-font": SANS,
  }),
  theme("phosphor", "Phosphor", "dark", {
    "--nh-pill-bg": "rgba(4, 14, 6, 0.92)",
    "--nh-pill-border": "rgba(51, 255, 102, 0.25)",
    "--nh-text": "#4dff88",
    "--nh-tentative-opacity": "0.5",
    "--nh-placeholder": "rgba(77, 255, 136, 0.4)",
    "--nh-timer": "rgba(77, 255, 136, 0.7)",
    "--nh-rec-dot": "#4dff88",
    "--nh-fx-primary": "#33ff66",
    "--nh-fx-accent": "#ccffcc",
    "--nh-fx-glow": "rgba(51, 255, 102, 0.9)",
    "--nh-font": MONO,
  }),
  theme("amber-terminal", "Amber Terminal", "dark", {
    "--nh-pill-bg": "rgba(18, 10, 2, 0.92)",
    "--nh-pill-border": "rgba(255, 176, 0, 0.28)",
    "--nh-text": "#ffb000",
    "--nh-tentative-opacity": "0.5",
    "--nh-placeholder": "rgba(255, 176, 0, 0.4)",
    "--nh-timer": "rgba(255, 176, 0, 0.7)",
    "--nh-rec-dot": "#ff5c00",
    "--nh-fx-primary": "#ffb000",
    "--nh-fx-accent": "#ffe08a",
    "--nh-fx-glow": "rgba(255, 176, 0, 0.85)",
    "--nh-font": MONO,
  }),
  theme("vaporwave", "Vaporwave", "dark", {
    "--nh-pill-bg": "rgba(24, 10, 38, 0.9)",
    "--nh-pill-border": "rgba(255, 113, 206, 0.35)",
    "--nh-text": "#fdf6ff",
    "--nh-tentative-opacity": "0.55",
    "--nh-placeholder": "rgba(253, 246, 255, 0.45)",
    "--nh-timer": "#01cdfe",
    "--nh-rec-dot": "#ff71ce",
    "--nh-fx-primary": "#ff71ce",
    "--nh-fx-accent": "#01cdfe",
    "--nh-fx-glow": "rgba(185, 103, 255, 0.9)",
    "--nh-font": SANS,
  }),
  theme("nord", "Nord", "dark", {
    "--nh-pill-bg": "rgba(46, 52, 64, 0.92)",
    "--nh-pill-border": "rgba(216, 222, 233, 0.15)",
    "--nh-text": "#eceff4",
    "--nh-tentative-opacity": "0.55",
    "--nh-placeholder": "rgba(236, 239, 244, 0.4)",
    "--nh-timer": "#81a1c1",
    "--nh-rec-dot": "#bf616a",
    "--nh-fx-primary": "#88c0d0",
    "--nh-fx-accent": "#ebcb8b",
    "--nh-fx-glow": "rgba(136, 192, 208, 0.7)",
    "--nh-font": SANS,
  }),
  theme("dracula", "Dracula", "dark", {
    "--nh-pill-bg": "rgba(40, 42, 54, 0.92)",
    "--nh-pill-border": "rgba(189, 147, 249, 0.25)",
    "--nh-text": "#f8f8f2",
    "--nh-tentative-opacity": "0.55",
    "--nh-placeholder": "rgba(248, 248, 242, 0.4)",
    "--nh-timer": "#6272a4",
    "--nh-rec-dot": "#ff5555",
    "--nh-fx-primary": "#bd93f9",
    "--nh-fx-accent": "#50fa7b",
    "--nh-fx-glow": "rgba(189, 147, 249, 0.8)",
    "--nh-font": SANS,
  }),
  theme("solarized-dark", "Solarized Dark", "dark", {
    "--nh-pill-bg": "rgba(0, 43, 54, 0.93)",
    "--nh-pill-border": "rgba(131, 148, 150, 0.2)",
    "--nh-text": "#93a1a1",
    "--nh-tentative-opacity": "0.55",
    "--nh-placeholder": "rgba(147, 161, 161, 0.4)",
    "--nh-timer": "#586e75",
    "--nh-rec-dot": "#dc322f",
    "--nh-fx-primary": "#2aa198",
    "--nh-fx-accent": "#b58900",
    "--nh-fx-glow": "rgba(42, 161, 152, 0.7)",
    "--nh-font": SANS,
  }),
  theme("solarized-light", "Solarized Light", "light", {
    "--nh-pill-bg": "rgba(253, 246, 227, 0.95)",
    "--nh-pill-border": "rgba(101, 123, 131, 0.25)",
    "--nh-text": "#657b83",
    "--nh-tentative-opacity": "0.5",
    "--nh-placeholder": "rgba(101, 123, 131, 0.45)",
    "--nh-timer": "#93a1a1",
    "--nh-rec-dot": "#dc322f",
    "--nh-fx-primary": "#268bd2",
    "--nh-fx-accent": "#cb4b16",
    "--nh-fx-glow": "rgba(38, 139, 210, 0.5)",
    "--nh-font": SANS,
  }),
  theme("rose-pine", "Rosé Pine", "dark", {
    "--nh-pill-bg": "rgba(25, 23, 36, 0.92)",
    "--nh-pill-border": "rgba(196, 167, 231, 0.22)",
    "--nh-text": "#e0def4",
    "--nh-tentative-opacity": "0.55",
    "--nh-placeholder": "rgba(224, 222, 244, 0.4)",
    "--nh-timer": "#908caa",
    "--nh-rec-dot": "#eb6f92",
    "--nh-fx-primary": "#c4a7e7",
    "--nh-fx-accent": "#f6c177",
    "--nh-fx-glow": "rgba(196, 167, 231, 0.75)",
    "--nh-font": SANS,
  }),
  theme("catppuccin-mocha", "Catppuccin Mocha", "dark", {
    "--nh-pill-bg": "rgba(30, 30, 46, 0.92)",
    "--nh-pill-border": "rgba(203, 166, 247, 0.22)",
    "--nh-text": "#cdd6f4",
    "--nh-tentative-opacity": "0.55",
    "--nh-placeholder": "rgba(205, 214, 244, 0.4)",
    "--nh-timer": "#9399b2",
    "--nh-rec-dot": "#f38ba8",
    "--nh-fx-primary": "#cba6f7",
    "--nh-fx-accent": "#94e2d5",
    "--nh-fx-glow": "rgba(203, 166, 247, 0.75)",
    "--nh-font": SANS,
  }),
  theme("newsprint", "Newsprint", "light", {
    "--nh-pill-bg": "rgba(247, 244, 237, 0.96)",
    "--nh-pill-border": "rgba(40, 38, 35, 0.3)",
    "--nh-text": "#282623",
    "--nh-tentative-opacity": "0.45",
    "--nh-placeholder": "rgba(40, 38, 35, 0.4)",
    "--nh-timer": "rgba(40, 38, 35, 0.6)",
    "--nh-rec-dot": "#a02c2c",
    "--nh-fx-primary": "#3d3a35",
    "--nh-fx-accent": "#a02c2c",
    "--nh-fx-glow": "rgba(61, 58, 53, 0.35)",
    "--nh-font": SERIF,
  }),
  theme("high-contrast", "High Contrast", "dark", {
    "--nh-pill-bg": "rgba(0, 0, 0, 0.97)",
    "--nh-pill-border": "#ffffff",
    "--nh-text": "#ffffff",
    "--nh-tentative-opacity": "0.7",
    "--nh-placeholder": "rgba(255, 255, 255, 0.6)",
    "--nh-timer": "#ffffff",
    "--nh-rec-dot": "#ff2d55",
    "--nh-fx-primary": "#ffffff",
    "--nh-fx-accent": "#ffe600",
    "--nh-fx-glow": "rgba(255, 255, 255, 0.9)",
    "--nh-font": SANS,
  }),
];

/** Unknown ids fall back to the default — settings resilience. */
export function getBuiltinTheme(id: string): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!;
}
