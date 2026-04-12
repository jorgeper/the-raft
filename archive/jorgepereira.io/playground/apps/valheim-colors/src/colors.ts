const NAMED_COLORS: Record<string, string> = {
  yellow: "#faff00",
  red: "#ff3c3c",
  green: "#00cc00",
  white: "#ffffff",
  grey: "#999999",
  blue: "#4488ff",
};

/** Extract the display color from a Valheim color code string.
 *  Supports `<#RRGGBB>` hex codes and `<color=name>` named colors. */
export function parseColor(code: string): string | null {
  const hexMatch = code.match(/<#([0-9a-fA-F]{6})>/);
  if (hexMatch) return "#" + hexMatch[1];

  const namedMatch = code.match(/<color=([a-zA-Z]+)>/i);
  if (namedMatch) return NAMED_COLORS[namedMatch[1].toLowerCase()] ?? null;

  return null;
}

/** Replace the color tag in a Valheim code string with a new hex color.
 *  If no color tag exists, prepends one. */
export function replaceColor(code: string, hexColor: string): string {
  const hex = hexColor.replace("#", "").toUpperCase();
  const tag = `<#${hex}>`;

  // Replace existing <#RRGGBB>
  if (/<#[0-9a-fA-F]{6}>/.test(code)) {
    return code.replace(/<#[0-9a-fA-F]{6}>/, tag);
  }

  // Replace existing <color=name>
  if (/<color=[a-zA-Z]+>/i.test(code)) {
    return code.replace(/<color=[a-zA-Z]+>/i, tag);
  }

  // No existing tag — prepend
  return tag + code;
}
