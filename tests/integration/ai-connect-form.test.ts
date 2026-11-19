import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { connectionCommand, guidedConnection } from '../../packages/intelligence/src/connect-form';
import { modelPolicy, type ModelPolicy } from '../../packages/intelligence/src/index';
import { adapterSecretRef, SdkInferenceAdapter } from '../../packages/intelligence/src/adapters';
import { taskIds } from '../../packages/intelligence/src/registry';

// ADR-089. The guided command is a strict schema over the same model policy command the developer path accepts.
const valid = () => ({
  adapter: 'anthropic',
  model: 'claude-test-1',
  evaluationStatus: 'SYNTHETIC_ONLY',
  processingScope: { kind: 'countries', codes: ['DE'] },
  termsSourceId: randomUUID(),
  evaluationSourceId: randomUUID(),
  inputRateMinorPerMillion: '300',
  outputRateMinorPerMillion: '1500',
  maxCostMinor: '200',
  dailyBudgetMinor: '5000',
  effectiveUntil: new Date(Date.now() + 86400000 * 30).toISOString(),
  tasks: ['translation', 'evidence_gaps'],
  reason: 'Connect the reviewed provider',
  expectedVersion: 0,
  confirmed: true,
});
const server = (processingLocations = ['DE']) => ({
  id: randomUUID(),
  version: 1,
  processingLocations,
  effectiveFrom: new Date().toISOString(),
});
const refuses = (patch: Record<string, unknown>) =>
  expect(guidedConnection.safeParse({ ...valid(), ...patch }).success).toBe(false);

describe('guided connection, accepted', () => {
  test('builds exactly the sixteen keys, a server secret name, USD and approved', () => {
    const c = connectionCommand(guidedConnection.parse(valid()), server());
    expect(Object.keys(c.policy)).toHaveLength(16);
    expect(c.policy.secretRef).toBe('CORRIDRA_ANTHROPIC_API_KEY');
    expect(c.policy.currency).toBe('USD');
    expect(c.policy.approved).toBe(true);
    expect(c.key).toBe('connect-anthropic');
    expect(c.policy.fallbackPolicyIds).toEqual([]);
    expect(modelPolicy.safeParse(c.policy).success).toBe(true);
    expect(JSON.stringify(c)).not.toMatch(/EU/);
  });
  test('the EU market key and 30 countries are accepted; the fallback is carried', () => {
    expect(
      guidedConnection.safeParse({ ...valid(), processingScope: { kind: 'market', key: 'EU' } })
        .success,
    ).toBe(true);
    const codes = [
      'AT',
      'BE',
      'BG',
      'HR',
      'CY',
      'CZ',
      'DK',
      'EE',
      'FI',
      'FR',
      'DE',
      'GR',
      'HU',
      'IE',
      'IT',
      'LV',
      'LT',
      'LU',
      'MT',
      'NL',
      'PL',
      'PT',
      'RO',
      'SK',
      'SI',
      'ES',
      'SE',
      'BD',
      'CN',
      'JP',
    ];
    const v = guidedConnection.parse({
      ...valid(),
      processingScope: { kind: 'countries', codes },
      fallbackPolicyId: randomUUID(),
    });
    const c = connectionCommand(v, server(codes));
    expect(c.policy.processingLocations).toHaveLength(30);
    expect(c.policy.fallbackPolicyIds).toHaveLength(1);
  });
  test('every provider maps to its own key name', () => {
    for (const [adapter, ref] of [
      ['openai', 'CORRIDRA_OPENAI_API_KEY'],
      ['google', 'CORRIDRA_GOOGLE_API_KEY'],
    ] as const)
      expect(
        connectionCommand(guidedConnection.parse({ ...valid(), adapter }), server()).policy
          .secretRef,
      ).toBe(ref);
  });
  test('the provider to key name mapping cannot be changed by a caller', () => {
    expect(Object.isFrozen(adapterSecretRef)).toBe(true);
    // Test files are ES modules, so strict mode makes a write to a frozen object throw.
    expect(() => {
      (adapterSecretRef as Record<string, string>).openai = 'CORRIDRA_OTHER_KEY';
    }).toThrow(TypeError);
    expect(adapterSecretRef.openai).toBe('CORRIDRA_OPENAI_API_KEY');
    expect(
      connectionCommand(guidedConnection.parse({ ...valid(), adapter: 'openai' }), server()).policy
        .secretRef,
    ).toBe('CORRIDRA_OPENAI_API_KEY');
  });
});

