import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { programmePublicCopy } from '../../packages/auth/src/customer-programme-publication';
import { switchRegistry } from '../../apps/web/lib/owner-switches';
import { uxSwitchNames, uxSwitchOn } from '../../apps/web/lib/ux-switches';
import { isTitleCase } from '../../apps/web/lib/ux/title-case';
import { programmePagesWords } from '../../apps/web/lib/i18n/programme-pages-words';
import {
  boardingCounts,
  programmeDecisions,
  programmeFacts,
  type Boarding,
  type ProgrammeGlanceSource,
} from '../../apps/web/lib/programme-room';
// The two page modules are .tsx files and the root typecheck has no jsx setting, so they load the way the other
// integration tests load components (a dynamic import). Their shapes are restated here, narrowly, for the tests.
type FirstRunLine =
  | 'title'
  | 'organiser'
  | 'summary'
  | 'destination'
  | 'dates'
  | 'focus'
  | 'audience'
  | 'eligibility'
  | 'capacity'
  | 'fee'
  | 'closes';
type Draft = Record<string, string | string[]>;
type FirstRunKept = Record<string, string | number | boolean | undefined>;
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const { copyFrom, emptyDraft, isoDay, lineProblem, lineStep, problem } = await load(
  'app/account/delegations/programme-page.tsx',
);
const { firstRunMoreLines, firstRunPageDraft, firstRunPurpose, firstRunStepLines } = await load(
  'app/account/delegations/first-run.tsx',
);

// ADR-084 slice S0: the guided first run and the decisions-first overview, as pure rules and as source facts.
// The browser behaviour (session-only draft, no server write before Publish, the order of the commands) is in
// tests/operator/del-s0-first-run.spec.ts.
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const switchName = 'CORRIDRA_DELEGATION_FIRST_RUN';

const valid: Draft = {
  ...emptyDraft('Synthetic machinery delegation'),
  organiser: 'Synthetic Dhaka Agro Traders Association',
  summary: 'A five day visit to machinery makers for importers of farm equipment.',
  destination: 'Guangzhou, China',
  dates: '12 to 16 March 2027',
  focus: 'Agricultural machinery',
  audience: 'Importers and distributors of farm machinery in Bangladesh.',
  eligibility: 'A registered company with an import licence.',
  capacity: '20',
  fee: 'USD 1,200 per company, paid to the organiser',
  closes: isoDay(30),
};
const lines = Object.keys(lineStep) as FirstRunLine[];
// One way each line can be wrong, so the two rule sets are compared on real refusals.
const broken: Record<FirstRunLine, Partial<Draft>[]> = {
  title: [{ title: '' }, { title: 'Machinery delegation without the mark' }],
  organiser: [{ organiser: '' }, { organiser: 'Dhaka Agro Traders Association' }],
  summary: [{ summary: 'Too short' }],
  destination: [{ destination: ' ' }],
  dates: [{ dates: '' }],
  focus: [{ focus: 'x' }],
  audience: [{ audience: 'Short' }],
  eligibility: [{ eligibility: '' }],
  capacity: [{ capacity: '0' }, { capacity: '1001' }, { capacity: 'ten' }],
  fee: [{ fee: 'x' }],
  closes: [{ closes: '' }, { closes: isoDay(0) }, { closes: isoDay(180) }],
};

