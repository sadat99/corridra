import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The notice a person sees when this browser holds a saved request that is not sent yet. It must say
// only what is true today: saved for 24 hours, sent from this device and browser, nothing sent yet.
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
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) =>
    createElement('a', { href }, children as never),
}));
// The module is a TSX file; the package type check has no JSX setting, so it is loaded by path.
const modulePath = '../../apps/web/components/pending-request-notice';
const load = async () => await import(/* @vite-ignore */ modulePath);
const wheres = ['verify', 'signin', 'signup', 'account'] as const;
const words = (sentence: string) => sentence.split(/\s+/).filter(Boolean).length;

describe('the saved request notice', () => {
  it('says plainly that nothing is sent yet and that it is kept for 24 hours', async () => {
    const { pendingNoticeText } = await load();
    for (const where of wheres) {
      const text = pendingNoticeText(where).join(' ');
      expect(text, where).toContain('has not been sent yet');
      expect(text, where).toContain('24 hours');
    }
  });

  it('names the device and browser wherever a person must come back to finish', async () => {
    const { pendingNoticeText } = await load();
    for (const where of ['verify', 'signin', 'signup', 'account'] as const)
      expect(pendingNoticeText(where).join(' '), where).toContain('this device and browser');
  });

  it('promises nothing about other devices or a longer time', async () => {
    const { pendingNoticeText } = await load();
    for (const where of wheres) {
      const text = pendingNoticeText(where).join(' ').toLowerCase();
      expect(text, where).not.toMatch(/any device|another device|other device|days|week|forever/);
    }
  });

  it('uses short sentences, plain words and no dashes', async () => {
    const { pendingNoticeText } = await load();
    for (const where of wheres) {
      for (const sentence of pendingNoticeText(where)) {
        expect(words(sentence), sentence).toBeLessThanOrEqual(20);
        expect(sentence, sentence).not.toMatch(/—|–| - /);
        expect(sentence.toLowerCase(), sentence).not.toMatch(/synthetic|invented|handoff|token/);
      }
    }
  });

  it('adds one link, to the request page, only on the account page', async () => {
    const { PendingRequestMessage } = await load();
    for (const where of wheres) {
      const html = renderToStaticMarkup(createElement(PendingRequestMessage, { where }));
      const links = html.match(/<a /g) ?? [];
      if (where === 'account') {
        expect(links, where).toHaveLength(1);
        expect(html, where).toContain('href="/plan"');
        expect(html, where).toContain('Open your request');
      } else expect(links, where).toHaveLength(0);
    }
  });

  it('is placed on sign-in, sign-up, verify and the account page, never on reset screens', () => {
    const access = readFileSync(resolve('apps/web/components/account-access.tsx'), 'utf8');
    expect(access).toContain("(mode === 'signin' || mode === 'signup' || mode === 'verify')");
    expect(access).toContain('<PendingRequestNotice where={mode} />');
    expect((access.match(/<PendingRequestNotice/g) ?? []).length).toBe(1);
    const account = readFileSync(resolve('apps/web/app/account/page.tsx'), 'utf8');
    expect(account).toContain('<PendingRequestNotice where="account" />');
    expect(account).toContain('<PendingRequestNotice where="verify" />');
  });

  it('the request page panel tells people to finish in the same device and browser', () => {
    const plan = readFileSync(resolve('apps/web/app/plan/intake.tsx'), 'utf8');
    expect(plan.replace(/\s+/g, ' ')).toContain(
      'saved privately for 24 hours while you activate your account and sign in. Use this same device and browser.',
    );
  });
});
