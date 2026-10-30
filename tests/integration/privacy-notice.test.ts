import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Renders the real privacy page for each setting. The notice must be true in every state: the
// mission email paragraph appears only while that email can be sent, and the device memory
// sentence only where a request can be sent without an account.
// React lives with the web app, not at the repository root.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;
// The page is a TSX module; the package type check has no JSX setting, so it is loaded by path.
const pagePath = '../../apps/web/app/privacy/page';
// Reads the visible text: everything outside angle brackets, with runs of space collapsed.
function visibleText(markup: string) {
  let inside = false;
  let out = '';
  for (const character of markup) {
    if (character === '<') {
      inside = true;
      out += ' ';
    } else if (character === '>') inside = false;
    else if (!inside) out += character;
  }
  return out.split(/\s+/).filter(Boolean).join(' ');
}
vi.mock('../../apps/web/components/public-shell', () => ({
  PublicShell: ({ children }: { children: unknown }) =>
    createElement('div', null, children as never),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) =>
    createElement('a', { href }, children as never),
}));

const text = async (env: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const key of [
    'DATA_ENVIRONMENT',
    'CORRIDRA_REAL_USE_ENABLED',
    'CORRIDRA_MISSION_EMAIL_ENABLED',
    'CORRIDRA_PULSE_ENABLED',
    'CORRIDRA_CUSTOMER_WORKSPACES_ENABLED',
    'CORRIDRA_DELIVERY_ENABLED',
    'CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED',
    'CORRIDRA_CUSTOMER_SPECIFICATION_CONFIRMATION_ENABLED',
    'CORRIDRA_CUSTOMER_SERVICE_REQUESTS_ENABLED',
    'CORRIDRA_CUSTOMER_BILLING_ENABLED',
    'CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED',
    'CORRIDRA_CUSTOMER_REAL_INVOICING_ENABLED',
    'CORRIDRA_CUSTOMER_SIMULATED_PAYMENTS_ENABLED',
    'CORRIDRA_LANGUAGES_FORM',
    'CORRIDRA_LANGUAGES_PAGES',
    'VERCEL_ENV',
  ])
    delete process.env[key];
  Object.assign(process.env, env);
  const { default: Page } = await import(/* @vite-ignore */ pagePath);
  return visibleText(renderToStaticMarkup(createElement(Page)));
};
const real = { DATA_ENVIRONMENT: 'real', CORRIDRA_REAL_USE_ENABLED: 'true' };
const emailSentence = 'We email the verified address on your account when we receive your request.';
const pulseSentence =
  'Email about your requests is off until you switch it on, on the Email choices page.';
const deviceSentence =
  'a private code for it is kept in your browser on this device so you can check its status later';

afterEach(() => {
  for (const key of [
    'DATA_ENVIRONMENT',
    'CORRIDRA_REAL_USE_ENABLED',
    'CORRIDRA_MISSION_EMAIL_ENABLED',
    'CORRIDRA_PULSE_ENABLED',
    'CORRIDRA_CUSTOMER_WORKSPACES_ENABLED',
    'CORRIDRA_DELIVERY_ENABLED',
    'CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED',
    'CORRIDRA_CUSTOMER_SPECIFICATION_CONFIRMATION_ENABLED',
    'CORRIDRA_CUSTOMER_SERVICE_REQUESTS_ENABLED',
    'CORRIDRA_CUSTOMER_BILLING_ENABLED',
    'CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED',
    'CORRIDRA_CUSTOMER_REAL_INVOICING_ENABLED',
    'CORRIDRA_CUSTOMER_SIMULATED_PAYMENTS_ENABLED',
    'CORRIDRA_LANGUAGES_FORM',
    'CORRIDRA_LANGUAGES_PAGES',
  ])
    delete process.env[key];
});

