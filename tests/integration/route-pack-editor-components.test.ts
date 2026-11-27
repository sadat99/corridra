import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { countsLine } from '../../apps/web/components/ux/change-summary';

// ADR-093 Phase 3, PR 2b: the shared pieces. RouteFactRow keeps its markup for a caller that gives it none of the new props: the
// html below was recorded from the component as it stood on main (PR 1) and must not change. NumberField and MoneyInput keep
// theirs for a caller that gives none of the new props, and ChangeSummary reads the same in every confirmation.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...c: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const load = async (path: string) =>
  await import(/* @vite-ignore */ `../../apps/web/components/ux/${path}`);

const main: Record<string, { props: Record<string, unknown>; html: string }> = {
  plain: {
    props: {
      label: 'Working week',
      core: true,
      locked: false,
      state: 'FILLED',
      value: { kind: 'text', text: 'Sat to Wed' },
      source: 'Staff knowledge',
      observed: '1 Nov 2026',
      validUntil: '31 Dec 2026',
    },
    html: '<li class="ux-fact-row" data-state="FILLED"><div class="ux-fact-body"><div class="ux-fact-main"><span class="ux-fact-label" dir="auto">Working week<span class="ux-status" data-tone="neutral">Core</span></span><div class="ux-fact-value" id="_R_0_" dir="auto"><p class="ux-fact-text" data-full="false">Sat to Wed</p></div></div><div class="ux-fact-meta"><div class="ux-fact-state"><span class="ux-fact-mark" data-state="FILLED"><span class="ux-fact-mark-shape" aria-hidden="true"><svg class="corridra-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false"><path d="M4.5 10.5 8 14l7.5-8"></path></svg></span><span>Filled</span></span></div><span class="ux-fact-source"><span class="ux-source-stamp"><span class="ux-source-stamp-dot" aria-hidden="true"></span><span class="ux-source-stamp-words">Staff knowledge · 1 Nov 2026</span></span><span class="ux-fact-until">Valid until 31 Dec 2026</span></span></div></div></li>',
  },
  pending: {
    props: {
      label: 'Currency',
      core: false,
      locked: false,
      state: 'PENDING',
      value: { kind: 'empty' },
    },
    html: '<li class="ux-fact-row" data-state="PENDING"><div class="ux-fact-body"><div class="ux-fact-main"><span class="ux-fact-label" dir="auto">Currency</span><div class="ux-fact-value" id="_R_0_" dir="auto"><p class="ux-fact-quiet">Not filled yet</p></div></div><div class="ux-fact-meta"><div class="ux-fact-state"><span class="ux-fact-mark" data-state="PENDING"><span class="ux-fact-mark-shape" aria-hidden="true"></span><span>Pending</span></span></div></div></div></li>',
  },
  stale: {
    props: {
      label: 'Fairs',
      core: true,
      locked: false,
      state: 'FILLED',
      value: { kind: 'list', items: ['a', 'b', 'c', 'd'] },
      source: 'example.org',
      staleSince: '31 Dec 2025',
    },
    html: '<li class="ux-fact-row" data-state="FILLED"><div class="ux-fact-body"><div class="ux-fact-main"><span class="ux-fact-label" dir="auto">Fairs<span class="ux-status" data-tone="neutral">Core</span></span><div class="ux-fact-value" id="_R_0_" dir="auto"><ul class="ux-fact-list" data-full="false"><li>a</li><li>b</li><li>c</li></ul><button type="button" class="text-link ux-fact-toggle" aria-expanded="false" aria-controls="_R_0_">Show Full Value</button></div></div><div class="ux-fact-meta"><div class="ux-fact-state"><span class="ux-fact-mark" data-state="FILLED"><span class="ux-fact-mark-shape" aria-hidden="true"><svg class="corridra-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false"><path d="M4.5 10.5 8 14l7.5-8"></path></svg></span><span>Filled</span></span><span class="ux-fact-mark ux-fact-mark-stale"><svg class="corridra-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false"><path d="M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13M10 6.5V10l2.5 1.5"></path></svg><span>Stale since 31 Dec 2025</span></span></div><span class="ux-fact-source"><span class="ux-source-stamp"><span class="ux-source-stamp-dot" aria-hidden="true"></span><span class="ux-source-stamp-words">example.org</span></span></span></div></div></li>',
  },
  na: {
    props: {
      label: 'Other',
      core: false,
      locked: false,
      state: 'NOT_APPLICABLE',
      value: { kind: 'empty' },
      note: 'None here',
    },
    html: '<li class="ux-fact-row" data-state="NOT_APPLICABLE"><div class="ux-fact-body"><div class="ux-fact-main"><span class="ux-fact-label" dir="auto">Other</span><div class="ux-fact-value" id="_R_0_" dir="auto" hidden=""><p class="ux-fact-quiet">Not filled yet</p></div></div><div class="ux-fact-meta"><div class="ux-fact-state"><span class="ux-fact-mark" data-state="NOT_APPLICABLE"><span class="ux-fact-mark-shape" aria-hidden="true"></span><span>Not applicable</span></span><span class="ux-fact-note">Not applicable: None here</span></div></div></div></li>',
  },
  locked: {
    props: {
      label: 'Languages',
      core: true,
      locked: true,
      state: 'FILLED',
      value: { kind: 'list', items: ['en'] },
    },
    html: '<li class="ux-fact-row" data-state="FILLED"><div class="ux-fact-body"><div class="ux-fact-main"><span class="ux-fact-label" dir="auto">Languages<span class="ux-status" data-tone="neutral">Core</span></span><div class="ux-fact-value" id="_R_0_" dir="auto"><ul class="ux-fact-list" data-full="false"><li>en</li></ul></div></div><div class="ux-fact-meta"><div class="ux-fact-state"><span class="ux-fact-mark" data-state="FILLED"><span class="ux-fact-mark-shape" aria-hidden="true"><svg class="corridra-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false"><path d="M4.5 10.5 8 14l7.5-8"></path></svg></span><span>Filled</span></span></div><span class="ux-fact-pack"><svg class="corridra-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false"><path d="M4.5 9h11v8h-11zM7 9V6.5a3 3 0 0 1 6 0V9M10 12v2"></path></svg>Pack setting</span></div></div></li>',
  },
  packNote: {
    props: {
      label: 'Sourcing',
      core: false,
      locked: true,
      state: 'FILLED',
      value: { kind: 'empty' },
      packNote: 'Set in the form.',
    },
    html: '<li class="ux-fact-row" data-state="FILLED"><div class="ux-fact-body"><div class="ux-fact-main"><span class="ux-fact-label" dir="auto">Sourcing</span><div class="ux-fact-value" id="_R_0_" dir="auto"><p class="ux-fact-quiet">Set in the form.</p></div></div><div class="ux-fact-meta"><div class="ux-fact-state"><span class="ux-fact-mark" data-state="FILLED"><span class="ux-fact-mark-shape" aria-hidden="true"><svg class="corridra-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false"><path d="M4.5 10.5 8 14l7.5-8"></path></svg></span><span>Filled</span></span></div><span class="ux-fact-pack"><svg class="corridra-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false"><path d="M4.5 9h11v8h-11zM7 9V6.5a3 3 0 0 1 6 0V9M10 12v2"></path></svg>Pack setting</span></div></div></li>',
  },
};

