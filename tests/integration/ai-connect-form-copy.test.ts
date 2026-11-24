import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { guidedConnection } from '../../packages/intelligence/src/connect-form';
import { taskIds } from '../../packages/intelligence/src/registry';
import {
  changeFact,
  euConsequence,
  euHelper,
  fallbackOption,
  progressLine,
  providerNames,
  reviewSummary,
  savedText,
  stepNames,
  stepQuestions,
  taskGroups,
  taskLabels,
  words,
  groupSummary,
  matchesLine,
  tasksChosen,
  showTasks,
  chosenCount,
  countryAdded,
  countryRemoved,
  fromVersion,
  changeLabel,
  reasonCount,
  kindLabel,
  providerName,
} from '../../apps/web/app/operator/connect-ai-copy';
import {
  buildConnectionRequest,
  emptyDraft,
  minorToUsd,
  stepErrors,
  usdToMinor,
  type ConnectDraft,
  type DraftContext,
} from '../../apps/web/app/operator/connect-ai-request';
import {
  aiConnectionRecordedFact,
  aiConnectionRows,
  beforeSendRows,
} from '../../apps/web/lib/consequence-preview';

// ADR-089, Connect AI PR 2: the guided screen's words and the one request it sends. Pure: no database and no browser.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
// Words the screen must never use: no claim about where a provider processes data, no legal status, nothing about a key,
// and nothing that says AI is on or works.
const forbidden =
  /\b(ready|connected|working|verified|residency|gdpr|compliant|compliance|legal|lawful|key|api key|test connection)\b|stays in the eu|data stays/i;

const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : value && typeof value === 'object'
      ? Object.values(value).flatMap(strings)
      : [];
// Every line the screen can show: the copy module, its filled lines, and the words written in the screen's markup.
// Text in the markup sits on its own line after formatting ("Add {countryName(code)}"); quoted literals hold the rest.
// Comment lines are left out: they explain the code and are never shown.
const jsxText = (path: string) => {
  const code = read(path)
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
  return [
    ...code.map((line) => line.trim()).filter((line) => /^[A-Z][a-z]+ /.test(line)),
    ...code.flatMap((line) => [...line.matchAll(/'([^'\n]* [^'\n]*)'/g)].map((m) => m[1])),
  ];
};
const allLines = () => [
  ...strings(words),
  ...stepNames,
  ...stepQuestions,
  ...Object.values(taskLabels),
  ...Object.values(providerNames),
  euHelper(27, '12 October 2026'),
  euConsequence('openai'),
  changeFact('OpenAI', 0),
  changeFact('OpenAI', 3),
  savedText('OpenAI', 1),
  savedText('OpenAI', 4),
  savedText('OpenAI', 1, true),
  savedText('OpenAI', 4, true),
  reviewSummary('OpenAI', 'gpt-test', 2),
  fallbackOption('Google', 'gemini-test', 2),
  progressLine(0),
  progressLine(8),
  ...taskGroups.map((group) => group.name),
  groupSummary('Requests and companies', 2, 5),
  matchesLine(5, 75),
  matchesLine(1, 1),
  matchesLine(3, 3),
  tasksChosen(2, 12),
  showTasks(2, 12),
  chosenCount(3, 20),
  countryAdded('Bangladesh', 3, 20),
  countryRemoved('Bangladesh', 2, 20),
  fromVersion(4),
  ...stepNames.map(changeLabel),
  reasonCount(12),
  kindLabel('public_record'),
  providerName('anthropic'),
  ...jsxText('apps/web/app/operator/connect-ai-form.tsx'),
  ...jsxText('apps/web/app/operator/country-list-picker.tsx'),
];

const draft = (patch: Partial<ConnectDraft> = {}): ConnectDraft => ({
  ...emptyDraft,
  adapter: 'anthropic',
  model: 'claude-test-1',
  evaluationStatus: 'SYNTHETIC_ONLY',
  scope: 'countries',
  codes: ['DE', 'BD'],
  termsSourceId: randomUUID(),
  evaluationSourceId: randomUUID(),
  inputRate: '3',
  outputRate: '15.5',
  maxCost: '0.05',
  dailyBudget: '50',
  validUntil: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  tasks: ['translation', 'evidence_gaps'],
  reason: 'Connect the reviewed provider',
  confirmed: true,
  ...patch,
});

