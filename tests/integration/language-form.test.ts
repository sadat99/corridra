import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultLocale, localeCodes } from '../../apps/web/lib/i18n/locales';
import { languagesWithForm, languagesWithPages } from '../../apps/web/lib/i18n/pages';
import { fill, fillNodes } from '../../apps/web/lib/i18n/fill';
import { describeSwitches, switchRegistry } from '../../apps/web/lib/owner-switches';

// The request form in the chosen language (Lane 11): /plan follows the chosen language only for the languages the
// owner names in CORRIDRA_LANGUAGES_FORM, after the form words of each language are reviewed and recorded. It is
// independent of the home page release, and with it unset the form is exactly the English form it was.
const web = createRequire(resolve('apps/web/package.json'));
type Node = Parameters<typeof fillNodes>[1][string];
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => Node;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;
const others = localeCodes.filter((code) => code !== defaultLocale);
const env = (values: Record<string, string>) => values as NodeJS.ProcessEnv;
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

describe('the form switch', () => {
  it('releases every language for exactly true, only the listed languages for a list, and none for anything else', () => {
    const form = (value?: string) =>
      languagesWithForm(env(value === undefined ? {} : { CORRIDRA_LANGUAGES_FORM: value }));
    expect(form()).toEqual([]);
    for (const value of ['', 'false', 'yes', '1', 'nonsense', 'xx', 'en', ' , '])
      expect(form(value), value).toEqual([]);
    expect(form('true')).toEqual(others);
    expect(form(' TRUE ')).toEqual(others);
    expect(form('es,de')).toEqual(['es', 'de']);
    expect(form(' DE , es,es,en,xx ')).toEqual(['de', 'es']);
  });

  it('is independent of the home page switch in both directions', () => {
    expect(languagesWithForm(env({ CORRIDRA_LANGUAGES_PAGES: 'true' }))).toEqual([]);
    expect(languagesWithPages(env({ CORRIDRA_LANGUAGES_FORM: 'true' }))).toEqual([]);
    const both = env({ CORRIDRA_LANGUAGES_PAGES: 'fr', CORRIDRA_LANGUAGES_FORM: 'es,de' });
    expect(languagesWithPages(both)).toEqual(['fr']);
    expect(languagesWithForm(both)).toEqual(['es', 'de']);
  });
});

describe('the owner page', () => {
  const row = (name: string, values: Record<string, string> = {}) =>
    describeSwitches(env(values))
      .flatMap((group) => group.rows)
      .find((entry) => entry.name === name)!;

  it('shows what visitors really get from the form switch: Off, On, or On for the listed languages', () => {
    const state = (value?: string) =>
      row('CORRIDRA_LANGUAGES_FORM', value === undefined ? {} : { CORRIDRA_LANGUAGES_FORM: value })
        .state;
    for (const value of [undefined, '', 'false', 'nonsense', 'en'])
      expect(state(value), String(value)).toEqual({ text: 'Off', tone: 'neutral' });
    expect(state('true')).toEqual({ text: 'On', tone: 'positive' });
    expect(state(' TRUE ')).toEqual({ text: 'On', tone: 'positive' });
    expect(state('es,de')).toEqual({ text: 'On for es, de', tone: 'positive' });
    expect(state('es,de,de,en,xx')).toEqual({ text: 'On for es, de', tone: 'positive' });
    // Each row reads only its own setting.
    expect(row('CORRIDRA_LANGUAGES_FORM', { CORRIDRA_LANGUAGES_PAGES: 'true' }).state.text).toBe(
      'Off',
    );
    expect(row('CORRIDRA_LANGUAGES_PAGES', { CORRIDRA_LANGUAGES_FORM: 'true' }).state.text).toBe(
      'Off',
    );
  });

  it('lists the form switch right after the page words, with its plain label and line', () => {
    const names = switchRegistry.map((entry) => entry.name);
    expect(names.indexOf('CORRIDRA_LANGUAGES_FORM')).toBe(
      names.indexOf('CORRIDRA_LANGUAGES_PAGES') + 1,
    );
    const form = switchRegistry.find((entry) => entry.name === 'CORRIDRA_LANGUAGES_FORM')!;
    expect(form).toMatchObject({
      label: 'Request form in the chosen language',
      group: 'Accounts and requests',
      kind: 'flag',
    });
    expect(form.line).toBe(
      'Shows the request form at /plan in the language a person chose. Write true for every language, or a list such as es,de for only those. Unset, the form reads in English whatever language is chosen. It is separate from the home page switch: setting one never sets the other. Privacy, consent and notice sentences stay in English, and the signed-in private request form stays English. A language also needs to be in Languages with reviewed text. Set it only after the owner has recorded a review of the form words of each language. Needs a new deploy.',
    );
    // The form line names the reviewed-languages row by the label the owner sees.
    expect(
      switchRegistry.find((entry) => entry.name === 'CORRIDRA_LANGUAGES_REVIEWED')?.label,
    ).toBe('Languages with reviewed text');
  });

  it('no longer says the page words switch will translate the request form', () => {
    const pages = switchRegistry.find((entry) => entry.name === 'CORRIDRA_LANGUAGES_PAGES')!;
    expect(pages.label).toBe('Page words in the chosen language');
    expect(pages.line).not.toContain('later the request form');
    expect(pages.line).toBe(
      'Shows the home page in the language a person chose. Write true for every language, or a list such as es,de for only those. Unset, the home page reads in English whatever language is chosen. The request form has its own switch, Request form in the chosen language. Set it only after the owner has recorded a review of the page words of each language. Needs a new deploy.',
    );
  });
});

