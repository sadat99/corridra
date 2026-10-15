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
    <svg viewBox={world.viewBox} aria-hidden="true" className="ux-atlas-map" focusable="false">
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
