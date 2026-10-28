import { briefSchema, realBriefSchema, type MissionBrief } from './missions';
import {
  realCustomerInput,
  customerLabelAllowed,
  customerWebsiteAllowed,
} from './customer-input-mode';

// Names follow the V3 contract's three customer-facing products plus the secondary entry.
export const missionDraftFamilyLabels = {
  BUYERS_PARTNERS: 'Find buyers and business partners',
  SUPPLIERS_PRODUCTS: 'Find suppliers and source products',
  DELEGATION: 'Organise a delegation',
  OTHER: 'Another international business objective',
} as const;
export type MissionDraftFamily = keyof typeof missionDraftFamilyLabels;

// Objectives the existing request already accepts, grouped by the family they serve.
export const missionDraftObjectives: Record<MissionDraftFamily, MissionBrief['objective'][]> = {
  BUYERS_PARTNERS: [
    'Sell in a new market',
    'Find customers or distributors',
    'Make an upcoming business trip more productive',
  ],
  SUPPLIERS_PRODUCTS: ['Source suppliers', 'Make an upcoming business trip more productive'],
  DELEGATION: ['Run a multi-company mission', 'Make an upcoming business trip more productive'],
  OTHER: ['Something else', 'Make an upcoming business trip more productive'],
};

// Contract section 2, Product 2: context-dependent sourcing capabilities (V3-02-034 to 038).
export const sourcingContextLabels = {
  MACHINERY: 'Machinery or equipment',
  FINISHED_PRODUCTS: 'Finished products',
  MATERIALS_COMPONENTS: 'Raw materials or components',
  OEM_CUSTOM: 'OEM or custom manufacturing',
  OTHER_PROCUREMENT: 'Other procurement',
} as const;
export type SourcingContext = keyof typeof sourcingContextLabels;

// Customer-selected context, not a completed stage or a readiness decision. Store it as an
// ordinary versioned requirement so the unchanged request carries it to the operator.
export const requestStartingPoints = [
  'A product photo, description or idea',
  'An existing supplier',
  'An existing price quote or request for quotation',
  'An approved specification or repeat order',
  'A planned trip, factory visit or trade fair',
  'A negotiation or commercial follow-up',
  'A search for buyers, distributors or partners',
] as const;
export const startingPointLabel = 'Current position';

export function startingPointValue(point: (typeof requestStartingPoints)[number]) {
  return `${realCustomerInput() ? '' : 'Synthetic '}${point}`;
}

const sourcingCommon = [
  'Technical requirements',
  'Commercial requirements',
  'Regulatory requirements',
  'Delivery requirements',
];
const sourcingContextPrompts: Record<SourcingContext, string[]> = {
  MACHINERY: [
    'Application',
    'Capacity',
    'Power',
    'Installation',
    'Commissioning',
    'Acceptance tests',
    'Warranties',
    'Spares',
    'Maintenance',
    'After-sales support',
  ],
  FINISHED_PRODUCTS: [
    'Specifications',
    'Quality',
    'Packaging',
    'Certifications where applicable',
    'MOQ',
    'Lead times',
    'Delivery',
  ],
  MATERIALS_COMPONENTS: [
    'Grades',
    'Tolerances',
    'Consistency',
    'Testing',
    'Supply continuity',
    'Traceability',
  ],
  OEM_CUSTOM: [
    'Drawings',
    'Tooling',
    'Samples',
    'IP and confidentiality',
    'Production capacity',
    'Quality acceptance',
  ],
  // Category-specific criteria need reviewed configuration, which does not exist yet.
  OTHER_PROCUREMENT: [],
};

