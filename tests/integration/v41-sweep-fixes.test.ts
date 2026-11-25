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
    expect(read('apps/web/app/operator/reply-review.css')).toContain(
      '.ux-desk-frame .reply-review-card h6',
    );
  });

  it('keeps the dialog close button at 44 px inside a desk panel', () => {
    const css = read('apps/web/components/ux/dialog.css');
    expect(css).toMatch(
      /dialog\.ux-dialog\[open\] \.ux-dialog-head button\.ux-dialog-close \{\s*min-height: 44px;\s*min-width: 44px;/,
    );
  });

  it('names the sign-in destinations on the forgot-password pages, not a way back', async () => {
    const { accessHelp } = await import('../../apps/web/lib/access-doors');
    const words = [
      ...accessHelp.operatorForgotPassword('/operator/signin').links,
      ...accessHelp.helperForgotPassword.links,
    ].map((link) => link.text);
    expect(words).toContain('Operator Sign-In');
    expect(words).toContain('Helper Sign-In');
    expect(words.filter((text) => /^Back to/.test(text))).toEqual([]);
  });

  it('shows the module table without the raw setting name', () => {
    const source = read('apps/web/components/founder-activation.tsx');
    expect(source).not.toContain('<code>{m.flag}</code>');
    expect(source).not.toContain('<th scope="col">Flag</th>');
  });

  it('gives a row that opens more text a 44 px target, and a reference a token size', () => {
    const css = read('apps/web/components/problem-reports/problem-reports.css');
    expect(css).toMatch(/\.pr-fold > summary \{[^}]*min-height: 2\.75rem;/);
    expect(css).toMatch(/\.pr-queue code \{\s*font-size: var\(--text-sm\);/);
    expect(read('apps/web/components/problem-reports/problem-report-list.tsx')).toContain(
      'className="pr-fold"',
    );
    expect(read('apps/web/components/problem-reports/remove-my-words.tsx')).toContain(
      'className="pr-fold"',
    );
  });
});
