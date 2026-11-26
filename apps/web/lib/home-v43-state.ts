import {
  explorerMarkets,
  intents,
  marketPlace,
  needLimit,
  routeForMarket,
  sellMarketOf,
  targetFor,
  targetOptions,
  type Direction,
  type ExplorerMarket,
  type PlaceCode,
  type RoleId,
} from './home-v43-data';
import {
  goalRoute,
  validPair,
  type GoalKey,
  type MarketKey,
  type RoutePair,
  type RouteKey,
} from './home-routes-data';

// All interaction state of the home page v4.3 in one pure reducer (docs/revamp/specs/ui-ux-v4-3.md), so the
// precedence rules are tested without a browser. What a visitor chose or typed is never overwritten by a door:
//   - a picked role stays (`roleTouched`);
//   - a market or direction the visitor used stays (`explored`);
//   - a goal, company base or target the visitor set in the form stays (`edited`);
//   - the typed note and the timing are never touched by a door.
// Before any door is chosen every part shows the China content (`viewIntent`). A door does not open the long route
// block: only `openRoute` does (an anchor into it, or "See the Full Example").
export type HomeV43State = {
  intent: RouteKey | null;
  open: RouteKey | null;
  stage: number;
  role: RoleId;
  roleTouched: boolean;
  market: ExplorerMarket;
  direction: Direction;
  explored: boolean;
  goal: GoalKey;
  origin: PlaceCode;
  target: PlaceCode;
  edited: boolean;
  need: string;
  /** 0 is "Choose when"; 1 to 4 are the four shipped timings. */
  timing: number;
};

export type HomeV43Event =
  | { type: 'door'; route: RouteKey }
  | { type: 'openRoute'; route: RouteKey }
  | { type: 'closeRoute' }
  | { type: 'stage'; index: number }
  | { type: 'role'; role: RoleId }
  | { type: 'market'; market: ExplorerMarket }
  | { type: 'direction'; direction: Direction }
  | { type: 'useRoute' }
  | { type: 'inbound' }
  | { type: 'brief'; field: 'goal'; value: GoalKey }
  | { type: 'brief'; field: 'origin' | 'target'; value: PlaceCode }
  | { type: 'brief'; field: 'need'; value: string }
  | { type: 'brief'; field: 'timing'; value: number };

export const initialState: HomeV43State = {
  intent: null,
  open: null,
  stage: 0,
  role: intents.china.role,
  roleTouched: false,
  market: 'cn',
  direction: 'out',
  explored: false,
  goal: intents.china.goal,
  origin: 'BD',
  target: intents.china.target,
  edited: false,
  need: '',
  timing: 0,
};

/** The route every part follows: the chosen door, or China until one is chosen. */
export function viewIntent(state: HomeV43State): RouteKey {
  return state.intent ?? 'china';
}

/** The market the Sell route block shows (it has no China). */
export function sellMarket(state: HomeV43State): MarketKey {
  return sellMarketOf(state.market);
}

/** The origin and target as a pair for `briefHref`; it adds the pair only when the form would accept it. */
export function pairOf(state: HomeV43State): RoutePair | null {
  const pair = { from: state.origin, to: state.target };
  return validPair(pair) ? pair : null;
}

/** A door: the example, stages, role, market and (unless edited) the request follow it. */
function follow(state: HomeV43State, route: RouteKey, configureRequest: boolean): HomeV43State {
  const door = intents[route];
  const next: HomeV43State = { ...state, intent: route, stage: 0 };
  if (!next.roleTouched) next.role = door.role;
  if (!next.explored && door.market) {
    next.market = door.market;
    next.direction = 'out';
  }
  if (configureRequest && !next.edited) {
    next.goal = door.goal;
    next.origin = 'BD';
    next.target = door.target;
  }
  return next;
}

/** At most the limit of whole characters, as the form's own field holds. */
function cut(text: string): string {
  let out = '';
  for (const character of text) {
    if (out.length + character.length > needLimit) break;
    out += character;
  }
  return out;
}

export function homeV43Reducer(state: HomeV43State, event: HomeV43Event): HomeV43State {
  switch (event.type) {
    case 'door':
      return follow(state, event.route, true);
    case 'openRoute':
      return { ...follow(state, event.route, true), open: event.route };
    case 'closeRoute':
      return { ...state, open: null };
    case 'stage':
      return { ...state, stage: Math.max(0, Math.min(3, Math.trunc(event.index))) };
    case 'role':
      return { ...state, role: event.role, roleTouched: true };
    case 'market':
      return explorerMarkets.includes(event.market)
        ? { ...state, market: event.market, explored: true }
        : state;
    case 'direction':
      return { ...state, direction: event.direction, explored: true };
    case 'useRoute': {
      const route = routeForMarket(state.market, state.direction);
      const inbound = state.direction === 'in';
      const next = follow({ ...state, explored: true }, route, false);
      if (goalRoute[next.goal] !== route) next.goal = intents[route].goal;
      next.origin = inbound ? marketPlace[state.market] : 'BD';
      next.target = inbound ? 'BD' : marketPlace[state.market];
      return next;
    }
    case 'inbound': {
      const next = follow({ ...state, explored: true }, 'other', false);
      next.goal = 'other';
      if (next.origin === 'BD') next.origin = 'OTHER';
      next.target = 'BD';
      // `explored` was set only to keep the market; the visitor has not used the explorer.
      next.explored = state.explored;
      return next;
    }
    case 'brief':
      return briefField(state, event);
  }
}

function briefField(
  state: HomeV43State,
  event: Extract<HomeV43Event, { type: 'brief' }>,
): HomeV43State {
  if (event.field === 'need') return { ...state, need: cut(event.value) };
  if (event.field === 'timing') {
    const timing = Math.trunc(event.value);
    return timing >= 0 && timing <= 4 ? { ...state, timing } : state;
  }
  if (event.field === 'goal') {
    let next: HomeV43State = { ...state, goal: event.value, edited: true };
    const route = goalRoute[event.value];
    if (route !== viewIntent(state)) {
      if (next.origin === 'BD') next.target = targetFor('BD', intents[route].target);
      next = follow(next, route, false);
    }
    return next;
  }
  if (event.field === 'origin') {
    const preferred =
      event.value === 'BD'
        ? intents[viewIntent(state)].target
        : state.target === event.value
          ? 'BD'
          : state.target;
    return {
      ...state,
      origin: event.value,
      target: targetFor(event.value, preferred),
      edited: true,
    };
  }
  // A target the form does not offer for this company base is ignored.
  return targetOptions(state.origin).includes(event.value)
    ? { ...state, target: event.value, edited: true }
    : state;
}
