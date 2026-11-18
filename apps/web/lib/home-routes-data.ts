import type { MessageKey } from './i18n/messages';

// Example data for the home page, Two Routes (owner decision of 17 November 2026). Every company, city and amount here
// is invented for illustration and the page tags each set "Example". Nothing here is read from, or sent to, any
// record: the examples are static, and the page sends nothing. Place names and company names are proper nouns and
// stay as written, like airport codes; every sentence about them is a message key (lib/i18n/home-words.ts).

export const routeKeys = ['china', 'sell', 'delegation', 'other'] as const;
export type RouteKey = (typeof routeKeys)[number];

/** Where each door starts the real request. Only values the /plan page already accepts (P-05, P-07). */
export const routeHref: Record<RouteKey, string> = {
  china: '/plan?job=sourcing',
  sell: '/plan?job=buyers',
  delegation: '/plan?job=delegations',
  other: '/plan',
};

export const marketKeys = ['eu', 'gb', 'us', 'au', 'asia'] as const;
export type MarketKey = (typeof marketKeys)[number];

export type ExampleCompany = { name: string; place: string };

export type MarketExample = {
  /** The eight names an example trade fair lists, in the order of the eight roles in the words file. */
  fair: readonly ExampleCompany[];
  /** Three companies that are not on the fair list. */
  outside: readonly ExampleCompany[];
  /** The city of the example fair, used in the request hint. */
  city: string;
};

export const marketExamples: Record<MarketKey, MarketExample> = {
  eu: {
    city: 'Madrid',
    fair: [
      { name: 'Moda Brezo SA', place: 'Madrid, Spain' },
      { name: 'Hilaturas Arenal SL', place: 'Valencia, Spain' },
      { name: 'Punto Calma SL', place: 'Barcelona, Spain' },
      { name: 'Tissages Combelle SARL', place: 'Lyon, France' },
      { name: 'Casa Olmeda Hogar SL', place: 'Valencia, Spain' },
      { name: 'Stamperia Velluti Srl', place: 'Milan, Italy' },
      { name: 'Agenzia Corvetto Moda Srl', place: 'Milan, Italy' },
      { name: 'Maison Vellaure SAS', place: 'Lyon, France' },
    ],
    outside: [
      { name: 'Casa Vireo Distribución SL', place: 'Valencia, Spain' },
      { name: 'Maglieria Ostrano Srl', place: 'Milan, Italy' },
      { name: 'Lumbre Infantil SL', place: 'Barcelona, Spain' },
    ],
  },
  gb: {
    city: 'Manchester',
    fair: [
      { name: 'Hallow and Finch Retail Ltd', place: 'Manchester, United Kingdom' },
      { name: 'Pennine Yarnworks Ltd', place: 'Leeds, United Kingdom' },
      { name: 'Brackenmoor Knit Co Ltd', place: 'Glasgow, United Kingdom' },
      { name: 'Tolland Cloth Merchants Ltd', place: 'Bristol, United Kingdom' },
      { name: 'Ashgrove Home Textiles Ltd', place: 'Leeds, United Kingdom' },
      { name: 'Redbrook Print Studio Ltd', place: 'Manchester, United Kingdom' },
      { name: 'Calderwick Fashion Agency Ltd', place: 'Leeds, United Kingdom' },
      { name: 'Thistlecombe Luxury Knit Ltd', place: 'Glasgow, United Kingdom' },
    ],
    outside: [
      { name: 'Larkhollow Wholesale Ltd', place: 'Bristol, United Kingdom' },
      { name: 'Cobblestow Private Label Ltd', place: 'Manchester, United Kingdom' },
      { name: 'Wrenfield Kids Knitwear Ltd', place: 'Glasgow, United Kingdom' },
    ],
  },
  us: {
    city: 'Chicago',
    fair: [
      { name: 'Westbrine Apparel Inc', place: 'Chicago, United States' },
      { name: 'Pinecastle Yarn Mills Inc', place: 'Atlanta, United States' },
      { name: 'Juniper Row Knitwear LLC', place: 'Portland, United States' },
      { name: 'Trinity Bolt Fabrics Inc', place: 'Dallas, United States' },
      { name: 'Hearthline Home Goods Inc', place: 'Dallas, United States' },
      { name: 'Mossgate Print Works LLC', place: 'Portland, United States' },
      { name: 'Wabash Lane Showrooms LLC', place: 'Chicago, United States' },
      { name: 'Peachline Luxe Knits LLC', place: 'Atlanta, United States' },
    ],
    outside: [
      { name: 'Prairiemoor Wholesale Inc', place: 'Chicago, United States' },
      { name: 'Caddo Ridge Private Label LLC', place: 'Dallas, United States' },
      { name: 'Cedar Sprout Kids Inc', place: 'Portland, United States' },
    ],
  },
  au: {
    city: 'Melbourne',
    fair: [
      { name: 'Kestrel Bay Retail Pty Ltd', place: 'Melbourne, Australia' },
      { name: 'Wattlegum Yarns Pty Ltd', place: 'Brisbane, Australia' },
      { name: 'Coolabah Row Knitwear Pty Ltd', place: 'Sydney, Australia' },
      { name: 'Karri Point Cloth Pty Ltd', place: 'Perth, Australia' },
      { name: 'Harbourfold Home Textiles Pty Ltd', place: 'Sydney, Australia' },
      { name: 'Tallowwood Print House Pty Ltd', place: 'Melbourne, Australia' },
      { name: 'Gallery Row Fashion Agency Pty Ltd', place: 'Melbourne, Australia' },
      { name: 'Bellbird Luxe Knitwear Pty Ltd', place: 'Sydney, Australia' },
    ],
    outside: [
      { name: 'Mulgara Wholesale Pty Ltd', place: 'Brisbane, Australia' },
      { name: 'Quandong Private Label Pty Ltd', place: 'Perth, Australia' },
      { name: 'Possumwood Kids Pty Ltd', place: 'Melbourne, Australia' },
    ],
  },
  asia: {
    city: 'Singapore',
    fair: [
      { name: 'Larchmere Retail Pte Ltd', place: 'Singapore' },
      { name: 'Hoshizora Spinning Co., Ltd.', place: 'Tokyo, Japan' },
      { name: 'Danbi Knit Co., Ltd.', place: 'Seoul, South Korea' },
      { name: 'Seri Tenun Fabrics Sdn Bhd', place: 'Kuala Lumpur, Malaysia' },
      { name: 'Sakuranomori Home Textiles Co., Ltd.', place: 'Tokyo, Japan' },
      { name: 'Garam Print Studio Co., Ltd.', place: 'Seoul, South Korea' },
      { name: 'Merbau Fashion Agency Sdn Bhd', place: 'Kuala Lumpur, Malaysia' },
      { name: 'Kumoya Luxury Knit Co., Ltd.', place: 'Tokyo, Japan' },
    ],
    outside: [
      { name: 'Tanjong Vale Distribution Pte Ltd', place: 'Singapore' },
      { name: 'Sorabi Private Label Co., Ltd.', place: 'Seoul, South Korea' },
      { name: 'Pokok Kecil Kids Sdn Bhd', place: 'Kuala Lumpur, Malaysia' },
    ],
  },
};

