import { describe, expect, it } from 'vitest';
import { isTitleCase, titleCase } from '../../apps/web/lib/ux/title-case';
import { translate, type MessageKey } from '../../apps/web/lib/i18n/messages';
import { customerFiles, titleCaseFindings } from './title-case-scan';

// Button labels that come from the message catalogue rather than from the element: the Move cards and the way to
// start, and the two toggles on a request's page. Only the English words are rewritten.
const catalogueButtons = [
  'move.card.draft.action',
  'move.card.quote.action',
  'move.card.company.action',
  'move.card.reply.action',
  'move.card.reply.read',
  'move.start',
  'move.forget',
  'wsb.move.draft.action',
  'wsb.move.report.action',
  'room.replies.all',
  'room.trip.all',
  'room.trip.fewer',
] as const;

// Owner rule, 5 Nov 2026 (ui-direction): button and action labels use Title Case in English. Minor words (a, an,
// the, and, or, of, to, in, on, for, by, at) stay lowercase unless first. The text itself changes, never
// text-transform. This test reads every customer button, button-styled link and menu item from the source.
describe('Title Case for customer button labels', () => {
  it('writes Title Case as the owner described it', () => {
    expect(titleCase('Start a request')).toBe('Start a Request');
    expect(titleCase('New request')).toBe('New Request');
    expect(titleCase('Save draft')).toBe('Save Draft');
    expect(titleCase('Save and open approved report')).toBe('Save and Open Approved Report');
    expect(titleCase('Print or save as PDF')).toBe('Print or Save As PDF');
    expect(titleCase('a day to remember')).toBe('A Day to Remember');
    expect(titleCase('Sign out')).toBe('Sign Out');
    expect(titleCase('Show all {count} items')).toBe('Show All {count} Items');
    expect(titleCase('Mark as read')).toBe('Mark As Read');
    expect(isTitleCase('Finish and Send')).toBe(true);
    expect(isTitleCase('Finish and send')).toBe(false);
  });

  it('is applied to every customer button, button-styled link and menu item', () => {
    const wrong = customerFiles().flatMap((file) =>
      titleCaseFindings(file).map(
        (item) => `${file.replace(process.cwd() + '/', '')}: "${item.text}"`,
      ),
    );
    expect(wrong).toEqual([]);
  });

  it('is applied to the button labels that come from the message catalogue', () => {
    const wrong = catalogueButtons.filter(
      (key) => !isTitleCase(translate('en', key as MessageKey)),
    );
    expect(wrong).toEqual([]);
  });
});
