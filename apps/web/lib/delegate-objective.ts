import { customerLabelAllowed } from '@corridra/domain/customer-input-mode';
import type { DraftFormValues } from '@corridra/domain/mission-drafts';
import { privateRequestStoragePrefix } from './private-request-storage';

// The delegate's objective, carried instead of asked again (ADR-080 follow-through).
// A person says what they want once, when they apply to a programme. These helpers turn those same words into the
// starting point of their private request and name the next step toward sharing one sentence with the organiser.
// Pure: no storage, no network. Nothing here grants access, and nothing is written until the person presses a button.

/** The kinds of private request a delegate can start from a programme (guided draft families). */
export const delegateDirections = ['SUPPLIERS_PRODUCTS', 'BUYERS_PARTNERS', 'OTHER'] as const;
export type DelegateDirection = (typeof delegateDirections)[number];

// The button a delegate presses names the objective in the request's own vocabulary, so it is not asked again.
const objectiveFor = {
  SUPPLIERS_PRODUCTS: 'Source suppliers',
  BUYERS_PARTNERS: 'Find customers or distributors',
  OTHER: 'Make an upcoming business trip more productive',
} as const;
const control = /[\u0000-\u001f\u007f]/gu;
const clean = (value: string, max: number) =>
  value.replace(control, ' ').trim().slice(0, max).trim();
/** Text the request rules accept as written; anything else is left empty for the person to write. */
const allowed = (value: string, max: number) => {
  const text = clean(value, max);
  return customerLabelAllowed(text) ? text : '';
};

/**
 * The details of a guided private request started from a programme. Every value is the delegate's own words or the
 * programme's name: the statement becomes the description, the display name the company, and the note says where
 * the request came from so the team does not have to ask. Dates, market, outcomes and contact stay empty, because
 * nothing here knows them. The person reviews and completes the draft before anything is sent.
 */
export function draftFromObjective(input: {
  programmeName: string;
  statement: string;
  displayLabel: string;
  direction: DelegateDirection;
}): DraftFormValues {
  const name = clean(input.programmeName, 100);
  const title = allowed(`${name}: my objective`, 120) || allowed(name, 120);
  return {
    title,
    family: input.direction,
    objective: objectiveFor[input.direction],
    market: '',
    attendance: 'Not decided',
    startDate: '',
    endDate: '',
    timezone: 'UTC',
    offer: allowed(input.statement, 2000),
    website: '',
    outcomes: [],
    notes: allowed(
      `Started from the programme "${name}", where I am a registered participant.`,
      1000,
    ),
    requirements: [],
    contactName: '',
    contactEmail: '',
    profileVersion: null,
    sourcingContext: null,
    companyName: allowed(input.displayLabel, 160),
  };
}

export type DelegateStep = 'request' | 'share' | 'results';
/**
 * The one next step for a delegate. A shared objective needs a private request to stand on (the organiser sees a
 * sentence about a real request, never a loose claim), so the order is fixed: request, then share, then results.
 * `null` counts mean "not known" (a read failed or a module is off): the path then claims nothing as done.
 */
export function delegateNextStep(state: {
  privateRequests: number | null;
  sharedObjectives: number | null;
}): DelegateStep {
  if ((state.sharedObjectives ?? 0) > 0) return 'results';
  if ((state.privateRequests ?? 0) > 0) return 'share';
  return 'request';
}

// Where a delegate was heading when they left the programme to write their request. Kept in this tab only, so the
// screen that confirms the request can lead straight back to sharing. Navigation only: ids and a name, never access.
// Under the private request prefix, so sign-out clears it with the other private request state.
export const objectiveReturnKey = privateRequestStoragePrefix + 'objective-return';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type ObjectiveReturn = { registrationId: string; draftId: string; programmeName: string };

export function saveObjectiveReturn(storage: Storage, value: ObjectiveReturn) {
  try {
    storage.setItem(
      objectiveReturnKey,
      JSON.stringify({
        registrationId: value.registrationId,
        draftId: value.draftId,
        programmeName: clean(value.programmeName, 160),
        savedAt: Date.now(),
      }),
    );
  } catch {
    /* Storage can be unavailable. The delegate can still return through Delegations. */
  }
}
export function readObjectiveReturn(storage: Storage, now = Date.now()): ObjectiveReturn | null {
  try {
    const raw = storage.getItem(objectiveReturnKey);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ObjectiveReturn> & { savedAt?: number };
    if (
      typeof v.registrationId !== 'string' ||
      !uuid.test(v.registrationId) ||
      typeof v.draftId !== 'string' ||
      !uuid.test(v.draftId) ||
      typeof v.programmeName !== 'string' ||
      v.programmeName.length > 160 ||
      typeof v.savedAt !== 'number' ||
      now - v.savedAt > 24 * 3600 * 1000 ||
      v.savedAt > now + 60000
    ) {
      storage.removeItem(objectiveReturnKey);
      return null;
    }
    return { registrationId: v.registrationId, draftId: v.draftId, programmeName: v.programmeName };
  } catch {
    return null;
  }
}
export function clearObjectiveReturn(storage: Storage) {
  try {
    storage.removeItem(objectiveReturnKey);
  } catch {
    /* Nothing to clear. */
  }
}
