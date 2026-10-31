// Plain words for a customer's own request (CQ-23, CQ-24). Pure functions over the original brief the
// customer wrote, so every rule is tested without a database. Nothing is invented: a title uses only
// the objective and market the customer chose, and a field the customer left empty is never shown.
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

/** Fields the customer never needs to read: format markers and internal notice versions. */
export const internalFields = new Set(['schemaVersion', 'acknowledged', 'noticeVersion']);

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
