import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Team desk v4.1 final sweep (builder F6): the small fixes that have no page-level spec of their own. The measured
// results (44 px dialog close, no outer card, left-aligned primary) are in the pull request; these keep the source
// that produces them from drifting.
const read = (path: string) => readFileSync(resolve(path), 'utf8');

describe('team desk v4.1 sweep', () => {
  it('does not link Supply Sources from the Companies page while the v4.1 menu lists it', () => {
    const workspace = read('apps/web/app/operator/workspace.tsx');
    expect(workspace).toContain('{supplySources && !deskV41 && (');
  });

  it('keeps the page frame rules under the desk shell class, so the switch off is unchanged', () => {
    const css = read('apps/web/components/ux/page-frame.css');
    for (const selector of [
      '> .workspace-panel.ux-panel:not(:has(> :is(.detail-card.ux-network, .detail-card.delivery-ops)))',
      '.ux-workspace.ux-desk-frame > .ux-page-heading > .ux-frame-lead:has(> .ux-frame-primary)',
      '.ux-desk-frame .ux-state-label',
    ])
      expect(css).toContain(selector);
  });

  it('keeps the dialog close button at 44 px inside a desk panel, under the desk shell class', () => {
    const css = read('apps/web/components/ux/dialog.css');
    expect(css).toMatch(
      /\.ux-desk-frame dialog\.ux-dialog\[open\] \.ux-dialog-head button\.ux-dialog-close \{\s*min-height: 44px;\s*min-width: 44px;/,
    );
  });

  it('gives a row that opens more text a 44 px target, and a reference a token size', () => {
    const css = read('apps/web/components/problem-reports/problem-reports.css');
    // A list item keeps the browser's disclosure marker; padding makes the height.
    expect(css).toMatch(/\.pr-fold > summary \{\s*display: list-item;\s*min-height: 2\.75rem;/);
    expect(css).toMatch(/\.pr-queue code \{\s*font-size: var\(--text-sm\);/);
    expect(read('apps/web/components/problem-reports/problem-report-list.tsx')).toContain(
      'className="pr-fold"',
    );
    expect(read('apps/web/components/problem-reports/remove-my-words.tsx')).toContain(
      'className="pr-fold"',
    );
  });
  it('draws no black box round a desk panel form and keeps technical words in a closed fold', () => {
    const css = read('apps/web/components/ux/page-frame.css');
    expect(css).toMatch(
      /\.ux-desk-frame \.ux-operations-panel form\.operator-form > fieldset \{\s*border: 0;\s*padding: 0;\s*margin: 0;\s*min-width: 0;/,
    );
    expect(css).toContain('.ux-desk-frame details.desk-technical > summary');
    // A fold is closed by default: no `open` attribute on any of the three.
    for (const path of [
      'apps/web/components/founder-activation.tsx',
      'apps/web/app/operator/operations.tsx',
      'apps/web/app/operator/owner/page.tsx',
    ]) {
      const source = read(path);
      expect(source).toContain('<details className="desk-technical">');
      expect(source).not.toMatch(/<details className="desk-technical"\s+open/);
      expect(source).toContain('<summary>Technical details</summary>');
    }
    // The setting names stay on the page for the switch-off screen and move into the fold for v4.1.
    const activation = read('apps/web/components/founder-activation.tsx');
    expect(activation).toContain('{!deskV41 && <th scope="col">Flag</th>}');
    expect(activation).toContain('The setting that turns each customer module on');
  });

  it('writes a country as its name with its mark, and a route with the word "to", in the v4.1 desk', () => {
    const name = read('apps/web/app/operator/country-name.tsx');
    expect(name).toContain('if (!teamDeskV41) return off ?? code;');
    for (const path of [
      'apps/web/app/operator/company-link-review.tsx',
      'apps/web/app/operator/network.tsx',
      'apps/web/app/operator/customer-real-invoicing.tsx',
      'apps/web/app/operator/view-as/[role]/sample-screens.tsx',
    ])
      expect(read(path)).toContain('<CountryName code=');
    const operations = read('apps/web/app/operator/operations.tsx');
    expect(
      operations.match(
        /placeName\(r\.origin_market\)\} to \$\{placeName\(r\.destination_market\)/g,
      ),
    ).toHaveLength(2);
    expect(operations).not.toContain('word="→"');
    expect(read('apps/web/app/mission-experience-view.tsx')).toContain('{countryName(t.country)}');
  });
});
