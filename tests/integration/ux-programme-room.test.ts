import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  boardingCounts,
  boardingLine,
  checklistTermsFrom,
  meetingCoverage,
  programmeChecklist,
  programmeAttention,
  programmeGlance,
  programmeNextStep,
  programmeRoadSteps,
  programmeStage,
  programmeRoadStates,
  roomLenses,
  type Boarding,
} from '../../apps/web/lib/programme-room';
import { switchRegistry } from '../../apps/web/lib/owner-switches';

// The Programme Room (Lane 10 of the UX update): the pure rules, the proof that the room wraps the same
// panels, and every switch-off path. The room changes no panel, no data and no permission.
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const inv = (status: 'ISSUED' | 'USED' | 'UNAVAILABLE') => ({ status });
const reg = (status: 'REGISTERED' | 'REVOKED' | 'WITHDRAWN' = 'REGISTERED') => ({ status });
const boarding = (over: Partial<Boarding>): Boarding => ({
  invitations: [],
  registrations: [],
  moreInvitations: false,
  moreRegistrations: false,
  ...over,
});

describe('the counts', () => {
  it('count only what was read, and say which invitations were used and which are open', () => {
    const counts = boardingCounts(
      boarding({
        invitations: [inv('USED'), inv('USED'), inv('ISSUED'), inv('UNAVAILABLE')],
        registrations: [reg(), reg('REVOKED'), reg('WITHDRAWN')],
      }),
    );
    expect(counts).toEqual({ invitations: 4, used: 2, open: 1, registered: 1, complete: true });
  });
  it('are not a total when a list was longer than the page', () => {
    expect(boardingCounts(boarding({ moreInvitations: true })).complete).toBe(false);
    expect(boardingCounts(boarding({ moreRegistrations: true })).complete).toBe(false);
  });
  it('say Not measured yet instead of a number that would be wrong', () => {
    expect(boardingLine(null)).toBe('Not measured yet');
    expect(boardingLine(boardingCounts(boarding({ moreInvitations: true })))).toMatch(
      /^Not measured yet/,
    );
    expect(boardingLine(boardingCounts(boarding({})))).toBe('No invitations yet');
    expect(
      boardingLine(
        boardingCounts(boarding({ invitations: [inv('USED'), inv('ISSUED'), inv('ISSUED')] })),
      ),
    ).toBe('1 of 3 invitations used');
  });
});

describe('the programme road', () => {
  const states = (b: Boarding | null) => programmeRoadStates(b ? boardingCounts(b) : null);
  it('has the six steps in order, and marks only Set up when nothing could be read', () => {
    expect(programmeRoadSteps.map((s) => s.key)).toEqual([
      'setup',
      'invite',
      'register',
      'plan',
      'run',
      'report',
    ]);
    expect(states(null)).toEqual({
      setup: 'done',
      invite: 'notTracked',
      register: 'notTracked',
      plan: 'notTracked',
      run: 'notTracked',
      report: 'notTracked',
    });
  });
  it('says Invite is next before any invitation exists', () => {
    expect(states(boarding({}))).toMatchObject({ invite: 'now', register: 'later' });
  });
  it('says Register is now while registrations are missing or invitations are still open', () => {
    expect(states(boarding({ invitations: [inv('ISSUED')] }))).toMatchObject({
      invite: 'done',
      register: 'now',
    });
    expect(
      states(boarding({ invitations: [inv('USED'), inv('ISSUED')], registrations: [reg()] })),
    ).toMatchObject({ invite: 'done', register: 'now' });
  });
  it('says Register is done only when someone registered and no invitation is open', () => {
    expect(states(boarding({ invitations: [inv('USED')], registrations: [reg()] }))).toMatchObject({
      invite: 'done',
      register: 'done',
    });
  });
  it('does not claim Register is done from a partial list, but an open invitation still proves it is now', () => {
    expect(
      states(
        boarding({ moreInvitations: true, invitations: [inv('USED')], registrations: [reg()] }),
      ),
    ).toMatchObject({ invite: 'done', register: 'notTracked' });
    expect(
      states(
        boarding({ moreRegistrations: true, invitations: [inv('USED')], registrations: [reg()] }),
      ),
    ).toMatchObject({ invite: 'done', register: 'notTracked' });
    expect(
      states(
        boarding({
          moreInvitations: true,
          invitations: [inv('USED'), inv('ISSUED')],
          registrations: [reg()],
        }),
      ),
    ).toMatchObject({ invite: 'done', register: 'now' });
  });
  // CX-06 and the approved Organise room (5 Nov 2026): a stage with no record is a plain grey segment.
  it('draws a stage with no record as plain grey, with no "not tracked" words and no legend', () => {
    const lib = read('apps/web/lib/programme-room.ts');
    expect(lib).not.toMatch(/export const programmeRoadLegend/);
    const room = read('apps/web/app/account/delegations/programme-room.tsx');
    expect(room).not.toMatch(/not tracked|legend/i);
    expect(programmeStage(null)).toEqual({
      states: {
        setup: 'done',
        invite: 'grey',
        register: 'grey',
        plan: 'grey',
        run: 'grey',
        report: 'grey',
      },
      current: null,
    });
    expect(programmeStage(boardingCounts(boarding({}))).current).toBe('invite');
    const partial = programmeStage(
      boardingCounts(
        boarding({ moreInvitations: true, invitations: [inv('USED')], registrations: [reg()] }),
      ),
    );
    expect(partial.states).toMatchObject({ invite: 'done', register: 'grey' });
    expect(partial.current).toBeNull();
  });
  it('never claims a step it does not read: the days, the run and the report stay not tracked', () => {
    for (const b of [
      boarding({}),
      boarding({ invitations: [inv('USED')], registrations: [reg()] }),
    ]) {
      const s = states(b);
      expect([s.plan, s.run, s.report]).toEqual(['notTracked', 'notTracked', 'notTracked']);
    }
  });
  it('has at most one step that is now', () => {
    const cases: (Boarding | null)[] = [
      null,
      boarding({}),
      boarding({ invitations: [inv('ISSUED')] }),
      boarding({ invitations: [inv('USED')], registrations: [reg()] }),
      boarding({ moreInvitations: true, invitations: [inv('USED')], registrations: [reg()] }),
    ];
    for (const b of cases)
      expect(
        Object.values(states(b)).filter((state) => state === 'now').length,
      ).toBeLessThanOrEqual(1);
  });
});

