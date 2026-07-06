import { useEffect, type ReactNode } from 'react';

/** Centered dialog on a dimmed backdrop; closes on backdrop click / Escape. */
export default function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center sm:items-center"
      style={{ background: 'var(--backdrop)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={title}
        className="max-h-[85dvh] w-full max-w-md overflow-auto rounded-t-panel border border-line bg-page p-4 shadow-modal sm:rounded-panel"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-[15px] font-[650] text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-ctl bg-surface3 px-3 py-1 text-[12px] text-ink2 hover:bg-baseline"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