describe('the privacy notice', () => {
  it('real use, mission email off: says replies are not emailed and announces no mission email', async () => {
    const page = await text(real);
    expect(page).toContain('Mission reply emails are not sent.');
    expect(page).not.toContain(emailSentence);
    expect(page).not.toContain(deviceSentence);
  });
  it('real use, mission email on: adds the paragraph, still says replies are not emailed', async () => {
    const page = await text({ ...real, CORRIDRA_MISSION_EMAIL_ENABLED: 'true' });
    expect(page).toContain(emailSentence);
    expect(page).toContain('a link to mute messages about that request and a link to your account');
    expect(page).toContain('for at most 24 hours, only to send the email');
    expect(page).toContain('Sign-in and password emails are separate.');
    expect(page).toContain('Mission reply emails are not sent.');
  });
  it('the mission email switch counts only when it is exactly true, and only in real use', async () => {
    for (const value of ['TRUE', 'yes', '1', ' true', ''])
      expect(await text({ ...real, CORRIDRA_MISSION_EMAIL_ENABLED: value })).not.toContain(
        emailSentence,
      );
    expect(
      await text({ DATA_ENVIRONMENT: 'synthetic', CORRIDRA_MISSION_EMAIL_ENABLED: 'true' }),
    ).not.toContain(emailSentence);
  });
  it('email about your requests is described only while it can be sent, as off until switched on, with the address not stored', async () => {
    expect(await text(real)).not.toContain(pulseSentence);
    const page = await text({ ...real, CORRIDRA_PULSE_ENABLED: 'true' });
    expect(page).toContain(pulseSentence);
    expect(page).toContain('Our email records do not hold your address.');
    expect(page).toContain('the daily email has none');
    expect(page).toContain('Resend keeps its own delivery record');
    expect(page).toContain('a short description of what is needed as written by our team');
    expect(page).toContain('Basis: your consent.');
    // The processor line, the purposes list and the storage list change with the paragraph, so the notice is
    // true in both states.
    expect(page).toContain('the request emails you switch on');
    expect(page).toContain('Email about your requests (your email choices');
    expect(page).toContain('If you close the email prompt with Not now');
    const off = await text(real);
    expect(off).not.toContain('the request emails you switch on');
    expect(off).not.toContain('If you close the email prompt with Not now');
    expect(off).not.toContain('Email you switch on is delivered by Resend');
    for (const value of ['TRUE', 'yes', '1', ' true', ''])
      expect(await text({ ...real, CORRIDRA_PULSE_ENABLED: value })).not.toContain(pulseSentence);
    expect(
      await text({ DATA_ENVIRONMENT: 'synthetic', CORRIDRA_PULSE_ENABLED: 'true' }),
    ).not.toContain(pulseSentence);
  });
  it('billing records are described only while real invoices can be issued, and the practice flow only while it exists', async () => {
    const billing = 'Billing records';
    const practice = 'The practice payment flow on the billing page is a simulation';
    expect(await text(real)).not.toContain(billing);
    const plans = {
      CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
      CORRIDRA_CUSTOMER_BILLING_ENABLED: 'true',
      CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED: 'true',
    };
    expect(await text({ ...real, ...plans })).not.toContain(billing);
    const invoices = { ...plans, CORRIDRA_CUSTOMER_REAL_INVOICING_ENABLED: 'true' };
    const page = await text({ ...real, ...invoices });
    expect(page).toContain(billing);
    expect(page).toContain('We do not collect card or bank account details through this service.');
    expect(page).not.toContain(practice);
    const practicePage = await text({
      ...real,
      ...invoices,
      CORRIDRA_CUSTOMER_SIMULATED_PAYMENTS_ENABLED: 'true',
    });
    expect(practicePage).toContain(practice);
    expect(practicePage).toContain('(madeup)');
    // The practice flow switch alone describes nothing, and a sample deployment describes neither.
    expect(
      await text({ ...real, CORRIDRA_CUSTOMER_SIMULATED_PAYMENTS_ENABLED: 'true' }),
    ).not.toContain(practice);
    expect(await text({ DATA_ENVIRONMENT: 'synthetic', ...invoices })).not.toContain(billing);
  });
  it('test mode: tells people the code is kept on the device, how to remove it and when it is forgotten', async () => {
    const page = await text({ DATA_ENVIRONMENT: 'synthetic' });
    expect(page).toContain(deviceSentence);
    expect(page).toContain('Forget this request on this device');
    expect(page).toContain('The device forgets it after 30 days.');
    expect(page).toContain('Mission reply emails are not sent.');
    expect(page).not.toContain(emailSentence);
  });
  it('keeps the request notice version the database pins, and the new date', async () => {
    expect(await text(real)).toContain(
      'Updated 25 October 2026. Request notice version: real-intake-2026-10-21-v1.',
    );
    expect(await text({ DATA_ENVIRONMENT: 'synthetic' })).toContain(
      'Updated 25 October 2026. Request notice version: synthetic-intake-2026-10-05-v1.',
    );
  });
  it('names the responsible company, the contact and the standard sections', async () => {
    const page = await text(real);
    expect(page).toContain('Corridra Pte Ltd, 101 Robinson Road, Singapore 180239');
    expect(page).toContain('sadat@obsidianglobal.studio');
    for (const heading of [
      'In short',
      'What we collect and why',
      'Who we share information with',
      'Cookies and browser storage',
      'Where information is stored',
      'Your rights',
      'How we protect information',
      'Children',
    ])
      expect(page).toContain(heading);
    expect(page).toContain('We do not sell personal information');
    expect(page).toContain('Personal Data Protection Commission');
  });
  it('lists the possession cookie only while real use is on, and never claims tracking cookies', async () => {
    const cookie = 'A private cookie carries a possession token for a pending request';
    expect(await text(real)).toContain(cookie);
    expect(await text({ DATA_ENVIRONMENT: 'synthetic' })).not.toContain(cookie);
    for (const env of [real, { DATA_ENVIRONMENT: 'synthetic' }])
      expect(await text(env)).toContain('does not use advertising, analytics or tracking cookies');
  });
  it('uses no dashes as punctuation', async () => {
    for (const env of [
      real,
      { ...real, CORRIDRA_MISSION_EMAIL_ENABLED: 'true' },
      { ...real, CORRIDRA_PULSE_ENABLED: 'true' },
      { DATA_ENVIRONMENT: 'synthetic' },
      { ...real, CORRIDRA_LANGUAGES_FORM: 'true' },
    ])
      expect(await text(env)).not.toMatch(/—|–| - /);
  });
});

