import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { actionCatalogue } from '../../apps/web/lib/actions/catalogue';
import { translate } from '../../apps/web/lib/i18n/messages';

// Owner, 23 Nov 2026: no customer-readable "draft". A customer's unsent request is a "saved request".
describe('B5d: the remaining customer-readable draft words', () => {
  it('names the unsent request a saved request on the Move cards and the Road', () => {
    expect(translate('en', 'move.card.draft.object')).toBe('your request');
    expect(translate('en', 'move.card.draft.action')).toBe('Open Your Saved Request');
    expect(translate('en', 'mr.road.subline.DRAFT')).toBe('The request is saved and not sent yet.');
  });

  it('labels the phone plus row and the catalogue action without the word', () => {
    const pocket = readFileSync('apps/web/components/ux/pocket-button.tsx', 'utf8');
    expect(pocket).toContain("label: 'Continue Your Saved Request'");
    expect(pocket).not.toMatch(/label: '[^']*\bDrafts?\b[^']*'/i);
    const action = actionCatalogue.find((entry) => entry.id === 'continue_draft');
    expect(action?.label).toBe('Open Your Workspaces to Pick Up a Saved Request');
    for (const entry of actionCatalogue) expect(entry.label).not.toMatch(/\bdrafts?\b/i);
  });
});
