'use client';

import type { ReactNode } from 'react';
import './open-card.css';

// An outlined card that opens a part of the same page (board 3c, the pick section's closing row). It is a button, not a
// link and not a primary action: it changes what the page shows. Its title and line are its accessible name.
export function OpenCard({
  title,
  text,
  onOpen,
  className,
}: {
  title: ReactNode;
  text?: ReactNode;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={['ux-open-card', className ?? ''].join(' ').trim()}
      onClick={onOpen}
    >
      <strong>{title}</strong>
      {text ? <span>{text}</span> : null}
    </button>
  );
}

// A quiet text button for a line of in-page choices (same look as a quiet link, but it changes the page, not the URL).
export function QuietButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="ux-quiet-button" onClick={onClick}>
      {children}
    </button>
  );
}
