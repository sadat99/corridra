// The first question of a request: five pictures that open the existing job types. This table is the
// one place that says which picture opens which job, so the plan page, the home cards, the public
// pages and the guided-draft starters cannot disagree (tests/integration/ux-first-question.test.ts
// checks all of them against it and against the job catalogue the code itself holds). Every job type
// stays selectable: a picture only chooses a sensible start.
import type { MissionDraftFamily } from '@corridra/domain/mission-drafts';

export type PictureKey =
  'buy-products' | 'buy-machine' | 'sell-abroad' | 'group-trip' | 'something-else';

export type Picture = {
  key: PictureKey;
  icon: string;
  /** The guided-draft family whose objectives these jobs belong to. */
  family: MissionDraftFamily;
  /** Every job type this picture opens, as the job catalogue names them. */
  jobs: readonly string[];
  /** The job chosen when the picture is chosen. Null: the person picks one. */
  defaultJob: string | null;
};

export const pictures: readonly Picture[] = [
  {
    key: 'buy-products',
    icon: 'buy',
    family: 'SUPPLIERS_PRODUCTS',
    jobs: ['sourcing', 'supplier_evaluation'],
    defaultJob: 'sourcing',
  },
  {
    key: 'buy-machine',
    icon: 'settings',
    family: 'SUPPLIERS_PRODUCTS',
    jobs: ['machinery_procurement'],
    defaultJob: 'machinery_procurement',
  },
  {
    key: 'sell-abroad',
    icon: 'sell',
    family: 'BUYERS_PARTNERS',
    jobs: [
      'buyers',
      'customers',
      'distributors',
      'partners',
      'market_validation',
      'market_entry',
      'export_market_access',
    ],
    defaultJob: 'buyers',
  },
  {
    key: 'group-trip',
    icon: 'trip',
    family: 'DELEGATION',
    jobs: ['delegations'],
    defaultJob: 'delegations',
  },
  {
    // Preserve the historical key and objective/deep links. The visible entry now names visits.
    key: 'something-else',
    icon: 'trip',
    family: 'OTHER',
    jobs: ['meetings', 'factory_visits', 'trade_fairs', 'business_trips'],
    defaultJob: null,
  },
];

/** The request objective that goes with a job. This is the rule the plan page has always used. */
export function objectiveForJob(job: string) {
  if (['sourcing', 'machinery_procurement', 'supplier_evaluation'].includes(job))
    return 'Source suppliers';
  if (job === 'delegations') return 'Run a multi-company mission';
  if (['business_trips', 'factory_visits', 'trade_fairs', 'meetings'].includes(job))
    return 'Make an upcoming business trip more productive';
  if (['customers', 'distributors', 'partners'].includes(job))
    return 'Find customers or distributors';
  return 'Sell in a new market';
}

export function pictureForJob(job: string): PictureKey | null {
  return pictures.find((picture) => picture.jobs.includes(job))?.key ?? null;
}

/**
 * Which picture is chosen now. The objective "Something else" always means that picture; otherwise
 * the job decides. Nothing chosen yet means no picture.
 */
export function selectedPicture(objective: string, job: string): PictureKey | null {
  if (objective === 'Something else') return 'something-else';
  return job ? pictureForJob(job) : null;
}
