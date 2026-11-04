import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cardFromAnswer,
  tokenFromHash,
  unavailableWords,
} from '../../apps/web/lib/decision-card-page';

// Revamp Wave 4, spec docs/revamp/specs/decision-card-ui.md, the public page: D-03, D-04, D-05.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...c: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

const token = 'A'.repeat(43);
const open = {
  state: 'OPEN',
  card: {
    company: 'Lantern Cutting Works',
    decision: 'SELECT',
    rationale: 'Best fit for the declared product',
    nextAction: 'Send the purchase order',
    dueAt: '2026-12-01',
    provenance: { sourceKind: 'self_declaration', claimStatus: 'self_declared' },
  },
  expiresAt: '2026-11-10T10:00:00.000Z',
  synthetic: true,
};

describe('the link in the address', () => {
  it('takes only a 43-character link token from the fragment', () => {
    expect(tokenFromHash(`#${token}`)).toBe(token);
    for (const bad of ['', '#', '#short', `#${token}x`, `#${'A'.repeat(42)}!`, `${token}`, '#a b'])
      expect(tokenFromHash(bad), bad).toBeNull();
  });
});

describe('what the page shows', () => {
  it('reads only the six fields from an open answer', () => {
    const card = cardFromAnswer({
      ...open,
      card: {
        ...open.card,
        price: '987654321',
        email: 'buyer@example.com',
        file: 'quote.pdf',
        secondDecision: { decision: 'DECLINE' },
      },
      quotations: [{ unitPriceMinor: '1' }],
    });
    expect(card).toEqual({ ...open.card });
  });
  it.each([
    ['unknown answer', { state: 'unknown' }],
    ['empty object', {}],
    ['null', null],
    ['text', 'OPEN'],
    ['open without a card', { state: 'OPEN' }],
    ['open with a missing field', { state: 'OPEN', card: { ...open.card, rationale: undefined } }],
    ['open with a number field', { state: 'OPEN', card: { ...open.card, decision: 3 } }],
    ['an error body', { error: 'Too many requests. Try again in an hour.' }],
  ])('treats %s as not available', (_name, answer) => {
    expect(cardFromAnswer(answer)).toBeNull();
  });
});

describe('D-03 every answer that is not an open card shows the same words', () => {
  it('renders byte-identical text for unknown, random-token, malformed, error and switch-off answers', async () => {
    const { DecisionCardPage } = await loadWeb('app/decision-card/decision-card-page');
    const page = (state: unknown) => render(ce(DecisionCardPage, { state }));
    const unavailable = page({ kind: 'unavailable' });
    expect(unavailable).toContain('This link is not available.');
    expect(unavailableWords).toBe('This link is not available.');
    // Whatever the answer was, the page the visitor gets is the same one.
    for (const answer of [{ state: 'unknown' }, {}, null, { error: 'x' }, 'OPEN'])
      expect(cardFromAnswer(answer) === null ? page({ kind: 'unavailable' }) : '').toBe(
        unavailable,
      );
    // And it names nothing: no company, decision, date or reason.
    expect(unavailable).not.toMatch(/expired|withdrawn|switch|module|rate|token|limit/i);
  });
});

describe('D-05 the page shows the six fields and nothing else', () => {
  it('renders company, decision, rationale, next action, due date and one provenance label', async () => {
    const { DecisionCardPage } = await loadWeb('app/decision-card/decision-card-page');
    const card = cardFromAnswer(open)!;
    const html = render(ce(DecisionCardPage, { state: { kind: 'open', card } }));
    for (const text of [
      'Lantern Cutting Works',
      'Best fit for the declared product',
      'Send the purchase order',
      '1 Dec 2026',
      'Self-declared',
    ])
      expect(html, text).toContain(text);
    expect(html).toMatch(/Select|Selected/);
    // Seeded private values never come near the page.
    const dirty = cardFromAnswer({
      ...open,
      card: { ...open.card, price: '987654321', email: 'buyer@example.com' },
    })!;
    const dirtyHtml = render(ce(DecisionCardPage, { state: { kind: 'open', card: dirty } }));
    expect(dirtyHtml).toBe(html);
    expect(dirtyHtml).not.toMatch(/987654321|buyer@example|quote\.pdf|DECLINE/);
    // Nothing actionable: no form, no button, no input, no link.
    expect(html).not.toMatch(/<(form|button|input|textarea|select|a )\b/i);
  });
  it('shows a loading note while the link is checked, and nothing about the card', async () => {
    const { DecisionCardPage } = await loadWeb('app/decision-card/decision-card-page');
    const html = render(ce(DecisionCardPage, { state: { kind: 'loading' } }));
    expect(html).toContain('role="status"');
    expect(html).not.toContain('This link is not available.');
  });
});

describe('D-04 the page asks not to be indexed or referred', () => {
  const page = readFileSync('apps/web/app/decision-card/page.tsx', 'utf8');
  it('sets noindex, no-referrer and a dynamic render', () => {
    expect(page).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false/);
    expect(page).toContain("referrer: 'no-referrer'");
    expect(page).toContain("export const dynamic = 'force-dynamic'");
  });
});

describe('D-02 the token goes only in a POST body', () => {
  const client = readFileSync('apps/web/app/decision-card/decision-card-view.tsx', 'utf8');
  it('removes the fragment, posts without cookies and stores nothing', () => {
    expect(client).toContain('history.replaceState');
    expect(client).toContain("method: 'POST'");
    expect(client).toContain("credentials: 'omit'");
    expect(client).toContain("referrerPolicy: 'no-referrer'");
    expect(client).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
    expect(client).not.toMatch(/\?token=|\$\{token\}|\+ token/);
    // The replaceState runs before the request is sent.
    expect(client.indexOf('history.replaceState')).toBeLessThan(client.indexOf('fetch('));
  });
});
