/**
 * The words the teaching-layer components show. English is the default. A caller passes a translated
 * set (Lane 2 supplies them from the message module); a component never hard-codes a second copy.
 * Plain, short and common words (UI direction, "Words"): "Sample", never "synthetic"; "Corridra
 * team", never "operator". Move and Road are figures of speech and are explained at first use.
 */
export const mrLabels = {
  road: {
    title: 'Where this request stands',
    steps: {
      define: 'Define',
      find: 'Find',
      compare: 'Compare',
      visit: 'Visit',
      decide: 'Decide',
      follow: 'Follow through',
    },
    states: { done: 'Done', now: 'Now', later: 'Later', notTracked: 'Not tracked yet' },
    legend:
      'Done, now, later, or not tracked yet. Not tracked yet means no record exists for that step.',
    sublines: {
      DRAFT: 'The request is saved as a draft.',
      QUALIFICATION: 'The Corridra team is checking your requirement.',
      ACTIVE: 'Your request is approved to start.',
      TARGETING: 'The Corridra team is choosing who to approach.',
      OUTREACH: 'The Corridra team is looking for suppliers or buyers.',
      MEETINGS: 'Meetings are being arranged or held.',
      FOLLOW_UP: 'Follow-up is in progress.',
      COMMERCIAL_PIPELINE: 'A commercial step is in progress.',
      CLOSED: 'This request is closed.',
    },
    asides: {
      on_hold:
        'On hold. The Corridra team has paused this request. The step it resumes from is not shown.',
      cancelled: 'This request was cancelled.',
      unknown: 'Status:',
    },
  },
  holder: {
    you: 'You',
    team: 'Corridra team',
    third: 'Supplier or Buyer',
  },
  move: {
    due: 'Due',
    explainer: 'A Move is the one thing a person must do next.',
  },
  quote: {
    comparable: 'Comparable on supplied terms',
    notComparable: 'Not comparable yet',
    unitPrice: 'Original unit price',
    total: 'Original total',
    notStated: 'Not stated',
    revision: 'Offer revision',
    missing: 'Missing',
  },
  ghost: { example: 'Example' },
  mode: { sample: 'Sample', real: 'Real' },
} as const;

export type MrLabels = typeof mrLabels;
