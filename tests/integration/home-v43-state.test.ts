import { describe, expect, it } from 'vitest';
import {
  intents,
  routeForMarket,
  routeRecord,
  targetOptions,
  fitLine,
  marketLine,
} from '../../apps/web/lib/home-v43-data';
import {
  homeV43Reducer as reduce,
  initialState,
  pairOf,
  sellMarket,
  viewIntent,
  type HomeV43Event,
  type HomeV43State,
} from '../../apps/web/lib/home-v43-state';
import { briefHref, goalRoute, routeHref } from '../../apps/web/lib/home-routes-data';

// Home page v4.3 state (owner, 26 Nov 2026, via the Guardian). One pure reducer: a door sets the example, the stages,
// the role, the market and the request unless the visitor chose or typed that part; typed words and timing are never
// touched by a door. Before a door is chosen every part shows the China content and nothing is chosen.
const run = (events: HomeV43Event[], from: HomeV43State = initialState) =>
  events.reduce(reduce, from);

describe('the start', () => {
  it('has no door chosen, shows China everywhere and opens no route', () => {
    expect(initialState.intent).toBeNull();
    expect(initialState.open).toBeNull();
    expect(viewIntent(initialState)).toBe('china');
    expect(initialState).toMatchObject({
      role: 'importer',
      market: 'cn',
      direction: 'out',
      goal: 'china',
      origin: 'BD',
      target: 'CN',
      stage: 0,
      timing: 0,
      need: '',
    });
    expect(sellMarket(initialState)).toBe('eu');
  });

  it('is never changed in place', () => {
    const before = JSON.stringify(initialState);
    run([{ type: 'door', route: 'sell' }, { type: 'role', role: 'helper' }, { type: 'useRoute' }]);
    expect(JSON.stringify(initialState)).toBe(before);
  });
});

describe('a door', () => {
  it.each([
    ['china', 'importer', 'cn', 'china', 'CN'],
    ['sell', 'exporter', 'eu', 'sell', 'EU'],
    ['delegation', 'leader', 'cn', 'delegation', 'CN'],
    ['other', 'entering', 'cn', 'other', 'OTHER'],
  ] as const)(
    '%s sets the stages, role, market and request',
    (route, role, market, goal, target) => {
      const state = run([
        { type: 'stage', index: 2 },
        { type: 'door', route },
      ]);
      expect(state).toMatchObject({ intent: route, stage: 0, role, goal, origin: 'BD', target });
      // Another goal leaves the market where it was; the three routes set theirs
      expect(state.market).toBe(route === 'other' ? 'cn' : market);
      expect(viewIntent(state)).toBe(route);
    },
  );

  it('never opens the long route block; only an anchor into it does, and it follows the same rules', () => {
    for (const route of ['china', 'sell', 'delegation', 'other'] as const) {
      expect(run([{ type: 'door', route }]).open).toBeNull();
      const opened = run([{ type: 'openRoute', route }]);
      expect(opened.open).toBe(route);
      expect(opened.intent).toBe(route);
      expect(opened.goal).toBe(intents[route].goal);
    }
    expect(run([{ type: 'openRoute', route: 'sell' }, { type: 'closeRoute' }])).toMatchObject({
      open: null,
      intent: 'sell',
    });
  });

  it('keeps a role the visitor picked, a market or direction they used, and a goal they set', () => {
    const state = run([
      { type: 'role', role: 'supplier' },
      { type: 'market', market: 'au' },
      { type: 'brief', field: 'goal', value: 'fair' },
      { type: 'door', route: 'delegation' },
    ]);
    expect(state).toMatchObject({
      intent: 'delegation',
      role: 'supplier',
      market: 'au',
      goal: 'fair',
      target: 'EU',
      stage: 0,
    });
  });

  it('survives a change of door: typed words, timing, goal, role and market', () => {
    const state = run([
      { type: 'brief', field: 'need', value: 'Three knitwear lines for the Madrid fair' },
      { type: 'brief', field: 'timing', value: 2 },
      { type: 'role', role: 'supplier' },
      { type: 'direction', direction: 'in' },
      { type: 'brief', field: 'goal', value: 'machinery' },
      { type: 'door', route: 'sell' },
      { type: 'door', route: 'delegation' },
    ]);
    expect(state.need).toBe('Three knitwear lines for the Madrid fair');
    expect(state.timing).toBe(2);
    expect(state.role).toBe('supplier');
    expect(state.direction).toBe('in');
    expect(state.market).toBe('cn');
    expect(state.goal).toBe('machinery');
    expect(state.origin).toBe('BD');
  });

  it('resets the stage on a door but keeps it when the visitor only moves between stages', () => {
    const state = run([
      { type: 'door', route: 'sell' },
      { type: 'stage', index: 3 },
    ]);
    expect(state.stage).toBe(3);
    expect(run([{ type: 'door', route: 'china' }], state).stage).toBe(0);
    expect(run([{ type: 'stage', index: 9 }]).stage).toBe(3);
    expect(run([{ type: 'stage', index: -2 }]).stage).toBe(0);
  });
});

