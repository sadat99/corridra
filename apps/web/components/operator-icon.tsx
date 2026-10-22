import type { ReactNode } from 'react';

const drawings: Record<string, ReactNode> = {
  mission: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <path d="m12 12 8-8m-4 0h4v4" />
    </>
  ),
  company: (
    <>
      <path d="M5 21V5l10-2v18M3 21h18M15 10h4v11M8 7v2m4-3v3M8 12v2m4-2v2M9 21v-4h3v4" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-2-4" />
    </>
  ),
  progress: (
    <>
      <path d="M4 20v-5h3v5m4 0V9h3v11m4 0V4h3v16M3 10l6-5 4 1 7-4" />
    </>
  ),
  document: (
    <>
      <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7m-7 4h7M9 8h2" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M8 3v4m8-4v4M4 11h16" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 4-5 8-8 10-3-2-8-6-8-10V6zM9 12l2 2 4-5" />
    </>
  ),
  settings: (
    <>
      <path d="m9 3-1 3-3 1-2 4 2 2v4l4 2 3-1 3 1 4-2v-4l2-2-2-4-3-1-1-3z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18M5 7h14M5 17h14" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6" />
    </>
  ),
  network: (
    <>
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="m11 7-5 9m7-9 5 9M7 18h10" />
    </>
  ),
  spark: <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3h.01" />
    </>
  ),
  exit: (
    <>
      <path d="M10 4H4v16h6m-1-8h12m-4-4 4 4-4 4" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
};

/** Decorative only: the adjacent words are always the control's accessible name. */
export function OperatorIcon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <svg
      className={`operator-icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {drawings[name] ?? drawings.document}
    </svg>
  );
}