// The six currencies the calculator reads, and the one each market starts in. Nothing is ever converted.
export const calculatorCurrencies = ['BDT', 'USD', 'EUR', 'GBP', 'AUD', 'SGD'] as const;
export type CalculatorCurrency = (typeof calculatorCurrencies)[number];

export const marketCurrency: Record<MarketKey, CalculatorCurrency> = {
  eu: 'EUR',
  gb: 'GBP',
  us: 'USD',
  au: 'AUD',
  asia: 'USD',
};

/** Which of the eight example roles fit the example brief (the same two in every market). */
export const fairFits: readonly boolean[] = [true, false, true, false, false, false, false, false];
/** The trust label each fair row carries when it fits, and each outside row (by index). */
export const fairLabels: readonly (null | 'Evidence available' | 'Self-declared')[] = [
  'Evidence available',
  null,
  'Self-declared',
  null,
  null,
  null,
  null,
  null,
];
export const outsideLabels = ['Self-declared', 'Verified', 'Evidence available'] as const;

export type QuoteKey = 'a' | 'b' | 'c';

/** The three example quotes. Amounts and terms are invented for illustration. */
export const quotes: Record<
  QuoteKey,
  {
    price: string;
    delivery: string | null;
    install: 'included' | 'notIncluded' | 'notConfirmed';
    days: number;
    coverage: readonly (readonly [MessageKey, 'yes' | 'out' | 'ns'])[];
    verdict: MessageKey;
  }
