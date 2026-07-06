/** Date + formatting helpers shared across screens. */

export function toDateStr(d: Date): string {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

export function todayStr(): string {
  return toDateStr(new Date());
}

export function shiftDateStr(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + deltaDays);
  return toDateStr(d);
}

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

export function formatTimerMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  return (
    String(hours).padStart(2, '0') + ':' + String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0')
  );
}

let idCounter = 0;
export function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}
