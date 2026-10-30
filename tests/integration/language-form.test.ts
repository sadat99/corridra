import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultLocale, localeCodes } from '../../apps/web/lib/i18n/locales';
import { languagesWithForm, languagesWithPages } from '../../apps/web/lib/i18n/pages';
import { fill, fillNodes } from '../../apps/web/lib/i18n/fill';
import { describeSwitches, switchRegistry } from '../../apps/web/lib/owner-switches';
import { en } from '../../apps/web/lib/i18n/messages';
import { isPageKey } from '../../apps/web/lib/i18n/pages';
import { formEn, type FormKey } from '../../apps/web/lib/i18n/form-words/en';
import {
  englishOnlyMessages,
  issueSeparator,
  readFormMessage,
} from '../../apps/web/lib/i18n/form-words/messages';
import { words as ar } from '../../apps/web/lib/i18n/form-words/ar';
import { words as bn } from '../../apps/web/lib/i18n/form-words/bn';
import { words as de } from '../../apps/web/lib/i18n/form-words/de';
import { words as es } from '../../apps/web/lib/i18n/form-words/es';
import { words as fr } from '../../apps/web/lib/i18n/form-words/fr';
import { words as zh } from '../../apps/web/lib/i18n/form-words/zh';
import { missionCatalogue } from '../../packages/domain/src/commercial-missions';
import { objectiveOptions, outcomeOptions } from '../../packages/domain/src/missions';

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
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const formKeys = Object.keys(formEn) as FormKey[];
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

// The sentences that stay English in every language (Lane 11: legal, consent and privacy statements stay English;
// owner ruling of 30 October 2026: also how long information is kept and that nothing is an offer).
const staysEnglish = [
  'Create an account at the final step to keep your request and replies private.',
  'At the final step, create an account or sign in to keep your request and replies private.',
  'Read the privacy and request notice',
  'Read the test intake notice',
  'Sample requests stay private to this account.',
  'Your request is saved privately for 24 hours while you activate your account and sign in.',
  'Private offers and contacts are not shared with the organiser automatically.',
  'I have read the privacy and request notice and agree to Corridra handling this request.',
  'I have read the test intake notice and am submitting invented test details.',
  'Your password goes only to the account provider.',
  'Activate your account to submit it and read replies privately.',
  'Drafts stay in this tab for 24 hours.',
  'Anyone with this code can read the mission status and replies.',
  'It expires after 30 days.',
  'Your request is saved on this device. You do not need to copy a code. Use another device? Copy the code first.',
  'This device no longer remembers your request. Copy the code now if you still need it.',
  'Nothing here is an offer, a quote or a promise.',
  'Drafts expire after 24 hours.',
  'Your request is saved for 24 hours.',
  'No real customer mission has been accepted.',
];
const formSource = () =>
  ['apps/web/app/plan/intake.tsx', 'apps/web/app/plan/plan-head.tsx']
    .map(read)
    .join('\n')
    .replace(/\s+/g, ' ');