> = {
  a: {
    price: '42,000',
    delivery: 'FOB Ningbo',
    install: 'included',
    days: 90,
    coverage: [
      ['home.tr.q.cov.machine', 'yes'],
      ['home.tr.q.cov.install', 'yes'],
      ['home.tr.q.cov.freight', 'out'],
      ['home.tr.q.cov.insurance', 'out'],
      ['home.tr.q.cov.duty', 'out'],
    ],
    verdict: 'home.tr.q.verdict.a',
  },
  b: {
    price: '38,500',
    delivery: null,
    install: 'notIncluded',
    days: 75,
    coverage: [
      ['home.tr.q.cov.machine', 'yes'],
      ['home.tr.q.cov.install', 'out'],
      ['home.tr.q.cov.freight', 'ns'],
      ['home.tr.q.cov.insurance', 'ns'],
      ['home.tr.q.cov.duty', 'ns'],
    ],
    verdict: 'home.tr.q.verdict.b',
  },
  c: {
    price: '45,700',
    delivery: 'CIF Chattogram',
    install: 'notConfirmed',
    days: 120,
    coverage: [
      ['home.tr.q.cov.machine', 'yes'],
      ['home.tr.q.cov.install', 'ns'],
      ['home.tr.q.cov.freight', 'yes'],
      ['home.tr.q.cov.insurance', 'yes'],
      ['home.tr.q.cov.duty', 'out'],
    ],
    verdict: 'home.tr.q.verdict.c',
  },
};

/** The six stops of the example visit day, in Guangzhou time. Dhaka is two hours behind. */
export const visitStops = ['08:00', '09:30', '12:30', '14:30', '16:30', '20:00'] as const;

/** Dhaka time for a Guangzhou time: UTC+8 to UTC+6, always two hours earlier. */
export function dhakaTime(guangzhou: string): string {
  const [hour, minute] = guangzhou.split(':').map(Number);
  const h = (hour - 2 + 24) % 24;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Programme view rows for the delegation example: which of five stages each company has reached. */
export const programmeRows: readonly (readonly boolean[])[] = [
  [true, true, true, false, false],
  [true, true, false, false, false],
  [true, true, true, true, false],
  [true, false, false, false, false],
];

/** The six goals that open a real request. Every key is one the /plan page already accepts. */
export const goalLinks: readonly { key: string; label: MessageKey; href: string }[] = [
  { key: 'china', label: 'home.tr.br.g.china', href: '/plan?job=sourcing' },
  { key: 'machinery', label: 'home.tr.br.g.machinery', href: '/plan?job=sourcing' },
  { key: 'sell', label: 'home.tr.br.g.sell', href: '/plan?job=buyers' },
  { key: 'fair', label: 'home.tr.br.g.fair', href: '/plan?job=buyers' },
  { key: 'delegation', label: 'home.tr.br.g.delegation', href: '/plan?job=delegations' },
  { key: 'other', label: 'home.tr.br.g.other', href: '/plan' },
];

/** The six goals of the home page brief (board 3c), in the board's order. */
export const briefGoals = ['china', 'machinery', 'sell', 'fair', 'delegation', 'other'] as const;
export type GoalKey = (typeof briefGoals)[number];
/** The four timing answers of the brief, by number (words: home.b3.br.when.N). */
export const briefTimings = [1, 2, 3, 4] as const;

/**
 * The request job each goal opens. Every value is a key of the request form's job list (missionCatalogue), so the
 * form selects it exactly as `/plan?job=` links already do (P-05); "Something else" opens the form with no job.
 */
export const goalJob: Record<GoalKey, string | null> = {
  china: 'sourcing',
  machinery: 'machinery_procurement',
  sell: 'buyers',
  fair: 'trade_fairs',
  delegation: 'delegations',
  other: null,
};

/** Which route sentence the brief's draft card shows for a goal. */
export const goalRoute: Record<GoalKey, 'china' | 'sell' | 'delegation' | 'other'> = {
  china: 'china',
  machinery: 'china',
  sell: 'sell',
  fair: 'sell',
  delegation: 'delegation',
  other: 'other',
};

/** The request address the brief opens: the job, and the visitor's own words as a note for the form's notes field. */
export function briefHref(goal: GoalKey | null, note: string): string {
  const query = new URLSearchParams();
  const job = goal ? goalJob[goal] : null;
  if (job) query.set('job', job);
  const words = note.trim().slice(0, 1000);
  if (words) query.set('note', words);
  const text = query.toString();
  return text ? `/plan?${text}` : '/plan';
}
