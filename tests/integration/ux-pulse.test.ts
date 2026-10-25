import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultNotificationPreferences,
  emailIsOn,
  knownTimeZone,
  notificationKinds,
  notificationPreferencesInput,
} from '../../packages/domain/src/notifications';
import {
  fillPulse,
  pulseCatalog,
  pulsePlaceholders,
  renderPulse,
  type PulseInput,
} from '../../packages/auth/src/pulse-templates';
import { signPulseMute, verifyPulseMute } from '../../packages/auth/src/pulse-mute';
import { signMissionMailMute } from '../../packages/auth/src/mission-mail-mute';
import {
  databaseRecipientSource,
  noRecipientSource,
  customerNotificationWithdrawalEnabled,
  pulseApplicationEnabled,
  pulseCapability,
} from '../../packages/auth/src/customer-notifications';
import { accountAccessPath, accountReturnTo } from '../../apps/web/lib/account-return';
import { excludedPages, tools } from '../../apps/web/lib/all-tools';
import { switchRegistry } from '../../apps/web/lib/owner-switches';

// Pulse (ADR-067), the parts that need no database (the database has its own suite): what a person may
// choose, what an email may say, how the sign-in return is kept, and every switch-off path.
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const secret = 'pulse-unit-test-secret-0123456789abcdef';
const links = {
  link: 'https://corridra.test/account/requests/6f1d3a52-8c1e-4b3a-9d7e-2f4a5b6c7d8e',
  muteLink: 'https://corridra.test/pulse/mute/6f1d3a52-8c1e-4b3a-9d7e-2f4a5b6c7d8e#t=abc',
  manageLink: 'https://corridra.test/account/notifications',
};
const move = (over: Partial<PulseInput> = {}): PulseInput => ({
  kind: 'your-move',
  title: 'Add your import licence number',
  date: '2026-11-23',
  ...links,
  ...over,
});

describe('what a person may choose', () => {
  const valid = {
    kinds: ['your-move', 'complete'],
    digest: true,
    quietStart: '22:00',
    quietEnd: '07:00',
    timeZone: 'Asia/Dhaka',
    language: 'bn',
  };
  it('accepts a complete choice and the defaults', () => {
    expect(notificationPreferencesInput.safeParse(valid).success).toBe(true);
    expect(notificationPreferencesInput.safeParse(defaultNotificationPreferences).success).toBe(
      true,
    );
    expect(notificationKinds).toEqual(['your-move', 'update', 'countdown', 'complete']);
  });
  it.each([
    ['an unknown kind', { kinds: ['marketing'] }],
    ['a repeated kind', { kinds: ['update', 'update'] }],
    ['a quiet start alone', { quietEnd: null }],
    ['equal quiet times', { quietEnd: '22:00' }],
    ['a time that does not exist', { quietStart: '25:00' }],
    ['a time without a leading zero', { quietStart: '7:00' }],
    ['an unknown time zone', { timeZone: 'Mars/Olympus' }],
    ['an unknown language', { language: 'xx' }],
    ['an extra key', { extra: true }],
  ])('refuses %s', (_, over) => {
    expect(notificationPreferencesInput.safeParse({ ...valid, ...over }).success).toBe(false);
  });
  it('knows real zones and nothing else', () => {
    expect(knownTimeZone('Europe/Madrid')).toBe(true);
    expect(knownTimeZone('UTC')).toBe(true);
    expect(knownTimeZone('')).toBe(false);
    expect(knownTimeZone('x'.repeat(65))).toBe(false);
  });
});