describe('notice for the optional confirmation and quote records', () => {
  const enabled = {
    ...real,
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_DELIVERY_ENABLED: 'true',
    CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_SPECIFICATION_CONFIRMATION_ENABLED: 'true',
    CORRIDRA_CUSTOMER_SERVICE_REQUESTS_ENABLED: 'true',
  };
  const arrangements = 'Quote arrangements, for quotes that include them';
  const confirmationsKept =
    'Requirement confirmations cannot be changed or deleted once saved and are kept as part of the request’s history.';
  const arrangementsKept =
    'Quote arrangements cannot be changed or deleted once saved and are kept as part of the request’s history.';
  const updated = 'Updated 30 October 2026. Request notice version: real-intake-2026-10-21-v1.';
  it('names the stored confirmations, parties, terms and private staff costs when available', async () => {
    const page = await text(enabled);
    expect(page).toContain('Requirement confirmations');
    expect(page).toContain('private account identifier');
    expect(page).toContain(arrangements);
    expect(page).toContain('restricted acquisition costs, markup and relationship notes');
    expect(page).toContain('Customers see only the terms disclosed to them.');
    // Both record types reject any change or deletion in the database, and the notice says so.
    expect(page).toContain(confirmationsKept);
    expect(page).toContain(arrangementsKept);
    // Customer words only: nothing a customer cannot check, such as whether a module is installed.
    expect(page).not.toContain('where installed');
    expect(page).toContain(updated);
    expect(page).not.toMatch(/\u2014|\u2013| - /);
  });
  it('leaves each new paragraph out independently while its application gate is closed', async () => {
    const noConfirmation = await text({
      ...enabled,
      CORRIDRA_CUSTOMER_SPECIFICATION_CONFIRMATION_ENABLED: 'false',
    });
    expect(noConfirmation).not.toContain('Requirement confirmations');
    expect(noConfirmation).toContain(arrangements);
    expect(noConfirmation).not.toContain(confirmationsKept);
    expect(noConfirmation).toContain(arrangementsKept);
    expect(noConfirmation).toContain(updated);
    const noArrangements = await text({
      ...enabled,
      CORRIDRA_CUSTOMER_SERVICE_REQUESTS_ENABLED: 'false',
    });
    expect(noArrangements).toContain('Requirement confirmations');
    expect(noArrangements).not.toContain(arrangements);
    expect(noArrangements).toContain(confirmationsKept);
    expect(noArrangements).not.toContain(arrangementsKept);
    expect(noArrangements).toContain(updated);
    const neither = await text({
      ...enabled,
      CORRIDRA_CUSTOMER_SPECIFICATION_CONFIRMATION_ENABLED: 'false',
      CORRIDRA_CUSTOMER_SERVICE_REQUESTS_ENABLED: 'false',
    });
    expect(neither).not.toContain(confirmationsKept);
    expect(neither).not.toContain(arrangementsKept);
    expect(neither).toContain(
      'Updated 25 October 2026. Request notice version: real-intake-2026-10-21-v1.',
    );
  });
  it('does not announce these real record types in sample mode or without workspace access', async () => {
    for (const env of [
      { ...enabled, DATA_ENVIRONMENT: 'synthetic' },
      { ...enabled, CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'false' },
    ]) {
      const page = await text(env);
      expect(page).not.toContain('Requirement confirmations');
      expect(page).not.toContain(arrangements);
      expect(page).not.toContain(confirmationsKept);
      expect(page).not.toContain(arrangementsKept);
      expect(page).toContain('Updated 25 October 2026.');
    }
  });
});

