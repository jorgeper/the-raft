const MAX_NAME_CHARS = 120;
const MAX_EXT_CHARS = 20;
const INVISIBLE = new RegExp("[\\p{Cc}\\p{Cf}\\u2028\\u2029]", "u");

/** Mirrors Rust `sanitize_filename` (commands.rs): control and format characters
 * removed, `/ \\ :` become `_` (the name survives, no path component is dropped),
 * no leading dot, bounded length that keeps a short extension. */
export function safeFilename(name: string | null | undefined): string {
  const cleaned = Array.from(name ?? "")
    .filter((c) => !INVISIBLE.test(c))
    .map((c) => (c === "/" || c === "\\" || c === ":" ? "_" : c))
    .join("")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  if (!cleaned) return "attachment";
  const chars = Array.from(cleaned);
  if (chars.length <= MAX_NAME_CHARS) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  if (dot > 0) {
    const stem = Array.from(cleaned.slice(0, dot));
    const ext = cleaned.slice(dot);
    const extLen = Array.from(ext).length;
    if (extLen <= MAX_EXT_CHARS) return stem.slice(0, MAX_NAME_CHARS - extLen).join("") + ext;
  }
  return chars.slice(0, MAX_NAME_CHARS).join("");
}
