/** Circle avatar: photo when available, initials on accent-tint otherwise. */
export default function Avatar({ name, src, size = 40 }: { name: string; src: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return src ? (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      className="rounded-full border border-line object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden
      className="flex items-center justify-center rounded-full border border-line bg-accent-tint font-semibold text-accent-deep"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || '?'}
    </span>
  );
}
