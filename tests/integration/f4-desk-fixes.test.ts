import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// React is a dependency of the web app, so it is loaded from there, as the other screen tests do.
const fromWeb = createRequire(resolve('apps/web/package.json'));
const createElement = fromWeb('react').createElement as (...parts: unknown[]) => unknown;
const renderToStaticMarkup = fromWeb('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;

// Team desk v4.1 audit fixes, unit F4 (Status, Team and access, Helpers, Reports, Money, Supply, Owner page).
// What the browser draws is covered in tests/operator/p5b-helpers-status-team.spec.ts; this file holds the
// shared piece and the words, which need no browser.
const web = '../../apps/web/app/operator/';
const { DeskParts } = (await import(/* @vite-ignore */ `${web}${'desk-sections.tsx'}`)) as {
  DeskParts: (props: {
    tabs: { id: string; label: string; panel: string; anchor?: string }[];
    label: string;
  }) => unknown;
};
const { OperatorFlags } = (await import(/* @vite-ignore */ `${web}${'operator-flags.tsx'}`)) as {
  OperatorFlags: (props: Record<string, unknown>) => unknown;
};
const source = (path: string) => readFileSync(new URL(web + path, import.meta.url), 'utf8');
const tabs = [
  { id: 'one', label: 'First part', panel: 'first body' },
  { id: 'two', label: 'Second part', panel: 'second body', anchor: 'old-second' },
  { id: 'three', label: 'Third part', panel: 'third body' },
];
const draw = (teamDeskV41: boolean) =>
  renderToStaticMarkup(
    createElement(
      OperatorFlags as never,
      { replyReview: false, supplySources: false, teamDeskV41 } as never,
      createElement(DeskParts as never, { tabs, label: 'Parts of the page' } as never),
    ),
  );

describe('the inner parts of a page that has segments', () => {
  it('are sections of one page with the switch on: no tab row, the first in the open, later ones folds', () => {
    const html = draw(true);
    expect(html).not.toMatch(/role="tab(list|panel)?"/);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Parts of the page"');
    // The first part has no heading that repeats the segment, and is no landmark.
    expect(html).toMatch(
      /<div id="[^"]+" class="ux-desk-section" data-desk-section="one">first body<\/div>/,
    );
    expect(html).not.toContain('First part');
    // A later part is a closed fold that keeps its content in the page and the id its tab panel had.
    expect(html).toContain(
      '<details id="old-second" class="ux-desk-section" data-desk-section="two"><summary>Second part</summary>second body</details>',
    );
    expect(html).toMatch(/<details id="[^"]+" class="ux-desk-section" data-desk-section="three">/);
    expect(html).not.toContain('<details open');
  });
  it('are the shared tabs with the switch off, as before', () => {
    const html = draw(false);
    expect(html).toContain('role="tablist"');
    expect((html.match(/role="tab"/g) ?? []).length).toBe(3);
    expect(html).not.toContain('data-desk-section');
  });
});

describe('words and structure behind the switch', () => {
  it('Helpers says Helpers on and Helpers paused, and keeps the old words with the switch off', () => {
    const network = source('network.tsx');
    expect(network).toMatch(/teamDeskV41\s*\?\s*'Helpers on'\s*:\s*'Network enabled'/);
    expect(network).toMatch(/teamDeskV41\s*\?\s*'Helpers paused'\s*:\s*'Network paused'/);
    expect(network).toContain('onChooseWorkspace && !teamDeskV41');
  });
  it('Status keeps engineering notes behind Technical details and names each page in the outline', () => {
    const operations = source('operations.tsx');
    expect(operations).toContain('<summary>Technical details</summary>');
    expect(operations).toContain(
      'These counts cover every mission in this workspace that matches the filters.',
    );
    expect(operations).toContain("'ops-health': 'Health'");
    expect(operations).not.toMatch(/<SubTabs\b/);
  });
  it('the Status panel box takes the quiet border colour on every side', () => {
    const css = source('operator-overview.css');
    const rule = css.slice(css.indexOf('.ux-governance-panel > .ux-operations-panel {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('border-color: var(--border-subtle)');
  });
  it('Reports and Money keep one visible title; Money row actions are quiet with the switch on', () => {
    expect(source('delivery.tsx')).not.toMatch(/<h2>Client and programme delivery<\/h2>/);
    const money = source('opportunities.tsx');
    expect(money).toContain("desk ? 'button button-secondary' : 'primary-link'");
    expect((money.match(/className="primary-link"/g) ?? []).length).toBe(1);
    expect(money).toContain('hidden={deskV41 && !allOpportunities && index >= firstOpportunities}');
  });
  it('Supply publishes the workspace picker and shows the preview line of the other team pages', () => {
    const page = source('supply/supply-page.tsx');
    expect(page).toContain('<SupplySwitcher');
    expect(page).toContain(
      'Preview workspace: use made-up records here, never real customer details.',
    );
    expect(source('supply/supply-switcher.tsx')).toContain('publishTeamSwitcher(');
  });
  it('the owner page has no link back and no second list of menu places with the switch on', () => {
    const owner = source('owner/page.tsx');
    expect(owner).toMatch(/\{frame \? null : \(\s*<Link[^>]*>\s*Back to your workspace/);
    expect(owner).toContain("uxSwitchOn('CORRIDRA_UX_FRONT_DOORS') && !frame");
    expect(owner).toContain('const Parts = frame ? DeskSections : SubTabs;');
  });
});
