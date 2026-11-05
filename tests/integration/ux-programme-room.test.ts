import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  boardingCounts,
  boardingLine,
  programmeRoadLegend,
  programmeRoadSteps,
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
  it('has a legend that says what the room reads, not what a record is', () => {
    expect(programmeRoadLegend).toContain("does not read that step's records");
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
      'Manage participants',
      'Manage sample participants',
      'Coordinate and report',
      'Terms, eligibility and places',
      'Record fees and costs',
      'Record sample fees and costs',
      'Load more planning programmes',
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
    expect(room).toContain('Refresh counts');
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