// What the screen offers for a draft: its own sources and fallback, and the EU list.
const contextOf = (d: ConnectDraft, patch: Partial<DraftContext> = {}): DraftContext => ({
  sourceIds: [d.termsSourceId, d.evaluationSourceId],
  fallbackIds: d.fallbackPolicyId ? [d.fallbackPolicyId] : [],
  euOffered: true,
  ...patch,
});
const build = (d: ConnectDraft, expectedVersion: number, patch: Partial<DraftContext> = {}) =>
  buildConnectionRequest(d, expectedVersion, contextOf(d, patch));

describe('the owner-approved words, exactly', () => {
  it('labels and explains the EU choice as a list of countries Corridra records', () => {
    expect(words.countries.euLabel).toBe('EU member countries (list Corridra records)');
    expect(euHelper(27, '12 October 2026')).toBe(
      'Corridra saves the countries it lists as EU members today (27 countries, recorded 12 October 2026). This is a list of countries, not a check of where your provider processes data. Later changes to the list do not alter what you save.',
    );
    expect(euConsequence('anthropic')).toBe(
      "To use this list, the owner must set CORRIDRA_ANTHROPIC_PROCESSING_LOCATIONS and each cited source's rights review to include every country.",
    );
    // The same capitals the adapter reads (adapters.ts uses adapter.toUpperCase()).
    expect(euConsequence('google')).toContain('CORRIDRA_GOOGLE_PROCESSING_LOCATIONS');
    expect(read('packages/intelligence/src/adapters.ts')).toContain('toUpperCase()');
  });
  it('says before saving what changes, that no money moves and that nothing can run', () => {
    expect(changeFact('OpenAI', 2)).toBe(
      'Saving makes version 3 of the OpenAI connection. It replaces version 2, so route packs pinned to version 2 stop using AI.',
    );
    expect(changeFact('OpenAI', 0)).toBe(
      'This is the first version of the OpenAI connection. No route pack is pinned to an earlier version.',
    );
    expect(words.beforeSave.moneyFact).toBe('No. This saves settings only. No money moves.');
    // A real workspace has two states since ADR-091. Off: no run can start. On: the save still runs nothing, and the
    // sentence names what a later run must pass.
    expect(words.beforeSave.runRealOff).toBe(
      'No. This save runs no AI and does not switch it on. AI is off for this workspace, so no AI run can start here.',
    );
    expect(words.beforeSave.runRealOn).toBe(
      'No. This save runs no AI and does not switch it on. AI is already on for this workspace. A later run can use this connection only if the route pack of the request names it and the evaluation status is Approved provider. A run is refused if a cited statement holds an email address or a phone number. The cost cap and the daily budget still apply. A person must review every result.',
    );
    expect(words.beforeSave.runSample).toBe('No. This save runs no AI and does not switch it on.');
    for (const fact of [words.beforeSave.runRealOff, words.beforeSave.runRealOn])
      expect(fact.startsWith(words.beforeSave.runSample)).toBe(true);
    expect(JSON.stringify(words.beforeSave)).not.toContain(
      'No AI run is possible in a real workspace yet',
    );
    // The on-state sentence uses the form's own names for the evaluation status and the two limits.
    expect(words.beforeSave.runRealOn).toContain(words.evaluation.APPROVED_PROVIDER.label);
    const form = read('apps/web/app/operator/connect-ai-form.tsx');
    expect(form).toContain('words.beforeSave.runRealOn');
    expect(form).toContain('words.beforeSave.runRealOff');
    expect(form).not.toMatch(/beforeSave\.runReal(?!On|Off)/);
  });
  it('names owners and admins as the people who can connect', () => {
    expect(words.deniedHeading).toBe('Only owners and admins can do this');
  });
  it('says after saving that it is saved and not switched on', () => {
    expect(words.success.heading).toBe('Saved, not switched on');
    expect(savedText('Google', 2)).toBe(
      'Version 2 of the Google connection is saved. AI is not switched on. This save ran no AI and moved no money. Route packs pinned to version 1 no longer use AI.',
    );
    expect(savedText('Google', 1)).not.toContain('Route packs');
    expect(savedText('Google', 1)).toBe(
      'Version 1 of the Google connection is saved. AI is not switched on. This save ran no AI and moved no money.',
    );
    // With AI already on for the workspace the page never says it is off (ADR-091).
    expect(words.success.headingOn).toBe('Saved, AI was already on');
    expect(savedText('Google', 2, true)).toBe(
      'Version 2 of the Google connection is saved. AI was already on for this workspace, and this save did not change that. This save ran no AI and moved no money. A run starts only when a person starts one, and it must pass the checks. Route packs pinned to version 1 no longer use AI.',
    );
    expect(savedText('Google', 1, true)).toBe(
      'Version 1 of the Google connection is saved. AI was already on for this workspace, and this save did not change that. This save ran no AI and moved no money. A run starts only when a person starts one, and it must pass the checks.',
    );
    for (const text of [savedText('Google', 1, true), savedText('Google', 2, true)])
      expect(text).not.toContain('not switched on');
    expect(savedText('Google', 2, false)).toBe(savedText('Google', 2));
    const page = read('apps/web/app/operator/connect-ai-form.tsx');
    expect(page).toContain('savedText(saved.provider, saved.version, saved.aiOn)');
    expect(page).toContain('saved.aiOn ? words.success.headingOn : words.success.heading');
  });
  it('names a step for each of the nine and a label for each of the twelve tasks', () => {
    expect(stepNames).toHaveLength(9);
    expect(stepQuestions).toHaveLength(9);
    expect(Object.keys(taskLabels).sort()).toEqual([...taskIds].sort());
    expect(taskGroups.flatMap((group) => group.tasks).sort()).toEqual([...taskIds].sort());
    expect(progressLine(0)).toBe('Step 1 of 9: Provider · Next: Model');
    expect(progressLine(8)).toBe('Step 9 of 9: Save');
  });
});

