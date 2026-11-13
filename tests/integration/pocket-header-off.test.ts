import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// Pocket (phone): with the switch off the customer header is byte for byte what main draws, and with it on the only
// addition is the page title mirror, which takes the slot the customer header already left empty so no generated id
// (useId encodes position) moves. The team and contributor headers are pinned separately in revamp-app-header-guard.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  t: unknown,
  p?: unknown,
  ...c: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (e: unknown) => string;

async function render(extra: Record<string, unknown>) {
  const path = '../../apps/web/components/ux/app-header';
  const { AppHeader } = await import(/* @vite-ignore */ path);
  return renderToStaticMarkup(
    createElement(AppHeader, { kind: 'customer', live: false, notifications: true, ...extra }),
  );
}

describe('the customer header and the Pocket switch', () => {
  test('off is exactly the header without the switch', async () => {
    const plain = await render({});
    expect(await render({ pocket: false })).toBe(plain);
    expect(plain).not.toMatch(/pocket/i);
  });

  test('on adds only the page title mirror, hidden from assistive technology', async () => {
    const plain = await render({});
    const on = await render({ pocket: true });
    expect(on).toContain('<span class="ux-pocket-title" aria-hidden="true"></span>');
    expect(on.replace('<span class="ux-pocket-title" aria-hidden="true"></span>', '')).toBe(plain);
  });

  test('the header keeps every control it had: nothing is removed from the markup', async () => {
    const on = await render({ pocket: true });
    for (const kept of [
      'class="brand"',
      'ux-bar-new-narrow',
      'ux-csearch-trigger',
      'ux-util-help',
      'ux-util-avatar',
      'ux-bar-inbox',
    ])
      expect(on, kept).toContain(kept);
  });
});
