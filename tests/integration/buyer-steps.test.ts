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
            `tests/integration/fixtures/buyer-steps-off/${name}-${language}.markup`,
          );
          if (process.env.UPDATE_GOLDEN === '1' && flag === 'omitted') writeFileSync(file, html);
          expect(existsSync(file)).toBe(true);
          expect(html).toBe(readFileSync(file, 'utf8'));
        });
});

describe('with the switch on the reply journey draws the steps', () => {
  const newKeys = [
    'stepNamed',
    'stepNext',
    'stepCheckSend',
    'interestedFull',
    'needInfoFull',
    'notRelevantFull',
  ] as const;
  // The owner ruled one word out of this unit (UI/UX.v4 language row); it is spelled in parts so this file never holds it.
  const ruledOut = new RegExp(['d', 'raft'].join(''), 'i');
  const claim = 'Operator-reported context. No independent verification is asserted.';
  const draw = async (language: 'en' | 'zh', data: Record<string, unknown>) => {
    const { ReplyJourney } = (await loadWeb('app/buyer/reply-journey')) as {
      ReplyJourney: unknown;
    };
    return render(
      ce(ReplyJourney, {
        data,
        pending: null,
        declined: false,
        token: 'a'.repeat(64),
        language,
        beforeSend: true,
        steps: true,
        ask: [],
        busy: false,
        optOut: false,
        onOptOut: () => {},
        onRespond: () => {},
        onStop: () => {},
        onAccessDenied: () => {},
      }),
    );
  };

  it('the new words exist in English and Chinese, without a dash, Bangla or the word for an unfinished text', async () => {
    const { replyWords } = (await loadWeb('lib/reply-words')) as {
      replyWords: Record<'en' | 'zh', Record<string, string>>;
    };
    expect(replyWords.en.stepAnswer).toBe('Your answer');
    expect(replyWords.zh.stepAnswer).toBe('您的回答');
    expect(newKeys.map((key) => replyWords.en[key])).toEqual([
      'Step {n} of {total}: {name}',
      'Next: {name}',
      'Check and send',
      'Yes, Interested',
      'I Need More Information',
      'Not Relevant',
    ]);
    expect(newKeys.map((key) => replyWords.zh[key])).toEqual([
      '第 {n} 步，共 {total} 步：{name}',
      '下一步：{name}',
      '检查并发送',
      '是的，有兴趣',
      '我需要更多信息',
      '不相关',
    ]);
    for (const key of newKeys)
      for (const language of ['en', 'zh'] as const) {
        expect(replyWords[language][key]).not.toMatch(/[—–]/);
        expect(replyWords[language][key]).not.toMatch(ruledOut);
        expect(replyWords[language][key]).not.toMatch(/[ঀ-৿]/);
      }
  });

  it('English: the named step line, full-word answers and the claim sentence once', async () => {
    const html = await draw('en', {
      ...base,
      sharedRequirements: 'Plain trims for a spring line.',
    });
    expect(html).toContain('data-steps=""');
    expect(html).toContain('Step 1 of 3: Your answer · Next: Your message');
    for (const words of ['Yes, Interested', 'I Need More Information', 'Not Relevant'])
      expect(html).toContain(`<span>${words}</span>`);
    expect(html).toContain('ux-choice-row');
    expect(html.split(claim)).toHaveLength(2);
    expect(html).toContain('Why there may be a fit');
    expect(html).not.toContain('reply-shared');
    expect(html).not.toMatch(/[—–]/);
    // With no message to follow, the answer is the only step.
    expect(await draw('en', base)).toContain('Step 1 of 1: Your answer</p>');
  });

  it('Chinese: the step line and the answers in Chinese, no Bangla and no dash', async () => {
    const html = await draw('zh', {
      ...base,
      sharedRequirements: 'Plain trims for a spring line.',
    });
    expect(html).toContain('data-steps=""');
    expect(html).toContain('第 1 步，共 3 步：您的回答 · 下一步：您的留言');
    for (const words of ['是的，有兴趣', '我需要更多信息', '不相关'])
      expect(html).toContain(`<span>${words}</span>`);
    expect(html).not.toMatch(/[ঀ-৿]/);
    expect(html).not.toMatch(/[—–]/);
  });

  it('the message step names the check step next', async () => {
    const html = await draw('en', states.message.data);
    expect(html).toContain('Step 2 of 3: Your message · Next: Check and send');
  });
});
