import { geography as g } from './corridor-geography';

const [dhaka, beijing, madrid] = [g.points.dhaka, g.points.beijing, g.points.madrid];

/** A gentle curve between two projected points, bowed upward so the two corridors leave Bangladesh at clearly different angles. */
function arc(from: readonly [number, number], to: readonly [number, number], bow: number) {
  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  let nx = -dy / length;
  let ny = dx / length;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const lift = length * bow;
  return `M${from[0]} ${from[1]}Q${Math.round(mx + nx * lift)} ${Math.round(my + ny * lift)} ${to[0]} ${to[1]}`;
}

const chinaArc = arc(dhaka, beijing, 0.3);
const europeArc = arc(dhaka, madrid, 0.2);

/**
 * Real country outlines with both commercial directions from Bangladesh always visible.
 * The selected direction is emphasised. It describes commercial scope only, never a shipment route or local coverage.
 */
export function CorridorMap({ company, market }: { company: string; market: string }) {
  const reverse = company !== 'BD';
  const chinaActive = market === 'CN' || company === 'CN';
  const europeActive = market === 'ES' || market === 'EU' || company === 'ES';
  const arrow = reverse ? { markerStart: 'url(#map-arrow)' } : { markerEnd: 'url(#map-arrow)' };
  return (
    <svg viewBox={g.viewBox} aria-hidden="true" className="ux-atlas-map" focusable="false">
      <defs>
        <marker
          id="map-arrow"
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
      <path className="ux-map-land" d={g.paths.other} />
      <path className={'ux-map-eu' + (europeActive ? ' is-active' : '')} d={g.paths.eu} />
      <path className={'ux-map-spain' + (europeActive ? ' is-active' : '')} d={g.paths.spain} />
      <path className={'ux-map-china' + (chinaActive ? ' is-active' : '')} d={g.paths.china} />
      <path className="ux-map-bangladesh" d={g.paths.bangladesh} />
      <path
        className={'ux-map-arc ux-map-arc-europe' + (europeActive ? ' is-active' : '')}
        d={europeArc}
        {...(europeActive ? arrow : {})}
      />
      <path
        className={'ux-map-arc ux-map-arc-china' + (chinaActive ? ' is-active' : '')}
        d={chinaArc}
        {...(chinaActive ? arrow : {})}
      />
      <circle className="ux-map-pin ux-map-pin-home" cx={dhaka[0]} cy={dhaka[1]} r="5" />
      <circle className="ux-map-pin" cx={beijing[0]} cy={beijing[1]} r="4" />
      <circle className="ux-map-pin" cx={madrid[0]} cy={madrid[1]} r="4" />
      <text className="ux-map-label" x={dhaka[0] - 28} y={dhaka[1] + 34}>
        Bangladesh
      </text>
      <text className="ux-map-label ux-map-label-dark" x={beijing[0] - 10} y={beijing[1] + 34}>
        China
      </text>
      <text className="ux-map-label ux-map-label-dark" x={madrid[0] - 14} y={madrid[1] + 30}>
        Spain
      </text>
      <text className="ux-map-label" x={g.points.brussels[0] + 4} y={g.points.brussels[1] - 20}>
        EU
      </text>
    </svg>
  );
}
