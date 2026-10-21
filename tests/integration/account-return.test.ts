import { expect, test } from 'vitest';
import { accountAccessPath, accountReturnTo } from '../../apps/web/lib/account-return';

test('account continuation accepts only the request form and defaults to the account', () => {
  expect(accountReturnTo('/plan')).toBe('/plan');
  for (const value of [
    null,
    undefined,
    '/account',
    '',
    'https://example.invalid/plan',
    '//example.invalid/plan',
    'javascript:alert(1)',
    '/\\example.invalid/plan',
    '/plan/../operator',
    '/plan?token=private',
    '/plan#private',
    '%2Fplan',
    '/plan\n',
  ])
    expect(accountReturnTo(value)).toBe('/account');
});

test('account links retain a permitted destination without copying tokens or arbitrary queries', () => {
  for (const page of [
    '/signin',
    '/signup',
    '/verify-email',
    '/forgot-password',
    '/reset-password',
  ] as const) {
    expect(accountAccessPath(page, '/plan')).toBe(`${page}?returnTo=%2Fplan`);
    expect(accountAccessPath(page, '/account')).toBe(page);
    expect(accountAccessPath(page, 'https://example.invalid/?token=private')).toBe(page);
  }
});
