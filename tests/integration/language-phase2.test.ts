import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { displayDate, displayMoney, interfaceLocales } from '../../packages/domain/src/locale';
import { localeCodes, localeMeta, offeredLanguages } from '../../apps/web/lib/i18n/locales';

// Language, phase 2 (Lane 2 of the UX update, ADR-0066): the interface language list is tied to what
// the date and money formatters accept, the teaching-layer words come from the message module in
// every language, and with both language settings unset nothing changes from main.
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
  default: ({
    children,
    href,
    className,
  }: {
    children: unknown;
    href: string;
    className?: string;
  }) => createElement('a', { href, className }, children as never),
}));

const dir = '../../apps/web/components';
const load = async (name: string) => await import(/* @vite-ignore */ `${dir}/${name}`);
const render = (type: unknown, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(type, props));

describe('the interface languages and the formatters', () => {
  it.each(localeCodes)('%s is accepted by displayDate and displayMoney', (code) => {
    const tag = localeMeta[code].html;
    expect(() => new Intl.Locale(tag)).not.toThrow();
    const when = displayDate('2026-10-24T09:30:00Z', 'Asia/Dhaka', tag);
    expect(when).toContain('(Asia/Dhaka)');
    expect(when.length).toBeGreaterThan(8);
    const price = displayMoney('123456', 'USD', tag);
    expect(price).toMatch(/USD/);
    expect(price.length).toBeGreaterThan(4);
  });

  it('keeps the exact amount in every language: no digit is lost or rounded', () => {
    for (const code of localeCodes) {
      const tag = localeMeta[code].html;
      // The ten numerals this language uses, so the shown digits can be read back as 0 to 9.
      const numerals = new Intl.NumberFormat(tag, { useGrouping: false });
      const value = new Map<string, string>();
      for (let digit = 0; digit < 10; digit += 1) value.set(numerals.format(digit), String(digit));
      const read = [...displayMoney('123456', 'USD', tag)]
        .filter((char) => value.has(char))
        .map((char) => value.get(char))
        .join('');
      // 123456 minor units of a two-place currency read back as 1234.56, digit for digit.
      expect(read, tag).toBe('123456');
    }
  });

  it('the older domain list of interface locales is a subset of the real list', () => {
    for (const code of interfaceLocales) expect(localeCodes).toContain(code);
  });
});

describe('the teaching layer takes its words from the message module', () => {
  it.each(localeCodes)(
    '%s has every word, no empty one, and keeps the sentence pattern',
    async (code) => {
      const { mrLabelsFor } = await load('mr/labels');
      const labels = mrLabelsFor(code);
      const strings: string[] = [];
      const walk = (value: unknown) => {
        if (typeof value === 'string') strings.push(value);
        else if (value && typeof value === 'object') Object.values(value).forEach(walk);
      };
      walk(labels);
      expect(strings.length).toBeGreaterThan(40);
      for (const text of strings) expect(text.trim()).not.toBe('');
      expect(labels.move.phrase).toContain('{verb}');
      expect(labels.move.phrase).toContain('{object}');
      expect(Object.keys(labels.road.sublines)).toHaveLength(9);
    },
  );

  it('keeps the five trust words for the holders: you, the team and the other side', async () => {
    const { mrLabelsFor } = await load('mr/labels');
    for (const code of localeCodes) {
      const { holder } = mrLabelsFor(code);
      expect(new Set(Object.values(holder)).size).toBe(3);
      expect(holder.team, code).toMatch(/corridra/i);
    }
  });

  it('the Move sentence follows each language: the object first in Bangla, the verb first in English', async () => {
    const { mrLabelsFor, movePhrase } = await load('mr/labels');
    const en = mrLabelsFor('en');
    const bn = mrLabelsFor('bn');
    expect(movePhrase(en.move.phrase, en.move.verbs.Add, 'your licence number')).toBe(
      'Add your licence number',
    );
    const text = movePhrase(bn.move.phrase, bn.move.verbs.Add, 'আপনার লাইসেন্স নম্বর');
    expect(text.startsWith('আপনার লাইসেন্স নম্বর')).toBe(true);
    expect(text.endsWith(bn.move.verbs.Add)).toBe(true);
  });

  it('a component given no labels renders exactly what it renders with the English labels', async () => {
    const { Road } = await load('mr/road');
    const { MoveCard } = await load('mr/move-card');
    const { QuoteCard } = await load('mr/quote-card');
    const { mrLabelsFor } = await load('mr/labels');
    const en = mrLabelsFor('en');
    const road = { status: 'OUTREACH' };
    expect(render(Road, road)).toBe(render(Road, { ...road, labels: en.road }));
    const move = { verb: 'Add', object: 'your licence number', holder: 'you', due: '24 Oct' };
    expect(render(MoveCard, move)).toBe(
      render(MoveCard, { ...move, labels: { holder: en.holder, move: en.move } }),
    );
    expect(render(MoveCard, move)).toContain('Add your licence number');
    const quote = {
      supplier: 'Verde Machinery',
      currency: 'USD',
      revision: 2,
      comparable: true,
      unitPrice: 'USD 12.40',
      total: 'USD 1,240.00',
      terms: [],
    };
    expect(render(QuoteCard, quote)).toBe(render(QuoteCard, { ...quote, labels: en.quote }));
  });

  it('shows the Move verb in the language chosen', async () => {
    const { MoveCard } = await load('mr/move-card');
    const { mrLabelsFor } = await load('mr/labels');
    const es = mrLabelsFor('es');
    const html = render(MoveCard, {
      verb: 'Confirm',
      object: 'the delivery date',
      holder: 'team',
      labels: { holder: es.holder, move: es.move },
    });
    expect(html).toContain('Confirmar');
    expect(html).toContain('Equipo de Corridra');
    expect(html).not.toContain('Corridra team');
  });
});

describe('with both language settings unset the page is as it was', () => {
  it('offers English alone, so the chip renders nothing', async () => {
    expect(offeredLanguages({})).toEqual([{ code: 'en', draft: false }]);
    const { LanguageSwitcher } = await load('language-switcher');
    expect(render(LanguageSwitcher)).toBe('');
  });

  it('the chip styles live beside the chip and no longer in the global file', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(resolve('apps/web/components/language-switcher.css'), 'utf8');
    const source = readFileSync(resolve('apps/web/components/language-switcher.tsx'), 'utf8');
    const global = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
    expect(css).toContain('.lang-switcher > summary');
    expect(source).toContain("import './language-switcher.css'");
    expect(global).not.toContain('.lang-switcher');
  });
});
