import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { switchRegistry } from '../../apps/web/lib/owner-switches';
import { uxSwitchNames, uxSwitchOn } from '../../apps/web/lib/ux-switches';

// Wave 3 unit 08 (owner approved 20 November 2026): the Buyer reply in steps. Presentation only. This file locks the
// switch (off unless exactly "true") and, switch off, the exact markup the reply journey drew before the change. The
// golden files were captured from main (42bb5d0) before any render change; set UPDATE_GOLDEN=1 only to re-capture
// on a commit that is known to match main.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

const introduction = {
  company: 'Example Trims Limited',
  country: 'Bangladesh',
  capability: 'Plain trims',
  fit: 'Spring line',
  uncertainty: 'None stated',
  conversationPurpose: 'Introduction',
};
const base = {
  introduction,
  template: 'An introduction from the team.',
  expiresAt: '2026-12-17T09:00:00.000Z',
  decision: null,
  synthetic: true,
};
const states = {
  answer: { data: base, pending: null, declined: false },
  pending: { data: base, pending: 'INTERESTED', declined: false },
  declined: { data: base, pending: null, declined: true },
  message: {
    data: { ...base, decision: 'INTERESTED', sharedRequirements: 'Plain trims for a spring line.' },
    pending: null,
    declined: false,
  },
  receipt: {
    data: {
      ...base,
      decision: 'INTERESTED',
      sharedRequirements: 'Plain trims for a spring line.',
      detailResponse: { body: { message: 'We can supply this.' }, sourceKind: 'self_declared' },
    },
    pending: null,
    declined: false,
  },
} as const;

describe('the switch', () => {
  it('registers CORRIDRA_UX_BUYER_STEPS, described, off unless exactly true', () => {
    expect(uxSwitchNames).toContain('CORRIDRA_UX_BUYER_STEPS');
    const entry = switchRegistry.find((s) => s.name === 'CORRIDRA_UX_BUYER_STEPS');
    expect(entry?.line).toMatch(/Off by default/);
    expect(entry?.kind).toBe('flag');
    expect(uxSwitchOn('CORRIDRA_UX_BUYER_STEPS', {})).toBe(false);
    expect(uxSwitchOn('CORRIDRA_UX_BUYER_STEPS', { CORRIDRA_UX_BUYER_STEPS: '1' })).toBe(false);
    expect(uxSwitchOn('CORRIDRA_UX_BUYER_STEPS', { CORRIDRA_UX_BUYER_STEPS: 'true' })).toBe(true);
    expect(read('apps/web/app/buyer/page.tsx')).toContain("uxSwitchOn('CORRIDRA_UX_BUYER_STEPS')");
  });
});

describe('with the switch off the reply journey draws what it drew on main', () => {
  // The receipt prints when it was recorded, so the clock is fixed for the markup to be repeatable.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());
  for (const language of ['en', 'zh'] as const)
    for (const [name, state] of Object.entries(states))
      for (const flag of ['omitted', 'false'] as const)
        it(`${name} in ${language} (steps ${flag})`, async () => {
          const { ReplyJourney } = (await loadWeb('app/buyer/reply-journey')) as {
            ReplyJourney: unknown;
          };
          const props = {
            ...state,
            token: 'a'.repeat(64),
            language,
            beforeSend: false,
            ask: [],
            busy: false,
            optOut: false,
            onOptOut: () => {},
            onRespond: () => {},
            onStop: () => {},
            onAccessDenied: () => {},
            ...(flag === 'false' ? { steps: false } : {}),
          };
          const html = render(ce(ReplyJourney, props));
          expect(html).not.toContain('data-steps');
          expect(html).not.toContain('ux-choice');
          const file = resolve(
            `tests/integration/fixtures/buyer-steps-off/${name}-${language}.html`,
          );
          if (process.env.UPDATE_GOLDEN === '1' && flag === 'omitted') writeFileSync(file, html);
          expect(existsSync(file)).toBe(true);
          expect(html).toBe(readFileSync(file, 'utf8'));
        });
});
