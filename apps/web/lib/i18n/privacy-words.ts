/**
 * "Who can see it" words (PL1). English is the source. The bn, zh, es, ar, fr and de words are in lang/<code>.ts.
 * The label follows the page's own language and is never shown in a language the page itself does not show.
 */
export const privacyEn = {
  'privacy.heading': 'Who can see it',
  'privacy.canSee': 'Can see it',
  'privacy.notStated': 'Not stated',
  'privacy.reader.anyoneWithLink': 'Anyone with the link until it expires or is withdrawn',
  'privacy.reader.youMadeLink': 'You, who made the link',
  'privacy.reader.youSaved': 'You, who saved this report',
  'privacy.reader.anyoneWithReportLink':
    'Anyone with the original report link until it expires or is withdrawn',
  'privacy.reader.workspace': 'Other people in your workspace',
  'privacy.reader.corridra': 'The Corridra team',
  'privacy.reader.anyoneWithReplyLink': 'Anyone with this link until it expires',
  'privacy.reader.sendingTeam': 'The team that sent you this request',
  'privacy.reader.requester': 'The customer who asked for this introduction',
  'privacy.reader.workspaceOwnersReport':
    'Owners and admins of your workspace, including reports saved earlier. They can also download its books.',
  'privacy.reader.workspaceOwnersCard':
    'Owners and admins of your workspace, including cards made earlier',
  'privacy.reader.workspaceMembers': 'Other members of your workspace',
} as const;
