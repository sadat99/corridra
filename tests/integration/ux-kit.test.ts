import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { fieldAnchor, summaryFocusDue } from '../../apps/web/lib/ux/focus';
import {
  currentTeamItem,
  currentTeamSection,
  signedInShellFor,
  teamNavigation,
  teamSectionHref,
  teamSectionTitle,
  teamSettingsSections,
  teamSidebarShown,
} from '../../apps/web/lib/ux/shells';
import { publishTeamContext, readTeamContext } from '../../apps/web/lib/ux/team-context';
import { sectionForSlug } from '../../apps/web/lib/operator-urls';
import { workspaceSections } from '../../apps/web/lib/workspace-navigation';
import {
  canonicalPageRedirect,
  canonicalPageUrl,
  canonicalRedirectStatus,
  canonicalSiteOrigin,
} from '../../apps/web/lib/canonical-origin';
import {
  buildNotificationEmail,
  emailDecision,
  inboxSafePayload,
} from '../../apps/web/lib/ux/notify-mail';
import { languageBootScript } from '../../apps/web/lib/ux/language-boot';
import { localeCodes } from '../../apps/web/lib/i18n/locales';
import { wsE, wsEEn } from '../../apps/web/lib/i18n/ws/ws-e';
import { translate } from '../../apps/web/lib/i18n/messages';
import { notificationTypes } from '../../packages/communications/src/inbox';

// WS-E kit, shells and platform rules (commercial readiness program, 6.E). No browser, no database.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) =>
    createElement('a', { href }, children as never),
}));

describe('error summary focus (CQ-01)', () => {
  test('takes focus once per submit and never while the person types', () => {
    let last = 0;
    const events: string[] = [];
    // Submit 1 with two errors, then five keystrokes that change the error list.
    const run = (attempt: number, errors: number, label: string) => {
      if (summaryFocusDue(attempt, last, errors)) {
        last = attempt;
        events.push(label);
      }
    };
    run(0, 0, 'load');
    run(1, 2, 'submit 1');
    for (const count of [2, 1, 1, 1, 0]) run(1, count, 'typing');
    run(2, 1, 'submit 2');
    run(2, 1, 'typing');
    run(3, 0, 'submit 3 clean');
    expect(events).toEqual(['submit 1', 'submit 2']);
  });
  test('errors that arrive after the submit (from the server) still focus once', () => {
    expect(summaryFocusDue(4, 3, 0)).toBe(false);
    expect(summaryFocusDue(4, 3, 2)).toBe(true);
    expect(summaryFocusDue(4, 4, 2)).toBe(false);
  });
  test('field anchors are plain ids', () => {
    expect(fieldAnchor('contact.email')).toBe('contact.email');
    expect(fieldAnchor('a b"<x>')).toBe('a-b--x-');
  });
  test('the summary links each error to its field and has a unique title id', async () => {
    const { ErrorSummary } = await import('../../apps/web/components/ux/feedback');
    const html = renderToStaticMarkup(
      createElement(ErrorSummary, {
        attempt: 1,
        errors: [
          { field: 'email', message: 'Enter your email' },
          { field: 'name', message: 'Enter your name' },
        ],
      }),
    );
    expect(html).toContain('href="#email"');
    expect(html).toContain('href="#name"');
    expect(html).toMatch(/role="alert"/);
    expect(html).toMatch(/aria-labelledby="[^"]+-summary-title"/);
    expect(html).not.toContain('id="ux-kit-summary-title"');
    expect(renderToStaticMarkup(createElement(ErrorSummary, { attempt: 1, errors: [] }))).toBe('');
  });
});

describe('field help (UX-09, UX-11)', () => {
  test('one visible line and a named "?" button that controls the details', async () => {
    const { FieldHelp } = await import('../../apps/web/components/ux/field-help');
    const html = renderToStaticMarkup(
      createElement(FieldHelp, {
        id: 'budget-help',
        summary: 'Your budget in normal units.',
        details: 'We store the exact amount in the smallest unit of the currency.',
      }),
    );
    expect(html).toContain('id="budget-help"');
    expect(html).toContain('Your budget in normal units.');
    expect(html).toMatch(
      /<button[^>]*aria-expanded="false"[^>]*aria-label="More about this field"/,
    );
    expect(html).toMatch(/aria-controls="[^"]+-details"/);
    expect(html).toMatch(/role="note" hidden=""/);
    const plain = renderToStaticMarkup(createElement(FieldHelp, { summary: 'Only one line.' }));
    expect(plain).not.toContain('<button');
  });
});

