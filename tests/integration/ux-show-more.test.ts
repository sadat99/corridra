import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The shared show-more list (layout budget, page length: lists fold after a fixed count and nothing is
// removed). The browser behaviour is in tests/ux/show-more.spec.ts.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToString = web('react-dom/server').renderToString as (element: unknown) => string;
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

const items = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    createElement('li', { key: index }, `Item ${index + 1}`),
  );

describe('the show-more list on the server', async () => {
  const { ShowMoreList } = await loadWeb('components/ux/show-more');
  const render = (count: number, limit = 4) =>
    renderToString(
      createElement(
        ShowMoreList,
        { limit, noun: 'open gaps', className: 'cards' },
        ...items(count),
      ),
    );

  it('keeps every item in the HTML and hides all after the limit', () => {
    const html = render(11);
    for (let n = 1; n <= 11; n++) expect(html).toContain(`Item ${n}`);
    expect(html.match(/<li/g)).toHaveLength(11);
    expect(html.match(/<li hidden=""/g)).toHaveLength(7);
  });

  it('offers "Show all N" naming the count and the noun, tied to the list', () => {
    const html = render(11);
    expect(html).toContain('Show all 11 open gaps');
    expect(html).toContain('aria-expanded="false"');
    const controls = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controls).toBeTruthy();
    expect(html).toContain(`id="${controls}"`);
    expect(html).toContain('class="ux-showmore cards"');
  });

  it('shows no button and hides nothing when the list is within the limit', () => {
    for (const count of [0, 1, 4]) {
      const html = render(count);
      expect(html).not.toContain('Show all');
      expect(html).not.toContain('hidden');
    }
  });

  it('folds from the first item past the limit exactly', () => {
    const html = render(5);
    expect(html.match(/<li hidden=""/g)).toHaveLength(1);
    expect(html).toContain('Show all 5 open gaps');
  });
});
