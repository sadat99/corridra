import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// The shared quiet re-verify line: one sentence naming what waits, and one button that opens the in-place check.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  t: unknown,
  p?: unknown,
  ...c: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (e: unknown) => string;

// The path is held in a variable so the root type check does not follow a .tsx file (it has no JSX setting).
const path = '../../apps/web/components/ux/reverify-line';

describe('ReverifyLine', () => {
  test('says what is waiting and offers the check, as a status line and not an error', async () => {
    const { ReverifyLine } = await import(/* @vite-ignore */ path);
    const html = renderToStaticMarkup(
      createElement(ReverifyLine, { what: 'erasure requests', onVerified: () => undefined }),
    );
    expect(html).toContain('Confirm your code to see erasure requests.');
    expect(html).toContain('role="status"');
    expect(html).toContain('Confirm Code</button>');
    expect(html).toContain('type="button"');
    expect(html).not.toContain('role="alert"');
  });
});

// The group of billing reads: while the first read (the probe) has not answered, only the probe reads, so a lapsed
// check costs one refused request. A panel mounted alone is never held back.
describe('StepUpReads', () => {
  const reads = '../../apps/web/components/ux/step-up-reads';
  async function load() {
    return (await import(/* @vite-ignore */ reads)) as {
      StepUpReads: unknown;
      useStepUpRead: (probe?: boolean) => { allowed: boolean; epoch: number };
      refusedForCheck: (response: Response) => Promise<boolean>;
    };
  }
  test('while probing only the probe may read; alone every panel may', async () => {
    const { StepUpReads, useStepUpRead } = await load();
    const Panel = ({ name, probe }: { name: string; probe?: boolean }) =>
      createElement('i', { 'data-name': name }, String(useStepUpRead(probe).allowed));
    const html = renderToStaticMarkup(
      createElement(
        StepUpReads,
        { what: 'plans' },
        createElement(Panel, { name: 'probe', probe: true }),
        createElement(Panel, { name: 'other' }),
      ),
    );
    expect(html).toContain('<i data-name="probe">true</i>');
    expect(html).toContain('<i data-name="other">false</i>');
    expect(html).not.toContain('Confirm your code');
    const alone = renderToStaticMarkup(createElement(Panel, { name: 'alone' }));
    expect(alone).toContain('>true<');
  });
  test('only a 401 with STEP_UP_REQUIRED counts as a refusal for the check', async () => {
    const { refusedForCheck } = await load();
    const answer = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status });
    expect(await refusedForCheck(answer(401, { code: 'STEP_UP_REQUIRED' }))).toBe(true);
    expect(await refusedForCheck(answer(401, { error: 'Sign in to continue' }))).toBe(false);
    expect(await refusedForCheck(answer(403, { code: 'STEP_UP_REQUIRED' }))).toBe(false);
    expect(await refusedForCheck(new Response('not json', { status: 401 }))).toBe(false);
  });
});
