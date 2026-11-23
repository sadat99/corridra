// Plain words for a customer's own request (CQ-23, CQ-24). Pure functions over the original brief the
// customer wrote, so every rule is tested without a database. Nothing is invented: a title uses only
// the objective and market the customer chose, and a field the customer left empty is never shown.
import { formatDate, timeZoneLabel } from '../../lib/ux/format';
import { countryName } from '../../lib/ux/options';

const objectiveTitle: Record<string, (market: string) => string> = {
  'Sell in a new market': (m) => `Sell in ${m}`,
  'Find customers or distributors': (m) => `Find customers in ${m}`,
  'Source suppliers': (m) => `Source suppliers in ${m}`,
  'Make an upcoming business trip more productive': (m) => `Business trip to ${m}`,
  'Run a multi-company mission': (m) => `Group mission to ${m}`,
  'Something else': (m) => `Request for ${m}`,
};

/** A country or bloc code as a name ("AZ" becomes "Azerbaijan"); free text is kept as written. */
export function placeName(value: string): string {
  const v = value.trim();
  if (v === 'OTHER') return 'Another market';
  if (v === 'EU') return 'European Union';
  return /^[A-Z]{2}$/.test(v) ? countryName(v) : v;
}

/** "Sell in Spain" from the original brief, or null when the brief does not say enough. */
export function requestTitle(brief: unknown): string | null {
  if (!brief || typeof brief !== 'object') return null;
  const b = brief as Record<string, unknown>;
  const market =
    typeof b.market === 'string' && b.market.trim()
      ? placeName(b.market)
      : typeof b.marketCode === 'string' && b.marketCode.trim()
        ? placeName(b.marketCode)
        : '';
  const objective = typeof b.objective === 'string' ? b.objective : '';
  if (!market) return objective || null;
  const make = objectiveTitle[objective];
  return make ? make(market) : objective ? `${objective} (${market})` : `Request for ${market}`;
}

/** Fields the customer never needs to read: format markers, internal notice versions and the form's own codes. */
export const internalFields = new Set([
  'schemaVersion',
  'acknowledged',
  'noticeVersion',
  'job',
  'role',
]);

/** The groups a request detail shows, in reading order (CQ-24). Unknown fields go to Details. */
export const fieldGroups: { title: string; keys: string[] }[] = [
  { title: 'Goal', keys: ['objective', 'outcomes', 'job'] },
  {
    title: 'Where',
    keys: [
      'market',
      'marketCode',
      'companyCountry',
      'attendance',
      'startDate',
      'endDate',
      'timezone',
    ],
  },
  {
    title: 'Details',
    keys: [
      'offer',
      'requirements',
      'experience',
      'machinery',
      'moq',
      'oemOdm',
      'incoterm',
      'budgetMinor',
      'currency',
      'budgetBasis',
      'notes',
    ],
  },
  { title: 'Results', keys: ['outcomesDetail', 'results'] },
  { title: 'Contact', keys: ['name', 'company', 'email', 'website'] },
];

/** Groups the original brief: known keys in order, unknown keys in Details, duplicates and empty values left out. */
export function groupFields(original: Record<string, unknown>) {
  const seen = new Set<string>();
  const shown = (key: string) => {
    const value = original[key];
    if (internalFields.has(key) || seen.has(key)) return false;
    if (value === '' || value == null) return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return Object.prototype.hasOwnProperty.call(original, key);
  };
  // A market typed as words and the same market as a code say one thing: keep the words.
  if (
    typeof original.market === 'string' &&
    typeof original.marketCode === 'string' &&
    placeName(original.marketCode).toLowerCase() === placeName(original.market).toLowerCase()
  )
    seen.add('marketCode');
  const groups = fieldGroups.map((group) => {
    const keys = group.keys.filter(shown);
    keys.forEach((key) => seen.add(key));
    return { title: group.title, keys };
  });
  const rest = Object.keys(original).filter(shown);
  if (rest.length) groups[2] = { ...groups[2], keys: [...groups[2].keys, ...rest] };
  return groups.filter((group) => group.keys.length > 0);
}

