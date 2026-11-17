import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Visual grammar PR 1 (17 November 2026): the Explain primitive and the Road legend built on it.
// Static checks without a browser: the visible word is the accessible name, the explanation is in the
// server HTML and linked by aria-describedby, no title attribute stands in for text, the legend shows
// the catalogue words, and the step words are unchanged. Pointer, keyboard, no-JavaScript and width
// behaviour is in tests/ux/mr-explain.spec.ts.
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
const { translate, catalogs } = (await import('../../apps/web/lib/i18n/messages')) as {
  translate: (locale: string, key: string) => string;
  catalogs: Record<string, Record<string, string>>;
};
const say = (key: string) => translate('en', key);

const explainKeys = [
  'mr.explain.holder.you',
  'mr.explain.holder.team',
  'mr.explain.holder.owner',
  'mr.explain.holder.third',
  'mr.explain.state.done',
  'mr.explain.state.now',
  'mr.explain.state.later',
  'mr.explain.state.notTracked',
  'mr.explain.fill.notStated',
  'mr.explain.fill.notMeasured',
  'mr.explain.fill.excluded',
  'mr.quote.excluded',
  'mr.quote.notMeasured',
];

describe('Explain', () => {
  it('is one button named by its visible word, described by a tooltip in the server HTML', async () => {
    const { Explain } = await load('explain');
    const html = renderToStaticMarkup(
      createElement(
        Explain,
        { name: 'Done', text: 'This step is finished.' },
        createElement('span', { className: 'shape' }),
      ),
    );
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('type="button"');
    // The description is the sentence alone, so the word is not read twice.
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(
      `<span class="mr-explain-text" id="${describedBy}">This step is finished.</span>`,
    );
    expect(html).toMatch(/role="tooltip" id="[^"]+" class="mr-explain-pop">/);
    expect(html).toContain(
      '<span class="mr-explain-symbol" aria-hidden="true"><span class="shape"></span></span>',
    );
    // The button holds exactly the hidden symbol and the word, so its only text, and its name, is
    // the word.
    const button = /<button[^>]*>([\s\S]*?)<\/button>/.exec(html)![1];
    expect(button).toBe(
      '<span class="mr-explain-symbol" aria-hidden="true"><span class="shape"></span></span>' +
        '<span class="mr-explain-word">Done</span>',
    );
    expect(html).not.toMatch(/\btitle=/);
    // Closed in the server HTML; no data-js until hydrated, so CSS hover and focus work without JS.
    expect(html).not.toContain('data-open');
    expect(html).not.toContain('data-js');
  });

  it('never uses a title attribute or display: none for its text (source guard)', () => {
    for (const file of ['explain.tsx', 'road.tsx']) {
      const source = readFileSync(resolve('apps/web/components/mr', file), 'utf8');
      expect(source, file).not.toMatch(/\btitle=/);
    }
    const css = readFileSync(resolve('apps/web/components/mr/explain.css'), 'utf8');
    expect(css).not.toMatch(/display:\s*none/);
    expect(css).toMatch(/:not\(\[data-js\]\):is\(:hover, :focus-within\)/);
  });
});

