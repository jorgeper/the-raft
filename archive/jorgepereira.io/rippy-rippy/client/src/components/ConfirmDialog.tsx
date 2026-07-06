import Modal from './Modal';

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-[12.8px] text-ink2">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-ctl bg-surface3 px-4 py-2 text-[12.5px] font-[550] text-ink2"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-ctl px-4 py-2 text-[12.5px] font-[550] text-page"
          style={{ background: 'var(--crit)' }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
