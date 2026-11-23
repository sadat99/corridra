import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { programmePagesWords } from '../../apps/web/lib/i18n/programme-pages-words';

// D-040: an error box must not stay on the screen after the person changed the field it names. The rule is a pure
// function, tested here for every problem either form can raise. That each input calls it is read from the source,
// as the other programme tests do: this repository has no browser-free way to press keys in a rendered form, so the
// box disappearing on a real keystroke is not proven here.
type Draft = Record<string, string | string[]>;
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const words = programmePagesWords;

const editor = await load('app/account/delegations/programme-page.tsx');
const { emptyDraft, isoDay, problem, scheduleProblem, editorErrorAfterChange } = editor as {
  emptyDraft: (name: string) => Draft;
  isoDay: (offset: number) => string;
  problem: (step: number, draft: Draft, sample: boolean) => string;
  scheduleProblem: (draft: Draft) => string;
  editorErrorAfterChange: (error: string, changed: string) => string;
};
const { refusalWords } = (await load('app/account/delegations/programme-page-client.ts')) as {
  refusalWords: Record<string, string>;
};
const applications = await load('app/account/delegations/programme-applications.tsx');
const { applicationProblem, applyErrorAfterChange } = applications as {
  applicationProblem: (
    draft: { name: string; statement: string; consent: boolean },
    sample: boolean,
  ) => string;
  applyErrorAfterChange: (error: string, changed: string) => string;
};

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
// One way each editor step can be refused, with the fields its words name.
const editorCases: { step: number; change: Draft; names: string[] }[] = [
  { step: 0, change: { title: '' }, names: ['title'] },
  { step: 0, change: { organiser: '' }, names: ['organiser'] },
  { step: 0, change: { title: 'Machinery delegation' }, names: ['title', 'organiser'] },
  { step: 0, change: { summary: 'Too short' }, names: ['summary'] },
  { step: 1, change: { destination: ' ' }, names: ['destination'] },
  { step: 1, change: { dates: '' }, names: ['dates'] },
  { step: 1, change: { focus: 'x' }, names: ['focus'] },
  { step: 2, change: { audience: 'Short' }, names: ['audience'] },
  { step: 2, change: { eligibility: '' }, names: ['eligibility'] },
  { step: 2, change: { capacity: 'ten' }, names: ['capacity'] },
  { step: 3, change: { activities: 'ab' }, names: ['activities'] },
  { step: 3, change: { activities: 'Factory visit\nFactory visit' }, names: ['activities'] },
  { step: 3, change: { activities: 'A visit\n'.repeat(13) + 'x' }, names: ['activities'] },
  { step: 4, change: { fee: 'x' }, names: ['fee'] },
  { step: 4, change: { included: 'x' }, names: ['included', 'excluded'] },
  { step: 4, change: { excluded: 'Item\n'.repeat(9) }, names: ['included', 'excluded'] },
  { step: 5, change: { closes: isoDay(0) }, names: ['closes'] },
];
const editorFields = [...Object.keys(valid), 'agreed'];

