import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

/* A dropdown menu: a button that opens a short list of actions (the profile menu, a
 * table row's "⋯"). Follows the WAI-ARIA menu button pattern: Enter/Space/↓ open it on
 * the first item, ↑/↓/Home/End move, Escape closes and returns focus, Tab or a click
 * elsewhere closes it.
 *
 * The list is positioned against the viewport (fixed), so a table's scroll container
 * can't clip it; it closes on scroll or resize rather than drift away from its button.
 */

export interface MenuItem {
  label: string;
  icon?: string;
  onSelect: () => void;
  /** a destructive action, shown in red */
  danger?: boolean;
  /** draw a separator above this item */
  separated?: boolean;
  /** a small heading above this item, starting a group (e.g. "Theme") */
  section?: string;
  /** one of a set of choices: shown with a tick when chosen */
  checked?: boolean;
}

export function Menu({ label, trigger, triggerClassName = 'btn btn-ghost btn-icon', header, items, width = 220 }: {
  /** what the button does, for screen readers ("Account", "Actions for <participant name>") */
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  /** shown above the items, e.g. who is signed in */
  header?: ReactNode;
  items: MenuItem[];
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  /* Under the button, right edges aligned, kept inside the window. */
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    setPlace({ top: r.bottom + 6, left });
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const away = (e: PointerEvent) => {
      if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    const gone = () => setOpen(false);
    document.addEventListener('pointerdown', away);
    window.addEventListener('scroll', gone, true);
    window.addEventListener('resize', gone);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('scroll', gone, true);
      window.removeEventListener('resize', gone);
    };
  }, [open, place]);

  const onListKey = (e: KeyboardEvent) => {
    const els = [...(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); els[(n + els.length) % els.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(els.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <>
      <button
        ref={button} type="button" className={triggerClassName} aria-label={label} title={label}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
      >
        {trigger}
      </button>
      {open && place && (
        <div
          ref={list} id={id} role="menu" aria-label={label} className="menu" style={{ top: place.top, left: place.left, width }}
          onKeyDown={onListKey} onClick={(e) => e.stopPropagation()}
        >
          {header && <div className="menu-header">{header}</div>}
          {items.map((it) => (
            <div key={it.label} role="none">
              {it.separated && <div className="menu-sep" role="separator" />}
              {it.section && <div className="menu-section" role="presentation">{it.section}</div>}
              <button
                type="button" role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={it.checked === undefined ? undefined : it.checked}
                tabIndex={-1} className={`menu-item${it.danger ? ' danger' : ''}`}
                onClick={() => { close(false); it.onSelect(); }}
              >
                {it.icon && <Icon name={it.icon} size={16} />}
                <span className="menu-label">{it.label}</span>
                {it.checked && <span className="menu-check"><Icon name="check" size={16} /></span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
