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
  taskLabels,
  words,
} from '../../apps/web/app/operator/connect-ai-copy';
import {
  buildConnectionRequest,
  emptyDraft,
  minorToUsd,
  stepErrors,
  usdToMinor,
  type ConnectDraft,
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
  reviewSummary('OpenAI', 'gpt-test', 2),
  fallbackOption('Google', 'gemini-test', 2),
  progressLine(0),
  progressLine(8),
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
    expect(words.beforeSave.runReal).toBe(
      'No. This save runs no AI and does not switch it on. No AI run is possible in a real workspace yet.',
    );
    expect(words.beforeSave.runSample).toBe('No. This save runs no AI and does not switch it on.');
  });
  it('says after saving that it is saved and not switched on', () => {
    expect(words.success.heading).toBe('Saved, not switched on');
    expect(savedText('Google', 2)).toBe(
      'Version 2 of the Google connection is saved. AI is not switched on. This save ran no AI and moved no money. Route packs pinned to version 1 no longer use AI.',
    );
    expect(savedText('Google', 1)).not.toContain('Route packs');
  });
  it('names a step for each of the nine and a label for each of the twelve tasks', () => {
    expect(stepNames).toHaveLength(9);
    expect(stepQuestions).toHaveLength(9);
    expect(Object.keys(taskLabels).sort()).toEqual([...taskIds].sort());
    expect(progressLine(0)).toBe('Step 1 of 9: Provider · Next: Model');
    expect(progressLine(8)).toBe('Step 9 of 9: Save');
  });
});

describe('the words the screen must never use', () => {
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
    expect(stepErrors(draft({ dailyBudget: '1000' }), 5)).toEqual({});
    expect(stepErrors(draft({ dailyBudget: '1000.01' }), 5)).toEqual({
      dailyBudget: words.limits.budgetOver,
    });
  });
});

describe('the one request the screen sends', () => {
  it('parses under the server schema for chosen countries and for the EU list', () => {
    const countries = buildConnectionRequest(draft(), 0);
    expect(guidedConnection.parse(countries)).toMatchObject({
      processingScope: { kind: 'countries', codes: ['DE', 'BD'] },
      inputRateMinorPerMillion: '300',
      outputRateMinorPerMillion: '1550',
      maxCostMinor: '5',
      dailyBudgetMinor: '5000',
      expectedVersion: 0,
      confirmed: true,
    });
    const market = buildConnectionRequest(draft({ scope: 'market', codes: [] }), 2);
    expect(guidedConnection.parse(market).processingScope).toEqual({ kind: 'market', key: 'EU' });
    expect(market.expectedVersion).toBe(2);
  });
  it('carries only plain answers: no key, no key name, no version to write, no locations for a market', () => {
    const body = buildConnectionRequest(draft({ scope: 'market', codes: [] }), 1);
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
    expect(buildConnectionRequest(draft({ fallbackPolicyId: fallback }), 0).fallbackPolicyId).toBe(
      fallback,
    );
  });
  it('sends nothing from an unticked, unfinished or invalid draft', () => {
    expect(() => buildConnectionRequest(draft({ confirmed: false }), 0)).toThrow(
      words.save.confirmError,
    );
    expect(() => buildConnectionRequest(draft({ termsSourceId: '' }), 0)).toThrow(
      words.sources.blank,
    );
    expect(() => buildConnectionRequest(draft({ maxCost: '1.555' }), 0)).toThrow(
      words.money.decimals,
    );
    expect(() => buildConnectionRequest(draft({ model: '../x' }), 0)).toThrow(words.model.invalid);
    expect(() => buildConnectionRequest(draft({ validUntil: '2020-01-01' }), 0)).toThrow(
      words.limits.validError,
    );
    expect(() => buildConnectionRequest(draft({ codes: [] }), 0)).toThrow(words.countries.none);
    expect(() => buildConnectionRequest(draft({ tasks: [] }), 0)).toThrow(words.tasks.error);
    expect(() => buildConnectionRequest(draft({ reason: '  a ' }), 0)).toThrow(
      words.save.reasonError,
    );
  });
});

describe('Before You Save and the switch-off page', () => {
  it('gives each Before You Save row a code fact and leaves the two reply surfaces as they were', () => {
    expect(aiConnectionRows.map((r) => r.id)).toEqual(['change', 'money', 'run']);
    expect(aiConnectionRows.map((r) => r.icon)).toEqual(['document', 'shield', 'lock']);
    for (const row of aiConnectionRows) expect(row.sourceNote.length, row.id).toBeGreaterThan(20);
    expect(aiConnectionRecordedFact.sourceNote.length).toBeGreaterThan(20);
    expect(Object.keys(beforeSendRows).sort()).toEqual(['evidenceReply', 'recipientReply']);
  });
  it('draws the three rows and the recorded line with no control', async () => {
    const { BeforeSend } = await loadWeb('components/before-send.tsx');
    const html = render(
      ce(BeforeSend, {
        surface: 'aiConnection',
        heading: words.beforeSave.heading,
        rows: {
          change: { question: words.beforeSave.change, fact: changeFact('OpenAI', 1) },
          money: { question: words.beforeSave.money, fact: words.beforeSave.moneyFact },
          run: { question: words.beforeSave.run, fact: words.beforeSave.runReal },
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
      words.beforeSave.runReal,
      words.beforeSave.recorded,
    ])
      expect(html).toContain(line);
    expect(html).not.toMatch(/<(button|input|select|textarea|a)\b|onclick|style=/i);
  });
  it('draws nothing before the read answers, so with the switch off the panel is what it was', async () => {
    const { ConnectAiForm } = await loadWeb('app/operator/connect-ai-form.tsx');
    expect(render(ce(ConnectAiForm, { tenant: randomUUID() }))).toBe('');
  });
});
