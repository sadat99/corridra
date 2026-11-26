// Page words of /how-it-works and /trust that exist only in the one-job-per-page layout (owner, 26 Nov 2026, first
// hand to Guardian G66; docs/revamp/mockups/how-trust-v43 on the mockups branch). English, like the rest of the content
// of these two pages (content/public-pages.ts): the headline, the six steps and the five labels are English there too.
// Everything else on the pages is an existing key (home.tr.*, home.v43.*), each used once per page.

export const howTrustV43 = {
  tocLabel: 'On this page',
  howItWorks: {
    action: { href: '#how', label: 'See All Fourteen Steps' },
    toc: [
      { href: '#page-approach', label: 'The Approach in Six Steps' },
      { href: '#page-next', label: 'What to Expect' },
      { href: '#process', label: 'Four Stages, by Route' },
      { href: '#how', label: 'The Fourteen Steps and Four Rules' },
      { href: '#who', label: 'Who It Is For' },
      { href: '#faq', label: 'Questions About the Process' },
    ],
    approachEyebrow: 'The approach',
    expectEyebrow: 'What to expect',
    stagesGroup: 'Explore a mission stage',
    optionalKey: 'Dashed dot: optional',
  },
  trust: {
    action: { href: '#trust', label: 'See a History Example' },
    toc: [
      { href: '#page-approach', label: 'The Five Labels' },
      { href: '#trust', label: 'Every Fact Says How It Is Known' },
      { href: '#outcomes', label: 'Commercial Outcome Stages' },
      { href: '#page-next', label: 'What AI Can and Cannot Do' },
      { href: '#routes', label: 'Route Statuses' },
      { href: '#limits', label: 'Plain Limits' },
      { href: '#faq', label: 'Questions About Trust' },
    ],
    approachEyebrow: 'The five evidence labels',
    aiEyebrow: 'Where AI stops',
    legend: 'The five labels in one line each',
    illustrative: 'Illustrative example. The company, amounts and dates are invented.',
  },
  /** The long questions of the live /how-it-works, split four and four between the two pages (single source home.tr.fq.*). */
  faq: {
    howItWorks: [8, 3, 4, 5],
    trust: [6, 1, 2, 7],
  },
} as const;
