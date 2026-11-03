import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { requestEmailPath } from '../../packages/auth/src/mission-mail';
import { accountAccessPath, accountReturnTo, signInPath } from '../../apps/web/lib/account-return';
import { describeSwitches, switchRegistry } from '../../apps/web/lib/owner-switches';
import { emailReturnPagesOn } from '../../apps/web/lib/ux-switches';

// The emailed status link (ADR-076 item 5). It changes one path in one email and widens one reviewed
// navigation list. It grants no authority: every page still checks who is signed in.
const request = '0b5d6c52-3b1e-4c53-8f4f-1d2f6a9b7c10';
const env = (values: Record<string, string>) => values as NodeJS.ProcessEnv;
const source = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('the path the first email opens', () => {
  it('is the Room only when the status link and the Room are both exactly on', () => {
    expect(
      requestEmailPath(request, env({ CORRIDRA_STATUS_LINK: 'true', CORRIDRA_UX_ROAD: 'true' })),
    ).toBe(`/account/rooms/${request}`);
  });

  it.each([
    ['nothing set', {}],
    ['only the status link', { CORRIDRA_STATUS_LINK: 'true' }],
    ['only the Room', { CORRIDRA_UX_ROAD: 'true' }],
    ['upper case', { CORRIDRA_STATUS_LINK: 'TRUE', CORRIDRA_UX_ROAD: 'true' }],
    ['the Room in upper case', { CORRIDRA_STATUS_LINK: 'true', CORRIDRA_UX_ROAD: 'TRUE' }],
    ['one instead of true', { CORRIDRA_STATUS_LINK: '1', CORRIDRA_UX_ROAD: '1' }],
    ['false', { CORRIDRA_STATUS_LINK: 'false', CORRIDRA_UX_ROAD: 'true' }],
  ])('stays the saved request page, exactly as before, with %s', (_name, values) => {
    expect(requestEmailPath(request, env(values))).toBe(`/account/requests/${request}`);
  });

  it('reads the process settings when none are given', () => {
    const saved = { link: process.env.CORRIDRA_STATUS_LINK, road: process.env.CORRIDRA_UX_ROAD };
    try {
      delete process.env.CORRIDRA_STATUS_LINK;
      delete process.env.CORRIDRA_UX_ROAD;
      expect(requestEmailPath(request)).toBe(`/account/requests/${request}`);
    } finally {
      if (saved.link !== undefined) process.env.CORRIDRA_STATUS_LINK = saved.link;
      if (saved.road !== undefined) process.env.CORRIDRA_UX_ROAD = saved.road;
    }
  });

  it('is the only thing the email build changed: the sender still uses it for the button', () => {
    const mail = source('packages/auth/src/mission-mail.ts');
    expect(mail).toContain('link: `${origin}${requestEmailPath(job.requestId, env)}`');
    expect(mail).not.toContain('/account/requests/${job.requestId}');
    expect(mail).toContain('idempotencyKey: `mission-mail:${job.queueId}`');
  });
});

describe('the sign-in return pages the email may use', () => {
  it.each([
    ['nothing set', {}, false],
    ['Pulse only', { CORRIDRA_PULSE_ENABLED: 'true' }, true],
    ['the status link only', { CORRIDRA_STATUS_LINK: 'true' }, true],
    ['both', { CORRIDRA_PULSE_ENABLED: 'true', CORRIDRA_STATUS_LINK: 'true' }, true],
    ['upper case', { CORRIDRA_PULSE_ENABLED: 'TRUE', CORRIDRA_STATUS_LINK: 'TRUE' }, false],
    ['one instead of true', { CORRIDRA_PULSE_ENABLED: '1', CORRIDRA_STATUS_LINK: '1' }, false],
    ['the Room only', { CORRIDRA_UX_ROAD: 'true' }, false],
  ])('is decided as expected with %s', (_name, values, expected) => {
    expect(emailReturnPagesOn(env(values))).toBe(expected);
  });

  it('is used at every sign-in call site instead of reading Pulse alone', () => {
    for (const path of [
      'apps/web/app/signin/page.tsx',
      'apps/web/components/account-access.tsx',
      'apps/web/app/signup/signup-access.tsx',
    ]) {
      const text = source(path);
      expect(text, path).toContain('emailReturnPagesOn(');
      expect(text, path).not.toContain("process.env.CORRIDRA_PULSE_ENABLED === 'true'");
    }
  });
});