describe('what every message says', () => {
  it.each(['your-move', 'update', 'countdown', 'complete'] as const)(
    '%s renders with a plain-text twin',
    (kind) => {
      const mail = renderPulse(move({ kind, title: 'Visit week 3' }));
      expect(mail.subject.length).toBeGreaterThan(5);
      expect(mail.text).toContain(links.link);
      expect(mail.text).toContain(links.manageLink);
      expect(mail.text).toContain(links.muteLink);
      expect(mail.html).toContain('<!doctype html>');
      expect(mail.html).toContain(`href="${links.link}"`);
      // No tracking pixel, no script, no remote image, no form.
      expect(mail.html).not.toMatch(/<(img|script|iframe|form|link|style)\b/i);
      expect(mail.locale).toBe('en');
      expect(mail.dir).toBe('ltr');
    },
  );

  it('the Your Move email names the Move and the real date, or offers more time without one', () => {
    const dated = renderPulse(move());
    // The subject never carries the team's words: it shows on a lock screen and stays in the mail provider's log.
    expect(dated.subject).toBe('One thing needs you');
    expect(dated.text).toContain(
      'Your request needs one thing from you: Add your import licence number.',
    );
    expect(dated.text).toContain('Please do it by 23 November 2026.');
    const open = renderPulse(move({ date: null }));
    expect(open.text).toContain('If you need more time, reply and tell us.');
    expect(open.text).not.toContain('Please do it by');
  });

  it('the countdown names the date and the update and complete emails name the title', () => {
    expect(
      renderPulse(move({ kind: 'countdown', title: 'Factory visit', date: '2026-12-01' })).text,
    ).toContain('Factory visit is on 1 December 2026.');
    expect(
      renderPulse(move({ kind: 'countdown', title: 'Factory visit', date: null })).text,
    ).toContain('Factory visit is coming up.');
    expect(renderPulse(move({ kind: 'update', title: 'Suppliers found' })).text).toContain(
      'Your request moved forward: Suppliers found.',
    );
    expect(renderPulse(move({ kind: 'complete', title: 'Spain hotel textiles' })).text).toContain(
      'Spain hotel textiles is complete.',
    );
  });

  it('escapes markup, drops line breaks from the subject and refuses a title that is too short or too long', () => {
    const mail = renderPulse(move({ title: 'Add <b>x</b>\nBcc: someone@example.com' }));
    expect(mail.subject).not.toMatch(/[\r\n<>]/);
    expect(mail.subject).not.toContain('someone@example.com');
    expect(mail.html).not.toContain('<b>x</b>');
    expect(() => renderPulse(move({ title: 'ab' }))).toThrow('3 to 120');
    expect(() => renderPulse(move({ title: 'x'.repeat(121) }))).toThrow('3 to 120');
  });

  it('uses a name only when there is one', () => {
    expect(renderPulse(move({ name: 'Amina' })).text.startsWith('Hi Amina,')).toBe(true);
    expect(renderPulse(move({ name: '' })).text.startsWith('Hi,')).toBe(true);
  });

  it('refuses a date that does not exist and any link that is not plain https', () => {
    expect(() => renderPulse(move({ date: '2026-02-30' }))).toThrow('does not exist');
    expect(() => renderPulse(move({ date: 'soon' }))).toThrow('YYYY-MM-DD');
    expect(() => renderPulse(move({ link: 'http://corridra.test/x' }))).toThrow('https');
    expect(() => renderPulse(move({ link: 'https://user:pass@corridra.test/x' }))).toThrow(
      'plain https',
    );
    expect(() => renderPulse(move({ manageLink: 'not a link' }))).toThrow('https');
  });

  it('is English until another language is reviewed, so another locale falls back honestly', () => {
    expect(Object.keys(pulseCatalog)).toEqual(['en']);
    const mail = renderPulse(move({ locale: 'ar' }));
    expect(mail.locale).toBe('en');
    expect(mail.dir).toBe('ltr');
  });

  it('fills only known placeholders and fails on a missing or unknown one', () => {
    expect(fillPulse('{title} on {date}', { title: 'A', date: 'B' })).toBe('A on B');
    expect(() => fillPulse('{title}', {})).toThrow('missing mail placeholder');
    expect(() => fillPulse('{surprise}', { surprise: 'x' })).toThrow('missing mail placeholder');
    const catalog = JSON.stringify(pulseCatalog);
    for (const [, name] of catalog.matchAll(/\{([a-z_]+)\}/g))
      expect(pulsePlaceholders as readonly string[]).toContain(name);
    expect(catalog).not.toMatch(/[—–]/);
  });

  it('the daily digest lists each item once, has no mute link and holds one to twenty items', () => {
    const items = [
      { kind: 'your-move' as const, title: 'Add your trade licence', date: '2026-11-23' },
      { kind: 'your-move' as const, title: 'Add your bank letter', date: null },
    ];
    const mail = renderPulse({
      kind: 'digest',
      items,
      link: 'https://corridra.test/account/move',
      manageLink: links.manageLink,
    });
    expect(mail.subject).toBe('What is waiting for you');
    expect(mail.preheader).toBe('2 things in your requests.');
    expect(mail.text).toContain('Add your trade licence (by 23 November 2026)');
    expect(mail.text).toContain('Add your bank letter');
    expect(mail.text).not.toContain('Mute this request');
    expect(mail.html).not.toMatch(/<(img|script)\b/i);
    expect(() =>
      renderPulse({ kind: 'digest', items: [], link: links.link, manageLink: links.manageLink }),
    ).toThrow('1 to 20');
    expect(() =>
      renderPulse({
        kind: 'digest',
        items: Array.from({ length: 21 }, () => items[0]),
        link: links.link,
        manageLink: links.manageLink,
      }),
    ).toThrow('1 to 20');
  });
});

