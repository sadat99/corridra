import { beforeAll, afterAll, test, expect } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { OperationsService } from '../../packages/missions/src/operations';
import { founderActivation } from '../../packages/auth/src/founder-activation';

let f: Awaited<ReturnType<typeof commercialFixture>>, s: OperationsService;
beforeAll(async () => {
  f = await commercialFixture();
  s = new OperationsService(f.runtime);
});
afterAll(async () => {
  await f?.close();
});

const synthetic = { DATA_ENVIRONMENT: 'synthetic', VERCEL_ENV: 'preview' };
const state = (env: NodeJS.ProcessEnv, key: string) =>
  founderActivation(env).modules.find((m) => m.key === key)?.state;

test('with no flags set every customer module is off and nothing is claimed on', () => {
  const view = founderActivation(synthetic);
  expect(view.counts).toEqual({ on: 0, total: view.modules.length });
  expect(view.modules.every((m) => m.state === 'OFF')).toBe(true);
  expect(view.environment).toEqual({ deployment: 'preview', data: 'synthetic' });
  expect(view.note).toContain('No real customer data');
});

test('production locks every module even when its flag is set', () => {
  const env: NodeJS.ProcessEnv = {
    DATA_ENVIRONMENT: 'synthetic',
    VERCEL_ENV: 'production',
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_REQUESTS_ENABLED: 'true',
  };
  const view = founderActivation(env);
  expect(view.counts.on).toBe(0);
  expect(view.modules.every((m) => m.state === 'LOCKED_PRODUCTION')).toBe(true);
  expect(view.environment.deployment).toBe('production');
});

test('non-synthetic data locks every module', () => {
  const view = founderActivation({
    DATA_ENVIRONMENT: 'real',
    VERCEL_ENV: 'preview',
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
  });
  expect(view.counts.on).toBe(0);
  expect(view.modules.every((m) => m.state === 'LOCKED_NOT_SYNTHETIC')).toBe(true);
  expect(view.environment.data).toBe('not-synthetic');
});

test('a dependent flag waits for its prerequisite chain instead of reporting on', () => {
  const env: NodeJS.ProcessEnv = {
    ...synthetic,
    CORRIDRA_CUSTOMER_PROGRAMME_TEMPLATES_ENABLED: 'true',
  };
  expect(state(env, 'programme-templates')).toBe('WAITING_PREREQUISITE');
  expect(state(env, 'workspaces')).toBe('OFF');
  // Templates need workspaces, programmes, participants, economics and coordination.
  const full: NodeJS.ProcessEnv = {
    ...synthetic,
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMME_ECONOMICS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMME_COORDINATION_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMME_TEMPLATES_ENABLED: 'true',
  };
  const view = founderActivation(full);
  expect(
    view.modules
      .filter((m) => m.state === 'ON')
      .map((m) => m.key)
      .sort(),
  ).toEqual([
    'participants',
    'programme-coordination',
    'programme-economics',
    'programme-templates',
    'programmes',
    'workspaces',
  ]);
  expect(view.counts.on).toBe(6);
});

test('only the exact string true turns a flag on', () => {
  for (const value of ['TRUE', '1', 'yes', ' true', 'true ']) {
    expect(state({ ...synthetic, CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: value }, 'workspaces')).toBe(
      'OFF',
    );
  }
});

test('the report reads no secrets and names only flags', () => {
  const text = JSON.stringify(
    founderActivation({
      ...synthetic,
      RUNTIME_DATABASE_URL: 'postgres://user:secret@host/db',
      NEON_AUTH_COOKIE_SECRET: 'x'.repeat(40),
    }),
  );
  expect(text).not.toContain('secret');
  expect(text).not.toContain('postgres://');
  expect(text).not.toContain('xxxx');
});

test('owners and admins reach the founder view and an operator is denied', async () => {
  expect(await s.founderAccess(f.users.owner.ctx)).toEqual({ role: 'owner' });
  await expect(s.founderAccess(f.users.operator.ctx)).rejects.toThrow();
});