describe('RouteFactRow', () => {
  for (const [name, { props, html }] of Object.entries(main))
    test(`a row given none of the new props is drawn exactly as on main: ${name}`, async () => {
      const { RouteFactRow } = await load('route-fact-row.tsx');
      expect(render(ce(RouteFactRow, props))).toBe(html);
    });

  test('the action stands once, in the state line after the stale mark, and adds no row', async () => {
    const { RouteFactRow } = await load('route-fact-row.tsx');
    const html = render(
      ce(RouteFactRow, {
        ...main.stale!.props,
        action: ce('button', { type: 'button' }, 'Edit'),
      }),
    );
    expect(html.match(/Edit<\/button>/g)).toHaveLength(1);
    const state = html.slice(
      html.indexOf('class="ux-fact-state"'),
      html.indexOf('class="ux-fact-source"'),
    );
    expect(state).toContain('Stale since 31 Dec 2025');
    expect(state.indexOf('Stale since')).toBeLessThan(state.indexOf('ux-fact-action'));
    expect(html).not.toContain('<div class="ux-fact-action">');
  });

  test('unsaved says Changed, not saved beside the state; editing hides the value and the meta and draws the editor under the row', async () => {
    const { RouteFactRow } = await load('route-fact-row.tsx');
    const unsaved = render(ce(RouteFactRow, { ...main.plain!.props, unsaved: true }));
    expect(unsaved).toContain('Changed, not saved');
    expect(render(ce(RouteFactRow, main.plain!.props))).not.toContain('Changed, not saved');
    const editing = render(
      ce(RouteFactRow, {
        ...main.plain!.props,
        editing: true,
        editor: ce('div', { id: 'the-editor' }, 'editor'),
      }),
    );
    expect(editing).toContain('class="ux-fact-meta" hidden=""');
    expect(editing).toMatch(/class="ux-fact-value"[^>]* hidden=""/);
    expect(editing).toContain('Working week');
    expect(editing).toContain('Core');
    expect(editing.indexOf('the-editor')).toBeGreaterThan(editing.indexOf('ux-fact-body'));
    // The editor is drawn only while the row is open.
    expect(
      render(ce(RouteFactRow, { ...main.plain!.props, editor: ce('div', { id: 'the-editor' }) })),
    ).not.toContain('the-editor');
  });
});