describe('the mute token and the send capability', () => {
  const id = '6f1d3a52-8c1e-4b3a-9d7e-2f4a5b6c7d8e';
  it('is bound to one request and to this one purpose', () => {
    const token = signPulseMute(secret, id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifyPulseMute(secret, id, token)).toBe(true);
    // A token for one request does not open another request.
    const another = id.replace(/^6/, '7');
    expect(another).not.toBe(id);
    expect(verifyPulseMute(secret, another, token)).toBe(false);
    expect(verifyPulseMute(secret, id, 'A'.repeat(43))).toBe(false);
    expect(verifyPulseMute(secret, id, 'short')).toBe(false);
    // A mission mail token cannot mute Pulse, and the other way round.
    expect(token).not.toBe(signMissionMailMute(secret, id));
    expect(() => signPulseMute('short', id)).toThrow('32 characters');
    expect(() => signPulseMute(secret, '../x')).toThrow('not usable');
  });
  it('the send capability is per message and cannot be derived from the request', () => {
    expect(pulseCapability(secret, 'a')).not.toBe(pulseCapability(secret, 'b'));
    expect(pulseCapability(secret, 'a')).not.toBe(
      pulseCapability('another-secret-0123456789abcdef0123', 'a'),
    );
    expect(pulseCapability(secret, 'a').length).toBeGreaterThanOrEqual(20);
  });
});

describe('the sign-in return', () => {
  const request = '6f1d3a52-8c1e-4b3a-9d7e-2f4a5b6c7d8e';
  it.each([
    '/plan',
    '/account/move',
    '/account/notifications',
    `/account/requests/${request}`,
    `/account/rooms/${request}`,
  ])('keeps the exact email page %s when Pulse is on', (path) => {
    expect(accountReturnTo(path, true)).toBe(path);
    expect(accountAccessPath('/signin', path, undefined, true)).toBe(
      `/signin?returnTo=${encodeURIComponent(path)}`,
    );
  });
  it.each([
    null,
    undefined,
    '',
    '/account',
    'https://example.invalid/account/move',
    '//example.invalid/account/move',
    'javascript:alert(1)',
    '/account/move?token=private',
    '/account/move#private',
    '/account/move/',
    '/account/move/../operator',
    '/account/../operator',
    '/account//move',
    '/account/requests',
    '/account/requests/not-a-uuid',
    `/account/requests/${request}/extra`,
    `/account/requests/${request.toUpperCase()}`,
    `/account/requests/${request}%2F..`,
    '/account\\move',
    `/account/move\n`,
    `/operator`,
    `/account/billing`,
    `/account/rooms/${request}?view=work`,
    `/account/${'a'.repeat(120)}`,
  ])('refuses %j even with Pulse on, and falls back to the account', (value) => {
    expect(accountReturnTo(value as string, true)).toBe('/account');
    expect(accountAccessPath('/signin', value as string, undefined, true)).toBe('/signin');
  });
  it('with Pulse off keeps only the request form, exactly as before', () => {
    expect(accountReturnTo('/plan')).toBe('/plan');
    for (const path of [
      '/account/move',
      '/account/notifications',
      `/account/requests/${request}`,
      `/account/rooms/${request}`,
    ])
      expect(accountReturnTo(path)).toBe('/account');
    expect(accountAccessPath('/signin', '/account/move')).toBe('/signin');
    expect(accountAccessPath('/signin', '/plan', 'code')).toBe(
      '/signin?returnTo=%2Fplan&method=code',
    );
  });
});