describe('the English form words', () => {
  it('are form keys only: none is a page key or a shared catalogue key, so no other release can reach them', () => {
    for (const key of formKeys) {
      expect(key.startsWith('form.'), key).toBe(true);
      expect(isPageKey(key), key).toBe(false);
      expect(Object.hasOwn(en, key), key).toBe(false);
    }
    for (const key of Object.keys(en)) expect(key.startsWith('form.'), key).toBe(false);
  });

  it('are each used by the request page, so no word is shipped that nothing shows', () => {
    const sources = [
      'apps/web/app/plan/intake.tsx',
      'apps/web/app/plan/plan-head.tsx',
      'apps/web/app/plan/form-words.tsx',
      'apps/web/lib/i18n/form-words/messages.ts',
    ]
      .map(read)
      .join('\n');
    for (const key of formKeys) {
      if (key.startsWith('form.job.')) continue;
      expect(sources, key).toContain(`'${key}'`);
    }
    // Job words are reached through the job key, so every catalogue job has words and no other job does.
    expect(read('apps/web/app/plan/intake.tsx')).toContain('`form.job.${key}`');
    expect(formKeys.filter((key) => key.startsWith('form.job.')).sort()).toEqual(
      missionCatalogue.map((job) => `form.job.${job.key}`).sort(),
    );
  });

  it('show the stored values with the same words the request page always showed, and the values never change', () => {
    for (const job of missionCatalogue)
      expect(formEn[`form.job.${job.key}` as FormKey], job.key).toBe(job.label);
    const shown = (prefix: string) =>
      formKeys.filter((key) => key.startsWith(prefix)).map((key) => formEn[key]);
    for (const value of objectiveOptions) expect(shown('form.goal.')).toContain(value);
    for (const value of outcomeOptions) expect(shown('form.results.')).toContain(value);
    for (const value of ['Yes', 'No', 'Not decided']) expect(shown('form.where.')).toContain(value);
    // The values sent stay the domain values: the options and the market name are not read from the words.
    const intake = read('apps/web/app/plan/intake.tsx');
    expect(intake).toContain('value={v}');
    expect(intake).toContain("new Intl.DisplayNames(['en'], { type: 'region' }).of(marketCode)");
    expect(intake).toContain("new Intl.DisplayNames(['en'], { type: 'region' }).of(String(value))");
    expect(intake).toContain(
      'objective: missionCatalogue.find((t) => t.key === draft.job)?.label ?? draft.objective',
    );
  });

  it('leave every consent, privacy and storage sentence out, and the form still writes each one in English', () => {
    const catalogue = Object.values(formEn).join('\n');
    const source = `${formSource()} ${read('apps/web/lib/i18n/form-words/messages.ts')}`;
    for (const sentence of staysEnglish) {
      expect(catalogue, sentence).not.toContain(sentence);
      expect(source, sentence).toContain(sentence);
    }
  });

  it('keep the translated half of the saved-request sentence identical to what the English form writes', () => {
    // The English branch keeps its exact text (another test reads it), so the two cannot drift apart.
    expect(formSource()).toContain(
      `Your request is saved privately for 24 hours while you activate your account and sign in. ${formEn['form.pending.sameDevice']}`,
    );
  });

  it('use no dash as punctuation', () => {
    for (const [key, words] of Object.entries(formEn))
      expect(words, key).not.toMatch(/[\u2013\u2014]| - /);
  });

  it('cannot be reached through the shared translate function', () => {
    const walk = (dir: string): string[] =>
      readdirSync(resolve(dir), { withFileTypes: true }).flatMap((entry) =>
        entry.name === 'node_modules' || entry.name === '.next'
          ? []
          : entry.isDirectory()
            ? walk(`${dir}/${entry.name}`)
            : /\.(ts|tsx)$/.test(entry.name)
              ? [`${dir}/${entry.name}`]
              : [],
      );
    for (const file of ['apps/web/app', 'apps/web/components', 'apps/web/lib'].flatMap(walk))
      expect(read(file), file).not.toMatch(/\b(translate|t)\(\s*['"`]form\./);
  });
});

describe('where the form words are wired', () => {
  it('the layout and the language provider never read the form release', () => {
    for (const file of ['apps/web/app/layout.tsx', 'apps/web/components/language-provider.tsx']) {
      expect(read(file), file).not.toContain('languagesWithForm');
      expect(read(file), file).not.toContain('CORRIDRA_LANGUAGES_FORM');
      expect(read(file), file).not.toContain('form-words');
    }
  });

  it('the signed-in private request form mounts the form without its words, so it stays English', () => {
    const privateForm = read('apps/web/app/account/request/private-request-intake.tsx');
    expect(privateForm).toContain('<Intake');
    expect(privateForm).not.toContain('FormMain');
    expect(privateForm).not.toContain('FormWordsProvider');
    expect(privateForm).not.toContain('form-words');
  });

  it('the form reads its words only through the hook, which is English without the request page region', () => {
    const intake = read('apps/web/app/plan/intake.tsx');
    expect(intake).toContain("from './form-words'");
    expect(intake).not.toContain('form-main');
    expect(intake).not.toContain('FormWordsProvider');
    expect(read('apps/web/app/plan/page.tsx')).toContain('<FormMain className="ux-intake-page"');
  });

  it('joins several problems with one field the way the message reader splits them', () => {
    expect(read('apps/web/app/plan/intake.tsx')).toContain('.join(issueSeparator)');
    expect(issueSeparator).toBe('. ');
  });
});

describe('the message reader', () => {
  it('reads a message the form sets as its key', () => {
    expect(readFormMessage(formEn['form.message.chooseJob'])).toEqual([
      { key: 'form.message.chooseJob', values: {} },
    ]);
    expect(readFormMessage(formEn['form.message.draftLostSample'])).toEqual([
      { key: 'form.message.draftLostSample', values: {} },
    ]);
  });

  it('reads a known sentence followed by one that stays English, in their order', () => {
    expect(
      readFormMessage(`${formEn['form.message.draftNotResumed']} Drafts expire after 24 hours.`),
    ).toEqual([
      { key: 'form.message.draftNotResumed', values: {} },
      { english: 'Drafts expire after 24 hours.', lead: null },
    ]);
    expect(
      readFormMessage(
        `Your request is saved for 24 hours. ${formEn['form.message.accountNotCreated']}`,
      ),
    ).toEqual([
      { english: 'Your request is saved for 24 hours.', lead: null },
      { key: 'form.message.accountNotCreated', values: {} },
    ]);
  });

  it('reads joined problems part by part, with or without their full stops', () => {
    const joined = [formEn['form.message.chooseJob'], formEn['form.message.checkAmount']].join(
      issueSeparator,
    );
    expect(readFormMessage(joined)).toEqual([
      { key: 'form.message.chooseJob', values: {} },
      { key: 'form.message.checkAmount', values: {} },
    ]);
  });

  it('leads a consent message with the translated instruction and keeps the English consent wording', () => {
    for (const text of [
      'Read and acknowledge the test intake notice',
      'Read and acknowledge the request privacy notice',
    ])
      expect(readFormMessage(text)).toEqual([{ english: text, lead: 'form.message.consentLead' }]);
    expect(read('packages/domain/src/missions.ts')).toContain(
      "z.literal(true, { error: 'Read and acknowledge the test intake notice' })",
    );
    expect(read('packages/domain/src/missions.ts')).toContain(
      "z.literal(true, { error: 'Read and acknowledge the request privacy notice' })",
    );
  });

  it('gives nothing for a message it does not know, even when only one part is unknown', () => {
    expect(readFormMessage('Synthetic transport interruption')).toBeNull();
    expect(readFormMessage(`${formEn['form.message.chooseJob']}. Something unknown`)).toBeNull();
  });

  it('knows only sentences that stay English as English-only', () => {
    for (const text of Object.keys(englishOnlyMessages))
      expect(
        staysEnglish.some((sentence) => text.startsWith(sentence)) ||
          text.startsWith('Read and acknowledge'),
        text,
      ).toBe(true);
  });
});

const drafts = { bn, zh, es, ar, fr, de };
const draftCodes = Object.keys(drafts) as (keyof typeof drafts)[];
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
// The glossary words reviewed on 25 October 2026 (language review record).
const requestWord = {
  bn: 'অনুরোধ',
  zh: '需求',
  es: 'solicitud',
  ar: 'طلب',
  fr: 'demande',
  de: 'anfrage',
};
const teamWord = {
  bn: 'Corridra টিম',
  zh: 'Corridra 团队',
  es: 'Equipo de Corridra',
  ar: 'فريق Corridra',
  fr: 'Équipe Corridra',
  de: 'Corridra-Team',
};
const optionalWord = {
  bn: '(ঐচ্ছিক)',
  zh: '（选填）',
  es: '(opcional)',
  ar: '(اختياري)',
  fr: '(facultatif)',
  de: '(optional)',
};

describe('the drafted form words', () => {
  it('have exactly the English keys in all six languages, with every placeholder kept and none empty', () => {
    expect(draftCodes.sort()).toEqual(others.filter((code) => code !== 'en').sort());
    for (const code of draftCodes) {
      expect(Object.keys(drafts[code]).sort(), code).toEqual([...formKeys].sort());
      for (const key of formKeys) {
        expect(drafts[code][key].trim().length, `${code} ${key}`).toBeGreaterThan(0);
        expect(placeholders(drafts[code][key]), `${code} ${key}`).toEqual(
          placeholders(formEn[key]),
        );
      }
    }
  });

  it('use no dash as punctuation, and leave every stays-English sentence out', () => {
    for (const code of draftCodes)
      for (const key of formKeys) {
        expect(drafts[code][key], `${code} ${key}`).not.toMatch(/[\u2013\u2014]| - /);
        for (const sentence of staysEnglish)
          expect(drafts[code][key], `${code} ${key}`).not.toContain(sentence);
      }
  });

  it('keep the name Corridra, and use the glossary words for request and for the Corridra team', () => {
    for (const code of draftCodes)
      for (const key of formKeys) {
        const english = formEn[key];
        const words = drafts[code][key];
        if (english.includes('Corridra')) expect(words, `${code} ${key}`).toContain('Corridra');
        if (/\brequests?\b|\bintake\b/i.test(english))
          expect(words.toLowerCase(), `${code} ${key}`).toContain(requestWord[code]);
        if (/\boperator\b/i.test(english))
          expect(words, `${code} ${key}`).toContain(teamWord[code]);
        if (english.includes('(optional)'))
          expect(words, `${code} ${key}`).toContain(optionalWord[code]);
      }
  });

  it('keep the five step words distinct in each language, because they are the journey bar keys', () => {
    const steps = ['goal', 'where', 'details', 'results', 'contact'] as const;
    for (const code of draftCodes) {
      const words = steps.map((step) => drafts[code][`form.step.${step}`]);
      expect(new Set(words).size, code).toBe(5);
      if (['de', 'fr', 'es'].includes(code))
        for (const word of words) {
          expect(word.length, `${code} ${word}`).toBeLessThanOrEqual(12);
          expect(word.split(' ').length, `${code} ${word}`).toBeLessThanOrEqual(2);
        }
    }
  });

  it('keep buttons short: Back and Continue at most 14 characters, others at most 1.7 times English or 30', () => {
    const buttons: FormKey[] = [
      'form.action.createAccount',
      'form.action.submit',
      'form.action.clearDraft',
      'form.action.saving',
      'form.pending.open',
      'form.pending.activate',
      'form.pending.signIn',
      'form.pending.create',
      'form.pending.codeSignIn',
      'form.pending.return',
      'form.receipt.forget',
      'form.receipt.copy',
      'form.check.submit',
      'form.contact.signInReturn',
    ];
    for (const code of draftCodes) {
      for (const key of ['form.action.back', 'form.action.continue'] as const)
        expect(drafts[code][key].length, `${code} ${key}`).toBeLessThanOrEqual(14);
      for (const key of buttons)
        expect(drafts[code][key].length, `${code} ${key}`).toBeLessThanOrEqual(
          Math.max(30, 1.7 * formEn[key].length),
        );
      expect(drafts[code]['form.receipt.another'].length, code).toBeLessThanOrEqual(55);
      for (const key of ['form.notice.realPill', 'form.notice.samplePill'] as const)
        expect(drafts[code][key].length, `${code} ${key}`).toBeLessThanOrEqual(20);
    }
  });

  it('address the reader formally in German, French and Spanish', () => {
    const informal = {
      de: /\b(du|dich|dir|dein\w*)\b/i,
      fr: /\b(tu|toi|ton|ta|tes)\b/i,
      es: /(?<![\p{L}])(tú|tu|tus|puedes|quieres|tienes)(?![\p{L}])/iu,
    };
    for (const [code, pattern] of Object.entries(informal))
      for (const key of formKeys)
        expect(drafts[code as keyof typeof informal][key], `${code} ${key}`).not.toMatch(pattern);
  });

  it('say how to write an amount: digits 0 to 9 in Bangla and Arabic, a point as the decimal mark in German, French and Spanish', () => {
    expect(bn['form.budget.hint']).toContain('0 থেকে 9 অঙ্ক ব্যবহার করুন।');
    expect(ar['form.budget.hint']).toContain('استخدم الأرقام من 0 إلى 9.');
    expect(de['form.budget.hint']).toContain('Punkt als Dezimalzeichen');
    expect(fr['form.budget.hint']).toContain('point comme séparateur décimal');
    expect(es['form.budget.hint']).toContain('punto como separador decimal');
    // The money examples are slots, so their digits and periods are never translated.
    for (const code of draftCodes) {
      expect(drafts[code]['form.budget.hint'], code).toContain('{cny}');
      expect(drafts[code]['form.budget.hint'], code).toContain('{bhd}');
    }
  });

  it('copy no English into another language, except words that are spelled the same', () => {
    const same: Record<string, FormKey[]> = {
      de: ['form.step.details', 'form.contact.name', 'form.check.status'],
      fr: ['form.step.contact'],
      es: ['form.where.no'],
    };
    for (const code of draftCodes)
      for (const key of formKeys)
        if (!(same[code] ?? []).includes(key))
          expect(drafts[code][key], `${code} ${key}`).not.toBe(formEn[key]);
  });

  it('put a narrow no-break space before French question marks, exclamation marks, colons and semicolons', () => {
    for (const key of formKeys) expect(fr[key], key).not.toMatch(/(?<! )[?!:;]/);
  });

  it('write counts inside Bangla sentences in Bengali digits, and only the amount hint names 0 and 9', () => {
    for (const key of formKeys)
      if (key !== 'form.budget.hint') expect(bn[key], key).not.toMatch(/[0-9]/);
    expect(bn['form.contact.passwordHint']).toContain('১৪');
  });
});

describe('the drafted form words load on demand', () => {
  it('each language is a literal import of its own file, and only the request page region loads them', () => {
    const loader = read('apps/web/lib/i18n/form-words/load.ts');
    for (const code of draftCodes) expect(loader).toContain(`${code}: () => import('./${code}')`);
    const walk = (dir: string): string[] =>
      readdirSync(resolve(dir), { withFileTypes: true }).flatMap((entry) =>
        entry.name === 'node_modules' || entry.name === '.next'
          ? []
          : entry.isDirectory()
            ? walk(`${dir}/${entry.name}`)
            : /\.(ts|tsx)$/.test(entry.name)
              ? [`${dir}/${entry.name}`]
              : [],
      );
    const files = ['apps/web/app', 'apps/web/components', 'apps/web/lib'].flatMap(walk);
    const using = (pattern: RegExp) => files.filter((file) => pattern.test(read(file))).sort();
    expect(using(/form-words\/load'/)).toEqual(['apps/web/app/plan/form-main.tsx']);
    expect(using(/form-words\/(bn|zh|es|ar|fr|de)'/)).toEqual([]);
    // The page reads the release; the owner page only describes it.
    expect(using(/import \{[^}]*\blanguagesWithForm\b/)).toEqual([
      'apps/web/app/plan/page.tsx',
      'apps/web/lib/owner-switches.ts',
    ]);
    expect(using(/<FormMain\b/)).toEqual(['apps/web/app/plan/page.tsx']);
    expect(read('apps/web/app/plan/page.tsx')).toContain('released={languagesWithForm()}');
  });

  it('the built page is English even with every language released, because the language applies after load', async () => {
    const { LanguageProvider } = await load('components/language-provider');
    const { FormMain } = await load('app/plan/form-main');
    const { PlanHead } = await load('app/plan/plan-head');
    const html = renderToStaticMarkup(
      createElement(
        LanguageProvider,
        { offered: localeCodes.map((code) => ({ code, draft: false })), pageLocales: others },
        createElement(
          FormMain,
          { released: others, className: 'ux-intake-page' },
          createElement(PlanHead, { realMode: false }),
        ),
      ),
    );
    expect(html).toContain(
      '<main id="main" lang="en" dir="ltr" tabindex="-1" class="ux-public ux-intake-page">',
    );
    expect(html).toContain(`<h1>${formEn['form.head.title']}</h1>`);
  });
});
