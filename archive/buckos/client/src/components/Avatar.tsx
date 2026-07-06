const PALETTE = [
  { bg: '#f7e8e1', fg: '#a2543a' }, // terracotta
  { bg: '#e9f0e6', fg: '#4f7a4f' }, // sage
  { bg: '#eae7f3', fg: '#5d5488' }, // lavender
  { bg: '#f5ecd9', fg: '#8a6b2f' }, // honey
  { bg: '#e3edf0', fg: '#3f6b78' }, // river
];

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function hue(name: string): (typeof PALETTE)[number] {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return PALETTE[h % PALETTE.length];
}

export default function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const c = hue(name);
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full font-body font-semibold select-none"
      style={{ width: size, height: size, background: c.bg, color: c.fg, fontSize: size * 0.4 }}
    >
      {initials(name)}
    </span>
  );
}
