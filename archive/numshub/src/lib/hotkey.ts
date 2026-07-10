// Human-readable labels for handy-keys binding strings (U2).
// Mirrors src-tauri/src/tray.rs::hotkey_label.

const SYMBOLS: Record<string, string> = {
  command: "⌘",
  super: "⌘",
  meta: "⌘",
  option: "⌥",
  alt: "⌥",
  ctrl: "⌃",
  control: "⌃",
  shift: "⇧",
  escape: "Esc",
  esc: "Esc",
  space: "Space",
};

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

export function formatHotkey(binding: string): string {
  if (!binding) return "";
  return binding
    .split("+")
    .map((part) => {
      let side = "";
      let base = part;
      if (part.endsWith("_right")) {
        side = "Right ";
        base = part.slice(0, -"_right".length);
      } else if (part.endsWith("_left")) {
        side = "Left ";
        base = part.slice(0, -"_left".length);
      }
      const symbol = SYMBOLS[base] ?? capitalize(base);
      return `${side}${symbol}`;
    })
    .join(" ");
}
