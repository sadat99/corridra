import { expect, test } from 'vitest';
import {
  authenticatorReturnTarget,
  classifyVerifyResult,
} from '../../apps/web/lib/authenticator-check';
import { workspaceSections } from '../../apps/web/lib/workspace-navigation';

const roles = ['owner', 'admin', 'operator', 'reviewer', 'viewer'] as const;

test('only a verify answer that carries a session token and user id is an accepted code', () => {
  expect(classifyVerifyResult({ data: { token: 't', user: { id: 'u' } }, error: null })).toBe(
    'accepted',
  );
  for (const result of [
    { error: null },
    {},
    { data: {}, error: null },
    { data: { token: 't' }, error: null },
    { data: { user: { id: 'u' } }, error: null },
    { data: '<html>', error: null },
  ])
    expect(classifyVerifyResult(result)).toBe('unknown');
});

test('a wrong or expired code is not accepted, and only that answer says so', () => {
  expect(classifyVerifyResult({ error: { status: 401, code: 'INVALID_CODE' } })).toBe(
    'invalid-code',
  );
});

test('an ended sign-in, a spent challenge, a limit or a refused origin means the code was not checked', () => {
  expect(classifyVerifyResult({ error: { status: 401, code: 'INVALID_TWO_FACTOR_COOKIE' } })).toBe(
    'signed-out',
  );
  expect(classifyVerifyResult({ error: { status: 401 } })).toBe('signed-out');
  expect(
    classifyVerifyResult({ error: { status: 400, code: 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE' } }),
  ).toBe('signed-out');
  expect(classifyVerifyResult({ error: { status: 429 } })).toBe('rate-limited');
  expect(classifyVerifyResult({ error: { status: 429, code: 'ACCOUNT_TEMPORARILY_LOCKED' } })).toBe(
    'rate-limited',
  );
  expect(classifyVerifyResult({ error: { status: 403 } })).toBe('origin-rejected');
  expect(classifyVerifyResult({ error: { status: 403, code: 'INVALID_ORIGIN' } })).toBe(
    'origin-rejected',
  );
});

test('server failures, unrecognised errors and missing answers stay unknown, never accepted', () => {
  for (const error of [
    { status: 500 },
    { status: 502 },
    { status: 400, code: 'TOTP_NOT_ENABLED' },
    { status: 500, statusText: 'Fetch Error' },
    {},
  ])
    expect(classifyVerifyResult({ error })).toBe('unknown');
  expect(classifyVerifyResult(undefined)).toBe('unknown');
  expect(classifyVerifyResult(null)).toBe('unknown');
});

test('the return link targets the previous section only when the role may open it', () => {
  for (const role of roles)
    for (const section of workspaceSections) {
      const target = authenticatorReturnTarget(section.id, role);
      const allowed =
        section.id !== 'workspace-authenticator' &&
        (section.roles as readonly string[]).includes(role);
      expect(target).toEqual(allowed ? { href: '#' + section.id, label: section.label } : null);
    }
  expect(authenticatorReturnTarget('workspace-ai', 'viewer')).toBeNull();
  expect(authenticatorReturnTarget('workspace-network', 'viewer')).toBeNull();
  expect(authenticatorReturnTarget('workspace-controls', 'admin')).toBeNull();
  expect(authenticatorReturnTarget('workspace-controls', 'owner')).toEqual({
    href: '#workspace-controls',
    label: 'Workspace controls',
  });
});

test('there is no return link from the overview, the directory, the panel itself or an unknown address', () => {
  for (const previous of [
    '',
    'main',
    'workspace-navigation',
    'workspace-authenticator',
    '__proto__',
    'constructor',
    'nonexistent',
  ])
    expect(authenticatorReturnTarget(previous, 'owner')).toBeNull();
  expect(authenticatorReturnTarget('workspace-missions', undefined)).toBeNull();
  expect(authenticatorReturnTarget('workspace-missions', '')).toBeNull();
});
