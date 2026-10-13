import { useEffect, useRef, type ReactNode } from 'react';

/* A modal on the native <dialog> element: focus trapping, Escape and the
   backdrop come from the browser. */
export function Dialog({ open, onClose, labelledBy, children }: {
  open: boolean; onClose: () => void; labelledBy: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={labelledBy}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
    >
      {open && children}
    </dialog>
  );
}
