import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './Icon';

/* A destructive button that acts only after being held down for `ms` (mouse, touch,
   or Space/Enter): releasing early cancels. Used where a confirm dialog is too easy
   to click through, e.g. erasing a patch. The fill shows how long is left. */
export function HoldButton({ ms = 2000, icon, label, holdingText = 'Keep holding…', disabled, onConfirm, children }: {
  ms?: number; icon?: string; label: string; holdingText?: string; disabled?: boolean;
  onConfirm: () => void; children: ReactNode;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const confirm = useRef(onConfirm);
  confirm.current = onConfirm;

  const cancel = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  };
  const start = () => {
    if (disabled || timer.current !== undefined) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      setHolding(false);
      confirm.current();
    }, ms);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const isKey = (key: string) => key === ' ' || key === 'Enter';
  return (
    <button
      type="button"
      className={`btn btn-danger hold-btn${holding ? ' holding' : ''}`}
      style={{ '--hold-ms': `${ms}ms` } as CSSProperties}
      disabled={disabled}
      aria-label={label}
      /* Capture keeps the hold on this button even as its label changes width; moving
         off it, or letting go, cancels. */
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(e) => { if (isKey(e.key)) { e.preventDefault(); if (!e.repeat) start(); } }}
      onKeyUp={(e) => { if (isKey(e.key)) cancel(); }}
      onBlur={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="hold-fill" aria-hidden />
      {icon && <Icon name={icon} size={16} />}
      <span aria-live="polite">{holding ? holdingText : children}</span>
    </button>
  );
}