describe('the words the screen must never use', () => {
  it('scans every line function the copy module exports', async () => {
    const copy = await loadWeb('app/operator/connect-ai-copy.ts');
    const functions = Object.entries(copy)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();
    // Each one is called in allLines() above; a new one must be added there too.
    const scanned = read('tests/integration/ai-connect-form-copy.test.ts')
      .slice(0, read('tests/integration/ai-connect-form-copy.test.ts').indexOf('const draft ='))
      .split('const allLines')[1];
    for (const name of functions) expect(scanned, name).toMatch(new RegExp(`\\b${name}\\b`));
  });
  it('finds no forbidden word and no dash in any line', () => {
    const lines = allLines();
    expect(lines.length).toBeGreaterThan(100);
    for (const line of lines) {
      expect(line, line).not.toMatch(forbidden);
      expect(line, line).not.toMatch(dashes);
    }
  });
  it('the scan itself catches a planted claim', () => {
    for (const planted of [
      'Your data stays in the EU.',
      'GDPR compliant',
      'The provider is connected and ready.',
      'Enter your API key',
    ])
      expect(planted).toMatch(forbidden);
  });
  it('asks for no key and shows no key presence', () => {
    for (const path of [
      'apps/web/app/operator/connect-ai-form.tsx',
      'apps/web/app/operator/connect-ai-copy.ts',
      'apps/web/app/operator/connect-ai-request.ts',
    ])
      expect(read(path), path).not.toMatch(/secretRef|API_KEY|apiKey|password/);
  });
});

describe('money is exact text, never a float', () => {
  it('moves the decimal point in the text', () => {
    expect(usdToMinor('12.5')).toEqual({ minor: '1250' });
    expect(usdToMinor('0.05')).toEqual({ minor: '5' });
    expect(usdToMinor('1000')).toEqual({ minor: '100000' });
    expect(usdToMinor('0.10')).toEqual({ minor: '10' });
    // Past the range a float holds exactly, the text stays exact.
    expect(usdToMinor('99999999999.99')).toEqual({ minor: '9999999999999' });
  });
  it('refuses what is not an amount above zero with two decimals at most', () => {
    expect(usdToMinor('1.505')).toEqual({ error: words.money.decimals });
    expect(usdToMinor('-1')).toEqual({ error: words.money.aboveZero });
    expect(usdToMinor('0')).toEqual({ error: words.money.aboveZero });
    expect(usdToMinor('0.00')).toEqual({ error: words.money.aboveZero });
    for (const typed of ['', '1e5', 'abc', '.', '1,000'])
      expect(usdToMinor(typed), typed).toEqual({ error: words.money.notNumber });
  });
  it('reads an earlier version back as USD text', () => {
    expect(minorToUsd('1250')).toBe('12.50');
    expect(minorToUsd('5')).toBe('0.05');
    expect(minorToUsd('100000')).toBe('1000.00');
  });
  it('holds the daily budget to 1,000.00 USD', () => {
    expect(stepErrors(draft({ dailyBudget: '1000' }), 5, contextOf(draft()))).toEqual({});
    expect(stepErrors(draft({ dailyBudget: '1000.01' }), 5, contextOf(draft()))).toEqual({
      dailyBudget: words.limits.budgetOver,
    });
  });
});

