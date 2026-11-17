/**
 * "Who can see it" words (PL1). English is the source. Every catalogue carries these English words as its draft
 * placeholder until a native review is recorded, so no unreviewed translation is shown; the label marks itself
 * `lang="en"` in every language.
 */
export const privacyWords = {
  'privacy.heading': 'Who can see it',
  'privacy.canSee': 'Can see it',
  'privacy.notStated': 'Not stated',
  'privacy.reader.anyoneWithLink': 'Anyone with the link',
  'privacy.reader.youMadeLink': 'You, who made the link',
  'privacy.reader.youSaved': 'You, who saved this report',
  'privacy.reader.anyoneWithReportLink': 'Anyone with the original report link',
  'privacy.reader.workspace': 'Other people in your workspace',
  'privacy.reader.corridra': 'The Corridra team',
  'privacy.reader.anyoneWithReplyLink': 'Anyone with your private reply link',
  'privacy.reader.sendingTeam': 'The team that sent you this request',
  'privacy.reader.requester': 'The customer who asked for this introduction',
} as const;
