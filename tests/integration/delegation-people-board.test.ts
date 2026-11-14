import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { switchRegistry } from '../../apps/web/lib/owner-switches';
import { uxSwitchNames, uxSwitchOn } from '../../apps/web/lib/ux-switches';
import {
  boardLead,
  boardRows,
  decisionsFor,
} from '../../apps/web/app/account/delegations/programme-people-board-model';
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

  it('offers the same answers the public page panel offers, and none for an application that is closed', () => {
    expect(decisionsFor('SUBMITTED')).toEqual(['INVITED', 'WAITLISTED', 'DECLINED']);
    expect(decisionsFor('WAITLISTED')).toEqual(['INVITED', 'DECLINED']);
    expect(decisionsFor('INVITED')).toEqual(['DECLINED']);
    expect(decisionsFor('DECLINED')).toEqual(['INVITED', 'WAITLISTED']);
    expect(decisionsFor('INVITATION_EXPIRED')).toEqual(['INVITED', 'WAITLISTED', 'DECLINED']);
    for (const closed of ['JOINED', 'REGISTRATION_ENDED', 'WITHDRAWN'] as const)
      expect(decisionsFor(closed)).toEqual([]);
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
      expect(line).not.toMatch(/[—–]/);
  });
});

describe('money view ordering', () => {
  const person = (label: string, due: string, recorded: string, currency = 'USD') => ({
    label,
    amounts: [{ currency, due, recorded }],
  });
  it('compares exact amounts with BigInt, so one minor unit past 2^53 still counts as owed', () => {
    const big = '9007199254740993';
    const near = '9007199254740992';
    expect(Number(big) === Number(near)).toBe(true);
    expect(owesInAnyCurrency([{ currency: 'BDT', due: big, recorded: near }])).toBe(true);
    expect(owesInAnyCurrency([{ currency: 'BDT', due: big, recorded: big }])).toBe(false);
  });
  it('puts who still owes first and keeps the order read otherwise; it never compares two currencies', () => {
    const rows = [
      person('Synthetic participant 1', '100', '100'),
      person('Synthetic participant 2', '9007199254740993', '9007199254740992', 'BDT'),
      person('Synthetic participant 3', '100', '100'),
      person('Synthetic participant 4', '100', '40'),
    ];
    expect(owesFirst(rows).map((row) => row.label)).toEqual([
      'Synthetic participant 2',
      'Synthetic participant 4',
      'Synthetic participant 1',
      'Synthetic participant 3',
    ]);
    // Owing in one currency while paid in another still counts as owing; nothing is netted.
    expect(
      owesInAnyCurrency([
        { currency: 'USD', due: '100', recorded: '500' },
        { currency: 'BDT', due: '5', recorded: '0' },
      ]),
    ).toBe(true);
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
    expect(entry?.line).not.toMatch(/[—–]/);
    expect(read('scripts/qa/signed-in-sweep.ts')).toContain(`'${name}'`);
  });
  it('reaches the room as one prop that needs the room and the participants, and nothing else', () => {
    expect(read('apps/web/app/account/delegations/[workspaceId]/page.tsx')).toContain(
      `boardEnabled={uxSwitchOn('${name}')}`,
    );
    const list = read('apps/web/app/account/delegations/customer-programmes.tsx');
    expect(list).toContain('const board = boardEnabled && roomEnabled && participantsEnabled;');
    expect(list).toContain('boardFirst={board}');
    expect(list).toContain('compact={board}');
  });
  it('adds no route, read, command or migration: the board imports only the existing client helpers', () => {
    const board = read('apps/web/app/account/delegations/programme-people-board.tsx');
    const urls = [...board.matchAll(/\/api\/[a-z-]+/g)].map((m) => m[0]);
    expect(new Set(urls)).toEqual(new Set(['/api/customer-programme-pages']));
    expect(board).toContain("kind: 'application'");
    expect(board).toContain("action: 'decide'");
  });
});