describe('the one request the screen sends', () => {
  it('parses under the server schema for chosen countries and for the EU list', () => {
    const countries = build(draft(), 0);
    expect(guidedConnection.parse(countries)).toMatchObject({
      processingScope: { kind: 'countries', codes: ['DE', 'BD'] },
      inputRateMinorPerMillion: '300',
      outputRateMinorPerMillion: '1550',
      maxCostMinor: '5',
      dailyBudgetMinor: '5000',
      expectedVersion: 0,
      confirmed: true,
    });
    const market = build(draft({ scope: 'market', codes: [] }), 2);
    expect(guidedConnection.parse(market).processingScope).toEqual({ kind: 'market', key: 'EU' });
    expect(market.expectedVersion).toBe(2);
  });
  it('carries only plain answers: no key, no key name, no version to write, no locations for a market', () => {
    const body = build(draft({ scope: 'market', codes: [] }), 1);
    expect(Object.keys(body).sort()).toEqual(
      [
        'adapter',
        'confirmed',
        'dailyBudgetMinor',
        'effectiveUntil',
        'evaluationSourceId',
        'evaluationStatus',
        'expectedVersion',
        'inputRateMinorPerMillion',
        'maxCostMinor',
        'model',
        'outputRateMinorPerMillion',
        'processingScope',
        'reason',
        'tasks',
        'termsSourceId',
      ].sort(),
    );
    expect(JSON.stringify(body)).not.toMatch(/secret|api|processingLocations|"version"/i);
    const fallback = randomUUID();
    expect(build(draft({ fallbackPolicyId: fallback }), 0).fallbackPolicyId).toBe(fallback);
  });
  it('sends nothing from an unticked, unfinished or invalid draft', () => {
    expect(() => build(draft({ confirmed: false }), 0)).toThrow(words.save.confirmError);
    expect(() => build(draft({ termsSourceId: '' }), 0)).toThrow(words.sources.blank);
    expect(() => build(draft({ maxCost: '1.555' }), 0)).toThrow(words.money.decimals);
    expect(() => build(draft({ model: '../x' }), 0)).toThrow(words.model.invalid);
    expect(() => build(draft({ validUntil: '2020-01-01' }), 0)).toThrow(words.limits.validError);
    expect(() => build(draft({ codes: [] }), 0)).toThrow(words.countries.none);
    expect(() => build(draft({ tasks: [] }), 0)).toThrow(words.tasks.error);
    expect(() => build(draft({ reason: '  a ' }), 0)).toThrow(words.save.reasonError);
  });
  it('sends no source or fallback the lists no longer hold, and no EU list that is not offered', () => {
    const d = draft({ fallbackPolicyId: randomUUID() });
    expect(() => build(d, 0, { sourceIds: [d.termsSourceId] })).toThrow(words.sources.refused);
    expect(() => build(d, 0, { fallbackIds: [] })).toThrow(words.fallback.FALLBACK_NOT_CURRENT);
    // An earlier EU choice with the list no longer on offer is the countries path: never a market scope.
    const eu = draft({ scope: 'market', codes: [] });
    expect(() => build(eu, 0, { euOffered: false })).toThrow(words.countries.none);
    expect(build({ ...eu, codes: ['BD'] }, 0, { euOffered: false }).processingScope).toEqual({
      kind: 'countries',
      codes: ['BD'],
    });
    expect(build({ ...eu, codes: ['BD'] }, 0).processingScope).toEqual({
      kind: 'market',
      key: 'EU',
    });
    // Without the EU list on offer, an unanswered choice is the countries path.
    expect(build(draft({ scope: '' }), 0, { euOffered: false }).processingScope).toEqual({
      kind: 'countries',
      codes: ['DE', 'BD'],
    });
    // With it on offer, a choice is needed.
    expect(() => build(draft({ scope: '' }), 0)).toThrow(words.countries.none);
  });
});

