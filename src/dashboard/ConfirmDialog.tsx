import type { ReactNode } from 'react';

import { useEffect, useId, useRef } from 'react';

interface Props {
  children: ReactNode;
  confirmLabel: string;
  icon?: ReactNode;
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/** A modal question on the native `<dialog>`, which traps focus and cancels on Escape. */
export function ConfirmDialog({ children, confirmLabel, icon, onCancel, onConfirm, open, title }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog)
      return;
    if (open && !dialog.open)
      dialog.showModal();
    else if (!open && dialog.open)
      dialog.close();
  }, [open]);

  return (
    <dialog
      aria-describedby={bodyId}
      aria-labelledby={titleId}
      className="confirm-dialog"
      onCancel={(e) => {
        // React closes it through `open`, so the state and the element never disagree.
        e.preventDefault();
        onCancel();
      }}
      ref={ref}
    >
      <h2 className="confirm-dialog-title" id={titleId}>
        {icon}
        {title}
      </h2>
      <div className="confirm-dialog-body" id={bodyId}>{children}</div>
      <div className="confirm-dialog-actions">
        <button onClick={onCancel} type="button">Cancel</button>
        <button className="primary" onClick={onConfirm} type="button">{confirmLabel}</button>
      </div>
    </dialog>
  );
}
