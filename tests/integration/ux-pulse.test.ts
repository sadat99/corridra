import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultNotificationPreferences,
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
  noRecipientSource,
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

describe('every message says titles and dates only', () => {
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
    expect(dated.subject).toBe('One thing needs you: Add your import licence number');
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
  it('there is no address source until the owner chooses one', async () => {
    expect(noRecipientSource.available).toBe(false);
    expect(await noRecipientSource.resolve('anyone')).toBeNull();
  });
  it('the owner registry lists the switch as a real flag', () => {
    expect(switchRegistry.find((s) => s.name === 'CORRIDRA_PULSE_ENABLED')?.kind).toBe('flag');
  });
  it('the preference page and its route answer 404 and 503 when the switch is off', () => {
    const page = read('apps/web/app/account/notifications/page.tsx');
    expect(page).toContain('if (!customerNotificationsEnabled()) notFound();');
    const route = read('apps/web/app/api/pulse/preferences/route.ts');
    expect(route).toContain(
      "if (!customerNotificationsEnabled()) throw new DomainError('Email choices are unavailable', 503);",
    );
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
