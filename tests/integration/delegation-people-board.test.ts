import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { switchRegistry } from '../../apps/web/lib/owner-switches';
import { uxSwitchNames, uxSwitchOn } from '../../apps/web/lib/ux-switches';
import {
  boardLead,
  boardRows,
} from '../../apps/web/app/account/delegations/programme-people-board-model';
import {
  declineReasonLength,
  decisionIntent,
  decisionLabel,
  decisionNote,
  decisionPayload,
  decisionProblem,
  decisionsFor,
} from '../../apps/web/app/account/delegations/programme-application-decisions';
import {
  owesFirst,
  owesInAnyCurrency,
} from '../../apps/web/app/account/delegations/programme-money-model';

// ADR-084 slice S3 (CORRIDRA_DELEGATION_BOARD): the ordering rules and the switch wiring, over records the organiser
// already reads. Sample records only. No database is needed: nothing here reads or writes anything.
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const app = (id: number, status: string, over: Record<string, unknown> = {}) =>
  ({
    id: `app-${id}`,
    status,
    displayLabel: `Synthetic applicant ${id}`,
    statement: 'Synthetic statement',
    appliedAt: `2026-11-0${id}T09:00:00Z`,
    decisionVersion: 1,
    ...over,
  }) as never;
const invitation = (id: number, status: 'ISSUED' | 'USED' | 'UNAVAILABLE', day: number) => ({
  id: `inv-${id}`,
  label: `Synthetic invitation ${id}`,
  expiresAt: `2026-12-${String(day).padStart(2, '0')}T09:00:00Z`,
  status,
});
const registration = (
  id: number,
  status: 'REGISTERED' | 'REVOKED' | 'WITHDRAWN' = 'REGISTERED',
) => ({
  id: `reg-${id}`,
  displayLabel: `Synthetic participant ${id}`,
  consentedAt: `2026-11-1${id}T09:00:00Z`,
  status,
});

