import { afterEach, expect, test } from 'vitest';
import { customerIssuer } from '../../packages/auth/src/customer-session';
import { customerIssuerFromEnv } from '../../packages/auth/src/customer-production';

const production =
  'https://ep-shiny-glade-b2if1xhk.neonauth.c-6.eu-central-1.aws.neon.tech/neondb/auth';
const isolated =
  'https://ep-autumn-scene-b17sgino.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const keys = [
  'VERCEL_ENV',
  'DATA_ENVIRONMENT',
  'CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK',
  'CORRIDRA_CUSTOMER_ISSUER',
  'NEON_AUTH_BASE_URL',
] as const;
const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
const unlockedProduction = (issuer = production) => {
  process.env.VERCEL_ENV = 'production';
  process.env.DATA_ENVIRONMENT = 'synthetic';
  process.env.CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK = 'synthetic-only';
  process.env.CORRIDRA_CUSTOMER_ISSUER = issuer;
};
const ok = (value: string) => customerIssuer.safeParse(value).success;

test('the isolated acceptance issuer is always accepted and nothing else is by default', () => {
  expect(ok(isolated)).toBe(true);
  expect(ok(production)).toBe(false);
});

test('the owner issuer is accepted only when production is unlocked and the value matches exactly', () => {
  unlockedProduction();
  expect(ok(production)).toBe(true);
  expect(ok(isolated)).toBe(true);
  // A different valid-looking issuer, with a trailing slash or a different database, stays rejected.
  expect(ok(production + '/')).toBe(false);
  expect(ok(production.replace('/neondb/', '/other/'))).toBe(false);
  expect(ok(production.replace('b2if1xhk', 'zzzzzzzz'))).toBe(false);
});

test('without the unlock or with non-synthetic data the owner issuer is rejected', () => {
  unlockedProduction();
  delete process.env.CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK;
  expect(ok(production)).toBe(false);
  unlockedProduction();
  process.env.DATA_ENVIRONMENT = 'real';
  expect(ok(production)).toBe(false);
  unlockedProduction();
  process.env.VERCEL_ENV = 'preview';
  expect(ok(production)).toBe(false);
});

test('the owner issuer must still be a well-formed https Frankfurt Neon Auth address', () => {
  const cases = [
    'http://ep-a.neonauth.c-6.eu-central-1.aws.neon.tech/neondb/auth',
    'https://ep-a.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth',
    'https://ep-a.neonauth.c-6.us-east-1.aws.neon.tech/neondb/auth',
    'https://evil.example.com/neondb/auth',
    'https://user:pw@ep-a.neonauth.c-6.eu-central-1.aws.neon.tech/neondb/auth',
    'https://ep-a.neonauth.c-6.eu-central-1.aws.neon.tech:8443/neondb/auth',
    'https://ep-a.neonauth.c-6.eu-central-1.aws.neon.tech/neondb/auth?x=1',
    'https://ep-a.neonauth.c-6.eu-central-1.aws.neon.tech/neondb/auth#x',
    'https://ep-a.neonauth.c-6.eu-central-1.aws.neon.tech/neondb/auth/extra',
    'https://ep-a.neonauth.c-6.eu-central-1.aws.neon.tech/Neon DB/auth',
  ];
  for (const value of cases) {
    unlockedProduction(value);
    expect(ok(value), value).toBe(false);
  }
});

test('the pinned issuer comes from the explicit setting first, then the provider address', () => {
  expect(customerIssuerFromEnv({})).toBe('');
  expect(customerIssuerFromEnv({ NEON_AUTH_BASE_URL: 'https://a.example/x' })).toBe(
    'https://a.example/x',
  );
  expect(
    customerIssuerFromEnv({
      NEON_AUTH_BASE_URL: 'https://a.example/x',
      CORRIDRA_CUSTOMER_ISSUER: 'https://b.example/y',
    }),
  ).toBe('https://b.example/y');
});
