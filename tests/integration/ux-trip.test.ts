import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeSwitches, switchRegistry } from '../../apps/web/lib/owner-switches';
import { uxSwitchOn } from '../../apps/web/lib/ux-switches';
import { catalogs, en, translate, type MessageKey } from '../../apps/web/lib/i18n/messages';
import { localeCodes } from '../../apps/web/lib/i18n/locales';
import { hanLang, isChangedMeeting, orderTrip, tripKeys } from '../../apps/web/lib/trip';

// The Trip view (Batch E part E1, GAP-034): a fourth lens of the Room that shows only the reviewed
// itinerary of the saved commercial report. These checks prove the switch, that the off path is the
// page it was, what the lens may never show, and the order and words of the list. The browser
// behaviour is in tests/operator/ux-room.spec.ts.
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const roomDir = 'apps/web/app/account/rooms/[requestId]';

type Meeting = Parameters<typeof orderTrip>[0][number];
const meeting = (over: Partial<Meeting> & { label: string }): Meeting => ({
  status: 'SCHEDULED',
  scheduleChanged: false,
  ...over,
});

describe('the Trip switch', () => {
  const entry = () => switchRegistry.find((s) => s.name === 'CORRIDRA_UX_TRIP');
  const state = (env: NodeJS.ProcessEnv) =>
    new Map(describeSwitches(env).flatMap((g) => g.rows.map((r) => [r.name, r.state.text]))).get(
      'CORRIDRA_UX_TRIP',
    );

  it('is a real owner switch with a plain description that names what it needs', () => {
    expect(entry()?.kind).toBe('flag');
    expect(entry()?.label).toBe('Trip view');
    expect(entry()?.line).toContain('Needs the Road on a request');
    expect(entry()?.line).toContain('Never books anything.');
    expect(entry()?.line).not.toMatch(/[—–]| - /);
  });
  it('is off by default and on only when the setting is exactly true', () => {
    expect(state({})).toBe('Off');
    expect(state({ CORRIDRA_UX_TRIP: 'true' })).toBe('On');
    expect(state({ CORRIDRA_UX_TRIP: 'TRUE' })).toBe('Off');
    expect(state({ CORRIDRA_UX_TRIP: '1' })).toBe('Off');
    expect(uxSwitchOn('CORRIDRA_UX_TRIP', {})).toBe(false);
    expect(uxSwitchOn('CORRIDRA_UX_TRIP', { CORRIDRA_UX_TRIP: 'true' })).toBe(true);
    expect(uxSwitchOn('CORRIDRA_UX_TRIP', { CORRIDRA_UX_TRIP: '1' })).toBe(false);
  });
  it('leaves the decision card switch planned (not part of this work); the books switch is a real one', () => {
    expect(switchRegistry.find((s) => s.name === 'CORRIDRA_UX_BOOKS')?.kind).toBe('flag');
    expect(switchRegistry.find((s) => s.name === 'CORRIDRA_SHARE_CARD')?.kind).toBe('planned');
  });
});