describe('people board ordering', () => {
  it('puts applications waiting for an answer first, oldest first, then invited, waiting list, in, and ended last', () => {
    const rows = boardRows(
      [
        app(5, 'DECLINED'),
        app(3, 'WAITLISTED'),
        app(2, 'SUBMITTED'),
        app(1, 'SUBMITTED'),
        app(4, 'INVITED', { invitationExpiresAt: '2026-12-20T00:00:00Z' }),
      ],
      [invitation(1, 'ISSUED', 10), invitation(2, 'USED', 5)],
      [registration(1), registration(2, 'WITHDRAWN')],
    );
    expect(rows.map((row) => row.label)).toEqual([
      'Synthetic applicant 1',
      'Synthetic applicant 2',
      'Synthetic invitation 1',
      'Synthetic applicant 4',
      'Synthetic applicant 3',
      'Synthetic participant 1',
      'Synthetic applicant 5',
      'Synthetic participant 2',
      'Synthetic invitation 2',
    ]);
    expect(rows.map((row) => row.group)).toEqual([
      'decide',
      'decide',
      'waiting',
      'waiting',
      'waitlisted',
      'in',
      'closed',
      'closed',
      'closed',
    ]);
  });

  it('shows a joined application once, as its registration, and keeps it when the registration is not read', () => {
    const joined = app(1, 'JOINED', { registrationId: 'reg-1' });
    expect(boardRows([joined], [], [registration(1)]).map((row) => row.kind)).toEqual([
      'registration',
    ]);
    expect(boardRows([joined], [], []).map((row) => row.kind)).toEqual(['application']);
  });

  it('never calls a registration confirmed or an application a place: states keep their own group', () => {
    const rows = boardRows([app(1, 'JOINED')], [], [registration(1, 'REVOKED')]);
    expect(rows.find((row) => row.kind === 'registration')?.group).toBe('closed');
  });

  it('says only what was read: counts, the next name, and "read so far" while more is unread', () => {
    const rows = boardRows([app(1, 'SUBMITTED'), app(2, 'SUBMITTED')], [], []);
    expect(boardLead(rows, false)).toBe(
      '2 applications are waiting for your answer. Next: Synthetic applicant 1.',
    );
    expect(boardLead(rows, true)).toContain('read so far');
    expect(boardLead([], false)).toBe('No applications, invitations or registrations yet.');
    expect(boardLead(boardRows([], [], [registration(1)]), false)).toBe(
      'Nothing is waiting for your answer.',
    );
    for (const line of [boardLead(rows, true), boardLead([], false)])
      expect(line).not.toMatch(/[\u2014\u2013]/);
  });

  it('makes no claim about applications while they are unread, failed or unavailable', () => {
    const invited = boardRows([], [invitation(1, 'ISSUED', 10)], []);
    for (const applications of ['loading', 'failed', 'unavailable'] as const) {
      // Nothing read at all: no line, never "No applications" or "Nothing is waiting".
      expect(boardLead([], false, { applications, people: 'loading' })).toBeNull();
      expect(boardLead([], false, { applications, people: 'failed' })).toBeNull();
      expect(boardLead([], false, { applications, people: 'ready' })).toBeNull();
      // Invitations read, applications not: only who was invited, and nothing about answers.
      const line = boardLead(invited, false, { applications, people: 'ready' })!;
      expect(line).toBe('1 person has been invited and has not joined yet.');
      expect(line).not.toMatch(/waiting for your answer|No applications/);
    }
  });

  it('says only the applications while the participants are unread, and only who was invited the other way round', () => {
    const waiting = boardRows([app(1, 'SUBMITTED')], [], []);
    for (const people of ['loading', 'failed', 'unavailable'] as const) {
      expect(boardLead(waiting, false, { applications: 'ready', people })).toBe(
        '1 application is waiting for your answer. Next: Synthetic applicant 1.',
      );
      expect(boardLead([], false, { applications: 'ready', people })).toBe('No applications yet.');
      expect(
        boardLead(boardRows([app(2, 'WAITLISTED')], [], []), true, {
          applications: 'ready',
          people,
        }),
      ).toBe('No applications are waiting for your answer read so far.');
    }
    expect(boardLead([], false, { applications: 'none', people: 'loading' })).toBeNull();
    expect(boardLead([], false, { applications: 'none', people: 'ready' })).toBe(
      'No applications, invitations or registrations yet.',
    );
  });

  it('keeps the full lines when everything was read, with or without more to read', () => {
    const ready = { applications: 'ready', people: 'ready' } as const;
    const rows = boardRows([], [invitation(1, 'ISSUED', 10)], [registration(1)]);
    expect(boardLead(rows, false, ready)).toBe(
      'Nothing is waiting for your answer. 1 person has been invited and has not joined yet.',
    );
    expect(boardLead(rows, true, ready)).toContain('read so far');
  });
});

