import type { IconName } from '../components/corridra-icon';
import type { FlagCode } from '../components/ux/flag';
import { goalRoute, type GoalKey, type MarketKey, type RouteKey } from './home-routes-data';
import type { MessageKey } from './i18n/messages';

// Tables of the home page v4.3 (docs/revamp/specs/ui-ux-v4-3.md). Keys only: every sentence is a `home.v43.*` key of
// lib/i18n/home-v43-words*.ts and every place name comes from an existing key, so no copy and no place name is
// written here. Sample amounts live in the words as the pack has them (USD as written, never converted).

/** A key of the v4.3 words, by its name after `home.v43.`. The words test finds every one of them. */
export const v43 = (name: string) => `home.v43.${name}` as MessageKey;

export const intentKeys = [
  'china',
  'sell',
  'delegation',
  'other',
] as const satisfies readonly RouteKey[];

/** The eight roles of the pack, in its order. */
export const roleIds = [
  'exporter',
  'importer',
  'machinery',
  'entering',
  'buyer',
  'supplier',
  'leader',
  'helper',
] as const;
export type RoleId = (typeof roleIds)[number];

/** Places as the request form holds them. REGION is Key Asian Markets, OTHER is "Other or undecided". */
export const placeCodes = ['BD', 'CN', 'EU', 'GB', 'US', 'AU', 'REGION', 'OTHER'] as const;
export type PlaceCode = (typeof placeCodes)[number];
/** The places a company can be based in, in the order of the form. */
export const originCodes = [
  'BD',
  'CN',
  'GB',
  'US',
  'AU',
  'OTHER',
] as const satisfies readonly PlaceCode[];

/** The written name of each place: existing keys only (home.country.*, home.tr.mk.*). */
export const placeName = Object.fromEntries([
  ['BD', 'home.country.bd'],
  ['CN', 'home.country.cn'],
  ['EU', 'home.tr.mk.eu'],
  ['GB', 'home.tr.mk.gb'],
  ['US', 'home.tr.mk.us'],
  ['AU', 'home.tr.mk.au'],
  ['REGION', 'home.tr.mk.asia'],
  ['OTHER', v43('place.other')],
]) as Record<PlaceCode, MessageKey>;
/** The mark before each name: a flag, the compass for Key Asian Markets, nothing for "Other or undecided". */
export const placeFlag: Record<PlaceCode, FlagCode | 'region' | null> = {
  BD: 'bd',
  CN: 'cn',
  EU: 'eu',
  GB: 'gb',
  US: 'us',
  AU: 'au',
  REGION: 'region',
  OTHER: null,
};

export const explorerMarkets = ['cn', 'eu', 'gb', 'us', 'au', 'asia'] as const;
export type ExplorerMarket = (typeof explorerMarkets)[number];
export const marketPlace: Record<ExplorerMarket, PlaceCode> = {
  cn: 'CN',
  eu: 'EU',
  gb: 'GB',
  us: 'US',
  au: 'AU',
  asia: 'REGION',
};
export type Direction = 'out' | 'in';

/** What one door sets: the goal, the role, the market, the example route line and the request route. */
export const intents: Record<
  RouteKey,
  {
    goal: GoalKey;
    role: RoleId;
    market: ExplorerMarket | null;
    line: readonly [PlaceCode, PlaceCode];
    target: PlaceCode;
  }
> = {
  china: { goal: 'china', role: 'importer', market: 'cn', line: ['BD', 'CN'], target: 'CN' },
  sell: { goal: 'sell', role: 'exporter', market: 'eu', line: ['BD', 'EU'], target: 'EU' },
  delegation: {
    goal: 'delegation',
    role: 'leader',
    market: 'cn',
    line: ['BD', 'CN'],
    target: 'CN',
  },
  other: { goal: 'other', role: 'entering', market: null, line: ['OTHER', 'BD'], target: 'OTHER' },
};

export const needLimit = 600;
export const timings = [1, 2, 3, 4] as const;

/** The suppliers of the china console, the rows of the sell console, the phases and the questions. */
export const offerIds = ['a', 'b', 'c'] as const;
/**
 * The sample amounts and delivery codes, as the pack has them (invented, USD as written, never converted, never
 * summed or ranked). They are the page's data, not words: the catalogue holds no amount or delivery code.
 */