describe('Before You Save and the switch-off page', () => {
  it('gives each Before You Save row a code fact and leaves the two reply surfaces as they were', () => {
    expect(aiConnectionRows.map((r) => r.id)).toEqual(['change', 'money', 'run']);
    expect(aiConnectionRows.map((r) => r.icon)).toEqual(['document', 'shield', 'lock']);
    for (const row of aiConnectionRows) expect(row.sourceNote.length, row.id).toBeGreaterThan(20);
    // The run row cites the record that opened AI in real workspaces and both states, and every file it names exists.
    const run = aiConnectionRows[2].sourceNote;
    expect(run).toContain('docs/adr/0091-ai-assistance-in-real-workspaces.md:Decision 5');
    expect(run).toContain('0002_real_workspace_runs.sql:51-54 (app.ai_real_runs_open');
    expect(run).toContain('0002_real_workspace_runs.sql:111-116 (app.part4_enabled');
    expect(run).not.toContain('sample-only');
    for (const path of run.match(/(?:docs|packages)\/[\w./-]+\.(?:sql|ts|md)/g) ?? [])
      expect(read(path).length, path).toBeGreaterThan(0);
    const step = read(
      'packages/db/ai-model-policy-real-migrations/0002_real_workspace_runs.sql',
    ).split('\n');
    expect(step[50]).toContain('CREATE FUNCTION app.ai_real_runs_open()');
    expect(step[110]).toContain('CREATE OR REPLACE FUNCTION app.part4_enabled');
    expect(step[68]).toContain('APPROVED_PROVIDER');
    expect(step[71]).toContain('may be a phone number');
    expect(step[91]).toContain('daily_budget_minor');
    expect(step[105]).toContain('AI review authority required');
    expect(aiConnectionRecordedFact.sourceNote.length).toBeGreaterThan(20);
    expect(Object.keys(beforeSendRows).sort()).toEqual(['evidenceReply', 'recipientReply']);
  });
  it('draws the three rows and the recorded line with no control', async () => {
    const { BeforeSend } = await loadWeb('components/before-send.tsx');
    // Both real workspace states (ADR-091) draw the same three rows; only the run fact differs.
    for (const runFact of [words.beforeSave.runRealOff, words.beforeSave.runRealOn]) {
      const html = render(
        ce(BeforeSend, {
          surface: 'aiConnection',
          heading: words.beforeSave.heading,
          rows: {
            change: { question: words.beforeSave.change, fact: changeFact('OpenAI', 1) },
            money: { question: words.beforeSave.money, fact: words.beforeSave.moneyFact },
            run: { question: words.beforeSave.run, fact: runFact },
          },
          recorded: words.beforeSave.recorded,
        }),
      );
      expect(html).toContain('aria-label="Before you save"');
      expect(html.match(/class="before-send-row"/g)).toHaveLength(3);
      for (const line of [
        words.beforeSave.change,
        words.beforeSave.money,
        words.beforeSave.run,
        words.beforeSave.moneyFact,
        runFact,
        words.beforeSave.recorded,
      ])
        expect(html).toContain(line);
      expect(html).not.toMatch(/<(button|input|select|textarea|a)\b|onclick|style=/i);
    }
  });
  it('draws nothing before the read answers, so with the switch off the panel is what it was', async () => {
    const { ConnectAiForm } = await loadWeb('app/operator/connect-ai-form.tsx');
    expect(render(ce(ConnectAiForm, { tenant: randomUUID() }))).toBe('');
  });
  it('draws nothing when the read answers 404 (switch off), 401 or is lost, first or later', async () => {
    const { firstReadView, laterReadView } = await loadWeb('app/operator/connect-ai-form.tsx');
    const { ActionError } = await loadWeb('lib/ux/step-up.ts');
    const off = new ActionError('Not found', 404);
    expect(firstReadView(off)).toBe('hidden');
    expect(laterReadView(off)).toBe('hidden');
    expect(firstReadView(new ActionError('Sign in to continue', 401))).toBe('hidden');
    expect(firstReadView(new TypeError('Failed to fetch'))).toBe('hidden');
    // The switch is known to be on: a server failure or a refusal is shown, never hidden.
    expect(firstReadView(new ActionError('Failed', 500))).toBe('readFailed');
    expect(firstReadView(new ActionError('Access denied', 403))).toBe('denied');
    expect(laterReadView(new TypeError('Failed to fetch'))).toBe('readFailed');
    expect(laterReadView(new ActionError('Access denied', 403))).toBe('denied');
  });
});
