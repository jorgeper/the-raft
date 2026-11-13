/**
 * SPEC §4.2 — the whole retro look draws from this single palette
 * (≤ 24 unique colors). U6 scans src/render/*.ts and fails the build if any
 * material color lives outside this file.
 */
export const PALETTE = {
  skyTop: '#3d9be9',
  skyBottom: '#bfe8ff',
  white: '#ffffff',
  sun: '#ffd93b',
  grass: '#63c74d',
  grassDark: '#3f9b4f',
  dirt: '#c98f5a',
  dirtDark: '#a9713f',
  wallGreen: '#2e7d4f',
  stand: '#9aa5b1',
  standDark: '#6b7683',
  skin: '#ffcf9e',
  red: '#e04a3a',
  blue: '#3a6fe0',
  cream: '#f2f2f2',
  wood: '#d9a066',
  pink: '#ff8fab',
  yellow: '#ffe066',
  teal: '#7ae0d8',
  purple: '#9b5de5',
  dark: '#243040',
} as const;

export type PaletteColor = keyof typeof PALETTE;
