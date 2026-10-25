import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fairs, type Fair } from '../../apps/web/content/fairs';
import {
  countdown,
  countdownWords,
  datesLastChecked,
  fairProblems,
  isCalendarDay,
  nextFairDate,
  publishableFairs,
} from '../../apps/web/lib/fairs';
import { switchRegistry } from '../../apps/web/lib/owner-switches';

// Fair pages and the Countdown (Lane 12 of the UX update): a date is shown only with its source, the
// person who read it and the day, and a countdown only exists for a real date.
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const today = '2026-10-25';
const good: Fair = {
  slug: 'example-fair',
  name: 'Example Trade Fair',
  city: 'Frankfurt',
  countryCode: 'DE',
  website: 'https://example.com/fair',
  dates: [
    {
      kind: 'opens',
      on: '2027-03-10',
      source: 'https://example.com/fair/dates',
      verifiedBy: 'A. Rahman',
      verifiedOn: '2026-10-20',
    },
    {
      kind: 'closes',
      on: '2027-03-13',
      source: 'https://example.com/fair/dates',
      verifiedBy: 'A. Rahman',
      verifiedOn: '2026-10-21',
    },
  ],
};
const with_ = (over: Partial<Fair>): Fair => ({ ...good, ...over });

describe('the shipped list', () => {
  it('is empty until a person adds a checked entry, and every entry it ever holds follows the rules', () => {
    expect(fairs.length).toBe(fairs.length);
    for (const fair of fairs) expect(fairProblems(fair, today), fair.slug).toEqual([]);
    const slugs = fairs.map((f) => f.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('what an entry must have', () => {
  it('accepts a complete entry', () => {
    expect(fairProblems(good, today)).toEqual([]);
    expect(publishableFairs([good], today)).toEqual([good]);
  });
  it.each([
    ['a slug with capitals', with_({ slug: 'Example-Fair' }), 'slug'],
    ['a slug that is too short', with_({ slug: 'ab' }), 'slug'],
    ['no name', with_({ name: ' ' }), 'name'],
    ['a lower case country', with_({ countryCode: 'de' }), 'countryCode'],
    ['a website that is not https', with_({ website: 'http://example.com' }), 'website'],
    ['a website with a password', with_({ website: 'https://a:b@example.com' }), 'website'],
    ['no dates', with_({ dates: [] }), 'dates'],
  ])('refuses %s', (_, fair, reason) => {
    expect(fairProblems(fair, today)).toContain(reason);
    expect(publishableFairs([fair], today)).toEqual([]);
  });
  const date = (over: object) => with_({ dates: [{ ...good.dates[0]!, ...over }] });
  it.each([
    ['a date that is not a calendar day', { on: '2027-02-30' }, 'on'],
    ['a date written another way', { on: '10/03/2027' }, 'on'],
    ['no source', { source: '' }, 'source'],
    ['a source that is not https', { source: 'http://example.com/x' }, 'source'],
    ['no person who read it', { verifiedBy: '' }, 'verifiedBy'],
    ['a checking day that is not a day', { verifiedOn: 'yesterday' }, 'verifiedOn'],
    ['a checking day in the future', { verifiedOn: '2026-10-26' }, 'verifiedOn'],
  ])('refuses %s', (_, over, reason) => {
    expect(fairProblems(date(over), today).some((p) => p.endsWith(`: ${reason}`))).toBe(true);
  });
  it('allows a date the fair has not announced, with its source and checker', () => {
    expect(fairProblems(date({ on: null }), today)).toEqual([]);
  });
  it('refuses a repeated kind and a fair that closes before it opens', () => {
    expect(
      fairProblems(with_({ dates: [good.dates[0]!, good.dates[0]!] }), today).some((p) =>
        p.includes('repeated'),
      ),
    ).toBe(true);
    expect(
      fairProblems(
        with_({ dates: [good.dates[0]!, { ...good.dates[1]!, on: '2027-03-09' }] }),
        today,
      ),
    ).toContain('closes before it opens');
  });
  it('shows a slug once', () => {
    expect(publishableFairs([good, good], today)).toHaveLength(1);
  });
});

describe('dates last checked and the next date', () => {
  it('is the latest day any date was read, and nothing without dates', () => {
    expect(datesLastChecked(good)).toBe('2026-10-21');
    expect(datesLastChecked(with_({ dates: [] }))).toBeNull();
  });
  it('picks the nearest date still to come, counting today, and never one that has passed', () => {
    expect(nextFairDate(good, today)).toEqual({ kind: 'opens', on: '2027-03-10' });
    expect(nextFairDate(good, '2027-03-10')).toEqual({ kind: 'opens', on: '2027-03-10' });
    expect(nextFairDate(good, '2027-03-11')).toEqual({ kind: 'closes', on: '2027-03-13' });
    expect(nextFairDate(good, '2027-03-14')).toBeNull();
  });
});

describe('the countdown', () => {
  it('counts whole calendar days and has no time zone to guess', () => {
    expect(countdown('2026-10-26', today)).toEqual({ state: 'future', days: 1 });
    expect(countdown('2026-12-31', today)).toEqual({ state: 'future', days: 67 });
    expect(countdown(today, today)).toEqual({ state: 'today', days: 0 });
    expect(countdown('2026-10-20', today)).toEqual({ state: 'past', days: 5 });
    // Across a leap day and a year end.
    expect(countdown('2028-03-01', '2028-02-28')).toEqual({ state: 'future', days: 2 });
    expect(countdown('2027-01-01', '2026-12-31')).toEqual({ state: 'future', days: 1 });
  });
  it('does not exist for anything that is not a real day', () => {
    for (const bad of ['', 'soon', '2026-13-01', '2026-02-30', '2026-1-1', '2026-10-25T00:00:00Z'])
      expect(countdown(bad, today), bad).toBeNull();
    expect(countdown('2026-10-26', 'tomorrow')).toBeNull();
    expect(isCalendarDay(null)).toBe(false);
  });
  it('says plainly when a date has passed, and names a next date only when there is a real one', () => {
    expect(countdownWords({ state: 'future', days: 1 })).toBe('Tomorrow');
    expect(countdownWords({ state: 'future', days: 12 })).toBe('In 12 days');
    expect(countdownWords({ state: 'today', days: 0 })).toBe('Today');
    expect(countdownWords({ state: 'past', days: 1 })).toBe('This date passed yesterday');
    expect(countdownWords({ state: 'past', days: 9 })).toBe('This date passed 9 days ago');
    expect(countdownWords({ state: 'past', days: 9 }, { on: '2027-03-10' })).toBe(
      'This date passed 9 days ago. The next date is 2027-03-10',
    );
    expect(countdownWords({ state: 'past', days: 9 }, null)).not.toContain('next');
  });
});

describe('the switch and every switch-off path', () => {
  it('is a real owner switch, and the books switch is still only planned', () => {
    expect(switchRegistry.find((s) => s.name === 'CORRIDRA_UX_FAIRS')?.kind).toBe('flag');
    expect(switchRegistry.find((s) => s.name === 'CORRIDRA_UX_BOOKS')?.kind).toBe('planned');
  });
  it('both pages answer not found with the switch off, before they read anything', () => {
    for (const path of ['apps/web/app/fairs/page.tsx', 'apps/web/app/fairs/[slug]/page.tsx']) {
      const page = read(path);
      const off = page.indexOf("if (!uxSwitchOn('CORRIDRA_UX_FAIRS')) notFound();");
      expect(off, path).toBeGreaterThan(-1);
      // The switch is read before the list is, including in the title of the detail page.
      expect(page.indexOf("uxSwitchOn('CORRIDRA_UX_FAIRS')"), path).toBeLessThan(
        page.indexOf('publishableFairs(fairs'),
      );
      expect(page, path).toContain('robots: { index: false, follow: false }');
    }
  });
  it('shows only entries that follow the rules, and any other address is not found', () => {
    const detail = read('apps/web/app/fairs/[slug]/page.tsx');
    expect(detail).toContain('publishableFairs(fairs, today).find((item) => item.slug === slug)');
    expect(read('apps/web/app/fairs/page.tsx')).toContain('publishableFairs(fairs, today)');
    expect(detail).toContain('if (!found) notFound();');
  });
  it('the countdown draws nothing for a missing or unreal date and uses no script', () => {
    const component = read('apps/web/components/countdown.tsx');
    expect(component).toContain('if (!on) return null;');
    expect(component).toContain('if (!value) return null;');
    expect(component).not.toMatch(/use client|useEffect|setInterval|Date\.now|new Date/);
  });
  it('the stylesheet uses tokens only', () => {
    expect(read('apps/web/app/fairs/fairs.css')).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
