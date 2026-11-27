import { landDots } from '../lib/home-v44-land';

// Home page v7 dotted maps (canvas "Home v7"): one world, framed per use, with route arcs from Bangladesh and the place
// names written on the map. Decorative: the route is always written in words beside it. The arcs draw once; the dot
// travelling along each arc and the pulse on each pin are stopped by Pause Motion and by reduced motion (home-v7.css).
// Coordinates are on the 720 by 276 plane of lib/home-v44-land.ts. Nothing here is scaled: sizes match the canvas.
type Spot = { x: number; y: number; name: string; lx: number; ly: number; cx: number; cy: number };
const spots = {
  BD: { x: 541, y: 113, name: 'Bangladesh', lx: 541, ly: 135, cx: 541, cy: 113 },
  CN: { x: 568, y: 90, name: 'China', lx: 568, ly: 76, cx: 554.5, cy: 70 },
  AE: { x: 468, y: 112, name: 'UAE', lx: 468, ly: 134, cx: 504.5, cy: 76 },
  EU: { x: 380, y: 60, name: 'Europe', lx: 380, ly: 46, cx: 460.5, cy: -7 },
  UK: { x: 357, y: 54, name: 'UK', lx: 357, ly: 40, cx: 449, cy: -13 },
  US: { x: 164, y: 82, name: 'United States', lx: 164, ly: 68, cx: 352.5, cy: -73 },
  AU: { x: 628, y: 210, name: 'Australia', lx: 628, ly: 232, cx: 584.5, cy: 116 },
  SG: { x: 607, y: 157, name: 'Singapore', lx: 607, ly: 143, cx: 574, cy: 95 },
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
      {marks.map((key) => {
        if (key === 'BD') return null;
        const tone = tones[key];
        const color = tone ? toneFill[tone] : undefined;
        return (
          <g key={key} className="hv7-pin">
            <circle className="hv7-pin-dot" cx={spots[key].x} cy={spots[key].y} r={5} style={color ? { fill: color } : undefined} />
            <circle className="hv7-pulse" cx={spots[key].x} cy={spots[key].y} r={5} style={color ? { stroke: color } : undefined} />
          </g>
        );
      })}
      <g className="hv7-pin hv7-pin-home">
        <circle className="hv7-pin-dot" cx={bd.x} cy={bd.y} r={alone ? 7 : 6} />
        <circle className="hv7-pulse" cx={bd.x} cy={bd.y} r={alone ? 7 : 6} />
      </g>
      {(Object.keys(labels) as SpotKey[]).map((key) => (
        <text
          key={key}
          className="hv7-label"
          x={spots[key].lx}
          y={labels[key]?.y ?? spots[key].ly}
          textAnchor="middle"
        >
          {labels[key]?.name ?? spots[key].name}
        </text>
      ))}
    </svg>
  );
}
