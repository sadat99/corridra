import { expect, test } from 'vitest';
import {
  customerOpenAdmission,
  customerProductionLocked,
  customerProductionUnlocked,
} from '../../packages/auth/src/customer-production';
import { customerWorkspacesEnabled } from '../../packages/auth/src/customer-workspaces';
import { customerRequestsEnabled } from '../../packages/auth/src/customer-requests';
import { founderActivation } from '../../packages/auth/src/founder-activation';

const production = { VERCEL_ENV: 'production', DATA_ENVIRONMENT: 'synthetic' };
const unlocked = { ...production, CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK: 'synthetic-only' };

test('production stays locked unless the owner sets the exact unlock value', () => {
  expect(customerProductionLocked(production)).toBe(true);
  expect(customerProductionUnlocked(production)).toBe(false);
  for (const value of ['true', '1', 'SYNTHETIC-ONLY', ' synthetic-only', 'synthetic-only ', '']) {
    const env = { ...production, CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK: value };
    expect(customerProductionLocked(env)).toBe(true);
  }
  expect(customerProductionLocked(unlocked)).toBe(false);
  expect(customerProductionUnlocked(unlocked)).toBe(true);
});

test('the unlock never applies to non-synthetic data', () => {
  const env = { ...unlocked, DATA_ENVIRONMENT: 'real' };
  expect(customerProductionLocked(env)).toBe(true);
  expect(customerProductionUnlocked(env)).toBe(false);
  expect(customerProductionLocked({ VERCEL_ENV: 'production' })).toBe(true);
});

test('non-production deployments are never locked by this switch', () => {
  for (const VERCEL_ENV of ['preview', 'development', undefined]) {
    expect(customerProductionLocked({ VERCEL_ENV })).toBe(false);
  }
  expect(customerProductionUnlocked({ VERCEL_ENV: 'preview', DATA_ENVIRONMENT: 'synthetic' })).toBe(
    false,
  );
});

test('the module gates follow the lock and still need their own flags', () => {
  const flags = {
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_REQUESTS_ENABLED: 'true',
  };
  expect(customerWorkspacesEnabled({ ...production, ...flags })).toBe(false);
  expect(customerRequestsEnabled({ ...production, ...flags })).toBe(false);
  expect(customerWorkspacesEnabled({ ...unlocked, ...flags })).toBe(true);
  expect(customerRequestsEnabled({ ...unlocked, ...flags })).toBe(true);
  // Unlocking alone enables nothing.
  expect(customerWorkspacesEnabled(unlocked)).toBe(false);
  expect(customerRequestsEnabled(unlocked)).toBe(false);
});

test('open admission needs its own exact value, synthetic data and an unlocked deployment', () => {
  const open = { CORRIDRA_CUSTOMER_OPEN_ADMISSION: 'synthetic-only' };
  expect(customerOpenAdmission({ ...unlocked, ...open })).toBe(true);
  expect(customerOpenAdmission(unlocked)).toBe(false);
  expect(customerOpenAdmission({ ...production, ...open })).toBe(false);
  expect(customerOpenAdmission({ ...unlocked, ...open, DATA_ENVIRONMENT: 'real' })).toBe(false);
  expect(customerOpenAdmission({ ...unlocked, CORRIDRA_CUSTOMER_OPEN_ADMISSION: 'true' })).toBe(
    false,
  );
  // A preview with the switch is allowed because previews are not locked.
  expect(
    customerOpenAdmission({ VERCEL_ENV: 'preview', DATA_ENVIRONMENT: 'synthetic', ...open }),
  ).toBe(true);
});

test('the founder view reports the unlock, the open admission and module states truthfully', () => {
  const locked = founderActivation(production);
  expect(locked.environment).toMatchObject({
    deployment: 'production',
    productionUnlocked: false,
    openAdmission: false,
  });
  expect(locked.modules.every((m) => m.state === 'LOCKED_PRODUCTION')).toBe(true);
  const open = founderActivation({
    ...unlocked,
    CORRIDRA_CUSTOMER_OPEN_ADMISSION: 'synthetic-only',
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
  });
  expect(open.environment).toMatchObject({ productionUnlocked: true, openAdmission: true });
  expect(open.modules.find((m) => m.key === 'workspaces')?.state).toBe('ON');
  expect(open.modules.find((m) => m.key === 'requests')?.state).toBe('OFF');
  expect(open.counts.on).toBe(1);
});