describe('the signed-out visitor of the Room', () => {
  it('is sent to sign-in with the Room path, and to plain sign-in with none', () => {
    expect(signInPath(`/account/rooms/${request}`)).toBe(
      `/signin?next=%2Faccount%2Frooms%2F${request}`,
    );
    expect(signInPath()).toBe('/signin');
    expect(signInPath('')).toBe('/signin');
  });

  it('is wired: the Room passes its own path, the verify-email step is unchanged', () => {
    // The path is passed only while the status link is on, so with it off the redirect is plain /signin.
    expect(source('apps/web/app/account/rooms/[requestId]/page.tsx')).toContain(
      "customerPageSession(\n    uxSwitchOn('CORRIDRA_STATUS_LINK') ? `/account/rooms/${parsed.data}` : undefined,\n  )",
    );
    const session = source('apps/web/lib/customer-page-session.ts');
    expect(session).toContain('redirect(signInPath(next))');
    expect(session).toContain("redirect('/verify-email')");
    expect(session).toContain("if (!issuer || !auth) redirect('/signin')");
    // The other callers still ask with no path, so their behaviour is not changed by this build.
    for (const path of [
      'apps/web/app/account/move/page.tsx',
      'apps/web/app/account/notifications/page.tsx',
      'apps/web/app/account/all-tools/page.tsx',
    ])
      expect(source(path), path).toContain('customerPageSession()');
  });

  it('returns to the Room after sign-in through the reviewed exact path list', () => {
    const next = `/account/rooms/${request}`;
    const kept = accountReturnTo(next, true);
    expect(kept).toBe(next);
    expect(accountAccessPath('/signin', kept, undefined, true)).toBe(
      `/signin?returnTo=%2Faccount%2Frooms%2F${request}`,
    );
  });

  it.each([
    'https://evil.example/account',
    '//evil.example',
    `/account/rooms/${request}?x=1`,
    `/account/rooms/${request}#t`,
    `/account/rooms/${request}/extra`,
    `/account/rooms/${request.toUpperCase()}`,
    `/account\\rooms\\${request}`,
    `\\account\\move`,
    `/\\evil.example`,
    `/account%2Frooms%2F${request}`,
    `/account%2frooms%2f${request}`,
    `/account%252Frooms%252F${request}`,
    `/account/rooms/${request}\t`,
    `/account/rooms/${request}\n`,
    `/account/rooms/${request}/`,
    'javascript:alert(1)',
    `/account\u2215rooms\u2215${request}`,
    `/account\u2215move`,
    '/account/rooms/../move',
    '/plan/',
    '/plan?x=1',
    '/account/rooms/00000000-0000-0000-0000-000000000000',
    '/ACCOUNT/move',
  ])('is never sent to %j, and lands on the account', (next) => {
    const kept = accountReturnTo(next, true);
    expect(kept).toBe('/account');
    expect(accountAccessPath('/signin', kept, undefined, true)).toBe('/signin');
  });

  it('keeps only the request form when the email pages are off, as before', () => {
    const next = `/account/rooms/${request}`;
    expect(accountReturnTo(next, false)).toBe('/account');
    expect(accountAccessPath('/signin', next)).toBe('/signin');
  });

  it('also allows the move and notification pages to be returned to, which still check sign-in and their own switch', () => {
    expect(accountReturnTo('/account/move', true)).toBe('/account/move');
    expect(accountReturnTo('/account/notifications', true)).toBe('/account/notifications');
    const move = source('apps/web/app/account/move/page.tsx');
    expect(move).toContain("if (!uxSwitchOn('CORRIDRA_UX_MOVE')) notFound();");
    expect(move.indexOf('notFound();')).toBeLessThan(move.indexOf('customerPageSession()'));
    const notifications = source('apps/web/app/account/notifications/page.tsx');
    expect(notifications).toContain(
      'if (dark && !customerNotificationWithdrawalEnabled()) notFound();',
    );
    expect(notifications.indexOf('notFound();')).toBeLessThan(
      notifications.indexOf('customerPageSession()'),
    );
  });
});

describe('the owner switch list', () => {
  const entry = (name: string) => switchRegistry.find((item) => item.name === name)!;

  const stateOf = (values: Record<string, string>) =>
    describeSwitches(env(values))
      .flatMap((group) => group.rows)
      .find((row) => row.name === 'CORRIDRA_STATUS_LINK')?.state.text;

  it('describes the status link as a real switch, off by default, in plain words', () => {
    expect(entry('CORRIDRA_STATUS_LINK').kind).toBe('flag');
    expect(entry('CORRIDRA_STATUS_LINK').label).toBe('Emailed status link');
    expect(entry('CORRIDRA_STATUS_LINK').line).not.toMatch(/[\u2013\u2014]/);
    expect(stateOf({})).toBe('Off');
    expect(stateOf({ CORRIDRA_STATUS_LINK: 'true' })).toBe('On');
    expect(stateOf({ CORRIDRA_STATUS_LINK: 'TRUE' })).toBe('Off');
    expect(stateOf({ CORRIDRA_STATUS_LINK: '1' })).toBe('Off');
  });

  it('leaves the decision card planned; the books switch is a real one', () => {
    expect(entry('CORRIDRA_UX_BOOKS').kind).toBe('flag');
    expect(entry('CORRIDRA_SHARE_CARD').kind).toBe('planned');
  });
});