describe('the markets explorer', () => {
  it('marks the explorer used, so a later door leaves the market and direction alone', () => {
    const state = run([
      { type: 'market', market: 'us' },
      { type: 'door', route: 'china' },
    ]);
    expect(state.market).toBe('us');
    expect(state.explored).toBe(true);
    expect(sellMarket(state)).toBe('us');
    expect(
      run([
        { type: 'direction', direction: 'in' },
        { type: 'door', route: 'sell' },
      ]).direction,
    ).toBe('in');
  });

  it('writes the route record: status and detail by market and direction', () => {
    expect(routeRecord('cn', 'out')).toMatchObject({
      origin: 'BD',
      destination: 'CN',
      tone: 'open',
      status: 'home.v43.mk.status.sourcing',
      detail: 'home.v43.mk.detail.cn',
    });
    expect(routeRecord('gb', 'out').status).toBe('home.v43.mk.status.sales');
    expect(routeRecord('gb', 'out').detail).toBe('home.v43.mk.detail.sell');
    expect(routeRecord('asia', 'out').detail).toBe('home.v43.mk.detail.region');
    expect(routeRecord('asia', 'in')).toMatchObject({
      origin: 'REGION',
      destination: 'BD',
      tone: 'selective',
      status: 'home.v43.mk.status.selective',
      detail: 'home.v43.mk.detail.inRegion',
    });
    expect(routeRecord('eu', 'in').detail).toBe('home.v43.mk.detail.inRegion');
    expect(routeRecord('us', 'in').detail).toBe('home.v43.mk.detail.inOther');
  });

  it('says "Case by case" for every market going into Bangladesh, and never Key Asian Markets on the Sell line', () => {
    for (const market of ['cn', 'eu', 'gb', 'us', 'au', 'asia'] as const)
      expect(marketLine(market, 'in')).toBe('home.v43.mk.line.case');
    expect(marketLine('cn', 'out')).toBe('home.v43.mk.line.buy');
    expect(marketLine('au', 'out')).toBe('home.v43.mk.line.sell');
    expect(marketLine('asia', 'out')).toBe('home.v43.mk.line.region');
  });

  it('maps "Use This Route in the Request": inbound is Another goal, China is Source, the rest Sell', () => {
    expect(routeForMarket('cn', 'in')).toBe('other');
    expect(routeForMarket('eu', 'in')).toBe('other');
    expect(routeForMarket('cn', 'out')).toBe('china');
    for (const market of ['eu', 'gb', 'us', 'au', 'asia'] as const)
      expect(routeForMarket(market, 'out')).toBe('sell');
  });

  it('sets the request from the chosen route, and from the Into Bangladesh direction', () => {
    const out = run([{ type: 'market', market: 'gb' }, { type: 'useRoute' }]);
    expect(out).toMatchObject({ intent: 'sell', goal: 'sell', origin: 'BD', target: 'GB' });
    expect(pairOf(out)).toEqual({ from: 'BD', to: 'GB' });
    const inbound = run([
      { type: 'market', market: 'cn' },
      { type: 'direction', direction: 'in' },
      { type: 'useRoute' },
    ]);
    expect(inbound).toMatchObject({ intent: 'other', goal: 'other', origin: 'CN', target: 'BD' });
    expect(pairOf(inbound)).toEqual({ from: 'CN', to: 'BD' });
    // A goal that already belongs to the route is kept (machinery is a China goal)
    const kept = run([{ type: 'brief', field: 'goal', value: 'machinery' }, { type: 'useRoute' }]);
    expect(kept.goal).toBe('machinery');
  });

  it('builds an inbound request: Another goal, base undecided, target Bangladesh; the explorer stays unused', () => {
    const state = run([{ type: 'inbound' }]);
    expect(state).toMatchObject({
      intent: 'other',
      goal: 'other',
      origin: 'OTHER',
      target: 'BD',
      explored: false,
    });
    expect(pairOf(state)).toBeNull();
    // A base the visitor already set is kept
    expect(run([{ type: 'brief', field: 'origin', value: 'GB' }, { type: 'inbound' }]).origin).toBe(
      'GB',
    );
  });
});