describe('money view ordering', () => {
  const BIG = '9007199254740993';
  const NEAR = '9007199254740992';
  type Status = 'NO_FEE' | 'UNPAID' | 'PART_PAID' | 'PAID' | 'OVERPAID';
  const person = (
    label: string,
    due: string,
    recorded: string,
    status: Status,
    state: 'ACTIVE' | 'WITHDRAWN' | 'REMOVED' = 'ACTIVE',
    currency = 'USD',
  ) => ({ label, state, amounts: [{ currency, due, recorded, status }] });
  it('uses the status the server computed from the exact amounts, so one minor unit past 2^53 still counts as owed', () => {
    expect(Number(BIG) === Number(NEAR)).toBe(true);
    // The server says PART_PAID for BIG due and NEAR recorded; a Number comparison could not tell them apart.
    expect(owesInAnyCurrency([{ status: 'PART_PAID' }])).toBe(true);
    expect(owesInAnyCurrency([{ status: 'UNPAID' }])).toBe(true);
    for (const status of ['NO_FEE', 'PAID', 'OVERPAID'] as const)
      expect(owesInAnyCurrency([{ status }])).toBe(false);
  });
  it('puts active people who still owe first and keeps the order read otherwise; it never compares two currencies', () => {
    const rows = [
      person('Synthetic participant 1', '100', '100', 'PAID'),
      person('Synthetic participant 2', BIG, NEAR, 'PART_PAID', 'ACTIVE', 'BDT'),
      person('Synthetic participant 3', '100', '100', 'PAID'),
      person('Synthetic participant 4', '100', '40', 'PART_PAID'),
    ];
    expect(owesFirst(rows).map((row) => row.label)).toEqual([
      'Synthetic participant 2',
      'Synthetic participant 4',
      'Synthetic participant 1',
      'Synthetic participant 3',
    ]);
    // Owing in one currency while paid in another still counts as owing; nothing is netted.
    expect(owesInAnyCurrency([{ status: 'OVERPAID' }, { status: 'UNPAID' }])).toBe(true);
  });
  it('never puts a withdrawn or removed participant above an active one, even when more is due than recorded', () => {
    const rows = [
      person('Synthetic withdrawn', BIG, NEAR, 'PART_PAID', 'WITHDRAWN', 'BDT'),
      person('Synthetic removed', '500', '0', 'UNPAID', 'REMOVED'),
      person('Synthetic active paid', '100', '100', 'PAID'),
      person('Synthetic active owing', BIG, NEAR, 'PART_PAID', 'ACTIVE', 'BDT'),
    ];
    const ordered = owesFirst(rows);
    expect(ordered.map((row) => row.label)).toEqual([
      'Synthetic active owing',
      'Synthetic active paid',
      'Synthetic withdrawn',
      'Synthetic removed',
    ]);
    // The label is kept as it was, and nothing is dropped.
    expect(ordered).toHaveLength(rows.length);
  });
});

