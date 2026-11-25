import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// The shared quiet re-verify line: one sentence naming what waits, and one button that opens the in-place check.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (t: unknown, p?: unknown) => unknown;
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