export const offerAmounts = { a: 'USD 36,800', b: 'USD 34,200', c: 'USD 39,100' } as const;
export const deliveryCodes = { a: 'FOB Ningbo', c: 'CIF Chattogram' } as const;
/** The commercial record sample: the original quote and the supplier's correction (revision 2). */
export const ledgerAmounts = { original: 'USD 36,800', correction: 'USD 37,400' } as const;
export const buyerRows = [
  { id: 1, shortlist: true },
  { id: 2, shortlist: false },
  { id: 3, shortlist: true },
  { id: 4, shortlist: true },
] as const;
/** The fair list is the first three rows; the qualified shortlist is the rows that fit. */
export const fairRowCount = 3;
export const phaseIds = [1, 2, 3] as const;
export const questionIds = [1, 2, 3] as const;
export const stageIds = [1, 2, 3, 4] as const;
export const faqIds = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** The sub-label of a market row: it is "Case by case" for every row while the direction is into Bangladesh. */
export function marketLine(market: ExplorerMarket, direction: Direction): MessageKey {
  if (direction === 'in') return v43('mk.line.case');
  if (market === 'cn') return v43('mk.line.buy');
  return v43(market === 'asia' ? 'mk.line.region' : 'mk.line.sell');
}

/** The route record of a market and a direction (the pack's drawRoutes). */
export function routeRecord(market: ExplorerMarket, direction: Direction) {
  const inbound = direction === 'in';
  const place = marketPlace[market];
  const status = inbound ? 'selective' : market === 'cn' ? 'sourcing' : 'sales';
  let detail = 'sell';
  if (market === 'cn') detail = 'cn';
  if (market === 'asia') detail = 'region';
  if (inbound) detail = market === 'eu' || market === 'asia' ? 'inRegion' : 'inOther';
  return {
    origin: inbound ? place : ('BD' as PlaceCode),
    destination: inbound ? ('BD' as PlaceCode) : place,
    tone: inbound ? ('selective' as const) : ('open' as const),
    status: v43(`mk.status.${status}`),
    detail: v43(`mk.detail.${detail}`),
  };
}

/** Which door "Use This Route in the Request" selects: inbound is Another goal, China is Source, the rest Sell. */
export function routeForMarket(market: ExplorerMarket, direction: Direction): RouteKey {
  if (direction === 'in') return 'other';
  return market === 'cn' ? 'china' : 'sell';
}

/** The markets the Sell route block takes (it has no China). */
export function sellMarketOf(market: ExplorerMarket): MarketKey {
  return market === 'cn' ? 'eu' : market;
}

/** The target markets for a company base: every place but the base itself, and "Other or undecided" always. */
export function targetOptions(origin: PlaceCode): PlaceCode[] {
  return placeCodes.filter((code) => code !== origin || code === 'OTHER');
}
/** The preferred target when it is offered, otherwise "Other or undecided". */
export function targetFor(origin: PlaceCode, preferred: PlaceCode): PlaceCode {
  return targetOptions(origin).includes(preferred) ? preferred : 'OTHER';
}

/** Which fit line the request summary shows (the pack's briefStatus). */
export function fitLine(origin: PlaceCode, target: PlaceCode, goal: GoalKey) {
  const route = goalRoute[goal];
  if (target === 'BD' && origin !== 'BD') return 'selective';
  if (origin === 'BD' && target === 'CN' && route === 'china') return 'sourcing';
  if (origin === 'BD' && ['EU', 'GB', 'US', 'AU', 'REGION'].includes(target) && route === 'sell')
    return 'sales';
  return 'ask';
}

/**
 * Which route block each anchor of the shipped route blocks lives in (read from home-routes.tsx and home-sell.tsx on
 * 26 Nov 2026). An anchor in this list opens its route before it takes focus.
 */
export const anchorRoute: Readonly<Record<string, RouteKey>> = {
  'route-china': 'china',
  gaps: 'china',
  'quote-a': 'china',
  'quote-b': 'china',
  'quote-c': 'china',
  'visit-title': 'china',
  'comparable-title': 'china',
  'route-sell': 'sell',
  'worth-title': 'sell',
  'faircost-title': 'sell',
  'route-delegation': 'delegation',
  'route-other': 'other',
};

/** The section anchors the header, the footer and the hero point at (each id exists once on the V43 page). */
export const sectionIds = [
  'start',
  'solutions',
  'service-source',
  'service-sell',
  'service-delegation',
  'example',
  'process',
  'markets',
  'inbound',
  'trust',
  'people',
  'questions',
  'brief',
] as const;

/** The icon of each Solutions row. */
export const solutionIcons: Record<'source' | 'sell' | 'delegation' | 'inbound', IconName> = {
  source: 'search',
  sell: 'sell',
  delegation: 'trip',
  inbound: 'globe',
};
