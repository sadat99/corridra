'use client';
// A closed disclosure with a count in its summary, for the signed-in customer pages' page budget
// (docs/revamp/specs/layout-budget.md). The content stays mounted while closed, so a draft typed in it
// survives closing. It opens on its own when `open` is true (a result the person is waiting for) or when the
// address hash names it or something inside it, so every old #id link still lands on what it points at.
import './page-budget.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Fold({
  summary,
  open = false,
  anchor,
  className,
  children,
}: {
  summary: ReactNode;
  /** Forces the disclosure open (and keeps it open while true). */
  open?: boolean;
  /** An element id that opens the disclosure when the address hash names it. */
  anchor?: string;
  className?: string;
  children: ReactNode;
}) {
  const [manual, setManual] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const check = () => {
      const word = decodeURIComponent(window.location.hash.slice(1));
      if (!word) return;
      const target = document.getElementById(word);
      if ((anchor && word === anchor) || (target && ref.current?.contains(target))) {
        setManual(true);
        // The target is drawn once the panel is open.
        requestAnimationFrame(() => target?.scrollIntoView());
      }
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [anchor]);
  return (
    <details
      ref={ref}
      className={className ? `account-fold ${className}` : 'account-fold'}
      open={open || manual}
      onToggle={(event) => setManual(event.currentTarget.open)}
    >
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
