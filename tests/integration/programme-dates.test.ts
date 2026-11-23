import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setViewerTimeZone } from '../../apps/web/lib/ux/format';
import { boardingCounts, programmeChecklist } from '../../apps/web/lib/programme-room';

// The programme screens show a date through the product's one formatter (apps/web/lib/ux/format.ts): "24 Oct 2026" for
// a day and "24 Oct 2026, 06:08 (Dhaka, UTC+6)" for a moment, never an ISO string and never a format of their own.
// The lines are built by pure functions, tested here. The panels that draw them read from the server first and are not
// rendered; the public page is rendered in tests/integration/programme-page-view.test.ts.
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const { shortDay } = (await load('app/account/delegations/programme-page-client.ts')) as {
  shortDay: (iso: string) => string;
};
const { feeQuestionLine } = (await load('app/account/delegations/fee-dispute-client.ts')) as {
  feeQuestionLine: (label: string, dispute: { reason: string; filedAt: string }) => string;
};
type AgendaRow = { startsAt: string | null; endsAt: string | null; timezone: string | null };
const { agendaTimes } = (await load('app/account/delegations/programme-projections.tsx')) as {
  agendaTimes: (row: AgendaRow, zone: string | undefined) => string;
};

afterEach(() => setViewerTimeZone(undefined));

describe('a day on the application lists', () => {
  it('is the UTC day of the stored moment, whatever zone the reader is in', () => {
    for (const zone of ['Pacific/Auckland', 'America/Los_Angeles']) {
      setViewerTimeZone(zone);
      expect(shortDay('2026-11-18T23:59:00.000Z')).toBe('18 Nov 2026');
      expect(shortDay('2026-11-18T00:00:00.000Z')).toBe('18 Nov 2026');
    }
  });

  it('is empty for a value that is not a date, instead of failing the whole list', () => {
    expect(shortDay('')).toBe('');
    expect(shortDay('not a date')).toBe('');
  });
});

describe('a fee question as the organiser reads it', () => {
  it('says when it was asked as a full moment in the reader’s zone, not as an ISO day', () => {
    setViewerTimeZone('Asia/Dhaka');
    const line = feeQuestionLine('Dhaka Agro Importers', {
      reason: 'ALREADY_PAID',
      filedAt: '2026-11-01T20:30:00.000Z',
    });
    expect(line).toBe(
      'Dhaka Agro Importers: I have already paid, asked 2 Nov 2026, 02:30 (Dhaka, UTC+6).',
    );
    expect(line).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('is the line the review panel draws', () => {
    const panel = read('apps/web/app/account/delegations/programme-fee-dispute-review.tsx');
    expect(panel).toContain("{feeQuestionLine(labels[d.registrationId] ?? 'A participant', d)}");
    expect(panel).not.toContain('.slice(0, 10)');
  });
});

describe('when a scheduled activity runs', () => {
  const row: AgendaRow = {
    startsAt: '2027-03-09T01:00:00.000Z',
    endsAt: '2027-03-09T03:30:00.000Z',
    timezone: 'Asia/Dhaka',
  };

  it('is shown in the programme’s time zone, with the zone named at both ends', () => {
    expect(agendaTimes(row, 'Asia/Shanghai')).toBe(
      '9 Mar 2027, 09:00 (Shanghai, UTC+8) to 9 Mar 2027, 11:30 (Shanghai, UTC+8)',
    );
  });

  it('falls back to the activity’s own zone when the programme has none', () => {
    expect(agendaTimes(row, undefined)).toBe(
      '9 Mar 2027, 07:00 (Dhaka, UTC+6) to 9 Mar 2027, 09:30 (Dhaka, UTC+6)',
    );
  });

  it('is shown in UTC and says so when no zone was recorded, whatever zone the reader is in', () => {
    setViewerTimeZone('Asia/Dhaka');
    expect(agendaTimes({ ...row, timezone: null }, undefined)).toBe(
      '9 Mar 2027, 01:00 (UTC) to 9 Mar 2027, 03:30 (UTC), time zone not recorded',
    );
  });

  it('is the line the agenda draws', () => {
    const panel = read('apps/web/app/account/delegations/programme-projections.tsx');
    expect(panel).toContain('{row.scheduled && <p>{agendaTimes(row, zone)}</p>}');
  });
});

describe('the programme dates fact of the checklist', () => {
  const counts = boardingCounts({
    invitations: [],
    registrations: [],
    moreInvitations: false,
    moreRegistrations: false,
  });
  const dates = (timezone: string) =>
    programmeChecklist(
      counts,
      {
        readiness: { activeParticipants: 0, readyParticipants: 0 },
        meetings: { state: 'AVAILABLE', scheduled: 0, qualifiedHeld: 0, participantsSharing: 0 },
        agenda: [],
        conflicts: [],
        context: {
          startsAt: '2026-12-01T20:00:00.000Z',
          endsAt: '2026-12-03T20:00:00.000Z',
          timezone,
        },
      },
      null,
    ).find((row) => row.key === 'dates')?.value;

  it('is the two days in the programme’s own time zone', () => {
    setViewerTimeZone('America/Los_Angeles');
    expect(dates('Asia/Dhaka')).toBe('2 Dec 2026 to 4 Dec 2026');
    expect(dates('UTC')).toBe('1 Dec 2026 to 3 Dec 2026');
  });

  it('never falls back to an ISO date when the recorded zone cannot be read', () => {
    setViewerTimeZone('Asia/Dhaka');
    // The formatter then reads the days in the reader's own zone.
    expect(dates('Not/AZone')).toBe('2 Dec 2026 to 4 Dec 2026');
  });
});

describe('no programme screen formats a date on its own', () => {
  it.each([
    'apps/web/app/delegations/[address]/programme-page-view.tsx',
    'apps/web/app/account/delegations/programme-page-client.ts',
    'apps/web/app/account/delegations/programme-projections.tsx',
    'apps/web/app/account/delegations/programme-fee-dispute-review.tsx',
    'apps/web/lib/programme-room.ts',
  ])('%s goes through the shared formatter', (path) => {
    const source = read(path);
    expect(source).not.toContain('Intl.DateTimeFormat');
    expect(source).not.toMatch(/toLocale(Date|Time)?String/);
    expect(source).toMatch(/from '(\.\.\/)+lib\/ux\/format'|from '\.\/ux\/format'|feeQuestionLine/);
  });
});