describe('shared application decisions', () => {
  it('offers the same answers the public page panel offers, and none for an application that is closed', () => {
    expect(decisionsFor('SUBMITTED')).toEqual(['INVITED', 'WAITLISTED', 'DECLINED']);
    expect(decisionsFor('WAITLISTED')).toEqual(['INVITED', 'DECLINED']);
    expect(decisionsFor('INVITED')).toEqual(['DECLINED']);
    expect(decisionsFor('DECLINED')).toEqual(['INVITED', 'WAITLISTED']);
    expect(decisionsFor('INVITATION_EXPIRED')).toEqual(['INVITED', 'WAITLISTED', 'DECLINED']);
    for (const closed of ['JOINED', 'REGISTRATION_ENDED', 'WITHDRAWN'] as const)
      expect(decisionsFor(closed)).toEqual([]);
  });
  it('words each answer as the page panel always did', () => {
    expect(decisionLabel('INVITED', 'SUBMITTED')).toBe('Invite to Join');
    expect(decisionLabel('INVITED', 'INVITATION_EXPIRED')).toBe('Invite Again');
    expect(decisionLabel('WAITLISTED', 'SUBMITTED')).toBe('Put on Waiting List');
    expect(decisionLabel('DECLINED', 'SUBMITTED')).toBe('Decline');
  });
  it('asks for a reason of 10 to 500 characters (counted as characters, trimmed) only for a decline', () => {
    expect(declineReasonLength).toEqual({ min: 10, max: 500 });
    expect(decisionNote('INVITED', '  anything  ')).toBe('');
    expect(decisionNote('WAITLISTED', 'anything')).toBe('');
    expect(decisionNote('DECLINED', '  Synthetic reason here  ')).toBe('Synthetic reason here');
    expect(decisionProblem('INVITED', '')).toBeNull();
    expect(decisionProblem('WAITLISTED', '')).toBeNull();
    expect(decisionProblem('DECLINED', 'too short')).toMatch(/reason/i);
    expect(decisionProblem('DECLINED', '1234567890')).toBeNull();
    expect(decisionProblem('DECLINED', 'x'.repeat(500))).toBeNull();
    expect(decisionProblem('DECLINED', 'x'.repeat(501))).not.toBeNull();
    // Ten characters that are twenty UTF-16 units still count as ten.
    expect(decisionProblem('DECLINED', '\u{1F600}'.repeat(10))).toBeNull();
    expect(decisionProblem('DECLINED', '\u{1F600}'.repeat(9))).not.toBeNull();
  });
  it('sends the payload and command id intent it always sent, key for key', () => {
    const item = app(1, 'SUBMITTED', { id: 'app-1', decisionVersion: 7 }) as {
      id: string;
      decisionVersion: number;
    } & Record<string, unknown>;
    const scope = { workspaceId: 'ws-1', programmeId: 'prog-1' };
    const forIntent = (intent: string) => 'cmd:' + intent;
    for (const decision of ['INVITED', 'WAITLISTED', 'DECLINED'] as const) {
      const note = decision === 'DECLINED' ? 'Synthetic reason: the places are full.' : '';
      expect(decisionIntent(item as never, decision, note)).toBe(
        'decide' + 'app-1' + 7 + decision + note,
      );
      // The literal below is what programme-page.tsx built before the rules were shared, in the same key order.
      const before = JSON.stringify({
        kind: 'application',
        action: 'decide',
        commandId: 'cmd:' + 'decide' + 'app-1' + 7 + decision + note,
        workspaceId: 'ws-1',
        programmeId: 'prog-1',
        applicationId: 'app-1',
        expectedVersion: 7,
        decision,
        ...(note ? { note } : {}),
        acknowledged: true,
      });
      expect(JSON.stringify(decisionPayload(scope, item as never, decision, note, forIntent))).toBe(
        before,
      );
    }
  });
  it('is used by both the page panel and the board, which keep no list or rule of their own', () => {
    const board = read('apps/web/app/account/delegations/programme-people-board.tsx');
    const panel = read('apps/web/app/account/delegations/programme-page.tsx');
    for (const source of [board, panel]) {
      expect(source).toContain("from './programme-application-decisions'");
      expect(source).toContain('decisionsFor(');
      expect(source).toContain('decisionPayload(');
      expect(source).not.toMatch(/'INVITATION_EXPIRED'/);
      expect(source).not.toMatch(/'decide' \+/);
    }
  });
});

describe('switch and wiring', () => {
  const name = 'CORRIDRA_DELEGATION_BOARD';
  it('is its own switch, off unless the value is exactly "true", and not the first run switch', () => {
    expect(uxSwitchNames).toContain(name);
    expect(uxSwitchOn(name, {})).toBe(false);
    for (const value of ['1', 'TRUE', 'yes', ' true', ''])
      expect(uxSwitchOn(name, { [name]: value })).toBe(false);
    expect(uxSwitchOn(name, { [name]: 'true' })).toBe(true);
    expect(uxSwitchOn(name, { CORRIDRA_DELEGATION_FIRST_RUN: 'true' })).toBe(false);
  });
  it('is in the owner switch list and the signed-in sweep, with plain words and no em dash', () => {
    const entry = switchRegistry.find((s) => s.name === name);
    expect(entry?.kind).toBe('flag');
    expect(entry?.group).toBe('Programmes and delegations');
    expect(entry?.line).not.toMatch(/[\u2014\u2013]/);
    expect(read('scripts/qa/signed-in-sweep.ts')).toContain(`'${name}'`);
  });
  it('is read from the one switch where the page is rendered (the only wiring a browser test cannot reach)', () => {
    // The room-and-participants condition is proved in the browser (tests/ux/del-s3-people-board.spec.ts: the
    // switch alone shows nothing when either is off); this server page cannot be rendered here.
    expect(read('apps/web/app/account/delegations/[workspaceId]/page.tsx')).toContain(
      `boardEnabled={uxSwitchOn('${name}')}`,
    );
  });
});
