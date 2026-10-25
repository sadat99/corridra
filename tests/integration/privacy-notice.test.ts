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
    'CORRIDRA_CUSTOMER_BILLING_ENABLED',
    'CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED',
    'CORRIDRA_CUSTOMER_REAL_INVOICING_ENABLED',
    'CORRIDRA_CUSTOMER_SIMULATED_PAYMENTS_ENABLED',
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
    'CORRIDRA_CUSTOMER_BILLING_ENABLED',
    'CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED',
    'CORRIDRA_CUSTOMER_REAL_INVOICING_ENABLED',
    'CORRIDRA_CUSTOMER_SIMULATED_PAYMENTS_ENABLED',
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
    ])
      expect(await text(env)).not.toMatch(/—|–| - /);
  });
});
