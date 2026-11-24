import { afterEach, describe, expect, test } from 'vitest';
import { dayText } from '../../apps/web/app/account/billing/billing-client';
import { setViewerTimeZone } from '../../apps/web/lib/ux/format';

// ADR-092 (unit B8). A billing period, issue, due, payment or credit date is a calendar day with no time. It is
// formatted in UTC, so a reader west of UTC sees the same day as everyone else, never the day before.
afterEach(() => setViewerTimeZone(undefined));

describe('billing dates are calendar days', () => {
  test('a day reads the same for a reader west of UTC, east of UTC and in UTC', () => {
    for (const zone of ['America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Dhaka', 'UTC']) {
      setViewerTimeZone(zone);
      expect(dayText('2026-10-23'), zone).toBe('23 Oct 2026');
      expect(dayText('2026-01-01'), zone).toBe('1 Jan 2026');
      // A stored instant that means a day keeps its day too.
      expect(dayText('2026-12-31T00:00:00.000Z'), zone).toBe('31 Dec 2026');
    }
  });
  test('nothing to show stays nothing, and an unreadable value is shown as it is', () => {
    expect(dayText(null)).toBeNull();
    expect(dayText('not a date')).toBe('not a date');
  });
});