describe('the request form', () => {
  it('moves the example when the goal changes route, and keeps the goal against a door afterwards', () => {
    const state = run([{ type: 'brief', field: 'goal', value: 'fair' }]);
    expect(state).toMatchObject({ goal: 'fair', intent: 'sell', edited: true, target: 'EU' });
    expect(viewIntent(state)).toBe('sell');
    expect(run([{ type: 'door', route: 'delegation' }], state).goal).toBe('fair');
    // A goal on the route already shown does not choose a door
    expect(run([{ type: 'brief', field: 'goal', value: 'machinery' }]).intent).toBeNull();
  });

  it('keeps the target valid for the company base, falling back to Other or undecided', () => {
    expect(targetOptions('BD')).not.toContain('BD');
    expect(targetOptions('OTHER')).toContain('OTHER');
    const cn = run([{ type: 'brief', field: 'origin', value: 'CN' }]);
    // The base is China and the target was China, so the target moves to Bangladesh
    expect(cn).toMatchObject({ origin: 'CN', target: 'BD' });
    // The target the visitor had is kept when the new base allows it
    const kept = run([
      { type: 'brief', field: 'target', value: 'US' },
      { type: 'brief', field: 'origin', value: 'CN' },
    ]);
    expect(kept.target).toBe('US');
    // Choosing the same place as the base again moves the target to Bangladesh
    expect(
      run([
        { type: 'brief', field: 'origin', value: 'CN' },
        { type: 'brief', field: 'target', value: 'BD' },
        { type: 'brief', field: 'origin', value: 'BD' },
      ]).origin,
    ).toBe('BD');
    // A target the form does not offer is ignored
    const same = run([{ type: 'brief', field: 'target', value: 'BD' }]);
    expect(same.target).toBe('CN');
    expect(same.edited).toBe(false);
  });

  it('cuts the note at 600 whole characters and takes only timings 0 to 4', () => {
    expect(run([{ type: 'brief', field: 'need', value: 'x'.repeat(900) }]).need).toHaveLength(600);
    const emoji = run([{ type: 'brief', field: 'need', value: '\u{1F600}'.repeat(400) }]).need;
    expect([...emoji]).toHaveLength(300);
    expect(run([{ type: 'brief', field: 'timing', value: 7 }]).timing).toBe(0);
    expect(run([{ type: 'brief', field: 'timing', value: 4 }]).timing).toBe(4);
  });

  it('writes the fit line of the summary', () => {
    expect(fitLine('BD', 'CN', 'china')).toBe('sourcing');
    expect(fitLine('BD', 'CN', 'machinery')).toBe('sourcing');
    expect(fitLine('BD', 'REGION', 'sell')).toBe('sales');
    expect(fitLine('BD', 'EU', 'fair')).toBe('sales');
    expect(fitLine('CN', 'BD', 'other')).toBe('selective');
    expect(fitLine('OTHER', 'BD', 'china')).toBe('selective');
    expect(fitLine('BD', 'OTHER', 'other')).toBe('ask');
    expect(fitLine('BD', 'EU', 'china')).toBe('ask');
  });
});

describe('the request address', () => {
  it('opens each door at the same address as the live doors, with the pair only when valid', () => {
    for (const route of ['china', 'sell', 'delegation', 'other'] as const) {
      expect(briefHref(intents[route].goal, '')).toBe(routeHref[route]);
      expect(goalRoute[intents[route].goal]).toBe(route);
    }
    const sell = run([{ type: 'door', route: 'sell' }]);
    expect(briefHref(sell.goal, '', pairOf(sell))).toBe(
      '/plan?job=buyers&companyCountry=BD&marketCode=EU',
    );
    const region = run([{ type: 'market', market: 'asia' }, { type: 'useRoute' }]);
    expect(pairOf(region)).toBeNull();
    expect(briefHref(region.goal, '', pairOf(region))).toBe('/plan?job=buyers');
    const other = run([{ type: 'door', route: 'other' }]);
    expect(pairOf(other)).toBeNull();
    expect(briefHref(other.goal, 'x', pairOf(other))).toBe('/plan?note=x');
  });
});
