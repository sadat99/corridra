// The Buying Trip starter (ADR-084 slice S7). It is a generic starting plan, not stored data: the words are fixed here
// and become an ordinary private workspace template only when the organiser saves it with the existing template save
// command. It holds tasks only: no costs, prices, fees, people, dates, countries or companies. A host or factory an
// organiser later names on a page is that organiser's own statement; nothing here links, checks or verifies one.
// Everything is shown only while CORRIDRA_DELEGATION_BUYING_TRIP is "true" and the template module is on.

/** The select value for the starter in the first run. It is not a template id, so it can never be sent as one. */
export const buyingTripStarterId = 'starter:buying-trip';
export const buyingTripStarterName = 'Buying trip';
export const buyingTripStarterLabel = 'Buying trip (starter)';

type StarterContent = {
  reportingPurpose: string;
  capacity: null;
  tasks: {
    title: string;
    detail: string | null;
    dueOffsetDays: null;
    assigneeLabel: null;
  }[];
  plannedCosts: [];
};

const taskWords: readonly (readonly [string, string])[] = [
  [
    'List the factories and hosts to visit',
    'Write each name as your own statement. Corridra does not check it.',
  ],
  [
    'Agree the visit days with each host',
    'Note the day and place each host offers before anything is shared.',
  ],
  [
    'Confirm each visit with the host in writing',
    'A visit stays planned until the host has confirmed it.',
  ],
  [
    'Ask each traveller to check their own entry and visa needs',
    'Use the official source. Corridra does not check this.',
  ],
  [
    'Prepare product questions and sample requests for each visit',
    'Keep one list per visit so the answers can be compared.',
  ],
  [
    'Record what each visit produced and the next step',
    'Write what happened and what is still open.',
  ],
];

/** In a sample workspace every private word starts with "Synthetic ", as the template rules there require. */
const mark = (sample: boolean, text: string) => (sample ? 'Synthetic ' + text : text);

export function buyingTripStarterSave(sample: boolean): {
  name: string;
  description: string;
  content: StarterContent;
} {
  return {
    name: mark(sample, buyingTripStarterName),
    description: mark(
      sample,
      'Starter plan for factory visits and host meetings. It holds no people, fees or costs.',
    ),
    content: {
      reportingPurpose: mark(
        sample,
        'Plan factory visits and host meetings for a buying trip, then record what happened.',
      ),
      capacity: null,
      tasks: taskWords.map(([title, detail]) => ({
        title: mark(sample, title),
        detail: mark(sample, detail),
        dueOffsetDays: null,
        assigneeLabel: null,
      })),
      plannedCosts: [],
    },
  };
}

/** The public page lines the first run pre-fills. Every one is PLANNED: nothing here is a confirmed visit. */
export const buyingTripActivities: readonly string[] = [
  'Factory visits',
  'Host meetings',
  'Sample review',
];
export const buyingTripActivityText = buyingTripActivities.join('\n');