describe('the Road legend', () => {
  it('shows four step shapes and four holder shapes, each explained, with the catalogue sentences', async () => {
    const { Road } = await load('road');
    const html = renderToStaticMarkup(createElement(Road, { status: 'MEETINGS' }));
    // Four step states, then (PR 3) the four holder shapes.
    expect(html.match(/class="mr-explain"/g)).toHaveLength(8);
    for (const [state, word] of [
      ['done', 'Done'],
      ['now', 'Now'],
      ['later', 'Later'],
      ['notTracked', 'Not tracked yet'],
    ]) {
      expect(html).toContain(`data-key="${state}"`);
      expect(html).toContain(`<span class="mr-explain-word">${word}</span>`);
      expect(html).toMatch(
        new RegExp(
          `<span class="mr-explain-text" id="[^"]+">${say(`mr.explain.state.${state}`)}</span>`,
        ),
      );
    }
    expect(html).toContain(`<p class="mr-road-legend-note">${say('mr.road.legend')}</p>`);
    expect(html).not.toMatch(/\btitle=/);
  });

  it('takes its sentences from the same language as its words', async () => {
    const { Road } = await load('road');
    const { mrLabelsFor } = await load('labels');
    const html = renderToStaticMarkup(
      createElement(Road, { status: 'MEETINGS', labels: mrLabelsFor('bn').road }),
    );
    expect(html).toContain(
      `<span class="mr-explain-word">${translate('bn', 'mr.road.state.done')}</span>`,
    );
    expect(html).toContain(translate('bn', 'mr.explain.state.done'));
    expect(html).toContain(translate('bn', 'mr.explain.state.notTracked'));
    expect(html).not.toContain(say('mr.explain.state.done'));
  });

  it('renders no control at all when decorative, keeping the shapes and words', async () => {
    const { Road } = await load('road');
    const html = renderToStaticMarkup(
      createElement(Road, { status: 'MEETINGS', decorative: true }),
    );
    expect(html).not.toMatch(/<(button|a|input|form)\b/);
    expect(html).not.toContain('role="tooltip"');
    expect(html).not.toContain('tabindex');
    for (const [state, word] of [
      ['done', 'Done'],
      ['now', 'Now'],
      ['later', 'Later'],
      ['notTracked', 'Not tracked yet'],
    ])
      expect(html).toContain(
        `<span class="mr-road-key-static"><span class="mr-road-key" data-key="${state}" aria-hidden="true"></span>${word}</span>`,
      );
    expect(html).toContain(`<p class="mr-road-legend-note">${say('mr.road.legend')}</p>`);
  });

  it('is decorative wherever the read-only view-as samples draw it', () => {
    const source = readFileSync(
      resolve('apps/web/app/operator/view-as/[role]/sample-screens.tsx'),
      'utf8',
    );
    const roads = source.match(/<Road\b[^>]*>/g) ?? [];
    expect(roads.length).toBeGreaterThan(0);
    for (const road of roads) expect(road).toMatch(/\bdecorative\b/);
  });

  it('renders no explanation when the legend is off', async () => {
    const { Road } = await load('road');
    const html = renderToStaticMarkup(
      createElement(Road, { status: 'MEETINGS', showLegend: false }),
    );
    expect(html).not.toContain('mr-explain');
  });
});

describe('the explanation words', () => {
  it('match the agreed English, keep the step words, and exist in every catalogue', () => {
    expect(say('mr.road.state.notTracked')).toBe('Not tracked yet');
    expect(say('mr.explain.state.notTracked')).toBe(
      'Nothing has been recorded for this step. That is not zero.',
    );
    expect(say('mr.explain.fill.notStated')).toBe(
      'The supplier left this term blank. It is not zero.',
    );
    expect(say('mr.explain.fill.excluded')).toBe('Shipping is not included in the price.');
    expect(say('mr.explain.holder.owner')).toBe(
      'Your workspace owner or an admin needs to do the next thing.',
    );
    for (const [locale, catalog] of Object.entries(catalogs))
      for (const key of explainKeys) expect(catalog[key], `${locale} ${key}`).toBeTruthy();
  });

  it('are grouped for components in mrLabels.explain', async () => {
    const { mrLabels } = await load('labels');
    expect(mrLabels.explain.holder.owner).toEqual({
      name: 'Workspace owner or admin',
      text: say('mr.explain.holder.owner'),
    });
    expect(mrLabels.explain.state.notTracked.name).toBe('Not tracked yet');
    expect(mrLabels.explain.fill.notStated.name).toBe('Not stated');
    expect(mrLabels.explain.fill.excluded.name).toBe('Excluded');
    expect(mrLabels.explain.fill.notMeasured.name).toBe('Not measured yet');
    expect(mrLabels.quote.excluded).toBe('Excluded');
  });
});
