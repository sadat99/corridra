import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Visual grammar PR 3 (17 November 2026): the holder is a marker shape. Circle: You. Square: Corridra
// team. Diamond: Workspace owner or admin. Half-disc (a dome, flat edge down): Supplier or Buyer. The
// code value `third` is unchanged and now draws the half-disc; `owner` draws the diamond. The Road
// legend explains all four. Static checks without a browser.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;

const dir = '../../apps/web/components/mr';
const load = async (name: string) => await import(/* @vite-ignore */ `${dir}/${name}`);
const { translate } = (await import('../../apps/web/lib/i18n/messages')) as {
  translate: (locale: string, key: string) => string;
};
const say = (key: string) => translate('en', key);
const source = (path: string) => readFileSync(resolve(path), 'utf8');

const shapes = [
  ['you', 'You', 'mr.explain.holder.you'],
  ['team', 'Corridra team', 'mr.explain.holder.team'],
  ['owner', 'Workspace owner or admin', 'mr.explain.holder.owner'],
  ['third', 'Supplier or Buyer', 'mr.explain.holder.third'],
] as const;

describe('holder badge shapes', () => {
  it('knows four holders, with the owner or admin as its own value', async () => {
    const { holders } = await load('types');
    expect([...holders]).toEqual(['you', 'team', 'owner', 'third']);
  });

  it.each(shapes)('draws %s with its own shape and its visible word', async (holder, word) => {
    const { HolderBadge } = await load('holder-badge');
    const html = renderToStaticMarkup(createElement(HolderBadge, { holder }));
    expect(html).toContain(`data-holder="${holder}"`);
    expect(html).toContain(
      `<i class="mr-holder-shape" data-holder="${holder}" aria-hidden="true">`,
    );
    expect(html).toContain(word);
  });

  it('keeps the shapes distinct in CSS: diamond for owner, true half-disc for third, on currentColor', () => {
    const css = source('apps/web/components/mr/holder-badge.css');
    const rule = (holder: string) =>
      new RegExp(`\\.mr-holder-shape\\[data-holder='${holder}'\\]\\s*\\{([^}]*)\\}`).exec(
        css,
      )?.[1] ?? '';
    expect(rule('owner')).toMatch(/rotate\(45deg\)/);
    expect(rule('third')).not.toMatch(/rotate/);
    expect(rule('you')).toMatch(/border-radius:\s*50%/);
    expect(rule('team')).toMatch(/border-radius:\s*0/);
    // Half-disc geometry: the height is half the width, only the top corners are round, each by half
    // the width, so the top is a semicircle and the bottom edge is flat.
    expect(rule('third')).toMatch(/height:\s*calc\(0\.625rem \/ 2\)/);
    expect(rule('third')).toMatch(
      /border-radius:\s*calc\(0\.625rem \/ 2\) calc\(0\.625rem \/ 2\) 0 0/,
    );
    expect(css).toMatch(/background:\s*currentColor/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });

  it('stays visible in forced colours', () => {
    const css = source('apps/web/components/mr/holder-badge.css');
    const block = /@media \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(block).toContain('forced-color-adjust: none');
    expect(block).toContain('CanvasText');
  });
});

describe('Road legend holder keys', () => {
  it('explains all four holder shapes, each a button named by its word', async () => {
    const { Road } = await load('road');
    const html = renderToStaticMarkup(createElement(Road, { status: 'MEETINGS' }));
    for (const [holder, word, key] of shapes) {
      expect(html).toContain(`<span class="mr-holder-shape" data-holder="${holder}"></span>`);
      expect(html).toContain(`<span class="mr-explain-word">${word}</span>`);
      expect(html).toContain(say(key));
    }
  });

  it('keeps the decorative sample inert: words and shapes, no button for the holders', async () => {
    const { Road } = await load('road');
    const html = renderToStaticMarkup(
      createElement(Road, { status: 'MEETINGS', decorative: true }),
    );
    expect(html).not.toContain('<button');
    for (const [holder, word] of shapes) {
      expect(html).toContain(`data-holder="${holder}"`);
      expect(html).toContain(word);
    }
  });
});

describe('Move page relabel', () => {
  it('no longer maps the diamond to Supplier or Buyer or relabels third as the owner', () => {
    const move = source('apps/web/app/account/move/move-view.tsx');
    expect(move).not.toContain('ownerHolders');
    expect(move).not.toMatch(/third:\s*say\('move\.wait\.owner'\)/);
    expect(move).not.toMatch(/row\.holder === 'team' \? 'team' : 'third'/);
  });
});