describe('ChangeSummary', () => {
  test('the count line, the lines in words and Show all N changes beyond the limit', async () => {
    const { ChangeSummary } = await load('change-summary.tsx');
    const lines = Array.from({ length: 9 }, (_, i) => `Added: Field ${i + 1}`);
    const html = render(ce(ChangeSummary, { counts: { added: 2, changed: 1, removed: 0 }, lines }));
    expect(html).toContain('Added 2, changed 1, removed 0');
    expect(html).toContain('Show all 9 changes');
    expect(html.match(/<li/g)).toHaveLength(9);
    expect(html.match(/<li[^>]* hidden=""/g)).toHaveLength(3);
    const few = render(ce(ChangeSummary, { lines: lines.slice(0, 2) }));
    expect(few).not.toContain('Show all');
    expect(few).not.toContain('Added 0');
    expect(
      render(ce(ChangeSummary, { lines: lines.slice(0, 3), limit: 2, noun: 'edits' })),
    ).toContain('Show all 3 edits');
    expect(countsLine({ added: 0, changed: 0, removed: 1 })).toBe('Added 0, changed 0, removed 1');
  });

  test('no colour, no icon and no em dash', async () => {
    const { ChangeSummary } = await load('change-summary.tsx');
    const html = render(
      ce(ChangeSummary, { counts: { added: 1, changed: 0, removed: 0 }, lines: ['Added: A'] }),
    );
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('\u2014');
  });
});

describe('NumberField', () => {
  test('a caller that gives no min is drawn with min 0, as before; null draws no minimum; a number draws that number', async () => {
    const { NumberField } = await load('number-field.tsx');
    const props = { id: 'n', label: 'Days', value: '', onChange: () => undefined, whole: true };
    expect(render(ce(NumberField, props))).toContain('min="0"');
    expect(render(ce(NumberField, { ...props, min: null }))).not.toContain('min=');
    expect(render(ce(NumberField, { ...props, min: -5 }))).toContain('min="-5"');
    expect(render(ce(NumberField, { ...props, min: null }))).toContain('step="1"');
  });
});

describe('MoneyInput', () => {
  test('a caller that gives neither new prop is drawn as before', async () => {
    const { MoneyInput } = await load('money-input.tsx');
    const props = {
      label: 'Amount',
      currency: 'USD',
      value: '4500',
      onChange: () => undefined,
      id: 'm',
    };
    const html = render(ce(MoneyInput, props));
    expect(html).toContain('Amount (USD)');
    expect(html).toContain('value="45.00"');
    expect(
      render(ce(MoneyInput, { ...props, decimalsWords: () => 'x', onText: () => undefined })),
    ).toBe(html);
  });
});