describe('the room wraps the same panels', () => {
  const list = read('apps/web/app/account/delegations/customer-programmes.tsx');
  it('uses each original panel twice: once in the room and once as the old toggles', () => {
    for (const panel of [
      'ProgrammeContext',
      'ProgrammeParticipants',
      'ProgrammeCoordination',
      'ProgrammeTerms',
      'ProgrammeEconomics',
    ])
      expect(list.match(new RegExp(`<${panel}\\b`, 'g')), panel).toHaveLength(2);
  });
  it('passes the room the same props the old toggles pass the panels', () => {
    // The same scope on every panel, in both branches.
    expect(list.match(/programmeId=\{p\.id\}/g)!.length).toBeGreaterThanOrEqual(10);
    expect(
      list.match(/<ProgrammeTerms[\s\S]*?coordinationEnabled=\{coordinationEnabled\}/g),
    ).toHaveLength(2);
    expect(list.match(/missionSharesEnabled=\{missionSharesEnabled\}/g)).toHaveLength(2);
  });
  it('keeps the old toggles word for word as the switch-off branch', () => {
    for (const text of [
      'Manage Participants',
      'Manage Sample Participants',
      'Coordinate and Report',
      'Terms, Eligibility and Places',
      'Record Fees and Costs',
      'Record Sample Fees and Costs',
      'Load More Planning Programmes',
    ])
      expect(list).toContain(text);
    expect(list).toContain('roomEnabled ? (');
  });
  it('shows the room only where a view has its panel on, in the order of the table', () => {
    expect(roomLenses.map((l) => l.key)).toEqual(['overview', 'people', 'plan', 'terms', 'money']);
    const room = read('apps/web/app/account/delegations/programme-room.tsx');
    expect(room).toContain("item.key === 'overview' || panels[item.key]");
    // A panel is mounted when first opened and then kept, hidden, so nothing typed is lost.
    expect(room).toContain('opened.has(item.key) &&');
    expect(room).toContain('hidden={lens !== item.key}');
  });
  it('reads only while on screen, again on a change of view or on request, and points at no missing view', () => {
    const room = read('apps/web/app/account/delegations/programme-room.tsx');
    expect(room).toContain('IntersectionObserver');
    expect(room).toContain('<LiveStatus key={reads}');
    expect(room).toContain('Refresh Counts');
    expect(room).toContain('available.length > 1');
    // The money note names the panels that are on the page: pricing needs templates too.
    expect(list).toContain('sharedMoneyNote={templatesEnabled && pricingEnabled}');
  });
  it('reads nothing a participant wrote: counts and states only', () => {
    const room = read('apps/web/app/account/delegations/programme-room.tsx');
    expect(room).not.toMatch(/displayLabel|consentedAt|reportingPurpose\b.*registration/);
    expect(room).not.toMatch(/fetch\(|localStorage|sessionStorage|document\.cookie/);
    expect(room).not.toContain('<svg');
  });
});

describe('every switch-off path', () => {
  it('is a real owner switch', () => {
    expect(switchRegistry.find((s) => s.name === 'CORRIDRA_UX_PROGRAMME')?.kind).toBe('flag');
  });
  it('the page passes the switch and mounts the styles only with it on', () => {
    const page = read('apps/web/app/account/delegations/[workspaceId]/page.tsx');
    expect(page).toContain("roomEnabled={uxSwitchOn('CORRIDRA_UX_PROGRAMME')}");
    expect(page).toContain("{uxSwitchOn('CORRIDRA_UX_PROGRAMME') && <ProgrammeRoomStyles />}");
  });
  it('the delegation components import no stylesheet, so the existing delegation specs bundle unchanged', () => {
    for (const file of ['programme-room.tsx', 'customer-programmes.tsx'])
      expect(read(`apps/web/app/account/delegations/${file}`), file).not.toMatch(
        /import\s+['"][^'"]+\.css['"]/,
      );
    const styles = read('apps/web/app/account/delegations/programme-room-styles.tsx');
    expect(styles).toContain("'./programme-room.css'");
    expect(styles).toContain('return null');
    expect(read('apps/web/app/account/delegations/programme-room.css')).not.toMatch(
      /#[0-9a-fA-F]{3,8}\b/,
    );
  });
  it('the default is off', () => {
    expect(read('apps/web/app/account/delegations/customer-programmes.tsx')).toContain(
      'roomEnabled = false',
    );
  });
});

describe('the Organise room overview (approved work rooms, 5 Nov 2026)', () => {
  const counts = (over: Partial<Boarding>) => boardingCounts(boarding(over));
  const projection = (over: Record<string, unknown> = {}) => ({
    readiness: { activeParticipants: 5, readyParticipants: 3 },
    meetings: { state: 'AVAILABLE' as const, scheduled: 18, qualifiedHeld: 3 },
    agenda: [{ needsReview: true }, { needsReview: false }, { needsReview: null }],
    conflicts: [{ left: 'a', right: 'b' }],
    ...over,
  });
  it('offers one next step read from the boarding counts, and opens the view that does it', () => {
    expect(programmeNextStep(null)).toEqual({
      title: 'See where your participants stand',
      target: 'people',
    });
    expect(programmeNextStep(counts({})).title).toBe('Invite your participants');
    expect(programmeNextStep(counts({ invitations: [inv('ISSUED')] })).title).toBe(
      'Get the remaining participants registered',
    );
    expect(programmeNextStep(counts({ moreInvitations: true })).title).toBe(
      'Review your participants',
    );
    expect(
      programmeNextStep(counts({ invitations: [inv('USED')], registrations: [reg()] })),
    ).toEqual({ title: 'Plan the days', target: 'plan' });
  });
  it('counts only what was read, and never shows a zero for a count it cannot give', () => {
    const full = programmeGlance(
      counts({ invitations: [inv('USED'), inv('ISSUED')], registrations: [reg()] }),
      projection(),
      true,
    );
    expect(full.map((t) => [t.key, t.value, t.of ?? ''])).toEqual([
      ['registered', '1', ''],
      ['open', '1', ''],
      ['ready', '3', 'of 5'],
      ['scheduled', '18', ''],
      ['held', '3', ''],
    ]);
    const unknown = programmeGlance(counts({ moreRegistrations: true }), null, true);
    expect(unknown.every((t) => !t.known && t.value === 'Not measured yet')).toBe(true);
    const notShared = programmeGlance(
      null,
      projection({ meetings: { state: 'NOT_SHARED', scheduled: null, qualifiedHeld: null } }),
      true,
    );
    expect(notShared.find((t) => t.key === 'scheduled')!.value).toBe('Not shared');
    expect(notShared.find((t) => t.key === 'held')!.value).toBe('Not shared');
    expect(programmeGlance(null, null, false).map((t) => t.key)).toEqual(['registered', 'open']);
    // Codex review of PR 314: a partial read (some shared links unavailable) is not a total, not even its zero.
    const partial = programmeGlance(
      null,
      projection({ meetings: { state: 'PARTIAL', scheduled: 0, qualifiedHeld: 0 } }),
      true,
    );
    for (const key of ['scheduled', 'held'])
      expect(partial.find((t) => t.key === key)).toMatchObject({
        value: 'Not measured yet',
        known: false,
      });
    for (const tiles of [unknown, notShared])
      for (const t of tiles) if (!t.known) expect(t.value).not.toBe('0');
  });
  it('lists what needs the organiser from the projection flags, each with the view that resolves it', () => {
    // Guardian review of PR 314: the meeting numbers say what they cover, as Results does (ADR-075 §5).
    expect(
      meetingCoverage(
        projection({
          meetings: { state: 'AVAILABLE', scheduled: 4, qualifiedHeld: 1, participantsSharing: 1 },
        }),
      ),
    ).toBe('Meetings from 1 of 5 participants who allowed counting; not all activity.');
    expect(
      meetingCoverage(
        projection({
          meetings: { state: 'PARTIAL', scheduled: 4, qualifiedHeld: 1, participantsSharing: 1 },
        }),
      ),
    ).toBeNull();
    expect(programmeAttention(null)).toEqual([]);
    expect(
      programmeAttention(projection()).map((i) => [i.key, i.title, i.action, i.target]),
    ).toEqual([
      ['overlaps', '1 pair of activities overlaps', 'Open Programme and Meetings', 'plan'],
      ['review', '1 activity needs review', 'Review', 'plan'],
      ['readiness', '2 participants are not ready yet', 'Open Participants', 'people'],
    ]);
    expect(
      programmeAttention(
        projection({
          conflicts: [],
          agenda: [],
          readiness: { activeParticipants: 2, readyParticipants: 2 },
        }),
      ),
    ).toEqual([]);
  });
  it("the room reads the projection through the panels' own read, and nothing a participant wrote", () => {
    const room = read('apps/web/app/account/delegations/programme-room.tsx');
    expect(room).toContain('useProgrammeGlance');
    expect(room).not.toMatch(/displayLabel|consentedAt|companies\.map|\.company\b/);
    const list = read('apps/web/app/account/delegations/customer-programmes.tsx');
    expect(list).toContain('projectionsEnabled={projectionsEnabled}');
    expect(read('apps/web/app/account/delegations/programme-room-styles.tsx')).toContain(
      "'../../../components/mr/stage-bar.css'",
    );
  });
});

describe('the plan stage and the checklist (GAP-039)', () => {
  const done = { scheduled: true, needsReview: false };
  const full = boardingCounts(
    boarding({ invitations: [inv('USED'), inv('USED')], registrations: [reg(), reg()] }),
  );
  const projection = (over: Record<string, unknown> = {}) => ({
    readiness: { activeParticipants: 4, readyParticipants: 3, definition: 'Ready means a place.' },
    meetings: { state: 'NOT_SHARED' as const, scheduled: null, qualifiedHeld: null },
    agenda: [done, done],
    conflicts: [],
    context: {
      startsAt: '2026-12-01T00:00:00.000Z',
      endsAt: '2026-12-03T00:00:00.000Z',
      timezone: 'UTC',
    },
    ...over,
  });
  const value = (rows: ReturnType<typeof programmeChecklist>, key: string) =>
    rows.find((r) => r.key === key)!.value;

  it('keeps Plan the days not tracked without a projection', () => {
    expect(programmeRoadStates(full).plan).toBe('notTracked');
    expect(programmeRoadStates(full, null).plan).toBe('notTracked');
  });
  it('marks Plan the days done only when every activity is scheduled and none needs review', () => {
    expect(programmeRoadStates(full, projection()).plan).toBe('done');
    expect(programmeRoadStates(full, projection({ agenda: [] })).plan).toBe('notTracked');
    expect(
      programmeRoadStates(
        full,
        projection({ agenda: [done, { scheduled: false, needsReview: null }] }),
      ).plan,
    ).toBe('notTracked');
    expect(
      programmeRoadStates(
        full,
        projection({ agenda: [done, { scheduled: true, needsReview: true }] }),
      ).plan,
    ).toBe('notTracked');
    expect(
      programmeRoadStates(
        full,
        projection({ agenda: [done, { scheduled: true, needsReview: null }] }),
      ).plan,
    ).toBe('notTracked');
  });
  it('leaves a cancelled activity out of the plan', () => {
    const agenda = [done, { scheduled: false, needsReview: null, status: 'CANCELLED' }];
    expect(programmeRoadStates(full, projection({ agenda })).plan).toBe('done');
  });
  it('never marks run or report, and never has more than one step now', () => {
    for (const counts of [null, boardingCounts(boarding({})), full]) {
      for (const p of [null, projection(), projection({ agenda: [] })]) {
        const s = programmeRoadStates(counts, p);
        expect([s.run, s.report]).toEqual(['notTracked', 'notTracked']);
        expect(Object.values(s).filter((x) => x === 'now').length).toBeLessThanOrEqual(1);
      }
    }
    expect(programmeStage(full, projection()).states.plan).toBe('done');
  });

  it('says Not measured yet for everything when nothing is loaded, and never gives a zero', () => {
    const rows = programmeChecklist(null, null, null);
    expect(rows.map((r) => r.value)).toEqual(rows.map(() => 'Not measured yet'));
    expect(rows.every((r) => !r.known)).toBe(true);
  });
  it('reads each fact from its record', () => {
    const rows = programmeChecklist(
      full,
      projection({
        agenda: [
          done,
          { scheduled: false, needsReview: null },
          { scheduled: true, needsReview: true },
        ],
        conflicts: [{ left: 'a', right: 'b' }],
      }),
      { termsSet: true, minimum: 2, maximum: 10 },
    );
    expect(value(rows, 'registered')).toBe('2');
    expect(value(rows, 'capacity')).toBe('2 of 10');
    expect(value(rows, 'minimum')).toBe('2 of 2');
    expect(value(rows, 'terms')).toBe('Set');
    expect(value(rows, 'dates')).toBe('1 Dec 2026 to 3 Dec 2026');
    expect(value(rows, 'activities')).toBe('2 of 3');
    expect(value(rows, 'overlaps')).toBe('1 pair overlaps');
    expect(value(rows, 'review')).toBe('1');
    expect(value(rows, 'ready')).toBe('3 of 4');
    expect(rows.find((r) => r.key === 'ready')!.note).toBe('Ready means a place.');
  });
  it('has no overall ready verdict', () => {
    const rows = programmeChecklist(full, projection(), { termsSet: true, minimum: 1, maximum: 5 });
    expect(
      rows.map((r) => r.fact.toLowerCase()).filter((f) => f === 'ready' || f === 'overall'),
    ).toEqual([]);
  });
  it('says what is not set when the record was read and holds nothing', () => {
    const rows = programmeChecklist(full, projection({ agenda: [], context: null }), {
      termsSet: false,
      minimum: null,
      maximum: null,
    });
    expect(value(rows, 'terms')).toBe('Not set yet');
    expect(value(rows, 'capacity')).toBe('No maximum set');
    expect(value(rows, 'minimum')).toBe('No minimum set');
    expect(value(rows, 'dates')).toBe('Not set yet');
    expect(value(rows, 'activities')).toBe('No activities yet');
  });
  it('degrades to Not measured yet when the participants list is partial or the terms read failed', () => {
    const partial = boardingCounts(boarding({ moreRegistrations: true, registrations: [reg()] }));
    const rows = programmeChecklist(partial, projection(), {
      termsSet: true,
      minimum: 2,
      maximum: 10,
    });
    expect(value(rows, 'registered')).toBe('Not measured yet');
    expect(value(rows, 'capacity')).toBe('Not measured yet');
    expect(value(rows, 'minimum')).toBe('Not measured yet');
    const noTerms = programmeChecklist(full, projection(), null);
    expect(['capacity', 'minimum', 'terms'].map((k) => value(noTerms, k))).toEqual([
      'Not measured yet',
      'Not measured yet',
      'Not measured yet',
    ]);
    expect(value(noTerms, 'activities')).toBe('2 of 2');
  });
  it('does not call an unknown review flag zero', () => {
    const rows = programmeChecklist(
      full,
      projection({ agenda: [{ scheduled: true, needsReview: null }] }),
      null,
    );
    expect(value(rows, 'review')).toBe('Not measured yet');
  });
  it('reads terms facts from the terms state shape', () => {
    expect(
      checklistTermsFrom({ terms: { current: null }, places: { minimum: null, maximum: 8 } }),
    ).toEqual({ termsSet: false, minimum: null, maximum: 8 });
    expect(
      checklistTermsFrom({
        terms: { current: { version: 1 } },
        places: { minimum: 3, maximum: 8 },
      }),
    ).toEqual({ termsSet: true, minimum: 3, maximum: 8 });
  });
  it('wires the checklist to the existing terms read behind the terms switch, and degrades on failure', () => {
    const hook = read('apps/web/app/account/delegations/programme-checklist.ts');
    expect(hook).toContain("from './terms-client'");
    expect(hook).toContain('parseState');
    expect(hook).toMatch(
      /\.catch\(\(\) => \{\s*if \(!controller\.signal\.aborted\) setTerms\(null\)/,
    );
    const room = read('apps/web/app/account/delegations/programme-room.tsx');
    expect(room).toContain('participantsEnabled && termsEnabled');
    expect(read('apps/web/app/account/delegations/customer-programmes.tsx')).toContain(
      'termsEnabled={termsEnabled}',
    );
  });
});
