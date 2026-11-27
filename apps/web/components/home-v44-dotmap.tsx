import { landDots } from '../lib/home-v44-land';

// Home page v4.4 dotted maps: the same world, framed per use, with route arcs from Bangladesh. Decorative: the route
// is always written in words beside it. The arcs draw once; the dot travelling along each arc and the pulse on each
// pin are stopped by Pause Motion and by reduced motion (home-v7.css).
type Spot = { x: number; y: number };
const spots = {
  BD: { x: 541, y: 113 },
  CN: { x: 568, y: 90 },
  AE: { x: 468, y: 112 },
  EU: { x: 380, y: 60 },
  UK: { x: 357, y: 54 },
  US: { x: 164, y: 82 },
  AU: { x: 628, y: 210 },
  SG: { x: 607, y: 157 },
} as const satisfies Record<string, Spot>;
export type SpotKey = keyof typeof spots;

function arc(to: Spot, lift: number) {
  const from = spots.BD;
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  return `M${from.x} ${from.y} Q${mx} ${Math.round(my - dist * lift)} ${to.x} ${to.y}`;
}

export function DotMap({
  view,
  routes = [],
  pins = [],
  fill = false,
  tones = {},
}: {
  /** x y width height on the 720 by 276 plane. */
  view: string;
  /** Places an arc runs to from Bangladesh. */
  routes?: readonly SpotKey[];
  /** Places that get a pin; Bangladesh always does. */
  pins?: readonly SpotKey[];
  /** Cover the box instead of fitting inside it. */
  fill?: boolean;
  /** A tone per place: open, soon, ask. */
  tones?: Partial<Record<SpotKey, 'open' | 'soon' | 'ask'>>;
}) {
  // Marks keep the same size on screen whatever the zoom of the frame.
  const k = Math.min(1, Math.max(0.4, Number(view.split(' ')[2]) / 560));
  const all = Array.from(new Set<SpotKey>([...routes, ...pins]));
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
        const d = arc(spots[key], key === 'CN' ? 0.9 : key === 'US' ? 0.45 : 0.5);
        return (
          <g key={key}>
            <path
              className="hv7-arc"
              pathLength={1}
              strokeWidth={1.8 * k}
              d={d}
              style={{ animationDelay: `${index * 0.45}s` }}
            />
            <circle className="hv7-travel" r={3 * k}>
              <animateMotion
                dur="3.6s"
                begin={`${index * 0.45 + 1.2}s`}
                repeatCount="indefinite"
                path={d}
              />
            </circle>
          </g>
        );
      })}
      {all.map((key) => (
        <g key={key} className="hv7-pin" data-tone={tones[key]}>
          <circle className="hv7-pin-dot" cx={spots[key].x} cy={spots[key].y} r={5 * k} />
          <circle className="hv7-pulse" cx={spots[key].x} cy={spots[key].y} r={5 * k} strokeWidth={1.5 * k} />
        </g>
      ))}
      <g className="hv7-pin hv7-pin-home">
        <circle className="hv7-pin-dot" cx={spots.BD.x} cy={spots.BD.y} r={7 * k} />
        <circle className="hv7-pulse" cx={spots.BD.x} cy={spots.BD.y} r={7 * k} strokeWidth={1.5 * k} />
      </g>
    </svg>
  );
}