describe('one line at a time judges exactly as the page editor does', () => {
  it('a complete page has no problem under either rule', () => {
    for (const sample of [true, false]) {
      for (const line of lines) expect(lineProblem(line, valid, sample), line).toBe('');
      for (let step = 0; step < 6; step++) expect(problem(step, valid, sample)).toBe('');
    }
  });

  it('each broken line gets the same words from both rules, in sample and real mode', () => {
    let compared = 0;
    for (const sample of [true, false])
      for (const line of lines)
        for (const change of broken[line]) {
          const draft = { ...valid, ...change };
          const own = lineProblem(line, draft, sample);
          // The mark on a sample name is a sample-only rule, so that case is not a refusal in real mode.
          if (!own) {
            expect(sample, `${line} ${JSON.stringify(change)}`).toBe(false);
            expect(problem(lineStep[line], draft, sample)).toBe('');
            continue;
          }
          expect(problem(lineStep[line], draft, sample), `${line} ${JSON.stringify(change)}`).toBe(
            own,
          );
          // No other line is blamed for it.
          for (const other of lines)
            if (other !== line) expect(lineProblem(other, draft, sample), other).toBe('');
          compared++;
        }
    expect(compared).toBeGreaterThanOrEqual(30);
  });

  it('keeps the existing 180-day closing rule: tomorrow up to 179 days from now', () => {
    expect(lineProblem('closes', { ...valid, closes: isoDay(1) }, false)).toBe('');
    expect(lineProblem('closes', { ...valid, closes: isoDay(179) }, false)).toBe('');
    expect(lineProblem('closes', { ...valid, closes: isoDay(180) }, false)).toBe(
      programmePagesWords['pp.edit.problem.closes'],
    );
  });
});

const kept = (over: Partial<FirstRunKept> = {}): FirstRunKept => ({
  step: 0,
  title: 'Synthetic machinery delegation',
  destination: 'Guangzhou, China',
  templateId: '',
  dates: '12 to 16 March 2027',
  unsure: false,
  audience: 'Importers and distributors of farm machinery in Bangladesh.',
  summary: 'A five day visit to machinery makers for importers of farm equipment.',
  fee: '',
  capacity: '',
  ...over,
});
const workspace = 'Synthetic Dhaka Agro Traders Association';

describe('the first run asks in three steps of one to three fields', () => {
  it('has three steps, each of one to three lines, and no line twice', () => {
    expect(firstRunStepLines).toHaveLength(3);
    for (const step of firstRunStepLines) {
      expect(step.length).toBeGreaterThanOrEqual(1);
      expect(step.length).toBeLessThanOrEqual(3);
    }
    const all = [...firstRunStepLines.flat(), ...firstRunMoreLines];
    expect(new Set(all).size).toBe(all.length);
  });

  it('asks for name and destination, then dates and who it is for, then fee and places', () => {
    expect(firstRunStepLines[0]).toEqual(['title', 'destination']);
    expect(firstRunStepLines[1]).toEqual(['dates', 'audience', 'summary']);
    expect(firstRunStepLines[2]).toEqual(['fee', 'capacity']);
  });

  it('carries every line the publish command needs, so Publish can be the last step', () => {
    const required = Object.keys(programmePublicCopy.shape).filter(
      (key) =>
        !programmePublicCopy.shape[key as keyof typeof programmePublicCopy.shape].safeParse(
          undefined,
        ).success,
    );
    const carried = new Set<string>([...firstRunStepLines.flat(), ...firstRunMoreLines]);
    // Lists start empty and stay optional in the first run.
    for (const key of required.filter((k) => !['activities', 'included', 'excluded'].includes(k)))
      expect(carried.has(key), key).toBe(true);
  });

  it('what it builds is accepted by the publish command exactly as the editor sends it', () => {
    const page = firstRunPageDraft(
      kept({ fee: 'USD 1,200 per company', capacity: '20' }),
      workspace,
    );
    for (const line of [...firstRunStepLines.flat(), ...firstRunMoreLines])
      expect(lineProblem(line, page, true), line).toBe('');
    const copy = copyFrom(page);
    expect(programmePublicCopy.safeParse(copy).success).toBe(true);
    expect(copy).toEqual({
      title: 'Synthetic machinery delegation',
      organiser: workspace,
      summary: 'A five day visit to machinery makers for importers of farm equipment.',
      destination: 'Guangzhou, China',
      dates: '12 to 16 March 2027',
      focus: 'Not stated yet',
      audience: 'Importers and distributors of farm machinery in Bangladesh.',
      eligibility: 'Not stated yet',
      activities: [],
      included: [],
      excluded: [],
      fee: 'USD 1,200 per company',
      capacity: 20,
    });
  });

  it('invents nothing: a line the organiser did not write is their workspace name or "Not stated yet"', () => {
    const page = firstRunPageDraft(kept(), workspace);
    expect(page.organiser).toBe(workspace);
    expect(page.focus).toBe(programmePagesWords['pp.public.notStated']);
    expect(page.eligibility).toBe(programmePagesWords['pp.public.notStated']);
    // Once written, the organiser's words win, including an emptied line, which Publish then refuses.
    const own = firstRunPageDraft(
      kept({ organiser: '', focus: 'Farm machinery', eligibility: 'An import licence.' }),
      workspace,
    );
    expect(own.focus).toBe('Farm machinery');
    expect(own.eligibility).toBe('An import licence.');
    expect(lineProblem('organiser', own, false)).not.toBe('');
    // Without a workspace name the line is empty and Publish refuses until it is typed.
    expect(lineProblem('organiser', firstRunPageDraft(kept(), ''), false)).not.toBe('');
  });

  it('"I am not sure yet" publishes the plain line and ignores a half-typed date', () => {
    const page = firstRunPageDraft(kept({ unsure: true, dates: '12' }), workspace);
    expect(page.dates).toBe('Dates to be confirmed');
    expect(lineProblem('dates', page, false)).toBe('');
    expect(lineProblem('dates', firstRunPageDraft(kept({ dates: '' }), workspace), false)).not.toBe(
      '',
    );
  });

  it('closes thirty days out unless the organiser picks a day', () => {
    expect(firstRunPageDraft(kept(), workspace).closes).toBe(isoDay(30));
    expect(firstRunPageDraft(kept({ closes: isoDay(60) }), workspace).closes).toBe(isoDay(60));
  });

  it('sends "What it is for" as the private purpose, inside the create command limits', () => {
    expect(firstRunPurpose('  A five day visit to machinery makers.  ')).toBe(
      'A five day visit to machinery makers.',
    );
    const long = firstRunPurpose('word '.repeat(240));
    expect(long.length).toBeLessThanOrEqual(500);
    expect(long.length).toBeGreaterThan(490);
    expect(firstRunPurpose('🌾'.repeat(400)).length).toBeLessThanOrEqual(500);
    // A summary the page accepts is always a purpose the create command accepts (10 to 500 characters).
    expect(firstRunPurpose(valid.summary).length).toBeGreaterThanOrEqual(10);
  });
});