describe('role shells (D14)', () => {
  test('each address belongs to one shell; sign-in pages and the staff preview stay public', () => {
    expect(signedInShellFor('/operator')).toBe('team');
    expect(signedInShellFor('/operator/missions')).toBe('team');
    expect(signedInShellFor('/operator/missions/0b5a0000-0000-4000-8000-000000000000')).toBe(
      'team',
    );
    expect(signedInShellFor('/operator/owner')).toBe('team');
    for (const path of [
      '/operator/signin',
      '/operator/forgot-password',
      '/operator/reset-password',
      '/operator/setup',
      '/operator/view-as/viewer',
    ])
      expect(signedInShellFor(path), path).toBeNull();
    expect(signedInShellFor('/account')).toBe('customer');
    expect(signedInShellFor('/account/requests/abc')).toBe('customer');
    expect(signedInShellFor('/contributor')).toBe('contributor');
    for (const path of ['/', '/plan', '/operators', '/accounts', '/signin', null, undefined])
      expect(signedInShellFor(path as string), String(path)).toBeNull();
    expect(teamSidebarShown('/operator/signin')).toBe(false);
    expect(teamSidebarShown('/operator/research')).toBe(true);
  });
  test('the sidebar is the D14 list, in order, and every original section stays reachable', () => {
    expect(teamNavigation.map((item) => item.key)).toEqual([
      'today',
      'missions',
      'companies',
      'meetings',
      'quotes',
      'reports',
      'network',
      'evidence',
    ]);
    const reachable = new Set<string>([
      ...teamNavigation.flatMap((item) => (item.section ? [item.section] : [])),
      ...teamSettingsSections,
    ]);
    for (const section of workspaceSections)
      expect(reachable.has(section.id), section.id).toBe(true);
    expect(teamNavigation.map((item) => translate('en', item.label))).toEqual([
      'Today',
      'Missions',
      'Companies',
      'Meetings',
      'Quotes and billing',
      'Reports',
      'Network',
      'Evidence',
    ]);
  });
  test('links keep the chosen workspace and fall back to # links when section addresses are off', () => {
    const tenant = '0b5a0000-0000-4000-8000-000000000001';
    expect(teamSectionHref('workspace-missions', true, tenant)).toBe(
      `/operator/missions?workspace=${tenant}`,
    );
    expect(teamSectionHref('workspace-missions', false, tenant)).toBe(
      `/operator?workspace=${tenant}#workspace-missions`,
    );
    expect(teamSectionHref(undefined, true, '')).toBe('/operator');
    expect(teamSectionHref('workspace-evidence', true, 'not-a-uuid')).toBe('/operator/evidence');
  });
  test('the current item follows the address; a # part wins; the owner page is Settings', () => {
    const at = (path: string, hash = '') =>
      currentTeamItem(currentTeamSection(path, hash, sectionForSlug));
    expect(at('/operator')).toBe('today');
    expect(at('/operator/missions')).toBe('missions');
    expect(at('/operator/research')).toBe('companies');
    expect(at('/operator/commercial')).toBe('quotes');
    expect(at('/operator/sources')).toBe('evidence');
    expect(at('/operator/audit')).toBe('settings');
    expect(at('/operator/owner')).toBe('settings');
    expect(at('/operator/missions/abc')).toBe('missions');
    expect(at('/operator', '#workspace-delivery')).toBe('reports');
    expect(at('/operator/missions', '#workspace-network')).toBe('network');
    expect(at('/operator', '#workspace-navigation')).toBe('today');
  });
  test('each team page has its own title', () => {
    expect(teamSectionTitle(undefined)).toBe('Today');
    expect(teamSectionTitle('workspace-research')).toBe('Companies');
    expect(teamSectionTitle('workspace-audit')).toBe('Access and audit');
  });
  test('the team context store only notifies on a real change', () => {
    publishTeamContext({ tenant: 't1', role: 'viewer' });
    const first = readTeamContext();
    publishTeamContext({ tenant: 't1', role: 'viewer' });
    expect(readTeamContext()).toBe(first);
    publishTeamContext({ tenant: 't1', role: 'owner' });
    expect(readTeamContext().role).toBe('owner');
  });
});

describe('host redirect and canonical link (CQ-17)', () => {
  const env = { VERCEL_ENV: 'production', APP_ORIGIN: canonicalSiteOrigin };
  test('the hosting alias moves to the owned address with path and query, permanently', () => {
    const target = canonicalPageRedirect(
      new Request('https://corridra.vercel.app/how-it-works?job=sell&x=1'),
      env,
    );
    expect(target?.href).toBe('https://c.obsidianglobal.studio/how-it-works?job=sell&x=1');
    expect(canonicalRedirectStatus).toBe(308);
    expect(canonicalPageRedirect(new Request(canonicalSiteOrigin + '/trust'), env)).toBeNull();
    expect(
      canonicalPageRedirect(new Request('https://corridra.vercel.app/', { method: 'POST' }), env),
    ).toBeNull();
    expect(
      canonicalPageRedirect(new Request('https://corridra-git-x.vercel.app/'), {
        ...env,
        VERCEL_ENV: 'preview',
      }),
    ).toBeNull();
  });
  test('the middleware runs on pages only, never on API routes, assets or files', async () => {
    const { config } = await import('../../apps/web/proxy');
    const pattern = new RegExp('^' + config.matcher[0] + '$');
    for (const path of ['/', '/plan', '/how-it-works', '/operator/missions', '/account/move'])
      expect(pattern.test(path), path).toBe(true);
    for (const path of [
      '/api/auth/callback',
      '/api/notifications',
      '/_next/static/chunk.js',
      '/icon.svg',
      '/robots.txt',
      '/.well-known/security.txt',
    ])
      expect(pattern.test(path), path).toBe(false);
  });
  test('the canonical link names the owned address and the path only', () => {
    expect(canonicalPageUrl('/')).toBe(canonicalSiteOrigin);
    expect(canonicalPageUrl('/trust')).toBe(canonicalSiteOrigin + '/trust');
    expect(canonicalPageUrl('//evil.example/x')).toBe(canonicalSiteOrigin);
    expect(canonicalPageUrl(null)).toBe(canonicalSiteOrigin);
  });
});

