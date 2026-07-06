import { useEffect, useState } from 'react';

function parse(text: string, integer: boolean): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  if (integer && !Number.isInteger(n)) return null;
  return n;
}

/**
 * Numeric input that tolerates an empty field while editing — the original
 * app coerced every keystroke with `parseFloat(value) || 0`, so clearing a
 * field instantly wrote 0 (SPEC §7 bug #6). Here the last valid value is
 * kept until a new valid one is typed; blur normalizes the text.
 */
export default function NumberField({
  value,
  onChange,
  integer = false,
  ariaLabel,
  className = '',
}: {
  value: number;
  onChange: (n: number) => void;
  integer?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  return (
    <input
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      aria-label={ariaLabel}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setText(e.target.value);
        const n = parse(e.target.value, integer);
        if (n !== null && n !== value) onChange(n);
      }}
      onBlur={() => {
        setFocused(false);
        const n = parse(text, integer);
        if (n === null) {
          setText(String(value));
        } else {
          setText(String(n));
          if (n !== value) onChange(n);
        }
      }}
      className={
        'tnum w-16 rounded-ctl border border-line bg-surface2 px-2 py-1.5 text-center text-ink ' + className
      }
    />
  );
}
