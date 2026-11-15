import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ADR-085. The two pages that can show the helper interest register, rendered for real: the privacy notice (its
// section must exist whatever the programme pages switch says) and the team door (the form). With either switch off, or
// with the register not open, both pages are exactly what they were: the markup is the same bytes as with the feature absent.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;
const privacyPath = '../../apps/web/app/privacy/page';
const teamPath = '../../apps/web/app/access/team/page';
let registerOpen = true;
vi.mock('../../apps/web/components/public-shell', () => ({
  PublicShell: ({ children }: { children: unknown }) =>
    createElement('div', null, children as never),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) =>
    createElement('a', { href }, children as never),
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    helperInterest: { offered: async () => registerOpen },
  }),
}));

const switches = [
  'CORRIDRA_HELPER_INTEREST',
  'CORRIDRA_NETWORK_ENABLED',
  'CORRIDRA_CUSTOMER_WORKSPACES_ENABLED',
  'CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED',
  'CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED',
  'CORRIDRA_PROGRAMME_PAGES',
  'CORRIDRA_CUSTOMER_MISSION_SHARES_ENABLED',
  'CORRIDRA_UX_ACCESS_DOORS',
  'DATA_ENVIRONMENT',
  'CORRIDRA_REAL_USE_ENABLED',
];
const clear = () => {
  for (const key of switches) delete process.env[key];
};
afterEach(() => {
  clear();
  registerOpen = true;
});
const real = { DATA_ENVIRONMENT: 'real', CORRIDRA_REAL_USE_ENABLED: 'true' };
const on = { CORRIDRA_HELPER_INTEREST: 'true', CORRIDRA_NETWORK_ENABLED: 'true' };
const pagesOn = {
  CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
  CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
  CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
  CORRIDRA_PROGRAMME_PAGES: 'true',
};

async function markup(path: string, env: Record<string, string>) {
  vi.resetModules();
  clear();
  Object.assign(process.env, env);
  const { default: Page } = await import(/* @vite-ignore */ path);
  const element = path === teamPath ? await Page() : createElement(Page);
  return renderToStaticMarkup(element);
}

describe('the privacy notice section', () => {
  it('is on the page with the helper interest switches on and programme pages OFF, with its contents link', async () => {
    const page = await markup(privacyPath, { ...real, ...on });
    expect(page).toContain('id="helper-interest"');
    expect(page).toContain('href="#helper-interest"');
    expect(page).not.toContain('id="programme-applications"');
    expect(page).toContain('Telling us you want to be a field helper');
  });

  // The visible words of the section only: the markup of the article, with tags removed and spaces collapsed.
  const section = (page: string) => {
    const start = page.indexOf('id="helper-interest"');
    const end = page.indexOf('</article>', start);
    return page
      .slice(start, end)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/\s+/g, ' ');
  };

  it('says the anonymous hashed email is kept only to limit repeat sign-ups and is removed after about two hours', async () => {
    const text = section(await markup(privacyPath, { ...real, ...on }));
    expect(text).toContain('scrambled, one-way form of your email address');
    expect(text).toContain('cannot be turned back into your address');
    expect(text).toContain('used for nothing else');
    expect(text).toContain('removed automatically after about two hours');
    expect(text).toContain(
      'the next time someone sends one of our request, reply, delivery or helper forms after that',
    );
    // The old wording, which said the hash was kept for good, is gone.
    expect(text).not.toContain('not deleted when your entry is');
  });

  it('covers what is collected and why, who sees it, how long it is kept, how to ask for deletion, and what it is not used for', async () => {
    const text = section(await markup(privacyPath, { ...real, ...on }));
    for (const part of [
      'your name, your email address, your country and a few words about why',
      'get in touch with people who are interested in helping the network',
      'the time you sent them',
      'Only owners and administrators of the Corridra team workspace that receives requests can read these entries',
      'Entries are deleted after 180 days. From then on our team can no longer see an entry, and it is removed the next time the form is used or our team opens the list',
      'To have yours deleted sooner, write to the contact under Who is responsible',
      'tell us the email address you used',
      'We do not use them for marketing',
      'we do not sell them or share them for anyone else',
      'we do not email you to confirm your note',
      'The form sets no cookies and keeps nothing in your browser',
      'holds no internet address',
      'It is not an invitation, a job or a reward',
      'The form is shown only while the Corridra Network is switched on',
    ])
      expect(text, part).toContain(part);
    // Links to the sections it points at exist on the page.
    const page = await markup(privacyPath, { ...real, ...on });
    for (const id of ['contact', 'sharing', 'storage']) expect(page).toContain(`id="${id}"`);
    expect(section(page)).not.toMatch(/owner must approve|awaits the owner|draft/i);
  });

  it('is written in plain words: no em dash, no en dash', async () => {
    expect(section(await markup(privacyPath, { ...real, ...on }))).not.toMatch(/[\u2013\u2014]/);
  });

  it('is a section of its own, not inside the programme applications section, with programme pages on', async () => {
    const page = await markup(privacyPath, { ...real, ...on, ...pagesOn });
    const programme = page.indexOf('id="programme-applications"');
    const helper = page.indexOf('id="helper-interest"');
    expect(programme).toBeGreaterThan(-1);
    expect(helper).toBeGreaterThan(programme);
    expect(page.slice(programme, helper)).toContain('</article>');
    expect(page.indexOf('id="sharing"')).toBeGreaterThan(helper);
  });
});

