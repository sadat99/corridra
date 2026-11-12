// Words of the organiser entry on the public trade missions page. English is the source. Every other catalogue
// carries these English words until a native reviewer is recorded for that language, so no unreviewed translation is
// shown (the same rule as the programme page words). Keys are stable: a translation replaces a value, never a key.
//
// Terms held apart on purpose (do not merge them in any language):
//   Programme     the organiser's delegation as a whole. Not a Mission, which is one company's own piece of work.
//   Application   a person asking to take part. Not a Request, which is sent to the Corridra team.
//   Invited       the organiser's answer to an application. Not an Introduction.
//   Joined        registered in the programme. Not a confirmed attendance and not a payment.
export const organiseEntryWords = {
  'organise.entry.label': 'Run your own delegation',
  'organise.entry.title': 'Organise the programme yourself.',
  'organise.entry.lead':
    'Create a programme, publish its public page and review the applications. You sign in to your Corridra account to start.',
  'organise.entry.steps.aria': 'Three steps to run your own delegation',
  'organise.entry.step.create.title': 'Create the programme',
  'organise.entry.step.create.text': 'Add the programme in your account and fill in its details.',
  'organise.entry.step.publish.title': 'Publish its page',
  'organise.entry.step.publish.text':
    'Write the public page, check the preview, then publish it and share the address.',
  'organise.entry.step.review.title': 'Review applications',
  'organise.entry.step.review.text':
    'Read each application. Invite, put on the Waiting List or decline. A decline always carries a reason.',
  'organise.entry.action': 'Open Your Programmes',
  'organise.entry.note':
    'Want the Corridra team to plan the trip with you? Use the request above instead.',
} as const;