describe('the language sentence follows the request form release', () => {
  const synthetic = { DATA_ENVIRONMENT: 'synthetic' };
  const englishForm =
    'If you choose a language, your browser remembers the choice in local storage. It is not sent to us and you can clear it in your browser settings at any time.';
  const translatedForm =
    'If you choose a language, your browser remembers the choice in local storage. You can clear it in your browser settings at any time. The choice itself is not sent to us. When the request form is shown in your language, your browser downloads that language’s words from our site, so our hosting provider’s records show which language’s words were loaded, as they show any file a browser loads.';
  it('keeps the earlier sentence and date while the request form shows no other language', async () => {
    for (const mode of [real, synthetic])
      for (const release of [
        {},
        ...['', 'false', 'en', 'nonsense'].map((value) => ({ CORRIDRA_LANGUAGES_FORM: value })),
      ]) {
        const page = await text({ ...mode, ...release });
        expect(page).toContain(englishForm);
        expect(page).not.toContain('hosting provider');
        expect(page).toContain('Updated 25 October 2026.');
      }
  });
  it('says the hosting provider sees which language’s words were loaded while any language is released, with the new date', async () => {
    for (const mode of [real, synthetic])
      for (const value of ['bn', 'true', 'es,de']) {
        const page = await text({ ...mode, CORRIDRA_LANGUAGES_FORM: value });
        expect(page).toContain(translatedForm);
        expect(page).not.toContain('It is not sent to us and you can clear it');
        expect(page).toContain('Updated 30 October 2026.');
      }
    expect(await text({ ...real, CORRIDRA_LANGUAGES_FORM: 'bn' })).toContain(
      'Updated 30 October 2026. Request notice version: real-intake-2026-10-21-v1.',
    );
  });
  it('reads only the request form release: releasing the home page words leaves the sentence as it was', async () => {
    const page = await text({ ...real, CORRIDRA_LANGUAGES_PAGES: 'true' });
    expect(page).toContain(englishForm);
    expect(page).not.toContain('hosting provider');
    expect(page).toContain('Updated 25 October 2026.');
  });
});
