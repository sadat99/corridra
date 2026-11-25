import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { catalogs, en, translate } from '../../apps/web/lib/i18n/messages';
import { localeCodes as locales } from '../../apps/web/lib/i18n/locales';

// Home page v4.2 words (owner, 25 Nov 2026: "Bangladesh buys from China", "Bangladesh sells to EU, UK, US,
// Australia", "Plain Limits(black)"; remove "Key Asian Markets" from the Sell Abroad route line and the route status
// card, keep it in the hero sentence). Guardian decision B2: each route sentence is one whole template with {from}
// and {to} slots, so every language keeps its own word order; the places are their own keys with their flags. Native
// review is not recorded for the six languages (docs/product/language-review-record.md).
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: unknown; href: string }) =>
    createElement('a', { href, ...rest, children }),
}));

const newKeys = ['home.v42.line.buys', 'home.v42.line.sells', 'home.v42.not.eyebrow'] as const;
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('the v4.2 words', () => {
  it('are the owner-approved English sentences and eyebrow', () => {
    expect(en['home.v42.line.buys']).toBe('{from} buys from {to}');
    expect(en['home.v42.line.sells']).toBe('{from} sells to {to}');
    expect(en['home.v42.not.eyebrow']).toBe('Plain limits');
  });

  it('exist in all six other languages, each sentence with exactly one {from} and one {to} and nothing else', () => {
    const others = locales.filter((l) => l !== 'en');
    expect(others.sort()).toEqual(['ar', 'bn', 'de', 'es', 'fr', 'zh']);
    for (const locale of others) {
      const words = catalogs[locale] as Record<string, string | undefined>;
      for (const name of newKeys) {
        const value = words[name];
        expect(value, `${locale} ${name}`).toBeTruthy();
        expect(value).not.toMatch(/Key Asian|Asia/i);
        const slots = value!.match(/\{[a-z]+\}/g) ?? [];
        expect(slots.sort(), `${locale} ${name}`).toEqual(
          name === 'home.v42.not.eyebrow' ? [] : ['{from}', '{to}'],
        );
      }
    }
  });

  it('name no place inside a sentence: Bangladesh and the places come from their own keys', () => {
    for (const locale of locales)
      for (const name of ['home.v42.line.buys', 'home.v42.line.sells'] as const)
        expect(translate(locale, name)).not.toMatch(/Bangladesh|China|EU|UK|US|Australia/);
  });
});

describe('the route lines', () => {
  it('leave Key Asian Markets out of the Sell line only where v4.2 asks; left out, every market shows', async () => {
    const { RouteLine } = await import('../../apps/web/components/home-route-line');
    const all = renderToStaticMarkup(createElement(RouteLine, { route: 'sell' }));
    const trimmed = renderToStaticMarkup(
      createElement(RouteLine, { route: 'sell', markets: 'noKeyAsian' }),
    );
    expect(text(all)).toContain('Key Asian Markets');
    expect(all).toContain('ux-region-mark');
    expect(text(trimmed)).not.toMatch(/Key Asian|Asia/);
    expect(trimmed).not.toContain('ux-region-mark');
    for (const place of ['EU', 'UK', 'US', 'Australia']) expect(text(trimmed)).toContain(place);
    expect(renderToStaticMarkup(createElement(RouteLine, { route: 'sell', markets: 'all' }))).toBe(
      all,
    );
  });

  it('read "Bangladesh buys from China" and "Bangladesh sells to EU, UK, US, Australia" in the two big doors', async () => {
    const { HomeV42Choice } = await import('../../apps/web/components/home-v42-choice');
    const html = renderToStaticMarkup(
      createElement(HomeV42Choice, {
        shown: 'none',
        opened: null,
        href: '/plan',
        cta: 'Start a Request',
        whatsapp: null,
        onChoose: () => undefined,
      }),
    );
    const lines = [
      ...html.matchAll(/<span class="hv42-line[^"]*">([\s\S]*?)<\/span><\/span><\/span>/g),
    ];
    expect(lines).toHaveLength(2);
    expect(text(lines[0]![1]!)).toBe('Bangladesh buys from China');
    expect(text(lines[1]![1]!)).toBe('Bangladesh sells to EU , UK , US , Australia');
    expect([...html.matchAll(/src="(\/flags\/\w+\.svg)"/g)].map((m) => m[1])).toEqual([
      '/flags/bd.svg',
      '/flags/cn.svg',
      '/flags/bd.svg',
      '/flags/eu.svg',
      '/flags/gb.svg',
      '/flags/us.svg',
      '/flags/au.svg',
    ]);
    expect(text(html)).not.toMatch(/Key Asian/);
    expect(html.match(/id="home-start"/g)).toHaveLength(1);
  });

  it('name the hero route map from live words only, without Key Asian Markets', async () => {
    const { HomeV42Hero } = await import('../../apps/web/components/home-v42-hero');
    const html = renderToStaticMarkup(createElement(HomeV42Hero));
    const name = [
      en['home.country.bd'],
      en['home.b3.to'],
      [
        'home.country.cn',
        'home.tr.mk.eu.to',
        'home.tr.mk.gb.to',
        'home.tr.mk.us.to',
        'home.tr.mk.au.to',
      ]
        .map((k) => en[k as keyof typeof en])
        .join(', '),
    ].join(' ');
    expect(html).toContain(`aria-label="${name}"`);
    expect(name).toBe('Bangladesh to China, the EU, the UK, the US, Australia');
    // The hero sentence keeps key Asian markets; the map does not draw it.
    expect(text(html)).toContain('key Asian markets');
    expect(html.slice(html.indexOf('<figure'))).not.toMatch(/Asia|region-mark/);
  });

  it('add no Key Asian string to any new v4.2 file', () => {
    for (const file of [
      'home-v42.tsx',
      'home-v42-hero.tsx',
      'home-v42-choice.tsx',
      'home-v42-parts.tsx',
      'home-v42.css',
    ])
      expect(readFileSync(resolve('apps/web/components', file), 'utf8')).not.toMatch(/Key Asian/i);
  });
});
