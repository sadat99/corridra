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

const organise = '/account/delegations/organise';

test('the organiser page is kept as an exact path, with or without the email-return switch', () => {
  expect(accountReturnTo(organise)).toBe(organise);
  expect(accountReturnTo(organise, true)).toBe(organise);
  expect(accountReturnTo(organise, false)).toBe(organise);
});

test('every variant of the organiser path falls back to the account', () => {
  for (const value of [
    organise + '/',
    organise + '?x',
    organise + '?x=1',
    organise + '#x',
    organise + '#',
    organise + '/x',
    organise + '/../x',
    organise + '/..',
    organise + ' ',
    ' ' + organise,
    organise + '\n',
    organise.toUpperCase(),
    '/Account/Delegations/Organise',
    '/account/delegations',
    '/account/delegations/organis',
    '/account//delegations/organise',
    '//account/delegations/organise',
    '//evil.example' + organise,
    '//evil.example',
    '/account/delegations/../delegations/organise',
    '/account/delegations/./organise',
    '/account/delegations%2Forganise',
    '%2Faccount%2Fdelegations%2Forganise',
    '/account/delegations/organis%65',
    '/account/delegations/organise%00',
    '/account/delegations/organise%2F',
    '/account\\delegations\\organise',
    'https://corridra.example' + organise,
    'http://localhost' + organise,
    'javascript:' + organise,
    'https:' + organise,
  ]) {
    expect(accountReturnTo(value)).toBe('/account');
    expect(accountReturnTo(value, true)).toBe('/account');
  }
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

test('every account page keeps the organiser page, so a new organiser who signs up comes back too', () => {
  for (const page of [
    '/signin',
    '/signup',
    '/verify-email',
    '/forgot-password',
    '/reset-password',
  ] as const) {
    expect(accountAccessPath(page, organise)).toBe(
      `${page}?returnTo=%2Faccount%2Fdelegations%2Forganise`,
    );
    expect(accountAccessPath(page, organise + '?x=1')).toBe(page);
    expect(accountAccessPath(page, organise + '/')).toBe(page);
  }
  expect(accountAccessPath('/signup', '/account/delegations/organise')).toBe(
    '/signup?returnTo=%2Faccount%2Fdelegations%2Forganise',
  );
  expect(accountAccessPath('/signin', organise, 'code')).toBe(
    '/signin?returnTo=%2Faccount%2Fdelegations%2Forganise&method=code',
  );
});

test('the code sign-in option is requested only for the sign-in page and keeps a permitted destination', () => {
  expect(accountAccessPath('/signin', '/account', 'code')).toBe('/signin?method=code');
  expect(accountAccessPath('/signin', '/plan', 'code')).toBe(
    '/signin?returnTo=%2Fplan&method=code',
  );
  expect(accountAccessPath('/signin', 'https://example.invalid/?token=private', 'code')).toBe(
    '/signin?method=code',
  );
  for (const page of ['/signup', '/verify-email', '/forgot-password', '/reset-password'] as const) {
    expect(accountAccessPath(page, '/plan', 'code')).toBe(`${page}?returnTo=%2Fplan`);
    expect(accountAccessPath(page, '/account', 'code')).toBe(page);
  }
});