// Suggestions only. A customer may use, rename or ignore any line; nothing is required.
export function requirementPrompts(
  family: MissionDraftFamily,
  context: SourcingContext | null,
): string[] {
  if (family === 'BUYERS_PARTNERS')
    return [
      'Offering and capacity',
      'Commercial objective',
      'Event or fair',
      'Preferred meeting location',
      'Target buyer or distributor profile',
    ];
  if (family === 'SUPPLIERS_PRODUCTS')
    return [...sourcingCommon, ...(context ? sourcingContextPrompts[context] : [])];
  if (family === 'DELEGATION')
    return [
      'Destination, event or programme',
      'Objectives',
      'Sectors',
      'Eligibility',
      'Capacity',
      'Participation terms',
    ];
  return [];
}

export type DraftForBrief = {
  family: MissionDraftFamily;
  objective: MissionBrief['objective'] | null;
  market: string;
  attendance: 'Yes' | 'No' | 'Not decided';
  startDate: string;
  endDate: string;
  timezone: string;
  offer: string;
  website: string;
  outcomes: MissionBrief['outcomes'];
  notes: string;
  requirements: { label: string; value: string }[];
  contactName: string;
  contactEmail: string;
  companyName: string;
};

// The customer's own words are carried unchanged. Requirement lines are appended after the offer
// text rather than interpreted, so the original request still shows exactly what was written.
export function composeOffer(d: Pick<DraftForBrief, 'offer' | 'requirements'>) {
  const lines = d.requirements.map((r) => `${r.label}: ${r.value}`);
  return [d.offer, ...(lines.length ? ['', 'Requirements:', ...lines] : [])].join('\n').trim();
}

// Judge whether a draft can become the existing request. Returns plain-language gaps, never a score.
export function draftReadiness(d: DraftForBrief): { ready: boolean; gaps: string[] } {
  const gaps: string[] = [];
  const parsed = (realCustomerInput() ? realBriefSchema : briefSchema).safeParse({
    objective: d.objective ?? undefined,
    market: d.market,
    attendance: d.attendance,
    startDate: d.startDate,
    endDate: d.endDate,
    timezone: d.timezone,
    offer: composeOffer(d),
    website: d.website,
    outcomes: d.outcomes,
    notes: d.notes,
    name: d.contactName,
    company: d.companyName,
    email: d.contactEmail,
    acknowledged: true,
  });
  // Requirement lines support the offer; they never stand in for saying what is offered or needed.
  if (d.offer.trim().length < 10) gaps.push('what you offer or need (at least 10 characters)');
  if (!parsed.success) {
    const names: Record<string, string> = {
      objective: 'what you want to do',
      market: 'the target country or market',
      attendance: 'whether you will attend in person',
      startDate: 'the visit start date',
      endDate: 'the visit end date',
      offer: 'a shorter offer and requirements (2000 characters in total)',
      outcomes: 'at least one outcome you want',
      name: 'your name',
      company: 'your company name',
      email: 'a test email address',
      website: 'a valid website address',
      timezone: 'a time zone',
    };
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '');
      // An empty offer is already named above in plainer words.
      if (key === 'offer' && d.offer.trim().length < 10) continue;
      const text = names[key] ?? issue.message;
      if (!gaps.includes(text)) gaps.push(text);
    }
  }
  return { ready: gaps.length === 0, gaps };
}

export function composeBrief(d: DraftForBrief): MissionBrief | null {
  const parsed = (realCustomerInput() ? realBriefSchema : briefSchema).safeParse({
    objective: d.objective ?? undefined,
    market: d.market,
    attendance: d.attendance,
    startDate: d.startDate,
    endDate: d.endDate,
    timezone: d.timezone,
    offer: composeOffer(d),
    website: d.website,
    outcomes: d.outcomes,
    notes: d.notes,
    name: d.contactName,
    company: d.companyName,
    email: d.contactEmail,
    acknowledged: true,
  });
  return parsed.success && d.offer.trim().length >= 10 ? parsed.data : null;
}

// A command id derived from the draft and its exact version. Sending the same version twice reuses the
// same id, so the existing request path answers with the original request instead of making a duplicate,
// and no retry details need to live in browser storage.
export async function draftCommandId(purpose: string, draftId: string, version: number) {
  const bytes = new Uint8Array(
    await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`corridra.draft.${purpose}:${draftId}:${version}`),
    ),
  ).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type DraftFormValues = DraftForBrief & {
  title: string;
  sourcingContext: SourcingContext | null;
  profileVersion: number | null;
};
export type DraftProblem = { field: string; message: string };