describe('the first run is a switch, off by default, and adds no server surface', () => {
  const page = read('apps/web/app/account/delegations/[workspaceId]/page.tsx');
  const list = read('apps/web/app/account/delegations/customer-programmes.tsx');
  const firstRun = read('apps/web/app/account/delegations/first-run.tsx');

  it('is a described owner switch that is on only for exactly "true"', () => {
    expect(uxSwitchNames).toContain(switchName);
    expect(uxSwitchOn(switchName, {})).toBe(false);
    for (const value of ['TRUE', '1', 'yes', 'on', ' true'])
      expect(uxSwitchOn(switchName, { [switchName]: value }), value).toBe(false);
    expect(uxSwitchOn(switchName, { [switchName]: 'true' })).toBe(true);
    const entry = switchRegistry.find((s) => s.name === switchName);
    expect(entry?.kind).toBe('flag');
    expect(entry?.group).toBe('Programmes and delegations');
    expect(entry?.line).not.toMatch(/[—–]/);
  });

  it('the page passes the switch as one prop, and the list acts on it only where pages are on', () => {
    expect(page).toContain(`firstRunEnabled={uxSwitchOn('${switchName}')}`);
    expect(list).toContain('firstRunEnabled = false');
    expect(list).toContain(
      'const firstRun = firstRunEnabled && pagesEnabled && participantsEnabled;',
    );
    expect(list).toContain('decisionsFirst={firstRun}');
  });

  it('with the switch off the create form and the tabs are the ones on main', () => {
    // The first run replaces nothing in the off branch: the same form, in the same place, under the same tab.
    expect(list).toContain('{newProgramme ?? createForm}');
    expect(list).toContain('const newProgramme = firstRun ? (');
    expect(list).toMatch(
      /\) : null;\n\s+\/\/ A workspace with no programme opens on the first run/,
    );
    expect(list).toContain("id: 'new',");
    expect(list).toContain(
      "label: realCustomerInput() ? 'New Programme' : 'New Sample Programme',",
    );
    // The plain create form stays reachable with the switch on.
    expect(list).toContain("<summary>{pp('pp.first.plain')}</summary>");
  });

  it('keeps its draft in the session only and calls only routes that already exist', () => {
    expect(firstRun).toContain('useFormDraft<FirstRunKept>(');
    expect(read('apps/web/lib/ux/use-form-draft.ts')).toContain('window.sessionStorage.setItem');
    expect(firstRun).not.toMatch(/localStorage|document\.cookie|indexedDB/);
    const called = [...firstRun.matchAll(/['"`](\/api\/[a-z-]+)/g)].map((m) => m[1]!);
    expect([...new Set(called)].sort()).toEqual([
      '/api/customer-programme-pages',
      '/api/customer-programme-templates',
      '/api/customer-programmes',
      '/api/customer-workspaces',
    ]);
    for (const route of new Set(called))
      expect(() => read(`apps/web/app${route}/route.ts`), route).not.toThrow();
    // Publish goes through the page client's own request, the one the editor uses.
    expect(firstRun).toContain("action: 'publish'");
    expect(firstRun).toContain('pageRequest(');
  });

  it('a template application carries no person, fee or payment', () => {
    const apply = firstRun.slice(
      firstRun.indexOf("action: 'apply'"),
      firstRun.indexOf('keep({ appliedTemplate'),
    );
    expect(apply).toContain('templateId: template.id');
    expect(apply).toContain('startDate: null');
    expect(apply).not.toMatch(/participant|invit|fee|payment|price|amount/i);
  });

  it('ships no migration, permission or API route', () => {
    for (const name of ['first-run', 'first_run', 'delegation_first'])
      expect(read('apps/web/lib/owner-switches.ts')).not.toContain(`${name}.sql`);
    expect(firstRun).not.toMatch(/programme\.[a-z_.]+\.(read|write)/);
  });
});

describe('the words of the first run and the overview', () => {
  const words = Object.entries(programmePagesWords).filter(([key]) => key.startsWith('pp.first.'));
  it('use no em dash and never the forbidden sample words', () => {
    expect(words.length).toBeGreaterThan(20);
    for (const [key, value] of words) {
      expect(value, key).not.toMatch(/[—–]/);
      expect(value, key).not.toMatch(/synthetic|fictional|invented/i);
    }
  });
  it('write every action label in Title Case', () => {
    for (const key of [
      'pp.first.more',
      'pp.first.preview.open',
      'pp.first.startAgain',
      'pp.first.plain',
      'pp.edit.publish',
      'pp.edit.continue',
      'pp.edit.back',
    ] as const)
      expect(isTitleCase(programmePagesWords[key]), programmePagesWords[key]).toBe(true);
  });
});

const inv = (status: 'ISSUED' | 'USED' | 'UNAVAILABLE') => ({ status });
const reg = () => ({ status: 'REGISTERED' as const });
const boarding = (over: Partial<Boarding> = {}) =>
  boardingCounts({
    invitations: [],
    registrations: [],
    moreInvitations: false,
    moreRegistrations: false,
    ...over,
  });
const projection = (over: Partial<ProgrammeGlanceSource> = {}): ProgrammeGlanceSource => ({
  readiness: { activeParticipants: 4, readyParticipants: 4 },
  meetings: { state: 'AVAILABLE', scheduled: 6, qualifiedHeld: 2, participantsSharing: 3 },
  agenda: [
    { scheduled: true, needsReview: false },
    { scheduled: false, needsReview: false },
  ],
  conflicts: [],
  ...over,
});

describe('the overview puts the next real decision first', () => {
  it('applications waiting for an answer come first, counted out of the total', () => {
    const [first, ...rest] = programmeDecisions(
      boarding({ invitations: [inv('USED'), inv('ISSUED')], registrations: [reg()] }),
      projection(),
      { applications: 12, awaiting: 3 },
    );
    expect(first).toEqual({
      key: 'applications',
      title: '3 of 12 applications are waiting for your answer',
      action: 'Answer 3 Applications',
      target: 'page',
    });
    expect(rest.map((d) => d.key)).toEqual(['boarding']);
  });

  it('says one application in the singular', () => {
    const [first] = programmeDecisions(null, null, { applications: 1, awaiting: 1 });
    expect(first!.title).toBe('1 of 1 application is waiting for your answer');
    expect(first!.action).toBe('Answer 1 Application');
  });

  it('offers no application decision when none is waiting or the page was not read', () => {
    for (const applications of [null, { applications: 5, awaiting: 0 }])
      expect(programmeDecisions(boarding(), null, applications).map((d) => d.key)).toEqual([
        'boarding',
      ]);
  });

  it('then what the plan flags, then boarding, then readiness, each with its count and its view', () => {
    const decisions = programmeDecisions(
      boarding({ invitations: [inv('USED')], registrations: [reg()] }),
      projection({
        conflicts: [{}, {}],
        agenda: [
          { scheduled: true, needsReview: true },
          { scheduled: true, needsReview: false },
          { scheduled: true, needsReview: false },
        ],
        readiness: { activeParticipants: 4, readyParticipants: 1 },
      }),
      { applications: 2, awaiting: 2 },
    );
    expect(decisions.map((d) => [d.key, d.action, d.target])).toEqual([
      ['applications', 'Answer 2 Applications', 'page'],
      ['overlaps', 'Resolve 2 Overlaps', 'plan'],
      ['review', 'Review 1 Activity', 'plan'],
      ['boarding', 'Plan the Days', 'plan'],
      ['readiness', 'See Who Is Not Ready', 'people'],
    ]);
    expect(decisions[2]!.title).toMatch(/^1 of 3 activities needs review\./);
    expect(decisions[4]!.title).toMatch(/^1 of 4 participants are ready\./);
  });

  it('always has the boarding step, with the boarding count out of its total', () => {
    expect(programmeDecisions(null, null, null)).toEqual([
      {
        key: 'boarding',
        title: 'See where your participants stand. Not measured yet.',
        action: 'Open Participants',
        target: 'people',
      },
    ]);
    expect(programmeDecisions(boarding(), null, null)[0]).toMatchObject({
      title: 'Invite your participants. No invitations yet.',
      action: 'Invite Participants',
    });
    expect(
      programmeDecisions(boarding({ invitations: [inv('USED'), inv('ISSUED')] }), null, null)[0],
    ).toMatchObject({
      title: 'Get the remaining participants registered. 1 of 2 invitations used.',
      action: 'Open Participants',
    });
  });

  it('writes every decision action in Title Case, with no em dash anywhere', () => {
    const all = [
      ...programmeDecisions(
        boarding({ invitations: [inv('USED')], registrations: [reg()] }),
        projection({
          conflicts: [{}],
          agenda: [{ scheduled: true, needsReview: true }],
          readiness: { activeParticipants: 2, readyParticipants: 1 },
        }),
        { applications: 3, awaiting: 1 },
      ),
      ...programmeDecisions(null, null, null),
      ...programmeDecisions(boarding(), null, null),
      ...programmeDecisions(boarding({ moreInvitations: true }), null, null),
    ];
    expect(all.length).toBeGreaterThanOrEqual(8);
    for (const d of all) {
      expect(isTitleCase(d.action), d.action).toBe(true);
      expect(d.title + d.action).not.toMatch(/[—–]/);
    }
  });
});

describe('the overview facts are counts out of a total', () => {
  it('gives each count with its total where a total exists', () => {
    const tiles = programmeFacts(
      boarding({
        invitations: [inv('USED'), inv('USED'), inv('ISSUED')],
        registrations: [reg(), reg()],
      }),
      projection(),
      { termsSet: true, minimum: 5, maximum: 20 },
      { applications: 12, awaiting: 3 },
    );
    expect(tiles.map((t) => [t.label, t.value, t.of ?? ''])).toEqual([
      ['applications answered', '9', 'of 12'],
      ['invitations used', '2', 'of 3'],
      ['places filled', '2', 'of 20'],
      ['participants ready', '4', 'of 4'],
      ['activities scheduled', '1', 'of 2'],
      ['meetings scheduled', '6', ''],
      ['qualified meetings held', '2', ''],
    ]);
    expect(tiles.every((t) => t.known)).toBe(true);
  });

  it('leaves out what is not read yet instead of calling it unknown', () => {
    // Nothing read: no tile, and so no "Not measured yet".
    expect(programmeFacts(null, null, null, null)).toEqual([]);
    // Participants read, projection and terms not: the two boarding facts only.
    const tiles = programmeFacts(
      boarding({ invitations: [inv('USED')], registrations: [reg()] }),
      null,
      null,
      null,
    );
    expect(tiles.map((t) => t.label)).toEqual(['invitations used', 'registered']);
    expect(JSON.stringify(tiles)).not.toContain('Not measured yet');
  });

  it('keeps "Not measured yet" only where the record was read and still cannot give the number', () => {
    const partial = programmeFacts(boarding({ moreRegistrations: true }), null, null, null);
    expect(partial).toEqual([
      { key: 'registered', value: 'Not measured yet', known: false, label: 'registered' },
    ]);
    const meetings = programmeFacts(
      null,
      projection({ meetings: { state: 'PARTIAL', scheduled: 1, qualifiedHeld: 0 } }),
      null,
      null,
    );
    expect(meetings.filter((t) => !t.known)).toEqual([
      { key: 'meetings', value: 'Not measured yet', known: false, label: 'meeting counts' },
    ]);
    // "Not shared" is a known state, said once, never a zero.
    const notShared = programmeFacts(
      null,
      projection({ meetings: { state: 'NOT_SHARED', scheduled: null, qualifiedHeld: null } }),
      null,
      null,
    );
    expect(notShared.find((t) => t.key === 'meetings')?.value).toBe('Not shared');
    expect(notShared.some((t) => t.value === '0' && /meeting/.test(t.label))).toBe(false);
  });

  it('never shows a zero for a count it cannot give', () => {
    const tiles = programmeFacts(
      boarding({ moreInvitations: true }),
      projection({ meetings: { state: 'UNAVAILABLE', scheduled: null, qualifiedHeld: null } }),
      null,
      { applications: 0, awaiting: 0 },
    );
    for (const tile of tiles.filter((t) => !t.known)) expect(tile.value).not.toMatch(/^\d/);
    expect(tiles.some((t) => t.label === 'applications answered')).toBe(false);
  });
});

describe('the room keeps what it had', () => {
  const room = read('apps/web/app/account/delegations/programme-room.tsx');
  it('draws the decisions only with the switch, and the next-step card otherwise', () => {
    expect(room).toContain('decisionsFirst = false');
    expect(room).toContain('const decisions = decisionsFirst && participantsEnabled;');
    expect(room).toMatch(
      /\{decisions \? \(\s+<Decisions[\s\S]+?\) : participantsEnabled \? \(\s+<NextStep live=\{live\}/,
    );
  });
  it('keeps the vertical stage timeline in the header in both states (owner lock, 12 Nov)', () => {
    expect(room).toContain('<div className="room-stage room-stage--timeline">');
    expect(room.match(/<Stage counts=/g)).toHaveLength(1);
  });
  it('reads the application counts through the page client, counts only', () => {
    expect(room).toContain("import { useApplicationCounts } from './programme-page-client';");
    const client = read('apps/web/app/account/delegations/programme-page-client.ts');
    const hook = client.slice(client.indexOf('export function useApplicationCounts'));
    expect(hook).toContain('/api/customer-programme-pages?view=page');
    expect(hook).toContain(
      'counts = { applications: view.applications, awaiting: view.awaiting };',
    );
    expect(hook).not.toMatch(/method:|POST|displayLabel|statement/);
  });
});
