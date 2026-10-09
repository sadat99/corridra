import { expect, test } from 'vitest';
import { canonicalPageRedirect } from '../../apps/web/lib/canonical-origin';

const env = { VERCEL_ENV: 'production', APP_ORIGIN: 'https://corridra.vercel.app' };

test('alias recovery links keep their token and use only the configured application origin', () => {
  const target = canonicalPageRedirect(
    new Request(
      'https://c.obsidianglobal.studio/reset-password?token=synthetic&next=https://untrusted.invalid',
    ),
    env,
  );
  expect(target?.origin).toBe(env.APP_ORIGIN);
  expect(target?.pathname).toBe('/reset-password');
  expect(target?.searchParams.get('token')).toBe('synthetic');
  expect(target?.searchParams.get('next')).toBe('https://untrusted.invalid');
  expect(
    canonicalPageRedirect(
      new Request('https://c.obsidianglobal.studio//untrusted.invalid/signin'),
      env,
    )?.origin,
  ).toBe(env.APP_ORIGIN);
});

test('canonical requests, previews, local development and API mutations are not redirected', () => {
  expect(canonicalPageRedirect(new Request(env.APP_ORIGIN + '/signup'), env)).toBeNull();
  const alias = new Request('https://c.obsidianglobal.studio/signin');
  expect(canonicalPageRedirect(alias, { ...env, VERCEL_ENV: 'preview' })).toBeNull();
  expect(canonicalPageRedirect(alias, { APP_ORIGIN: 'http://localhost:3000' })).toBeNull();
  expect(canonicalPageRedirect(new Request(alias.url, { method: 'POST' }), env)).toBeNull();
  expect(canonicalPageRedirect(alias, { VERCEL_ENV: 'production' })).toBeNull();
});

test('production redirects reject a non-HTTPS or non-origin configuration', () => {
  const request = new Request('https://c.obsidianglobal.studio/signin');
  for (const APP_ORIGIN of [
    'http://corridra.vercel.app',
    env.APP_ORIGIN + '/path',
    env.APP_ORIGIN + '?next=evil',
    'https://user:password@corridra.vercel.app',
  ])
    expect(() => canonicalPageRedirect(request, { ...env, APP_ORIGIN })).toThrow('exact HTTPS');
});