describe('the translated main region', () => {
  it('carries the language a page with its own release gives it, whatever the home page release says', async () => {
    const { TranslatedMain } = await load('components/translated-main');
    const { PublicShell } = await load('components/public-shell');
    const main = (props: Record<string, unknown>) =>
      renderToStaticMarkup(createElement(TranslatedMain, { className: 'x', ...props }, 'words'));
    expect(main({ language: 'ar' })).toBe(
      '<main id="main" lang="ar" dir="rtl" tabindex="-1" class="x">words</main>',
    );
    expect(main({ language: 'zh' })).toContain('lang="zh-Hans" dir="ltr"');
    expect(main({ language: 'en' })).toContain('lang="en" dir="ltr"');
    // Without a language of its own the region follows the home page release, as before (English here).
    expect(main({})).toContain('lang="en" dir="ltr"');
    const shell = renderToStaticMarkup(
      createElement(PublicShell, { className: 'ux-intake-page', translated: true, language: 'de' }),
    );
    expect(shell).toBe(
      '<main id="main" lang="de" dir="ltr" tabindex="-1" class="ux-public ux-intake-page"></main>',
    );
  });

  it('gives the same markup as the English shell when the language is English', async () => {
    const { PublicShell } = await load('components/public-shell');
    const render = (props: Record<string, unknown>) =>
      renderToStaticMarkup(
        createElement(PublicShell, { className: 'ux-intake-page', ...props }, 'words'),
      );
    expect(render({ translated: true, language: 'en' })).toBe(render({}));
  });
});

describe('message patterns with elements', () => {
  const link = createElement('a', { href: '/x' }, 'link');
  it('give one plain string when every value is text, exactly as fill does', () => {
    expect(fillNodes('Signed in as {email}.', { email: 'a@example.invalid' })).toBe(
      fill('Signed in as {email}.', { email: 'a@example.invalid' }),
    );
    expect(fillNodes('No values', {})).toBe('No values');
    expect(fillNodes('Keep {unknown} as written', {})).toBe('Keep {unknown} as written');
  });

  it('keep numbers and elements as their own nodes, as the JSX they replace does', () => {
    expect(fillNodes('STEP {step} OF {total}', { step: 2, total: '5' })).toEqual([
      'STEP ',
      2,
      ' OF 5',
    ]);
    const nodes = fillNodes('Status: {status}', { status: link }) as unknown[];
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toBe('Status: ');
    expect(renderToStaticMarkup(createElement('p', null, nodes))).toBe(
      '<p>Status: <a href="/x">link</a></p>',
    );
    // React text separators match JSX: "STEP {n} OF 5" renders the same markup either way.
    expect(
      renderToStaticMarkup(
        createElement('p', null, fillNodes('STEP {step} OF {total}', { step: 1, total: '5' })),
      ),
    ).toBe(renderToStaticMarkup(createElement('p', null, 'STEP ', 1, ' OF 5')));
  });
});
