import Modal from './Modal';

interface Props {
  title: string;
  body: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ title, body, confirmLabel, busy, onConfirm, onCancel }: Props) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="mb-5 text-ink-muted">{body}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-12 flex-1 rounded-pill border border-line font-medium text-ink transition-colors hover:bg-sunken"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="min-h-12 flex-1 rounded-pill bg-negative font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'Removing…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