describe('with either switch off the pages are the same bytes as with the feature absent', () => {
  const cases: Array<[string, Record<string, string>, Record<string, string>]> = [
    ['only the helper interest switch', { CORRIDRA_HELPER_INTEREST: 'true' }, {}],
    [
      '"TRUE" is not "true"',
      { CORRIDRA_HELPER_INTEREST: 'TRUE', CORRIDRA_NETWORK_ENABLED: 'true' },
      { CORRIDRA_NETWORK_ENABLED: 'true' },
    ],
    [
      '"1" is not "true"',
      { CORRIDRA_HELPER_INTEREST: '1', CORRIDRA_NETWORK_ENABLED: 'true' },
      { CORRIDRA_NETWORK_ENABLED: 'true' },
    ],
    [
      'the Network switch not "true"',
      { CORRIDRA_HELPER_INTEREST: 'true', CORRIDRA_NETWORK_ENABLED: 'false' },
      { CORRIDRA_NETWORK_ENABLED: 'false' },
    ],
  ];
  for (const [label, withIt, without] of cases)
    for (const path of [privacyPath, teamPath])
      it(`${path.split('/').slice(-2).join('/')}: ${label}`, async () => {
        const a = await markup(path, { ...real, ...withIt });
        const b = await markup(path, { ...real, ...without });
        expect(a).toBe(b);
        expect(a).not.toContain('helper-interest');
        expect(a).not.toContain('Not invited yet');
      });

  it('the team door: the Network switch alone changes nothing, and neither does an open register without the switches', async () => {
    const none = await markup(teamPath, { ...real });
    expect(await markup(teamPath, { ...real, CORRIDRA_NETWORK_ENABLED: 'true' })).toBe(none);
    registerOpen = true;
    expect(await markup(teamPath, { ...real, CORRIDRA_HELPER_INTEREST: 'true' })).toBe(none);
  });

  it('the team door: both switches on but the register not installed or not open is the same bytes too', async () => {
    const none = await markup(teamPath, { ...real, CORRIDRA_NETWORK_ENABLED: 'true' });
    registerOpen = false;
    expect(await markup(teamPath, { ...real, ...on })).toBe(none);
  });

  it('the team door shows the form only with both switches on and the register open', async () => {
    const shown = await markup(teamPath, { ...real, ...on });
    expect(shown).toContain('Not invited yet? Tell us you are interested');
    expect(shown).toContain('This is not an invitation, a job or a reward.');
    expect(shown).toContain('name="website"');
  });
});
