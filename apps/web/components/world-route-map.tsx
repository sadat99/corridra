import type { world as WorldData } from './world-geography';

/** The 27 EU member states. The EU is a trade bloc, so it is shown as its members. */
export const euMembers = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
] as const;

type World = typeof WorldData;

function members(code: string) {
  return code === 'EU' ? (euMembers as readonly string[]) : [code];
}
function pointOf(world: World, code: string): [number, number] | null {
  // The bloc is drawn to Belgium, where its institutions sit.
  const key = code === 'EU' ? 'BE' : code;
  return world.countries[key]?.c ?? world.points[key] ?? null;
}
function arc(from: [number, number], to: [number, number]) {
  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  let nx = -dy / length;
  let ny = dx / length;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const lift = length * 0.25;
  return `M${from[0]} ${from[1]}Q${Math.round(mx + nx * lift)} ${Math.round(my + ny * lift)} ${to[0]} ${to[1]}`;
}

/**
 * Any two places on the world map. Shape and point data cover every supported country. The arc is
 * a commercial direction only, never a shipment route or a promise of coverage.
 */
export function WorldRouteMap({
  world,
  from,
  to,
  names,
}: {
  world: World;
  from: string;
  to: string;
  names: { from: string; to: string };
}) {
  const fromSet = new Set(members(from));
  const toSet = new Set(members(to));
  const a = pointOf(world, from);
  const b = pointOf(world, to);
  return (
    <svg
      viewBox={world.viewBox}
      aria-hidden="true"
      className="ux-atlas-map ux-atlas-map-world"
      focusable="false"
    >
      <defs>
        <marker
          id="world-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M1 1L9 5L1 9z" className="ux-map-arrowhead" />
        </marker>
      </defs>
      {Object.entries(world.countries).map(([code, country]) => (
        <path
          key={code}
          d={country.d}
          className={
            fromSet.has(code) ? 'ux-map-from' : toSet.has(code) ? 'ux-map-to' : 'ux-map-land'
          }
        />
      ))}
      {[...toSet]
        .filter((code) => !world.countries[code] && world.points[code])
        .map((code) => (
          <circle
            key={code}
            className="ux-map-to-point"
            cx={world.points[code][0]}
            cy={world.points[code][1]}
            r="2"
          />
        ))}
      {a && b && (
        <path
          className="ux-map-arc is-active ux-map-arc-world"
          d={arc(a, b)}
          markerEnd="url(#world-arrow)"
        />
      )}
      {a && <circle className="ux-map-pin ux-map-pin-home" cx={a[0]} cy={a[1]} r="4" />}
      {b && <circle className="ux-map-pin" cx={b[0]} cy={b[1]} r="4" />}
      {a && (
        <text className="ux-map-label" x={Math.min(Math.max(a[0] - 20, 6), 520)} y={a[1] - 10}>
          {names.from}
        </text>
      )}
      {b && (
        <text className="ux-map-label" x={Math.min(Math.max(b[0] - 20, 6), 520)} y={b[1] - 10}>
          {names.to}
        </text>
      )}
    </svg>
  );
}

// Home page v4.4 (owner, 27 Nov 2026, decision 4): the route map of the home, framed on the route instead of the whole
// world. Same data, same members and same arc rule as `WorldRouteMap`; the frame is the box of the two ends with room
// around it, so a short route (Bangladesh to China) shows the region and a long one (Bangladesh to the US) shows the
// world. Decorative: the route is also written beside it. Colours come from CSS classes (tokens), never from here. The
// arc draws once when the route changes (300 ms, still under reduced motion); nothing loops.
const markFile: Record<string, string> = {
  BD: 'bd',
  CN: 'cn',
  EU: 'eu',
  GB: 'gb',
  US: 'us',
  AU: 'au',
};
const nominalWidth = 560;
const nominalHeight = 360;

function frameOf(a: [number, number], b: [number, number] | null) {
  const aspect = nominalWidth / nominalHeight;
  const points = b ? [a, b] : [a];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  let width = Math.max((Math.max(...xs) - Math.min(...xs)) * 1.5, 150);
  let height = Math.max((Math.max(...ys) - Math.min(...ys)) * 2.4, 60);
  if (!b) width = 200;
  if (width / height < aspect) width = height * aspect;
  else height = width / aspect;
  if (width > 600) {
    width = 600;
    height = width / aspect;
  }
  const x = Math.min(Math.max(cx - width / 2, 0), 600 - width);
  const y = Math.min(Math.max(cy - height / 2 + height * 0.04, 0), 300 - height);
  return { x, y, width, height, k: width / nominalWidth };
}

