import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatMoment, formatUtcDay, setViewerTimeZone } from '../../apps/web/lib/ux/format';
import {
  evidenceRequestStatusWords,
  meetingStatusWords,
  missionStatusWords,
} from '../../apps/web/lib/ux/mission-status-words';
import { missionStatusNames } from '../../apps/web/components/mr/road-status';

// Audit A5 (owner-approved audit, 14 November 2026): customer pages read "20 Nov 2026" and not "Nov 20, 2026, 12:00 AM (UTC)",
// a status chip is never a raw or lower-case code, an internal publication id is not shown, and the report copy has its spaces.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;

describe('customer dates', () => {
  it('a stored date reads as a day, in the product style, whatever the viewer zone is', () => {
    setViewerTimeZone('America/New_York');
    try {
      // Midnight UTC is the evening before in New York: the day must not shift.
      expect(formatUtcDay('2026-11-20T00:00:00Z')).toBe('20 Nov 2026');
      expect(formatUtcDay('2099-01-01T00:00:00.000Z')).toBe('1 Jan 2099');
    } finally {
      setViewerTimeZone(undefined);
    }
  });
  it('a moment keeps its time and names the zone of the record, never the viewer', () => {
    setViewerTimeZone('America/New_York');
    try {
      expect(formatMoment('2026-11-09T04:00:00Z', 'Asia/Dhaka')).toBe(
        '9 Nov 2026, 10:00 (Dhaka, UTC+6)',
      );
      expect(formatMoment('2026-11-10T01:00:00Z')).toBe('10 Nov 2026, 01:00 (UTC)');
    } finally {
      setViewerTimeZone(undefined);
    }
  });
  it('is language aware: Bangla keeps the order and uses its own numerals', () => {
    const bn = formatUtcDay('2026-11-20T00:00:00Z', 'bn-BD');
    expect(bn).not.toBe('20 Nov 2026');
    expect(bn).not.toMatch(/2026/);
  });
});

describe('status words', () => {
  it('every mission status has a fixed Title Case word, never a lower-case code', () => {
    for (const code of missionStatusNames) {
      const words = missionStatusWords(code);
      expect(words, code).toMatch(/^[A-Z]/);
      expect(words, code).not.toMatch(/[_]/);
      expect(words, code).not.toBe(code.toLowerCase());
    }
    expect(missionStatusWords('MEETINGS')).toBe('Meetings');
    expect(missionStatusWords('FOLLOW_UP')).toBe('Follow-Up');
  });
  it('an unknown code is still shown as words in Title Case', () => {
    expect(missionStatusWords('SOME_NEW_CODE')).toBe('Some New Code');
    expect(meetingStatusWords('RESCHEDULE_REQUIRED')).toBe('New Time Needed');
    expect(meetingStatusWords('SCHEDULED')).toBe('Time Confirmed');
    expect(evidenceRequestStatusWords('OPEN')).toBe('Open');
  });
});

describe('the mission passport', () => {
  const mission = {
    publicationId: 'pub-1',
    title: 'Cutting machine mission',
    company: 'Atelier Rahman',
    objective: 'Find an automatic cutting machine',
    brief: 'Sample mission',
    nextAction: 'Review the offers',
    dueAt: '2026-11-05T00:00:00Z',
    reviewedAt: '2026-10-08T00:00:00Z',
    updatedAt: '2026-10-08T00:00:00Z',
    status: 'MEETINGS',
    itinerary: [],
    totals: [],
    outcomes: { heldMeetings: 0 },
  };
  it('shows a Title Case status, a product style date and no internal id', async () => {
    const { MissionPassport } = await import('../../apps/web/components/mission-passport');
    const html = renderToStaticMarkup(createElement(MissionPassport, { mission }));
    expect(html).toContain('data-tone="neutral">Meetings</span>');
    expect(html).not.toContain('>meetings<');
    expect(html).toContain('Due 5 Nov 2026');
    expect(html).toContain('8 Oct 2026');
    expect(html).not.toMatch(/AM \(UTC\)|PM \(UTC\)/);
    // The internal id is kept for support in a data attribute, never read out or shown as customer text.
    expect(html).not.toContain('Publication reference');
    expect(html).not.toMatch(/>pub-1</);
    expect(html).toContain('data-publication-id="pub-1"');
  });
});

describe('saved report copy', () => {
  const source = readFileSync(
    resolve('apps/web/app/account/missions/saved-commercial-report.tsx'),
    'utf8',
  );
  it('has a space after every comma in its sentences', () => {
    for (const bad of [
      'scope,not',
      'company,contact,offer',
      'Companies,qualification',
      'observations,not',
      'self-declarations,not',
    ])
      expect(source, bad).not.toContain(bad);
  });
  it('shows no raw status code and no old date style', () => {
    expect(source).not.toContain('{meeting.status}');
    expect(source).not.toContain('{q.status}');
    expect(source).not.toContain('displayDate');
  });
});
