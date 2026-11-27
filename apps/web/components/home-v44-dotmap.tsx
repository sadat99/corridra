import type { ReactNode } from 'react';
import { landDots } from '../lib/home-v44-land';

// Home page v7 dotted maps (canvas boards "Home v7" and "Home v9"): one world, framed per use, with route arcs from
// Bangladesh (or towards it when `inbound`) and the place names written on the map. With `flags` every pin is the
// place's own round flag (home-v7-flags.tsx). Decorative: the route is always written in words beside it. The arcs
// draw once; the dot travelling along each arc and the pulse on each pin are stopped by Pause Motion and by reduced
// motion (home-v7.css). Coordinates are on the 720 by 276 plane of lib/home-v44-land.ts; sizes match the canvas.
type Spot = {
  x: number;
  y: number;
  name: string;
  flag: string;
  lx: number;
  ly: number;
  /** Where the name sits when pins are flags: offset from the pin and which side it grows to. */
  f: readonly [number, number, 'start' | 'middle' | 'end'];
  cx: number;
  cy: number;
};
const spots = {
  BD: { x: 541, y: 113, name: 'Bangladesh', flag: 'bd', lx: 541, ly: 135, f: [-17, 5, 'end'], cx: 541, cy: 113 },
  CN: { x: 568, y: 90, name: 'China', flag: 'cn', lx: 568, ly: 76, f: [0, -14, 'middle'], cx: 554.5, cy: 70 },
  GZ: { x: 586, y: 114, name: 'Guangzhou', flag: 'cn', lx: 586, ly: 131, f: [0, 18, 'middle'], cx: 560, cy: 100 },
  AE: { x: 468, y: 112, name: 'UAE', flag: 'ae', lx: 468, ly: 134, f: [0, 19, 'middle'], cx: 504.5, cy: 76 },
  EU: { x: 386, y: 62, name: 'Europe', flag: 'eu', lx: 380, ly: 46, f: [13, 5, 'start'], cx: 460.5, cy: -7 },
  UK: { x: 350, y: 50, name: 'UK', flag: 'uk', lx: 357, ly: 40, f: [-13, 5, 'end'], cx: 449, cy: -13 },
  US: { x: 164, y: 82, name: 'United States', flag: 'us', lx: 164, ly: 68, f: [0, -14, 'middle'], cx: 352.5, cy: -73 },
  AU: { x: 628, y: 210, name: 'Australia', flag: 'au', lx: 628, ly: 232, f: [0, 19, 'middle'], cx: 584.5, cy: 116 },
  SG: { x: 607, y: 157, name: 'Singapore', flag: 'sg', lx: 607, ly: 143, f: [0, -14, 'middle'], cx: 574, cy: 95 },
} as const satisfies Record<string, Spot>;
export type SpotKey = keyof typeof spots;
export type Tone = 'open' | 'soon' | 'ask';
type Label = { name?: string; y?: number };

const toneFill: Record<Tone, string> = {
  open: 'var(--cv-green)',
  soon: 'var(--cv-gold)',
  ask: 'var(--cv-grey)',
};

export function DotMap({
  view,
  routes = [],
  pins = [],
  labels = {},
  tones = {},
  fill = false,
  inbound = false,
  flags = false,
  extra = null,
}: {
  /** x y width height on the 720 by 276 plane. */
  view: string;
  /** Places an arc runs to from Bangladesh (or from the place to Bangladesh when inbound). */
  routes?: readonly SpotKey[];
  /** Places that get a pin without an arc; Bangladesh always does. */
  pins?: readonly SpotKey[];
  /** Places whose name is written on the map, each with an optional name or height of its own. */
  labels?: Partial<Record<SpotKey, Label>>;
  /** A colour per place, for the route statuses. */
  tones?: Partial<Record<SpotKey, Tone>>;
  /** Cover the box instead of fitting inside it. */
  fill?: boolean;
  /** Draw the arc towards Bangladesh. */
  inbound?: boolean;
  /** Every pin is the place's round flag. */
  flags?: boolean;
  /** Extra marks drawn under the pins (tags, dots). */
  extra?: ReactNode;
}) {
  const bd = spots.BD;
  const marks = Array.from(new Set<SpotKey>([...routes, ...pins]));
  const alone = routes.length === 0 && pins.length === 0;
  const pathTo = (key: Exclude<SpotKey, 'BD'>) => {
    const s = spots[key];
    return inbound
      ? `M${s.x} ${s.y} Q${s.cx} ${s.cy} ${bd.x} ${bd.y}`
      : `M${bd.x} ${bd.y} Q${s.cx} ${s.cy} ${s.x} ${s.y}`;
  };
  const pin = (key: SpotKey, home: boolean) => {
    const s = spots[key];
    const tone = tones[key];
    const color = tone ? toneFill[tone] : undefined;
    const radius = home ? (flags || alone ? (flags ? 10.5 : 7) : 6) : flags ? 8.2 : 5;
    const size = home ? 18 : 14;
    return (
      <g key={key} className={home ? 'hv7-pin hv7-pin-home' : 'hv7-pin'}>
        <circle
          className={flags ? 'hv7-pulse hv7-pulse-f' : 'hv7-pulse'}
          cx={s.x}
          cy={s.y}
          r={radius}
          style={color ? { stroke: color } : undefined}
        />
        {flags ? (
          <>
            <circle className="hv7-flag-ring" cx={s.x} cy={s.y} r={radius} />
            <use
              href={`#hv7-fl-${s.flag}`}
              x={s.x - size / 2}
              y={s.y - size / 2}
              width={size}
              height={size}
            />
          </>
        ) : (
          <circle
            className="hv7-pin-dot"
            cx={s.x}
            cy={s.y}
            r={radius}
            style={color ? { fill: color } : undefined}
          />
        )}
      </g>
    );
  };
  return (
    <svg
      className="hv7-dotmap"
      viewBox={view}
      preserveAspectRatio={fill ? 'xMidYMid slice' : 'xMidYMid meet'}
      aria-hidden="true"
      focusable="false"
    >
      <path className="hv7-land" d={landDots} />
      {routes.map((key, index) => {
        if (key === 'BD') return null;
        const d = pathTo(key);
        return (
          <g key={key}>
            <path
              className="hv7-arc"
              pathLength={1}
              d={d}
              style={{ animationDelay: `${index * 0.3}s` }}
            />
            <circle className="hv7-travel" r={3}>
              <animateMotion dur="3.4s" begin={`${1.2 + index * 0.3}s`} repeatCount="indefinite" path={d} />
            </circle>
          </g>
        );
      })}
      {extra}
      {marks.map((key) => (key === 'BD' ? null : pin(key, false)))}
      {pin('BD', true)}
      {(Object.keys(labels) as SpotKey[]).map((key) => {
        const s = spots[key];
        const [dx, dy, anchor] = s.f;
        return (
          <text
            key={key}
            className="hv7-label"
            x={flags ? s.x + dx : s.lx}
            y={labels[key]?.y ?? (flags ? s.y + dy : s.ly)}
            textAnchor={flags ? anchor : 'middle'}
          >
            {labels[key]?.name ?? s.name}
          </text>
        );
      })}
    </svg>
  );
}
