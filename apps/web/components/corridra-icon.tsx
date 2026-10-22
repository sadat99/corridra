/**
 * Corridra Meridian line icons (AC/1, owner decision 22 October 2026).
 * One owned family: 20 px grid, 1.5 px stroke (`--icon-stroke`), square ends, mitred joins,
 * right-angle routes and square nodes. Decorative only: the adjacent words are always the
 * control's accessible name, so every icon is aria-hidden.
 */
export const iconPaths = {
  // Customer navigation
  home: 'M3 9.5 10 4l7 5.5M5 8.5V16h10V8.5M8.5 16v-4h3v4',
  work: 'M3 7h14v9H3zM7.5 7V4.5h5V7M3 11h14',
  company: 'M4 16V4h7v12M11 8h5v8M2.5 16h15M6.5 7h2M6.5 10h2M6.5 13h2',
  progress: 'M3 16h14M5 16v-4M9 16V8M13 16V5',
  more: 'M4 9h2v2H4zM9 9h2v2H9zM14 9h2v2h-2z',
  // Three commercial starts
  sell: 'M3 10h8v6H3zM9.5 4H16v6.5M16 4l-6.5 6.5',
  buy: 'M3 16V9.5l4 2.5V9.5l4 2.5V4.5h4V16M2.5 16h15',
  trip: 'M4.5 17V3M4.5 4h10l-2.5 3.5 2.5 3.5h-10',
  // The five fixed trust states
  selfDeclared: 'M3 4h14v9H9l-4 3v-3H3z',
  evidence: 'M5 3h7l3 3v11H5zM12 3v3h3M7.5 10h5M7.5 13h5',
  verified: 'M3.5 3.5h13v13h-13zM7 10l2 2 4-4',
  derived: 'M3 15l4-4 3 3 6-7M12 7h4v4',
  outcome: 'M5 17V3M5 4h10l-10 6.5',
  // Operator and shared
  mission: 'M3 14h3v3H3zM14 3h3v3h-3zM6 15.5h3.5v-11H14',
  people:
    'M3 16.5v-1a4 4 0 0 1 8 0v1M7 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 1 0 0 5M12.5 4.2a2.5 2.5 0 0 1 0 4.6M13 11.6a4 4 0 0 1 4 3.9v1',
  document: 'M5 3h7l3 3v11H5zM12 3v3h3',
  calendar: 'M3 5h14v12H3zM3 8.5h14M7 3v4M13 3v4M6 12h2M10 12h2',
  clock: 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13M10 6.5V10l2.5 1.5',
  shield: 'M4 4h12v6c0 3.5-3 5.5-6 7-3-1.5-6-3.5-6-7zM7.5 10l2 2 3.5-4',
  settings: 'M3 6h6M13 6h4M3 14h2M9 14h8M11 4v4M7 12v4',
  grid: 'M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z',
  globe:
    'M10 3a7 7 0 1 0 0 14 7 7 0 1 0 0-14M10 3c-2.5 2-3.5 4.5-3.5 7s1 5 3.5 7M10 3c2.5 2 3.5 4.5 3.5 7s-1 5-3.5 7M3 10h14',
  search: 'M8.5 3.5a5 5 0 1 0 0 10 5 5 0 1 0 0-10M12.5 12.5 17 17',
  network: 'M9 2.5h2v2H9zM3 15h2v2H3zM15 15h2v2h-2zM10 4.5v5M10 9.5 4.5 15M10 9.5l5.5 5.5',
  // AI assistance is a reviewable draft, drawn as a pen; never a sparkle.
  draft: 'M4 16l1-4 7.5-7.5 3 3L8 15zM10.5 6.5l3 3',
  lock: 'M4.5 9h11v8h-11zM7 9V6.5a3 3 0 0 1 6 0V9M10 12v2',
  help: 'M3.5 3.5h13v13h-13zM8 8a2 2 0 1 1 2.8 1.8c-.5.3-.8.6-.8 1.2v1M10 14v.5',
  listen: 'M3 8h3l4-3v10l-4-3H3zM13 7.5a3.5 3.5 0 0 1 0 5M15.5 5a7 7 0 0 1 0 10',
  stop: 'M6 6h8v8H6z',
  exit: 'M8.5 4H4v12h4.5M8 10h9M14 7l3 3-3 3',
  refresh: 'M16 10a6 6 0 1 1-1.8-4.3M16 3.5V7h-3.5',
  check: 'M4.5 10.5 8 14l7.5-8',
  arrow: 'M3.5 10h13M12 5.5l4.5 4.5-4.5 4.5',
  open: 'M6 14 14 6M7.5 6H14v6.5',
  chevron: 'M8 5l5 5-5 5',
} as const;

export type IconName = keyof typeof iconPaths;

/** Earlier names kept so existing callers and navigation maps keep working. */
const aliases: Record<string, IconName> = {
  spark: 'draft',
  results: 'progress',
  companies: 'company',
};

export function resolveIcon(name: string): IconName {
  if (name in iconPaths) return name as IconName;
  return aliases[name] ?? 'document';
}

export function CorridraIcon({
  name,
  className = '',
  size,
}: {
  name: string;
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={`corridra-icon ${className}`.trim()}
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
    >
      <path d={iconPaths[resolveIcon(name)]} />
    </svg>
  );
}