describe('notifications (D7, V-45 infrastructure)', () => {
  test('the inbox never stores codes, tokens or outside links', () => {
    expect(
      inboxSafePayload({
        title: 'Programme invitation',
        href: '/account/delegations',
        invitationCode: 'ABCD-1234',
        token: 'secret',
        nested: { x: 1 },
      }),
    ).toEqual({ title: 'Programme invitation', href: '/account/delegations' });
    expect(inboxSafePayload({ href: 'https://evil.example/' })).toEqual({});
    expect(inboxSafePayload({ href: '//evil.example/' })).toEqual({});
  });
  test('an email goes only with a ready provider, an address and the person’s choice', () => {
    const base = { recipientEmail: 'person@example.com', providerReady: true };
    for (const type of notificationTypes)
      expect(emailDecision({ ...base, type }), type).toBe('send');
    expect(emailDecision({ ...base, type: 'QUOTE_SENT', providerReady: false })).toBe('not_sent');
    expect(emailDecision({ ...base, type: 'QUOTE_SENT', recipientEmail: undefined })).toBe(
      'not_sent',
    );
    expect(emailDecision({ ...base, type: 'QUOTE_SENT', recipientEmail: 'nope' })).toBe('not_sent');
    expect(emailDecision({ ...base, type: 'QUOTE_SENT', emailChoice: false })).toBe('not_chosen');
    // Invitations go even before the person could choose.
    expect(emailDecision({ ...base, type: 'TEAM_INVITE', emailChoice: false })).toBe('send');
  });
  test('the message escapes text and links only to the application origin', () => {
    const mail = buildNotificationEmail({
      type: 'QUOTE_SENT',
      origin: canonicalSiteOrigin,
      title: 'Quote <b>ready</b>',
      link: '/account/requests/1?tab=quotes',
      lines: ['Valid until 24 Oct 2026'],
    });
    expect(mail.subject).toBe('Quote <b>ready</b>');
    expect(mail.html).toContain('Quote &lt;b&gt;ready&lt;/b&gt;');
    expect(mail.html).toContain('https://c.obsidianglobal.studio/account/requests/1?tab=quotes');
    expect(mail.text).toContain('Valid until 24 Oct 2026');
    expect(mail.text).not.toMatch(/—/);
    const outside = buildNotificationEmail({
      type: 'REPLY_POSTED',
      origin: canonicalSiteOrigin,
      link: 'https://evil.example/phish',
    });
    expect(outside.html).not.toContain('evil.example');
    expect(outside.subject).toBe('There is a new reply');
  });
});

describe('language and direction before paint (CQ-10, CQ-48)', () => {
  const run = (
    offered: (typeof localeCodes)[number][],
    stored: string | null,
    browser: string[],
  ) => {
    const html = { lang: 'en', dir: 'ltr' };
    new Function('localStorage', 'navigator', 'document', languageBootScript(offered))(
      { getItem: () => stored },
      { languages: browser },
      { documentElement: html },
    );
    return html;
  };
  test('a remembered Arabic choice sets lang and right to left', () => {
    expect(run(['en', 'ar'], 'ar', ['en-GB'])).toEqual({ lang: 'ar', dir: 'rtl' });
  });
  test('a language that is not offered changes nothing', () => {
    expect(run(['en'], 'ar', ['ar'])).toEqual({ lang: 'en', dir: 'ltr' });
  });
  test('on a first visit the browser language is used when offered; Traditional Chinese is not', () => {
    expect(run(['en', 'zh'], null, ['zh-TW', 'zh-CN'])).toEqual({ lang: 'zh-Hans', dir: 'ltr' });
    expect(run(['en', 'zh'], null, ['zh-TW'])).toEqual({ lang: 'en', dir: 'ltr' });
  });
});

describe('WS-E messages (D16, D17)', () => {
  test('every key exists in all seven languages, with no em dash', () => {
    const keys = Object.keys(wsEEn);
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) expect(key.startsWith('wse.'), key).toBe(true);
    for (const locale of localeCodes.filter((code) => code !== 'en')) {
      const block = wsE[locale as Exclude<(typeof localeCodes)[number], 'en'>];
      expect(Object.keys(block).sort(), locale).toEqual([...keys].sort());
      for (const value of Object.values(block)) {
        expect(value.trim().length).toBeGreaterThan(0);
        expect(value).not.toMatch(/—/);
      }
    }
    for (const value of Object.values(wsEEn)) expect(value).not.toMatch(/—/);
  });
});