describe('guided connection, refused', () => {
  test('sources are required and must be identifiers', () => {
    const missing = valid() as Record<string, unknown>;
    delete missing.evaluationSourceId;
    expect(guidedConnection.safeParse(missing).success).toBe(false);
    const noTerms = valid() as Record<string, unknown>;
    delete noTerms.termsSourceId;
    expect(guidedConnection.safeParse(noTerms).success).toBe(false);
    refuses({ evaluationSourceId: 'not-a-uuid' });
    refuses({ termsSourceId: 'nope' });
  });
  test('evaluation status has no default', () => {
    const v = valid() as Record<string, unknown>;
    delete v.evaluationStatus;
    expect(guidedConnection.safeParse(v).success).toBe(false);
    refuses({ evaluationStatus: 'APPROVED' });
  });
  test('locations: none, 31, a non-country, duplicates, another market, a direct list', () => {
    refuses({ processingScope: { kind: 'countries', codes: [] } });
    const many = Array.from({ length: 31 }, (_, i) => `${String.fromCharCode(65 + (i % 26))}${i}`);
    refuses({ processingScope: { kind: 'countries', codes: many } });
    refuses({ processingScope: { kind: 'countries', codes: ['ZZ'] } });
    refuses({ processingScope: { kind: 'countries', codes: ['DE', 'DE'] } });
    refuses({ processingScope: { kind: 'market', key: 'EEA' } });
    refuses({ processingScope: { kind: 'market', key: 'ASIA' } });
    refuses({ processingScope: { kind: 'market', key: 'EU', codes: ['DE'] } });
    refuses({ processingLocations: ['DE'] });
  });
  test('the client can never send a key name, a key or other policy fields', () => {
    refuses({ secretRef: 'CORRIDRA_ANTHROPIC_API_KEY' });
    refuses({ apiKey: 'sk-not-real' });
    refuses({ approved: true });
    refuses({ currency: 'EUR' });
    refuses({ id: randomUUID() });
    refuses({ key: 'x-policy' });
  });
  test('rates and caps are whole positive minor units', () => {
    for (const bad of ['0', '1.5', '-1', '', '01', '1e3', '12345678901234'])
      for (const field of ['inputRateMinorPerMillion', 'outputRateMinorPerMillion', 'maxCostMinor'])
        refuses({ [field]: bad });
  });
  test('daily budget is 1 to 100000', () => {
    refuses({ dailyBudgetMinor: '100001' });
    refuses({ dailyBudgetMinor: '0' });
    expect(guidedConnection.safeParse({ ...valid(), dailyBudgetMinor: '100000' }).success).toBe(
      true,
    );
  });
  test('tasks: none, thirteen, duplicate, unknown', () => {
    refuses({ tasks: [] });
    refuses({ tasks: [...taskIds, 'translation'] });
    refuses({ tasks: ['translation', 'translation'] });
    refuses({ tasks: ['browse_the_web'] });
  });
  test('at most one fallback, an identifier', () => {
    refuses({ fallbackPolicyId: 'x' });
    refuses({ fallbackPolicyIds: [randomUUID(), randomUUID()] });
  });
  test('model name, reason, expected version and confirmation', () => {
    refuses({ model: 'a/../b' });
    refuses({ model: '../x' });
    refuses({ model: 'bad name' });
    refuses({ reason: 'ab' });
    refuses({ expectedVersion: -1 });
    refuses({ expectedVersion: 1.5 });
    refuses({ confirmed: false });
    const v = valid() as Record<string, unknown>;
    delete v.confirmed;
    expect(guidedConnection.safeParse(v).success).toBe(false);
  });
  test('a valid-until in the past is refused when the command is built', () => {
    const v = guidedConnection.parse({
      ...valid(),
      effectiveUntil: new Date(Date.now() - 1000).toISOString(),
    });
    expect(() => connectionCommand(v, server())).toThrow();
  });
});

describe('provider readiness for an EU style list', () => {
  const policy = (codes: string[]): ModelPolicy =>
    connectionCommand(guidedConnection.parse(valid()), server(codes)).policy;
  const eu = [
    'AT',
    'BE',
    'BG',
    'HR',
    'CY',
    'CZ',
    'DK',
    'EE',
    'FI',
    'FR',
    'DE',
    'GR',
    'HU',
    'IE',
    'IT',
    'LV',
    'LT',
    'LU',
    'MT',
    'NL',
    'PL',
    'PT',
    'RO',
    'SK',
    'SI',
    'ES',
    'SE',
  ];
  const ready = (env: Record<string, string>, p: ModelPolicy) =>
    new SdkInferenceAdapter({ CORRIDRA_ANTHROPIC_API_KEY: 'unit-test-not-a-key', ...env }).ready(p);
  test('fails when one country is missing from the deployment setting and passes with all', () => {
    const p = { ...policy(eu), evaluationStatus: 'APPROVED_PROVIDER' as const };
    expect(ready({ CORRIDRA_ANTHROPIC_PROCESSING_LOCATIONS: eu.slice(1).join(',') }, p)).toBe(
      false,
    );
    expect(ready({ CORRIDRA_ANTHROPIC_PROCESSING_LOCATIONS: eu.join(',') }, p)).toBe(true);
  });
});
