'use client';
// The overflow menu (customer experience spec, shared components): a button that opens a menu. The button
// has aria-haspopup and aria-expanded; the menu has role menu and its rows are menuitem or menuitemradio.
// Enter, Space and the arrow keys open it and move through it, Home and End jump, Escape closes it and puts
// focus back on the button, Tab and a click outside close it, and choosing a link closes it.
import Link from 'next/link';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import './overflow-menu.css';

const rows = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

export function OverflowMenu({
  label,
  trigger,
  children,
  className = '',
  align = 'end',
}: {
  /** The accessible name of the button and of the menu. */
  label: string;
  /** What the button shows: an icon, or an icon with a short word. Never the only name. */
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const panelId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-menu`;
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusFirst = useRef(false);

  const items = () =>
    [...(panel.current?.querySelectorAll<HTMLElement>(rows) ?? [])].filter(
      (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
    );

  useEffect(() => {
    if (!open) return;
    if (focusFirst.current) {
      items()[0]?.focus();
      focusFirst.current = false;
    }
    function outside(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
      return;
    }
    const onButton = event.target === button.current;
    if (onButton && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      focusFirst.current = true;
      setOpen(true);
      return;
    }
    if (!open || onButton) return;
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const go = (next: number) => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    if (event.key === 'ArrowDown') go(index + 1);
    else if (event.key === 'ArrowUp') go(index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(list.length - 1);
    else if (event.key === 'Tab') setOpen(false);
  }

  return (
    <div
      className={`ux-menu ${className}`.trim()}
      data-align={align}
      ref={wrapper}
      onKeyDown={onKeyDown}
    >
      <button
        ref={button}
        type="button"
        className="ux-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        onClick={() => {
          focusFirst.current = !open;
          setOpen((value) => !value);
        }}
      >
        {trigger}
      </button>
      <div
        id={panelId}
        ref={panel}
        role="menu"
        aria-label={label}
        className="ux-menu-panel"
        hidden={!open}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a[href], [data-menu-close]')) setOpen(false);
        }}
      >
        {open ? children : null}
      </div>
    </div>
  );
}

export function MenuLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link prefetch={false} role="menuitem" tabIndex={-1} className="ux-menu-row" href={href}>
      {children}
    </Link>
  );
}

export function MenuButton({
  children,
  ...rest
}: { children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'role' | 'type'>) {
  return (
    <button type="button" role="menuitem" tabIndex={-1} className="ux-menu-row" {...rest}>
      {children}
    </button>
  );
}

export function MenuRadio({
  checked,
  children,
  ...rest
}: { checked: boolean; children: ReactNode } & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'role' | 'type'
>) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      className="ux-menu-row"
      {...rest}
    >
      {children}
    </button>
  );
}
