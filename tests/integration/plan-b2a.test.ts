import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fill } from '../../apps/web/lib/i18n/fill';
import { formEn } from '../../apps/web/lib/i18n/form-words/en';
import { englishOnlyMessages } from '../../apps/web/lib/i18n/form-words/messages';
import { wsAEn } from '../../apps/web/lib/i18n/ws/ws-a';

// B2a plan flow (owner decisions of 23 November 2026). The browser cases are in tests/browser/plan-b2a.spec.ts;
// these cover the words and the real-mode contact note, which the sample browser build does not show.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;
const seen = vi.hoisted(() => ({ who: null as 'customer' | 'staff' | null }));
vi.mock('../../apps/web/components/use-signed-in', () => ({ useSignedInSeen: () => seen.who }));
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const render = (type: unknown, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(type, props));
const words = formEn as Record<string, string>;

describe('D-001: no customer-readable "draft" in the request form words', () => {
  it('has no English form word that says draft', () => {
    const found = Object.entries(words).filter(([, value]) => /draft/i.test(value));
    expect(found).toEqual([]);
  });

  it('has no English-only message that says draft', () => {
    expect(Object.keys(englishOnlyMessages).filter((text) => /draft/i.test(text))).toEqual([]);
  });

  it('says the plain facts instead', () => {
    // The summary note is a privacy sentence, so it stays English in every language and is not a form word.
    expect(words['form.side.draftOnly']).toBeUndefined();
    expect(readFileSync(resolve('apps/web/app/plan/intake.tsx'), 'utf8')).toContain(
      "'Nothing is sent until you check it. Nothing here is an offer, a quote or a promise.'",
    );
    expect(words['form.message.draftResumed']).toBe(
      'Your earlier answers from this tab are back. Your saved choices take precedence over link suggestions.',
    );
    expect(words['form.action.clearDraft']).toBe('Clear Answers');
  });

  it('writes no draft sentence in the form itself', () => {
    const source = readFileSync(resolve('apps/web/app/plan/intake.tsx'), 'utf8');
    expect(source).not.toMatch(/['"`>][^'"`<>\n]*\bDrafts? (only|expire)/);
  });
});

describe('D-008: the step line is one template', () => {
  it('fills "Step N of M: Name · Next: Name" and the last step without a next', () => {
    expect(fill(words['form.step.line']!, { step: 1, total: 5, name: 'Goal', next: 'Where' })).toBe(
      'Step 1 of 5: Goal · Next: Where',
    );
    expect(fill(words['form.step.lineLast']!, { step: 5, total: 5, name: 'Contact' })).toBe(
      'Step 5 of 5: Contact',
    );
  });

  it('keeps the signed-in sentence of the heading in the form words', async () => {
    expect(words['form.head.signedInLead']).toBe(
      'You are signed in, so your request and its replies stay private in your account.',
    );
    const source = readFileSync(resolve('apps/web/app/plan/plan-head.tsx'), 'utf8');
    expect(source).not.toContain('You are signed in, so');
    const { PlanHead } = await load('app/plan/plan-head');
    seen.who = 'customer';
    expect(render(PlanHead, { realMode: true })).toContain(
      'Start with your objective. You are signed in, so your request and its replies stay private in your account.',
    );
    seen.who = null;
  });
});

describe('D-011: one required marker', () => {
  it('is the lowercase word the kit uses', () => {
    expect(wsAEn['wsa.plan.required']).toBe('required');
  });
});

describe('D-007: the contact step does not ask an active account to activate', () => {
  const activate = 'Activate your account to submit it and read replies privately.';
  const sending = 'We review your request and propose next steps.';

  it('shows only the sending sentence to a signed-in, verified person', async () => {
    const { PlanContactNote } = await load('app/plan/plan-contact-note');
    const html = render(PlanContactNote, {
      realMode: true,
      account: { email: 'person@example.com', emailVerified: true },
    });
    expect(html).toContain(sending);
    expect(html).not.toContain('Activate');
  });

  it('still says to activate when the account is not verified or nobody is signed in', async () => {
    const { PlanContactNote } = await load('app/plan/plan-contact-note');
    for (const account of [null, { email: 'person@example.com', emailVerified: false }]) {
      const html = render(PlanContactNote, { realMode: true, account });
      expect(html).toContain(`${sending} ${activate}`);
    }
  });

  it('keeps the sample sentence in the sample form', async () => {
    const { PlanContactNote } = await load('app/plan/plan-contact-note');
    expect(render(PlanContactNote, { realMode: false, account: null })).toContain(
      words['form.contact.sampleHint'],
    );
  });
});
