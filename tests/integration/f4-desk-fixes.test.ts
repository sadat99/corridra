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
const { usePageTitleSays } = (await import(/* @vite-ignore */ `${web}${'desk-sections.tsx'}`)) as {
  usePageTitleSays: (words: string) => boolean;
};
const { sourceTitle } = (await import(/* @vite-ignore */ `${web}${'sources-panel.tsx'}`)) as {
  sourceTitle: (row: { id: string; locator?: string; kind?: string }) => string;
};
/** A heading that goes to screen readers only once the page title says its words. */
function TitleProbe() {
  return createElement('h2', usePageTitleSays('Probe') ? { className: 'sr-only' } : null, 'Probe');
}
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
    // The panel carries the menu's name in both switch states; the old third name is not on the screen.
    expect(source('delivery.tsx')).not.toContain('Client and programme delivery');
    expect(
      source('delivery.tsx').match(
        /<h2 className=\{deskV41 \|\| titled \? 'sr-only' : undefined\}>Reports<\/h2>/g,
      ),
    ).toHaveLength(3);
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

// Unit F4b: the switch-off audit items that are plain defects in both switch states.
describe('names that were printed more than once', () => {
  it('a panel reads the page title, so its own copy of the name is for screen readers only', () => {
    expect(source('operations.tsx')).toContain(
      "<h3 className={deskV41 || titledHealth ? 'sr-only' : undefined}>Recovery and health</h3>",
    );
    expect(source('operations.tsx')).toContain("deskV41 || titledOperations ? 'sr-only'");
    expect(source('workspace-controls.tsx')).toContain(
      "<h2 className={teamDeskV41 || titled ? 'sr-only' : undefined}>Workspace controls</h2>",
    );
    expect(source('workspace-audit.tsx')).toContain('data-title-said={titled || undefined}');
    expect(source('sources-panel.tsx')).toContain('data-title-said={titled || undefined}');
    // The shared heading keeps its label, icon and line; only its name goes to one pixel.
    const css = source('operator-overview.css');
    const rule = css.slice(css.indexOf('[data-title-said] > .ux-panel-heading h2 {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('clip-path: inset(50%)');
  });
  it('the first server render shows the heading, so a page without that title never loses its name', () => {
    const html = renderToStaticMarkup(createElement(TitleProbe as never));
    expect(html).toBe('<h2>Probe</h2>');
  });
  it('each Money opportunity names its own Evidence and accounting history heading', () => {
    expect(source('opportunities.tsx')).toMatch(
      /Evidence and accounting history\s*<span className="sr-only">, \{o\.title\}<\/span>/,
    );
  });
});

describe('a source in Sources and claims', () => {
  const id = '2db88616-465f-4935-8a51-0000000000e1';
  it('is named by the words before a record id, never by the id', () => {
    expect(
      sourceTitle({
        id: 'a',
        locator: `Mission intake ${id}; notice synthetic-intake-2026-10-05-v1`,
      }),
    ).toBe('Mission intake');
    expect(sourceTitle({ id: 'a', locator: `Record: ${id}` })).toBe('Record');
  });
  it('is named by its source type when the description is only an id or is missing', () => {
    expect(sourceTitle({ id: 'a', locator: id, kind: 'public_record' })).toBe(
      'Existing public record',
    );
    expect(sourceTitle({ id: 'a', kind: 'self_declaration' })).toBe('Original declaration');
    expect(sourceTitle({ id: 'a', locator: id })).toBe('Source');
  });
  it('keeps a description a person wrote exactly as written', () => {
    expect(sourceTitle({ id: 'a', locator: 'Invented trade fair catalogue, page 4' })).toBe(
      'Invented trade fair catalogue, page 4',
    );
  });
  it('shows record references at a size of the type scale', () => {
    const css = source('operator-overview.css');
    const rule = css.slice(css.indexOf('.ux-copy-reference code,'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('font-size: var(--text-sm)');
  });
});

describe('Today with larger text and the Supply breadcrumb', () => {
  it('the Today lists stack by their own width, so text at 200% never squeezes a name to one letter a line', () => {
    const css = source('operator-overview.css');
    expect(css).toMatch(
      /\.ux-operator-home :is\(\.ux-needs, \.ux-week\) \{\s*container-type: inline-size;/,
    );
    expect(css).toContain('@container (max-width: 26rem)');
  });
  it('the Supply breadcrumb rules apply with the team desk v4.1 frame only', () => {
    const css = source('supply/supply.css');
    expect(css).not.toMatch(/^\.supply-head > \.ux-kit-crumbs/m);
    expect(css).toContain('.ux-desk-frame .supply-head > .ux-kit-crumbs {');
    expect(css).toContain('.ux-desk-frame .supply-head > .ux-kit-crumbs a {');
  });
});
