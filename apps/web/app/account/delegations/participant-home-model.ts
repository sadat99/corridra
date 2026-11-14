import type { OwnFeeStatus, OwnPlace } from '@corridra/auth/customer-programme-terms';
import { money } from './terms-client';

// The participant home (ADR-084 slice S4): where I am, what is open for me, what is next. Pure wording over two
// reads the participant account already makes (the place and the recorded fee status). It reads nothing itself,
// estimates nothing and states only what those records say. A read that has not arrived, or failed, gives null for
// its part, so no claim is made about it. Money stays in the currency it was recorded in: one entry per currency,
// never converted and never added across currencies.

export type HomeInput = {
  registrationId: string;
  place: OwnPlace | null;
  fees: OwnFeeStatus | null;
};
export type HomeLines = {
  /** Where I am: the place status in the organiser's records. Null until the place is read. */
  where: string | null;
  /** What is open for me, from the records. Null when nothing is open or the read is missing. */
  open: string | null;
  /** The one next step, linking to the control that already exists. Null when none is offered. */
  next: { text: string } | null;
};

const positive = (minor: string) => BigInt(minor) > BigInt(0);

/** Per currency, as recorded. Never converted, never totalled. */
export function outstandingAmounts(fees: OwnFeeStatus | null): string[] {
  if (!fees) return [];
  return fees.amounts
    .filter((a) => positive(a.outstandingMinor))
    .map((a) => money(a.outstandingMinor, a.exponent) + ' ' + a.currency);
}

export function placeWords(place: OwnPlace): string {
  const { status, position } = place.enrolment;
  if (status === 'PLACED') return 'Place confirmed';
  if (status === 'WAITLISTED')
    return 'On the waiting list' + (position ? ', number ' + position : '');
  if (status === 'NOT_ELIGIBLE') return 'Not eligible';
  if (status === 'CANCELLED') return 'You gave up your place';
  return 'No place yet';
}

export function homeLines({ registrationId, place, fees }: HomeInput): HomeLines {
  if (!place || place.registrationId !== registrationId)
    return { where: null, open: null, next: null };
  const status = place.enrolment.status;
  const holding = status === 'PLACED' || status === 'WAITLISTED';
  const termsChanged = holding && !!place.terms && place.termsCurrent === false;
  // The fee read is only made where the terms say fees apply; without it nothing is said about money.
  const owed = place.terms?.feesApply ? outstandingAmounts(fees) : [];
  const tasks = status === 'PLACED' ? place.tasks : [];
  const parts: string[] = [];
  if (termsChanged) parts.push('Changed terms to accept');
  if (owed.length > 0) parts.push('Outstanding as recorded by the organiser: ' + owed.join(', '));
  for (const t of tasks.slice(0, 1))
    parts.push('Task ' + t.title + (t.dueOn ? ', due ' + t.dueOn : ''));
  if (tasks.length > 1)
    parts.push(tasks.length - 1 + (tasks.length === 2 ? ' more task' : ' more tasks'));
  let next: HomeLines['next'] = null;
  if (termsChanged) next = { text: 'Read and accept the changed terms' };
  else if (status === 'NOT_APPLIED' && (place.placesAvailable || place.waitlist))
    next = { text: 'Apply for a place' };
  else if (owed.length > 0) next = { text: 'Review the recorded fee' };
  else if (tasks.length > 0) next = { text: 'Next task: ' + tasks[0]!.title };
  return { where: placeWords(place), open: parts.length ? parts.join('; ') + '.' : null, next };
}
