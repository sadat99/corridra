import { briefHref, goalRoute } from './home-routes-data';
import { marketPlace, type ExplorerMarket, type PlaceCode } from './home-v43-data';
import { pairOf, type HomeV43State } from './home-v43-state';
import { fill } from './i18n/fill';
import type { MessageKey } from './i18n/messages';

// The request address of the home page v4.3. The notes the request form opens with are the visitor's own answers,
// composed exactly as the home's request always has been (route, what they need, timing), cut at 1000 whole
// characters by `briefHref`. The company base and the target go only as a valid pair (`companyCountry` and
// `marketCode`); nothing else is put in any other parameter.
type Say = (key: MessageKey) => string;

const sellMarkets: Partial<Record<PlaceCode, ExplorerMarket>> = Object.fromEntries(
  (['eu', 'gb', 'us', 'au', 'asia'] as const).map((market) => [marketPlace[market], market]),
);

/** The route sentence of the notes: the goal's own route, naming the market when the target is one. */
export function routeText(say: Say, state: Pick<HomeV43State, 'goal' | 'target'>): string {
  const kind = goalRoute[state.goal];
  if (kind !== 'sell') return say(`home.b3.br.route.${kind}` as MessageKey);
  const market = sellMarkets[state.target];
  return market
    ? fill(say('home.b3.br.route.sell'), { market: say(`home.b3.mkto.${market}` as MessageKey) })
    : say('home.b3.br.route.sellAny');
}

export function composeNote(
  say: Say,
  state: Pick<HomeV43State, 'goal' | 'target' | 'need' | 'timing'>,
): string {
  const need = state.need.trim();
  return [
    `${say('home.b3.note.route')}: ${routeText(say, state)}`,
    need ? `${say('home.b3.note.need')}: ${need}` : '',
    state.timing
      ? `${say('home.b3.note.when')}: ${say(`home.b3.br.when.${state.timing}` as MessageKey)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** What leaves the page: one address into /plan, built by `briefHref` alone. */
export function requestHref(say: Say, state: HomeV43State): string {
  return briefHref(state.goal, composeNote(say, state), pairOf(state));
}

/** The address of the "I Need Help Scoping This" path: no job, the visitor's words only. */
export function helpHref(say: Say, state: HomeV43State): string {
  return briefHref('other', composeNote(say, { ...state, goal: 'other' }), null);
}
