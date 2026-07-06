import { useEffect, useMemo, useState } from 'react';
import Coin from './Coin';

/**
 * A brief burst of Bucko coins from the center of the screen, shown when a
 * kid earns Buckos. Removes itself when the animation ends.
 */
export default function Celebration({ onDone }: { onDone: () => void }) {
  const [live, setLive] = useState(true);

  const coins = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.5;
        const distance = 90 + Math.random() * 110;
        return {
          id: i,
          x: `${Math.cos(angle) * distance}px`,
          y: `${Math.sin(angle) * distance - 40}px`,
          spin: `${Math.random() * 540 - 270}deg`,
          size: 16 + Math.round(Math.random() * 14),
          delay: `${Math.random() * 90}ms`,
        };
      }),
    []
  );

  useEffect(() => {
    const t = setTimeout(() => {
      setLive(false);
      onDone();
    }, 900);
    return () => clearTimeout(t);
  }, [onDone]);

  if (!live) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      {coins.map((c) => (
        <span
          key={c.id}
          className="absolute animate-[coin-burst_0.8s_ease-out_forwards]"
          style={
            {
              '--burst-x': c.x,
              '--burst-y': c.y,
              '--burst-spin': c.spin,
              animationDelay: c.delay,
            } as React.CSSProperties
          }
        >
          <Coin size={c.size} />
        </span>
      ))}
    </div>
  );
}