function Tag({
  code,
  name,
  at,
  k,
  below,
}: {
  code: string;
  name: string;
  at: [number, number];
  k: number;
  below: boolean;
}) {
  const mark = markFile[code];
  const width = (name.length * 7.4 + (mark ? 44 : 24)) * k;
  const height = 28 * k;
  const cx = at[0];
  const cy = at[1] + (below ? 32 : -32) * k;
  return (
    <g className="hv44-tag">
      <rect
        x={cx - width / 2}
        y={cy - height / 2}
        width={width}
        height={height}
        rx={height / 2}
        strokeWidth={k}
      />
      {mark ? (
        <image
          href={`/flags/${mark}.svg`}
          x={cx - width / 2 + 8 * k}
          y={cy - 7 * k}
          width={20 * k}
          height={14 * k}
        />
      ) : null}
      <text x={cx - width / 2 + (mark ? 34 : 12) * k} y={cy + 4.2 * k} fontSize={12.5 * k}>
        {name}
      </text>
    </g>
  );
}

/**
 * The route of the request on the world map. `from` and `to` are place codes as the request form holds them
 * (BD, CN, EU, GB, US, AU); Key Asian Markets and "Other or undecided" have no point, so the map shows only the
 * company's own country then.
 */
export function ZoomRouteMap({
  world,
  from,
  to,
  names,
}: {
  world: World;
  from: string;
  to: string;
  names: { from: string; to: string };
}) {
  const fromSet = new Set(members(from));
  const toSet = new Set(members(to));
  const a = pointOf(world, from);
  const b = to === 'REGION' || to === 'OTHER' ? null : pointOf(world, to);
  if (!a) return null;
  const f = frameOf(a, b);
  const path = b ? arc(a, b) : null;
  const dot = (() => {
    if (!b) return null;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    let nx = -dy / length;
    let ny = dx / length;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const qx = mx + nx * length * 0.25;
    const qy = my + ny * length * 0.25;
    const t = 0.58;
    return [
      (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * qx + t * t * b[0],
      (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * qy + t * t * b[1],
    ] as [number, number];
  })();
  return (
    <svg
      viewBox={`${f.x} ${f.y} ${f.width} ${f.height}`}
      aria-hidden="true"
      focusable="false"
      className="hv44-map"
    >
      {Object.entries(world.countries).map(([code, country]) => (
        <path
          key={code}
          d={country.d}
          strokeWidth={(fromSet.has(code) || toSet.has(code) ? 1.1 : 0.6) * f.k * 1.6}
          className={fromSet.has(code) ? 'hv44-from' : toSet.has(code) ? 'hv44-to' : 'hv44-land'}
        />
      ))}
      {path ? (
        <>
          <path key={`h-${from}-${to}`} className="hv44-arc-halo" d={path} strokeWidth={6 * f.k} />
          <path
            key={`a-${from}-${to}`}
            className="hv44-arc"
            d={path}
            pathLength={1}
            strokeWidth={2.4 * f.k}
          />
        </>
      ) : null}
      <circle className="hv44-halo" cx={a[0]} cy={a[1]} r={11 * f.k} />
      <circle
        className="hv44-pin hv44-pin-from"
        cx={a[0]}
        cy={a[1]}
        r={5.5 * f.k}
        strokeWidth={2 * f.k}
      />
      {b ? (
        <>
          <circle className="hv44-halo hv44-halo-to" cx={b[0]} cy={b[1]} r={11 * f.k} />
          <circle
            className="hv44-pin hv44-pin-to"
            cx={b[0]}
            cy={b[1]}
            r={5.5 * f.k}
            strokeWidth={2 * f.k}
          />
        </>
      ) : null}
      {path ? (
        <circle className="hv44-travel" r={4 * f.k} strokeWidth={1.4 * f.k}>
          <animateMotion dur="3.6s" repeatCount="indefinite" path={path} />
        </circle>
      ) : null}
      {dot ? (
        <circle
          className="hv44-dot"
          cx={dot[0]}
          cy={dot[1]}
          r={4.6 * f.k}
          strokeWidth={1.6 * f.k}
        />
      ) : null}
      <Tag code={from} name={names.from} at={a} k={f.k} below />
      {b ? <Tag code={to} name={names.to} at={b} k={f.k} below={false} /> : null}
    </svg>
  );
}