const control = /[\u0000-\u001f\u007f]/u;
const reservedHost =
  /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.(example|test|invalid)(\/[A-Za-z0-9._~/-]*)?$/;
const validDate = (v: string) =>
  v === '' ||
  (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v);
const syntheticOrEmpty = (v: string) => v === '' || customerLabelAllowed(v.trim());

// Saving rules only. A draft may be incomplete; readiness to send is judged by draftReadiness.
// These rules mirror the server schema and database checks so a customer sees problems before saving.
export function draftProblems(d: DraftFormValues): DraftProblem[] {
  const out: DraftProblem[] = [];
  const add = (field: string, message: string) => out.push({ field, message });
  const synthetic = realCustomerInput()
    ? 'Enter a clear description with at least two characters.'
    : 'While Corridra is in test mode, start this with the word Synthetic.';
  if (!customerLabelAllowed(d.title.trim()) || control.test(d.title))
    add(
      'title',
      realCustomerInput()
        ? 'Give the request a name with at least two characters.'
        : 'Give the request a name that starts with Synthetic and has at least 11 characters.',
    );
  for (const [field, value] of [
    ['offer', d.offer],
    ['notes', d.notes],
    ['companyName', d.companyName],
  ] as const)
    if (!syntheticOrEmpty(value.trim()) || control.test(value)) add(field, synthetic);
  if (d.offer.length > 2000) add('offer', 'Use at most 2000 characters.');
  if (d.notes.length > 1000) add('notes', 'Use at most 1000 characters.');
  if (d.companyName.length > 160) add('companyName', 'Use at most 160 characters.');
  if (d.market.length > 120) add('market', 'Use at most 120 characters.');
  if (!validDate(d.startDate)) add('startDate', 'Enter a valid date.');
  if (!validDate(d.endDate)) add('endDate', 'Enter a valid date.');
  if (d.startDate && d.endDate && d.endDate < d.startDate)
    add('endDate', 'The end date must follow the start date.');
  if (
    d.website.trim() !== '' &&
    !reservedHost.test(d.website.trim()) &&
    !customerWebsiteAllowed(d.website.trim())
  )
    add(
      'website',
      realCustomerInput()
        ? 'Enter a valid HTTPS website address.'
        : 'While Corridra is in test mode, use an example, test or invalid website address.',
    );
  if (
    d.contactEmail !== '' &&
    !(realCustomerInput()
      ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.contactEmail)
      : /^[a-z0-9._+-]+@example\.invalid$/.test(d.contactEmail))
  )
    add(
      'contactEmail',
      realCustomerInput()
        ? 'Enter a valid contact email address.'
        : 'Use a test address ending in @example.invalid.',
    );
  if (d.contactName.trim() !== '' && d.contactName.trim().length < 2)
    add('contactName', 'Enter at least 2 characters.');
  if (new Set(d.outcomes).size !== d.outcomes.length) add('outcomes', 'Choose each outcome once.');
  if (d.requirements.length > 20) add('requirements', 'Use at most 20 requirement lines.');
  const labels = new Set<string>();
  d.requirements.forEach((r, i) => {
    const label = r.label.trim();
    if (label.length < 2 || label.length > 60 || control.test(label))
      add('requirements.' + i + '.label', 'Use 2 to 60 characters.');
    if (labels.has(label.toLowerCase()))
      add('requirements.' + i + '.label', 'Use each label once.');
    labels.add(label.toLowerCase());
    const value = r.value.trim();
    if (!customerLabelAllowed(value) || value.length > 300 || control.test(value))
      add(
        'requirements.' + i + '.value',
        realCustomerInput()
          ? 'Use 2 to 300 characters.'
          : 'Start with Synthetic and use 11 to 300 characters.',
      );
  });
  return out;
}
