/** The Bucko coin — Buckos' signature mark, used in the wordmark, balances
 * and the add-Buckos celebration. */
export default function Coin({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="24" cy="24" r="22" fill="var(--accent)" />
      <circle cx="24" cy="24" r="17.5" fill="none" stroke="var(--accent-ink)" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="2.6 3.4" strokeLinecap="round" />
      <text
        x="24"
        y="25"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--accent-ink)"
        fontFamily="var(--font-display)"
        fontWeight="700"
        fontSize="21"
      >
        Ƀ
      </text>
    </svg>
  );
}
