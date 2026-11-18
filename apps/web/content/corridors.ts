export const corridorPages = {
  'bangladesh-china': {
    title: 'Bangladesh–China',
    market: 'CN',
    heading: 'Start with the requirement. Then every supplier conversation counts.',
    description:
      'Source products and machinery. Start with a clear specification, evidence of fit and a named next step.',
    jobs: [
      'Product and component sourcing',
      'Machinery and technical evaluation',
      'Factory visits and supplier talks',
      'Commercial delegations',
    ],
    qualification:
      'Where a supplier is based, where you visit and how goods ship are recorded separately. A proposed visit is not a confirmed appointment.',
    reverse:
      'Work from China into Bangladesh is a separate route. Tell us about it in a request and we will say whether we can take it on.',
    available:
      'Sourcing requests for products, components and machinery. Supplier offers stay side by side in their original currency and terms.',
  },
  'bangladesh-spain': {
    title: 'Bangladesh–Spain',
    market: 'ES',
    heading: 'Find a reason for the right buyer or distributor to meet you.',
    description:
      'Build buyer access around your offer and evidence. Carry each conversation into an owned follow-up.',
    jobs: [
      'Buyer and distributor access',
      'Export market validation',
      'Trade-fair preparation and follow-up',
      'Commercial missions',
    ],
    qualification:
      'Spain is one country. A buyer in Spain does not give you access to every EU country. So we plan each country on its own.',
    reverse:
      'Work from Spain into Bangladesh is a separate route. Tell us about it in a request and we will say whether we can take it on.',
    available:
      'Requests to reach buyers and distributors in Spain. Each conversation, sample and follow-up stays on one record with a named owner.',
  },
  'bangladesh-eu': {
    title: 'Bangladesh–EU',
    market: 'EU',
    heading: 'Choose the market inside the broader opportunity.',
    description:
      'Frame an export goal at EU level, then pick the member countries and counterparties that matter.',
    jobs: [
      'Export market access',
      'Buyer and distributor research',
      'Trade-fair productivity',
      'Country-specific market validation',
    ],
    qualification:
      'The EU is a group of countries, not one market and not all of Europe. We agree which member countries matter before any research starts.',
    reverse:
      'For work from an EU country into Bangladesh, name the actual country in your request. We review each one on its own.',
    available:
      'Requests to reach buyers and distributors in the EU countries you choose. Each conversation and follow-up stays on one record.',
  },
} as const;

/** The sentence every open destination without a page of its own carries, in the picker and in its row. */
export const openNote = 'Open now from Bangladesh. Describe your mission and we will review it.';

/**
 * The six open destinations from Bangladesh, as rows of the same size, weight and action in this order (owner step 2
 * board, screen 02, 18 November 2026, on the 17 November routes and markets wording). Key Asian Markets is an open
 * label that names no countries. A row with a `slug` has its own page; the others open the request with the countries
 * filled in. `flag` is the slot for the shared flag mark: it stays empty until that component exists, and Key Asian
 * Markets never gets a country flag.
 */
export const destinationRows = [
  {
    key: 'china',
    name: 'China',
    tagline: 'Buy products and machinery',
    href: '/corridors/bangladesh-china',
  },
  {
    key: 'eu',
    name: 'EU',
    tagline: 'Sell to buyers in EU countries',
    href: '/corridors/bangladesh-eu',
  },
  {
    key: 'uk',
    name: 'UK',
    tagline: 'Sell your products',
    href: '/plan?companyCountry=BD&marketCode=GB',
  },
  {
    key: 'us',
    name: 'US',
    tagline: 'Sell your products',
    href: '/plan?companyCountry=BD&marketCode=US',
  },
  {
    key: 'au',
    name: 'Australia',
    tagline: 'Sell your products',
    href: '/plan?companyCountry=BD&marketCode=AU',
  },
  {
    key: 'asia',
    name: 'Key Asian Markets',
    tagline: 'Name the market in your request',
    href: '/plan?companyCountry=BD',
  },
] as const;
