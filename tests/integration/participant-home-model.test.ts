import { describe, expect, it } from 'vitest';
import type { OwnFeeStatus, OwnPlace } from '../../packages/auth/src/customer-programme-terms';
import {
  homeLines,
  outstandingAmounts,
} from '../../apps/web/app/account/delegations/participant-home-model';

// ADR-084 slice S4: the participant home wording is pure and states only what the two existing reads say. Sample
// records; nothing here reads a database.
const id = '00000000-0000-4000-8000-000000000101';
const terms = {
  version: 2,
  included: 'Sample inclusions',
  excluded: null,
  cancellationTerms: 'Sample cancelling',
  changeTerms: 'Sample changes',
  feesApply: true,
  feeNote: null,
};
const place = (over: Partial<OwnPlace> = {}): OwnPlace => ({
  registrationId: id,
  programmeId: '00000000-0000-4000-8000-000000000002',
  programmeName: 'Sample Guangzhou delegation round 1',
  expiresAt: '2099-01-01T00:00:00Z',
  terms,
  acceptedVersion: 2,
  termsCurrent: true,
  criteria: null,
  enrolment: { status: 'PLACED', position: null, reasons: [] },
  placesAvailable: true,
  waitlist: false,
  fees: [],
  tasks: [],
  profileChoices: [],
  sendsMessages: false,
  ...over,
});
const fees = (amounts: OwnFeeStatus['amounts']): OwnFeeStatus => ({
  registrationId: id,
  programmeId: '00000000-0000-4000-8000-000000000002',
  expiresAt: '2099-01-01T00:00:00Z',
  provenance: 'ORGANISER_RECORDED',
  verified: false,
  collectsPayments: false,
  amounts,
});
const usd = {
  currency: 'USD',
  exponent: 2,
  dueMinor: '120000',
  recordedMinor: '20000',
  outstandingMinor: '100000',
};
const bdt = {
  currency: 'BDT',
  exponent: 0,
  dueMinor: '5000',
  recordedMinor: '0',
  outstandingMinor: '5000',
};

describe('participant home lines', () => {
  it('says nothing about a read that has not arrived or failed', () => {
    expect(homeLines({ registrationId: id, place: null, fees: null })).toEqual({
      where: null,
      open: null,
      next: null,
    });
    // A place read for another registration is not this one's.
    expect(homeLines({ registrationId: id + '1', place: place(), fees: null }).where).toBeNull();
  });

  it('keeps each currency on its own, as recorded, never converted or added', () => {
    expect(outstandingAmounts(fees([usd, bdt]))).toEqual(['1000.00 USD', '5000 BDT']);
    const lines = homeLines({ registrationId: id, place: place(), fees: fees([usd, bdt]) });
    expect(lines.open).toContain('1000.00 USD, 5000 BDT');
    expect(lines.open).toContain('Outstanding as recorded by the organiser: ');
    // No total across currencies: neither a sum of the minor units nor a combined figure.
    expect(lines.open).not.toMatch(/6000|1005|total/i);
  });

  it('claims no money when the fee read is missing, fees do not apply, or nothing is outstanding', () => {
    expect(homeLines({ registrationId: id, place: place(), fees: null }).open).toBeNull();
    const none = place({ terms: { ...terms, feesApply: false } });
    expect(homeLines({ registrationId: id, place: none, fees: fees([usd]) }).open).toBeNull();
    const paid = fees([{ ...usd, recordedMinor: '120000', outstandingMinor: '0' }]);
    expect(homeLines({ registrationId: id, place: place(), fees: paid }).open).toBeNull();
    // Recorded above the fee is not a debt.
    const over = fees([{ ...usd, outstandingMinor: '-500' }]);
    expect(homeLines({ registrationId: id, place: place(), fees: over }).open).toBeNull();
  });

  it('words the place without turning an application or a waiting list into a place', () => {
    const where = (enrolment: OwnPlace['enrolment']) =>
      homeLines({ registrationId: id, place: place({ enrolment }), fees: null }).where;
    expect(where({ status: 'PLACED', position: null, reasons: [] })).toBe('Place confirmed');
    expect(where({ status: 'WAITLISTED', position: 3, reasons: [] })).toBe(
      'On the waiting list, number 3',
    );
    expect(where({ status: 'NOT_APPLIED', position: null, reasons: [] })).toBe('No place yet');
    expect(where({ status: 'NOT_ELIGIBLE', position: null, reasons: ['ROLE'] })).toBe(
      'Not eligible',
    );
    expect(where({ status: 'CANCELLED', position: null, reasons: [] })).toBe(
      'You gave up your place',
    );
  });

  it('picks one next step in a fixed order and links only to the existing controls', () => {
    const href = '#registration-' + id;
    const changed = place({
      termsCurrent: false,
      tasks: [{ title: 'Send forms', dueOn: '2026-12-01' }],
    });
    expect(homeLines({ registrationId: id, place: changed, fees: fees([usd]) }).next).toEqual({
      text: 'Read and accept the changed terms',
      href,
    });
    const open = place({ enrolment: { status: 'NOT_APPLIED', position: null, reasons: [] } });
    expect(homeLines({ registrationId: id, place: open, fees: null }).next?.text).toBe(
      'Apply for a place',
    );
    const full = place({
      enrolment: { status: 'NOT_APPLIED', position: null, reasons: [] },
      placesAvailable: false,
      waitlist: false,
    });
    expect(homeLines({ registrationId: id, place: full, fees: null }).next).toBeNull();
    expect(homeLines({ registrationId: id, place: place(), fees: fees([usd]) }).next).toEqual({
      text: 'Review the recorded fee',
      href,
    });
    const tasks = place({ tasks: [{ title: 'Send forms', dueOn: '2026-12-01' }] });
    expect(homeLines({ registrationId: id, place: tasks, fees: null }).next?.text).toBe(
      'Next task: Send forms',
    );
    expect(homeLines({ registrationId: id, place: place(), fees: null }).next).toBeNull();
  });

  it('uses neutral wording: no urgency, no em dash, no verified or paid claim', () => {
    const lines = homeLines({
      registrationId: id,
      place: place({ termsCurrent: false, tasks: [{ title: 'Send forms', dueOn: '2026-12-01' }] }),
      fees: fees([usd]),
    });
    const text = JSON.stringify(lines);
    expect(text).not.toMatch(/—|–|urgent|overdue|immediately|last chance|hurry|verified|paid/i);
  });
});