describe('the page editor clears its error once the field it names changes (D-040)', () => {
  it('each problem a step can raise goes when one of its fields changes, and stays for any other', () => {
    const seen = new Set<string>();
    for (const { step, change, names } of editorCases) {
      const wrong = problem(step, { ...valid, ...change }, true);
      expect(wrong, JSON.stringify(change)).not.toBe('');
      seen.add(wrong);
      for (const field of editorFields)
        expect(editorErrorAfterChange(wrong, field), `${wrong} after ${field}`).toBe(
          names.includes(field) ? '' : wrong,
        );
    }
    // Every problem line of the editor is covered above, so none can be added without naming its field.
    const all = Object.entries(words)
      .filter(([key]) => key.startsWith('pp.edit.problem.') && key !== 'pp.edit.problem.schedule')
      .map(([, value]) => value);
    expect([...seen].sort()).toEqual([...all].sort());
  });

  it('the calendar days problem goes when either day changes', () => {
    const wrong = scheduleProblem({ startsOn: '2027-03-16', endsOn: '2027-03-12' });
    expect(wrong).toBe(words['pp.edit.problem.schedule']);
    expect(editorErrorAfterChange(wrong, 'startsOn')).toBe('');
    expect(editorErrorAfterChange(wrong, 'endsOn')).toBe('');
    expect(editorErrorAfterChange(wrong, 'dates')).toBe(wrong);
  });

  it('the reminder to tick the box goes when the box changes, and only then', () => {
    const wrong = words['pp.edit.agreeNeeded'];
    expect(editorErrorAfterChange(wrong, 'agreed')).toBe('');
    expect(editorErrorAfterChange(wrong, 'closes')).toBe(wrong);
  });

  it('a refusal from the server names no field, so it stays until the next submit', () => {
    const kept = [
      ...Object.values(refusalWords),
      words['pp.error.offline'],
      words['pp.error.invalid'],
      words['pp.error.notSaved'],
    ];
    expect(kept.length).toBeGreaterThan(10);
    for (const message of kept)
      for (const field of editorFields)
        expect(editorErrorAfterChange(message, field)).toBe(message);
  });

  it('every input of the editor and its tick box report their change to that rule', () => {
    const source = read('apps/web/app/account/delegations/programme-page.tsx');
    // All the text, date and list inputs change the draft through set().
    expect(source).toMatch(
      /const set = \(key: keyof Draft\) => \(value: string\) => \{\s+setDraft\(\(d\) => \(d \? \{ \.\.\.d, \[key\]: value \} : d\)\);\s+setError\(\(shown\) => editorErrorAfterChange\(shown, key\)\);/,
    );
    expect(source.match(/onChange=\{\(event\) => set\(/g)).toHaveLength(4);
    expect(source).toMatch(
      /setAgreed\(event\.target\.checked\);\s+setError\(\(shown\) => editorErrorAfterChange\(shown, 'agreed'\)\);/,
    );
  });
});

const application = {
  name: 'Synthetic Agro Importers',
  statement: 'Synthetic wish to compare rice transplanters before the season.',
  consent: true,
};
const applyCases: { change: Partial<typeof application>; names: string[] }[] = [
  { change: { name: 'S' }, names: ['name'] },
  { change: { statement: 'Too short' }, names: ['statement'] },
  { change: { name: 'Dhaka Agro Importers' }, names: ['name', 'statement'] },
  { change: { statement: 'Synthetic first line\nand a second line.' }, names: ['statement'] },
  { change: { consent: false }, names: ['consent'] },
];
const applyFields = ['name', 'statement', 'consent'];

describe('the application form clears its error once the field it names changes (D-040)', () => {
  it('a complete application has no problem, in sample and real mode', () => {
    expect(applicationProblem(application, true)).toBe('');
    expect(applicationProblem(application, false)).toBe('');
    // A real name needs no mark and may be short.
    expect(applicationProblem({ ...application, name: 'Li' }, false)).toBe('');
  });

  it('each problem goes when one of its fields changes, and stays for any other', () => {
    const seen = new Set<string>();
    for (const { change, names } of applyCases) {
      const wrong = applicationProblem({ ...application, ...change }, true);
      expect(wrong, JSON.stringify(change)).not.toBe('');
      seen.add(wrong);
      for (const field of applyFields)
        expect(applyErrorAfterChange(wrong, field), `${wrong} after ${field}`).toBe(
          names.includes(field) ? '' : wrong,
        );
    }
    const all = Object.entries(words)
      .filter(([key]) => key.startsWith('pp.apply.problem.'))
      .map(([, value]) => value);
    expect([...seen].sort()).toEqual([...all].sort());
  });

  it('a refusal from the server stays while the person types', () => {
    for (const message of [...Object.values(refusalWords), words['pp.error.offline']])
      for (const field of applyFields) expect(applyErrorAfterChange(message, field)).toBe(message);
  });

  it('the name, the statement and the tick box report their change to that rule', () => {
    const source = read('apps/web/app/account/delegations/programme-applications.tsx');
    for (const [setter, field] of [
      ['setName(event.target.value)', 'name'],
      ['setStatement(event.target.value)', 'statement'],
      ['setConsent(event.target.checked)', 'consent'],
    ] as const) {
      const at = source.indexOf(setter);
      expect(at, setter).toBeGreaterThan(-1);
      expect(source.slice(at, at + 160).replace(/\s+/g, ' ')).toContain(
        `${setter}; setError((shown) => applyErrorAfterChange(shown, '${field}'));`,
      );
    }
    // The form judges with the same rule the test reads.
    expect(source).toContain('applicationProblem({ name, statement, consent }, sample)');
  });
});