describe('every switch-off path', () => {
  it('the application switch needs real use as well, and the default is off', () => {
    expect(pulseApplicationEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(pulseApplicationEnabled({ CORRIDRA_PULSE_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(
      false,
    );
    expect(
      pulseApplicationEnabled({
        CORRIDRA_PULSE_ENABLED: 'false',
        CORRIDRA_REAL_USE_ENABLED: 'true',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
  it('a service built with no address source claims and sends nothing', async () => {
    expect(noRecipientSource.available).toBe(false);
    expect(await noRecipientSource.resolve('anyone', { queueId: 'q', capability: 'c' })).toBeNull();
  });
  it('the owner registry lists the switch as a real flag', () => {
    expect(switchRegistry.find((s) => s.name === 'CORRIDRA_PULSE_ENABLED')?.kind).toBe('flag');
  });
  it('with the switch off the page answers 404 and the route 503, except for a person who already said yes switching email off', () => {
    const page = read('apps/web/app/account/notifications/page.tsx');
    expect(page).toContain('const dark = !customerNotificationsEnabled();');
    expect(page).toContain('if (dark && !customerNotificationWithdrawalEnabled()) notFound();');
    // Signed out, unavailable, never chose or already off: the page does not exist.
    expect(page).toContain('if (dark) notFound();');
    expect(page).toContain(
      'if (unavailable || initial.version === 0 || !emailIsOn(initial)) notFound();',
    );
    // What a dark page shows is the paused form: nothing can be switched on.
    expect(page).toContain('initial = { ...initial, open: false };');
    const route = read('apps/web/app/api/pulse/preferences/route.ts');
    expect(route).toContain(
      'if (!customerNotificationsEnabled() && !(switchingOff && customerNotificationWithdrawalEnabled()))',
    );
    expect(route).toContain("throw new DomainError('Email choices are unavailable', 503);");
    // Only a body that saves an empty list counts as switching off.
    expect(route).toContain(
      'notificationPreferencesInput.safeParse(value).data?.kinds.length === 0',
    );
  });
  it('the notification service is built from the customer area, so the page and route decide what the Pulse switch allows', () => {
    expect(read('apps/web/lib/foundations.ts')).toContain(
      'enabled: customerNotificationWithdrawalEnabled(),',
    );
    expect(customerNotificationWithdrawalEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
  it('the email-link mute works whatever the sending switch says, so an old link keeps working', () => {
    const route = read('apps/web/app/api/pulse/mute/route.ts');
    expect(route).not.toContain('PULSE_ENABLED');
    expect(route).toContain('s.pulse.mute');
  });
  it('All tools lists the preference page and excludes the mute page with a reason', () => {
    expect(
      tools.some((t) => t.route === '/account/notifications' && t.module === 'notifications'),
    ).toBe(true);
    expect(
      excludedPages.some((e) => e.route === '/pulse/mute/[requestId]' && e.why.length > 20),
    ).toBe(true);
  });
  it('the staff route queues email only for a new set, never fails the Move and starts nothing without a source', () => {
    const route = read('apps/web/app/api/move/staff/route.ts');
    expect(route).toContain("input?.action === 'set' && !outcome.replayed && s.pulse.canSend");
    expect(route).toMatch(/catch \{\s*\/\/ Mail problems are not Move problems\./);
    const service = read('packages/auth/src/customer-notifications.ts');
    expect(service).toContain('return pulseApplicationEnabled() && this.recipients.available;');
  });
  it('the install job leaves notifications unchanged unless asked, and asks for a reason to enable or pause', () => {
    const script = read('scripts/install-customer-modules.ts');
    expect(script).toContain(
      "NOTIFICATIONS_ACTION: z.enum(['unchanged', 'install', 'enable', 'pause']).default('unchanged')",
    );
    expect(script).toContain('customer_notification_migrations');
    expect(script).toContain('Notification changes require INSTALL_APPLY=yes');
    expect(script).toContain('Notification changes require an explicit reason');
    const workflow = read('.github/workflows/install-customer-modules.yml');
    expect(workflow).toMatch(/notifications_action:[\s\S]*?default: unchanged/);
    expect(workflow).toContain('NOTIFICATIONS_ACTION: ${{ inputs.notifications_action }}');
    expect(workflow).toContain("inputs.notifications_action != 'unchanged'");
  });
});

describe('what the database module keeps', () => {
  const source = read('packages/db/customer-notification-migrations/0001_notifications.sql');
  const sql = source.replace(/--.*$/gm, '');
  it('holds no address, name or free text, only ids, a plain title and a date', () => {
    const tables = [...sql.matchAll(/CREATE TABLE customer_private\.(\w+) \(([\s\S]*?)\n\);/g)];
    expect(tables.map((t) => t[1])).toEqual([
      'notification_control',
      'notification_preference',
      'notification_mute',
      'notification_outbox',
    ]);
    for (const [, , body] of tables)
      expect(body).not.toMatch(/\b(address|email|recipient|name)\b/i);
  });
  it('is additive: it creates and grants, and never alters or drops anything that exists', () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|FUNCTION|POLICY|TRIGGER)\b/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+(?!customer_private\.notification_)/i);
    expect(sql).not.toMatch(/CREATE\s+OR\s+REPLACE/i);
    expect(sql).not.toMatch(/mission_mail/);
  });
  it('closes every internal function to the runtime and auth roles', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION customer_private\.notification_open\(\)/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION customer\.notification_preferences\(\)[\s\S]*FROM PUBLIC,corridra_auth/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION customer\.notification_preferences\(\)[\s\S]*TO corridra_runtime/,
    );
  });
  it('uses no colour outside the tokens and no dash character in the words people read', () => {
    expect(read('apps/web/app/account/notifications/notifications-form.css')).not.toMatch(
      /#[0-9a-fA-F]{3,8}\b/,
    );
    const form = read('apps/web/app/account/notifications/notifications-form.tsx');
    expect(form).not.toMatch(/[—–]/);
    expect(form).not.toContain('<svg');
  });
});

describe('found in review: the workflow, the caps and the claim', () => {
  const sql = readFileSync(
    resolve('packages/db/customer-notification-migrations/0001_notifications.sql'),
    'utf8',
  );
  it('a wait for quiet hours or a digest does not use up the attempts, and can last two days', () => {
    const workflow = readFileSync(resolve('apps/web/workflows/pulse.ts'), 'utf8');
    expect(workflow).toContain('while (tries < 60 && waits < 120)');
    expect(workflow).toContain("if (status === 'WAIT') {");
    // 120 waits of thirty minutes is sixty hours; the latest a message can first be due is under forty-eight.
    expect(120 * 30).toBeGreaterThan(48 * 60);
  });
  it('the cap per person is serialized by person, before the cap per request, in a fixed order', () => {
    const person = sql.indexOf("'customer.notification.person:'");
    const request = sql.indexOf("'customer.notification:'");
    expect(person).toBeGreaterThan(-1);
    expect(person).toBeLessThan(request);
  });
  it('a claim serializes by person after the capability check and before any row is locked', () => {
    const claim = sql.slice(sql.indexOf('CREATE FUNCTION customer.claim_notification'));
    const check = claim.indexOf('q.capability_hash<>encode');
    const lock = claim.indexOf(
      "pg_advisory_xact_lock(hashtextextended('customer.notification_claim:'",
    );
    const rows = claim.indexOf('WHERE id=queue FOR UPDATE');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(lock);
    expect(lock).toBeLessThan(rows);
  });
  it('queueing needs a fresh authenticator check, a recent command and a request still retained, and a missing outcome is refused', () => {
    const enqueue = sql.slice(sql.indexOf('CREATE FUNCTION customer.enqueue_move_notifications'));
    expect(enqueue.slice(0, 1800)).toContain('NOT customer_private.mfa_recent()');
    expect(enqueue).toContain("cmd.created_at<clock_timestamp()-interval '10 minutes'");
    expect(enqueue).toContain("skipped:='expired'");
    const seal = sql.slice(sql.indexOf('CREATE FUNCTION customer.seal_notification'));
    expect(seal.slice(0, 600)).toContain('NOT customer_private.mfa_recent()');
    // The check behind queueing and sealing is ten minutes, the window of the command it follows; the
    // Move itself still needs the five minute check, enforced when its command row is written.
    const recent = sql.slice(sql.indexOf('CREATE FUNCTION customer_private.mfa_recent'));
    expect(recent.slice(0, 500)).toContain("a.verified_at>now()-interval '10 minutes'");
    const finishFn = sql.slice(sql.indexOf('CREATE FUNCTION customer.finish_notification'));
    expect(finishFn).toContain("least(expires_at-interval '1 second',");
    expect(sql).toContain('OR outcome IS NULL OR outcome NOT IN');
  });
});

describe('email is off until a person switches it on (owner decision of 25 October 2026)', () => {
  const second = read(
    'packages/db/customer-notification-migrations/0002_email_off_until_chosen.sql',
  );
  const sql = second.replace(/--.*$/gm, '');
  it('a person who has chosen nothing has email off, and saving a kind is the opt-in', () => {
    expect(defaultNotificationPreferences.kinds).toEqual([]);
    expect(emailIsOn(defaultNotificationPreferences)).toBe(false);
    expect(emailIsOn({ kinds: ['your-move'] })).toBe(true);
    expect(
      notificationPreferencesInput.safeParse({ ...defaultNotificationPreferences }).success,
    ).toBe(true);
  });
  it('the second migration changes no table, drops nothing and gives no application role the address', () => {
    expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP)\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).toMatch(/p\.kinds:=ARRAY\[\]::text\[\]/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION customer\.notification_recipient\(uuid,text\) FROM PUBLIC,corridra_auth/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION customer\.notification_recipient\(uuid,text\) TO corridra_runtime/,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION customer\.notification_recipient_ready\(\) FROM PUBLIC,corridra_runtime,corridra_auth/,
    );
    expect(sql).not.toMatch(/GRANT[^;]*notification_recipient_ready/);
  });
  it('the lookup needs the capability, a message leased right now, an open control and email switched on, and reads only verified addresses', () => {
    const fn = sql.slice(sql.indexOf('CREATE FUNCTION customer.notification_recipient('));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).toContain(
      "q.capability_hash<>encode(sha256(convert_to(capability,'UTF8')),'hex')",
    );
    expect(body).toContain("q.status<>'LEASED'");
    expect(body).toContain('q.lease_until<=clock_timestamp()');
    expect(body).toContain('NOT customer_private.notification_open()');
    expect(body).toContain(
      'cardinality((customer_private.notification_preference_of(q.principal_id)).kinds)=0',
    );
    expect(body).toContain('u."emailVerified" IS TRUE');
    expect(body).toContain('p.disabled_at IS NULL');
    expect(body).toContain('SECURITY DEFINER SET search_path=pg_catalog');
    expect(body).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  });
  it('the third migration replaces two functions without touching a table, a drop or an access list', () => {
    const third = read(
      'packages/db/customer-notification-migrations/0003_withdrawal_and_issuer_check.sql',
    ).replace(/--.*$/gm, '');
    expect(third).not.toMatch(/\b(CREATE|ALTER|DROP)\s+TABLE\b/i);
    expect(third).not.toMatch(/\bDROP\b/i);
    expect(third).not.toMatch(/\b(GRANT|REVOKE)\b/i);
    expect([...third.matchAll(/CREATE OR REPLACE FUNCTION ([\w.]+)\(/g)].map((m) => m[1])).toEqual([
      'customer.notification_recipient',
      'customer.set_notification_preferences',
    ]);
    expect(third).not.toMatch(/CREATE FUNCTION/);
    // The lookup now also requires the account to belong to the pinned issuer.
    expect(third).toContain(
      'EXISTS(SELECT FROM customer_private.configuration c WHERE c.issuer=p.issuer)',
    );
    // Withdrawal (an empty list) works while the control is closed; switching on does not.
    expect(third).toContain(
      'IF NOT customer_private.notification_open() AND (chosen IS NULL OR cardinality(chosen)>0) THEN',
    );
  });
  it('the application reads the address through that lookup and keeps it for the one send only', () => {
    const service = read('packages/auth/src/customer-notifications.ts');
    expect(service).toContain("'SELECT customer.notification_recipient($1,$2) AS r'");
    expect(service).toContain(
      'to = await this.recipients.resolve(claim.principalId, { queueId: job.queueId, capability });',
    );
    expect(databaseRecipientSource({} as never).available).toBe(true);
    expect(noRecipientSource.available).toBe(false);
    expect(read('apps/web/lib/foundations.ts')).toContain(
      'new PulseService(runtimePool, config.AUTH_SECRET, databaseRecipientSource(runtimePool))',
    );
  });
  it('the install job will not open email while the sign-in table cannot be read, and closing never depends on it', () => {
    const script = read('scripts/install-customer-modules.ts');
    const helper = read('packages/auth/src/customer-notification-configuration.ts');
    expect(helper).toContain('SELECT customer.notification_recipient_ready() AS ready');
    expect(helper).toMatch(/catch \{\s*return false;\s*\}/);
    expect(script).toContain('const addressReady = await emailAddressSourceReady(pool);');
    expect(script).toContain("v.NOTIFICATIONS_ACTION === 'enable' && !addressReady");
    expect(script).toContain('Email was not opened');
    expect(script).toContain('The email control was not changed');
    expect(script).not.toContain('The control stays closed');
    expect(sql).toContain('has_schema_privilege(schema_oid,');
    expect(sql).toContain('has_table_privilege(table_oid,');
  });
  it('the Email choices page leads with a clear on and off switch and says email is off until it is on', () => {
    const form = read('apps/web/app/account/notifications/notifications-form.tsx');
    expect(form).toContain('Email me when something needs me');
    expect(form).toContain('We do not email you unless you switch this on.');
    expect(form).toContain('Pick at least one message, or leave email off.');
    expect(form).toContain("'Switch email on'");
    expect(form).toContain("'Switch email off'");
    expect(form).not.toMatch(/[—–]/);
  });
  it('a person who never looked is told once, where they already are, and can say not now', () => {
    const nudge = read('apps/web/components/email-nudge.tsx');
    expect(nudge).toContain('lang="en" dir="ltr"');
    expect(nudge).toContain('preferences.open === true');
    expect(nudge).toContain('preferences.synthetic !== true');
    expect(nudge).toContain('preferences.version === 0');
    expect(nudge).toContain('14 * 24 * 60 * 60 * 1000');
    expect(nudge).toContain('href="/account/notifications"');
    expect(nudge).not.toMatch(/[—–]/);
    expect(nudge).not.toContain('<svg');
    expect(read('apps/web/components/email-nudge.css')).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    for (const page of [
      'apps/web/app/account/move/page.tsx',
      'apps/web/app/account/requests/[requestId]/page.tsx',
    ])
      expect(read(page)).toContain('{customerNotificationsEnabled() && <EmailNudge />}');
  });
  it('every email says why the person gets it', () => {
    expect(renderPulse(move()).text).toContain(
      'You are getting this because you switched on email about your requests in Corridra.',
    );
  });

  it('no catalog puts the title in a subject, and a catalog that tried would throw', () => {
    for (const [locale, catalog] of Object.entries(pulseCatalog)) {
      for (const [name, copy] of Object.entries(catalog))
        if (typeof copy === 'object' && copy && 'subject' in copy)
          expect((copy as { subject: string }).subject, `${locale}.${name}`).not.toContain('{');
    }
    const en = pulseCatalog.en;
    const original = en.yourMove.subject;
    en.yourMove.subject = 'One thing needs you: {title}';
    try {
      expect(() => renderPulse(move())).toThrow();
    } finally {
      en.yourMove.subject = original;
    }
  });

  it('no subject ever carries the team words, whatever the kind', () => {
    const words = 'Zephyr Quartz words';
    for (const kind of ['your-move', 'update', 'countdown', 'complete'] as const)
      expect(renderPulse(move({ kind, title: words })).subject).not.toContain('Zephyr');
    const digest = renderPulse({
      kind: 'digest',
      name: 'Amina',
      link: 'https://corridra.test/account/move',
      manageLink: links.manageLink,
      items: [{ kind: 'your-move', title: words, date: null }],
    });
    expect(digest.subject).not.toContain('Zephyr');
  });

  it('the owner pack shows the subjects the templates really produce and says what the email holds', () => {
    const pack = read('docs/product/pulse-email-review-pack.md');
    const subjects = [...pack.matchAll(/^Subject: (.+)$/gm)].map((m) => m[1]);
    const produced = [
      renderPulse(move()).subject,
      renderPulse(move({ kind: 'update', date: null })).subject,
      renderPulse(move({ kind: 'countdown' })).subject,
      renderPulse(move({ kind: 'complete', date: null })).subject,
      pulseCatalog.en.digest.subject,
    ];
    expect(subjects).toEqual(produced);
    expect(pack).toContain('The greeting uses the name on their account.');
    expect(pack).toContain('Resend keeps its own');
    expect(pack).toContain('pulse-privacy-review-2026-10-25.md');
    expect(pack).not.toMatch(/never appears|titles and dates only|free text from the team never/i);
  });

  it('the review record lists every condition before opening and is not presented as legal advice', () => {
    const record = read('docs/product/pulse-privacy-review-2026-10-25.md');
    expect(record).toContain('not legal advice');
    expect(record).toContain('CUSTOMER_AUTH_MAIL_REPLY_TO');
    expect(record).toMatch(/Resend account for retention and data location/);
    for (const id of ['B1', 'B2', 'B3', 'NB1', 'NB11', 'R1', 'R4'])
      expect(record).toContain(`| ${id} `);
  });
});