/** Plain labels for the fields of a request. A field without one gets its own name in sentence case. */
const factLabels: Record<string, string> = {
  objective: 'Goal',
  market: 'Target market',
  attendance: 'Visit planned',
  startDate: 'Start date',
  endDate: 'End date',
  timezone: 'Time zone',
  offer: 'Offering or requirement',
  website: 'Website',
  outcomes: 'Desired outcomes',
  notes: 'Additional notes',
  name: 'Contact name',
  company: 'Company',
  email: 'Contact email',
  companyCountry: 'Company country',
  marketCode: 'Target country or trade bloc',
  product: 'Product or service',
  budgetMinor: 'Budget',
  currency: 'Currency',
  budgetBasis: 'Budget basis',
  moq: 'Minimum order quantity (MOQ)',
  oemOdm: 'Custom manufacturing (OEM / ODM)',
  incoterm: 'Delivery term (Incoterm)',
  application: 'Machinery use',
};
/** Sentence case for any field without a written label (CQ-24): "Delivery window", never "Delivery Window". */
function factLabel(key: string, nested: boolean) {
  // The one Goal is the customer's own choice; the requirement objective is the type of work they chose, in words.
  if (key === 'objective' && nested) return 'Type of work';
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return factLabels[key] ?? words.charAt(0).toUpperCase() + words.slice(1);
}
const placeKeys = new Set(['market', 'marketCode', 'companyCountry', 'targetMarkets']);
/** One value in plain words: a country name for a code, one date style, "Dhaka, UTC+6" for a time zone. */
function factValue(key: string, item: unknown, original: Record<string, unknown>): string {
  if (typeof item === 'boolean') return item ? 'Yes' : 'No';
  if (typeof item !== 'string') return String(item);
  if (placeKeys.has(key)) return placeName(item);
  if ((key === 'startDate' || key === 'endDate') && /^\d{4}-\d{2}-\d{2}$/.test(item))
    return formatDate(`${item}T00:00:00Z`, { timeZone: 'UTC' });
  if (key === 'timezone') {
    // The offset is the one on the day the visit starts, where the customer gave a day.
    const start = typeof original.startDate === 'string' ? Date.parse(original.startDate) : NaN;
    try {
      return timeZoneLabel(item, Number.isFinite(start) ? new Date(start) : new Date());
    } catch {
      return item;
    }
  }
  return item;
}

export type RequestFact = { key: string; label: string; value: string | string[] };

/**
 * The original brief as facts a customer reads (D-017): every nested part is opened, a field of the form itself
 * (format marker, type-of-work key, role code) is left out at every depth, and a fact the form wrote twice is shown
 * once. The customer's own words and values are never changed. A budget is left to the exact-money line above the list.
 */
export function requestFacts(
  original: Record<string, unknown>,
): { title: string; rows: RequestFact[] }[] {
  const same = (a: unknown, b: unknown) =>
    typeof a === 'string' &&
    typeof b === 'string' &&
    a.trim().toLowerCase() === b.trim().toLowerCase();
  const leaves: { key: string; path: string; value: unknown; nested: boolean }[] = [];
  const walk = (value: Record<string, unknown>, path: string) => {
    for (const [key, item] of Object.entries(value)) {
      if (internalFields.has(key)) continue;
      if (item && typeof item === 'object' && !Array.isArray(item))
        walk(item as Record<string, unknown>, path + key + '.');
      else leaves.push({ key, path: path + key, value: item, nested: path !== '' });
    }
  };
  walk(original, '');
  const budget = leaves.find((leaf) => leaf.key === 'budgetMinor' && leaf.nested);
  const hasMoney =
    budget?.value !== undefined && leaves.some((leaf) => leaf.key === 'currency' && leaf.value);
  const shown = leaves.filter((leaf) => {
    const { key, value, nested } = leaf;
    if (value === '' || value == null || (Array.isArray(value) && value.length === 0)) return false;
    if (!nested) return true;
    // Written by the form from an answer that is already shown.
    // The form stores the chosen type of work here, as its catalogue words; it is a fact of its own unless it only
    // repeats the Goal. The job key beside it is never shown.
    if (key === 'objective') return !same(value, original.objective);
    if (key === 'product') return !same(value, original.offer);
    if (key === 'marketCode')
      return typeof value !== 'string' || !same(placeName(value), placeNameOf(original.market));
    if (hasMoney && ['budgetMinor', 'currency', 'budgetBasis'].includes(key)) return false;
    return true;
  });
  const used = new Set<string>();
  const rowsFor = (keys: string[]) =>
    keys.flatMap((key) =>
      shown
        .filter((leaf) => leaf.key === key && !used.has(leaf.path))
        // The customer's own top-level answer first: Goal, then Type of work.
        .sort((a, b) => Number(a.nested) - Number(b.nested))
        .map((leaf) => {
          used.add(leaf.path);
          return leaf;
        }),
    );
  const groups = fieldGroups.map((group) => ({ title: group.title, leaves: rowsFor(group.keys) }));
  groups[2].leaves.push(...shown.filter((leaf) => !used.has(leaf.path)));
  return groups
    .filter((group) => group.leaves.length > 0)
    .map((group) => ({
      title: group.title,
      rows: group.leaves.map(({ key, path, value, nested }) => ({
        key: path,
        label: factLabel(key, nested),
        value: Array.isArray(value)
          ? value.map((entry) => factValue(key, entry, original))
          : factValue(key, value, original),
      })),
    }));
}
function placeNameOf(value: unknown) {
  return typeof value === 'string' ? placeName(value) : '';
}