describe('the pages and the report', () => {
  it('the Room page reads the switch on the server, after the Road switch that hides the page', () => {
    const page = read(`${roomDir}/page.tsx`);
    expect(page).toContain("trip={uxSwitchOn('CORRIDRA_UX_TRIP')}");
    expect(page).toContain("lenses={uxSwitchOn('CORRIDRA_UX_LENSES')}");
    expect(page.indexOf("if (!uxSwitchOn('CORRIDRA_UX_ROAD')) notFound();")).toBeGreaterThan(-1);
    expect(page.indexOf("if (!uxSwitchOn('CORRIDRA_UX_ROAD')) notFound();")).toBeLessThan(
      page.indexOf('await customerPageSession('),
    );
  });
  it('the Room shows the Trip button only with the lenses and the switch, and the lens bar stays inside the lenses', () => {
    const view = read(`${roomDir}/room-view.tsx`);
    expect(view).toContain('trip = false');
    expect(view).toContain("trip: 'room.lens.trip'");
    expect(view).toMatch(/\{lenses && \(\s*<div className="room-lenses"/);
    // One saved report component for every lens: no second renderer, no second request.
    expect((view.match(/<SavedCommercialReport/g) ?? []).length).toBe(1);
    expect(view).not.toMatch(/fetch\(/);
  });
  it('the report keeps its defaults, gains a trip section and never builds the trip from the whole page', () => {
    const report = read('apps/web/app/account/missions/saved-commercial-report.tsx');
    expect(report).toContain(
      "export type ReportSection = 'all' | 'compare' | 'evidence' | 'trip';",
    );
    expect(report).toContain("section = 'all'");
    expect(report).toContain('lenses = false');
    expect(report).toContain("const showTrip = section === 'trip';");
    expect(report).toContain('showTrip && renderTrip');
    // The three other parts do not follow the trip section.
    expect(report).toContain("const showRest = section === 'all';");
    expect(report).toContain("const showCompare = section === 'all' || section === 'compare';");
    expect(report).toContain("const showEvidence = section === 'all' || section === 'evidence';");
    // The lens key ignores the section, so switching lenses never fetches again.
    expect(report).toContain(
      'key={JSON.stringify([props.issuer, props.subject, props.resourceId])}',
    );
  });
});

describe('what the Trip lens may never show', () => {
  const list = read(`${roomDir}/trip-list.tsx`);
  it('reads only the itinerary: no money, contacts, quotations, offers, outcomes or evidence forms', () => {
    for (const word of [
      'totals',
      'outcomes',
      'experience',
      'quotation',
      'contact',
      'email',
      'phone',
      'requests',
      'displayMoney',
      'currency',
      '<form',
      '<textarea',
      '<input',
    ])
      expect(list, word).not.toContain(word);
  });
  it('has no export, download, print, share or calendar control and no request of its own', () => {
    expect(list).not.toMatch(/download|\.ics|window\.print|navigator\.share|mailto:|calendar/i);
    expect(list).not.toMatch(/fetch\(|<a |<svg|<img/);
  });
  it('reuses the status badge, the date formatter and the empty-state style', () => {
    expect(list).toContain("from '../../../../components/access-state'");
    expect(list).toContain("from '../../../../lib/ux/format'");
    expect(list).toContain('ux-empty');
    expect(list).toContain('text-link');
    expect(list).toContain('aria-expanded');
  });
  it('writes a time in the time zone of the place, never the viewer zone, and keeps it left to right', () => {
    expect(list).toContain("timeZone: item.timezone ?? 'UTC'");
    expect(list).toContain('dir="ltr"');
    expect(list).toContain('dir="auto"');
  });
  it('adds three classes, and the overrides that beat the customer kit, from tokens only, with no raw colour and no media query', () => {
    const css = read(`${roomDir}/room-view.css`);
    const rules = css.slice(css.indexOf('.room-trip-list'));
    expect(rules).toContain('.room-trip-head');
    expect(rules).toContain('.room-trip-facts');
    // The customer kit adds list margins and small grey time type; the Trip list overrides both.
    expect(rules).toMatch(/\.room \.room-trip-list > li\.room-strip \{[^}]*margin: 0;/);
    expect(rules).toMatch(
      /\.room \.room-trip-list \.room-trip-facts time \{[^}]*font-size: inherit;/,
    );
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb|hsl|@media|font-family/);
  });
});

describe('which language a name is read in', () => {
  it('marks text with Chinese characters as Chinese and leaves any other text unmarked', () => {
    expect(hanLang('绿野机械有限公司 meeting')).toBe('zh');
    expect(hanLang('上海市浦东新区')).toBe('zh');
    expect(hanLang('Dhaka Chamber of Commerce')).toBeUndefined();
    expect(hanLang('ঢাকা')).toBeUndefined();
    expect(hanLang('')).toBeUndefined();
  });
  it('is used for the name and the place of a meeting', () => {
    const list = read(`${roomDir}/trip-list.tsx`);
    expect(list).toContain('lang={hanLang(item.label)}');
    expect(list).toContain('lang={hanLang(place)}');
  });
});

describe('which meetings are shown and in what order', () => {
  it('treats a changed schedule and a required new time the same: nothing old is shown', () => {
    expect(isChangedMeeting(meeting({ label: 'a', scheduleChanged: true }))).toBe(true);
    expect(isChangedMeeting(meeting({ label: 'b', status: 'RESCHEDULE_REQUIRED' }))).toBe(true);
    expect(isChangedMeeting(meeting({ label: 'c' }))).toBe(false);
    expect(isChangedMeeting(meeting({ label: 'd', status: 'HELD' }))).toBe(false);
  });
  it('orders dated items by start, then undated in server order, then changed in server order', () => {
    const items = [
      meeting({ label: 'changed first', scheduleChanged: true, startsAt: '2026-01-01T00:00:00Z' }),
      meeting({ label: 'undated one' }),
      meeting({ label: 'late', startsAt: '2026-11-12T04:00:00Z' }),
      meeting({ label: 'reschedule', status: 'RESCHEDULE_REQUIRED' }),
      meeting({ label: 'early', startsAt: '2026-11-09T04:00:00Z' }),
      meeting({ label: 'undated two' }),
    ];
    expect(orderTrip(items).map((item) => item.label)).toEqual([
      'early',
      'late',
      'undated one',
      'undated two',
      'changed first',
      'reschedule',
    ]);
    // The server list is not changed in place.
    expect(items[0]!.label).toBe('changed first');
  });
  it('keeps dated items with the same start in server order', () => {
    const at = '2026-11-09T04:00:00Z';
    expect(
      orderTrip([
        meeting({ label: 'one', startsAt: at }),
        meeting({ label: 'two', startsAt: at }),
      ]).map((item) => item.label),
    ).toEqual(['one', 'two']);
  });
});

describe('the words', () => {
  const trip = tripKeys as readonly MessageKey[];
  it('are 23 Trip keys plus the lens name, all present in English and in every other catalog', () => {
    expect(trip.length).toBe(23);
    expect(Object.keys(en).filter((key) => key.startsWith('room.trip.')).length).toBe(23);
    for (const code of localeCodes) {
      for (const key of [...trip, 'room.lens.trip' as MessageKey])
        expect(catalogs[code][key]?.trim(), `${code}.${key}`).toBeTruthy();
    }
    expect(en['room.lens.trip']).toBe('Trip');
  });
  it('use no dash as punctuation and no word that sounds like a booking', () => {
    for (const key of [...trip, 'room.lens.trip' as MessageKey]) {
      expect(en[key], key).not.toMatch(/[—–]| - /);
    }
    // The help line may say that nothing is booked; no status may sound like a booking.
    for (const key of trip.filter((name) => name.startsWith('room.trip.status.')))
      expect(en[key], key).not.toMatch(/book/i);
  });
  it('say the count in the singular for one and with the number otherwise', () => {
    expect(en['room.trip.count.one']).toBe('1 meeting or visit');
    expect(en['room.trip.count.other']).toBe('{count} meetings or visits');
    expect(en['room.trip.all']).toBe('Show all {count} meetings and visits');
  });
  it('stay English placeholders in the six other languages until a native reviewer signs them off (D16)', () => {
    // Delete this check, and write the reviewed words, in the change that records the review.
    for (const code of localeCodes.filter((c) => c !== 'en'))
      for (const key of [...trip, 'room.lens.trip' as MessageKey])
        expect(translate(code, key), `${code}.${key}`).toBe(en[key]);
  });
  it('are recorded as a draft needing native review, never as reviewed', () => {
    const row = read('docs/qa/2026-10-31/i18n-review.md');
    expect(row).toMatch(/room\.trip\.\*[^\n]*draft, needs native review/i);
    expect(read('docs/product/language-review-record.md')).toMatch(/room\.trip\.\*/);
  });
});
