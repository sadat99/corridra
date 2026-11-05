import { describe, expect, it } from 'vitest';
import { missionCatalogue } from '../../packages/domain/src/commercial-missions';
import { intakeExperience } from '../../packages/domain/src/experience';
import {
  briefSchema,
  intakeSteps,
  objectiveOptions,
  outcomeOptions,
  realBriefSchema,
} from '../../packages/domain/src/missions';
import {
  composeBrief,
  composeOffer,
  draftCommandId,
  draftProblems,
  draftReadiness,
  missionDraftObjectives,
  type DraftForBrief,
  type DraftFormValues,
} from '../../packages/domain/src/mission-drafts';
import { currencies } from '../../packages/domain/src/currencies';
import { originalAmountToMinor } from '../../packages/domain/src/locale';
import { objectiveForJob, pictureForJob, pictures } from '../../apps/web/lib/first-question';

// Intake parity guard (revamp Wave 3 precondition). These facts describe the request exactly as it
// works today: the 15 jobs, what each one maps to, what the request schema accepts and refuses, and
// the guided-draft path that turns a saved draft into the same request. They must pass on current main
// and must keep passing after any change to the public home, /plan or the first question. If a number
// here has to change, the change is a product decision, not a refactor.

// Frozen on 4 Nov 2026 from packages/domain/src/commercial-missions.ts.
const jobs = [
  ['buyers', 'Find buyers', ['commercial_relevance', 'buyer_fit']],
  ['customers', 'Find customers', ['commercial_relevance', 'buyer_fit']],
  ['distributors', 'Find distributors', ['distributor_capability']],
  ['partners', 'Find commercial partners', ['commercial_relevance']],
  ['sourcing', 'Source products or components', ['supplier_fit']],
  ['machinery_procurement', 'Procure machinery', ['machinery_fit', 'supplier_fit']],
  ['supplier_evaluation', 'Qualify suppliers', ['supplier_fit']],
  ['meetings', 'Arrange commercial meetings', ['commercial_relevance']],
  ['factory_visits', 'Conduct site visits', ['visit_suitability']],
  ['trade_fairs', 'Improve trade-fair yield', ['commercial_relevance']],
  ['business_trips', 'Plan commercial trip execution', ['commercial_relevance']],
  ['market_validation', 'Validate a market', ['commercial_relevance']],
  ['market_entry', 'Enter a market', ['buyer_fit', 'distributor_capability']],
  ['export_market_access', 'Develop export access', ['buyer_fit']],
  ['delegations', 'Run a multi-company mission', ['commercial_relevance']],
] as const;

// job -> [objective the link sets, picture that opens it, requirement role]
const jobFacts: Record<string, [string, string, string]> = {
  buyers: ['Sell in a New Market', 'sell-abroad', 'EXPORTER'],
  customers: ['Find customers or distributors', 'sell-abroad', 'EXPORTER'],
  distributors: ['Find customers or distributors', 'sell-abroad', 'EXPORTER'],
  partners: ['Find customers or distributors', 'sell-abroad', 'EXPORTER'],
  sourcing: ['Source suppliers', 'buy-products', 'IMPORTER'],
  machinery_procurement: ['Source suppliers', 'buy-machine', 'BUYER'],
  supplier_evaluation: ['Source suppliers', 'buy-products', 'IMPORTER'],
  meetings: ['Make an upcoming business trip more productive', 'something-else', 'EXPORTER'],
  factory_visits: ['Make an upcoming business trip more productive', 'something-else', 'IMPORTER'],
  trade_fairs: ['Make an upcoming business trip more productive', 'something-else', 'EXPORTER'],
  business_trips: ['Make an upcoming business trip more productive', 'something-else', 'EXPORTER'],
  market_validation: ['Sell in a New Market', 'sell-abroad', 'EXPORTER'],
  market_entry: ['Sell in a New Market', 'sell-abroad', 'EXPORTER'],
  export_market_access: ['Sell in a New Market', 'sell-abroad', 'EXPORTER'],
  delegations: ['Run a multi-company mission', 'group-trip', 'INSTITUTION'],
};

describe('the 15 mission jobs', () => {
  it('are exactly these, in this order, with these labels and criteria', () => {
    expect(missionCatalogue.map((j) => [j.key, j.label, [...j.criteria]])).toEqual(
      jobs.map(([key, label, criteria]) => [key, label, [...criteria]]),
    );
    expect(missionCatalogue).toHaveLength(15);
  });
  it.each(jobs)('%s: objective, picture and role are unchanged', (key) => {
    const [objective, picture] = jobFacts[key]!;
    expect(objectiveForJob(key)).toBe(objective);
    expect(pictureForJob(key)).toBe(picture);
    expect(pictures.find((p) => p.key === picture)?.jobs).toContain(key);
  });
  it('the six request objectives and seven outcomes are unchanged', () => {
    expect(objectiveOptions).toEqual([
      'Sell in a New Market',
      'Find customers or distributors',
      'Source suppliers',
      'Make an upcoming business trip more productive',
      'Run a multi-company mission',
      'Something else',
    ]);
    expect(outcomeOptions).toEqual([
      'Relevant meetings',
      'Buyers / customers',
      'Distributor conversations',
      'Supplier visits',
      'Market validation',
      'Local commercial intelligence',
      'Something else',
    ]);
  });
});

// The experience block the form sends, built the way the form builds it (apps/web/app/plan/intake.tsx).
function experience(job: string) {
  const role = jobFacts[job]?.[2] ?? 'EXPORTER';
  const label = missionCatalogue.find((j) => j.key === job)?.label ?? 'Unknown job';
  return {
    schemaVersion: 1,
    companyCountry: 'BD',
    marketCode: 'CN',
    job,
    requirements: { objective: label, role, product: 'Combed cotton yarn, 30s count' },
  };
}

describe('the structured request every job sends', () => {
  it.each(jobs)('%s is accepted with only the required fields', (key) => {
    expect(intakeExperience.safeParse(experience(key)).success).toBe(true);
  });
  it('refuses a job that is not in the catalogue and any extra field', () => {
    expect(intakeExperience.safeParse(experience('anything_else')).success).toBe(false);
    expect(intakeExperience.safeParse({ ...experience('buyers'), surprise: 1 }).success).toBe(
      false,
    );
    const withExtra = experience('buyers') as { requirements: Record<string, unknown> };
    withExtra.requirements.surprise = 1;
    expect(intakeExperience.safeParse(withExtra).success).toBe(false);
  });
  it('carries every field a job captures', () => {
    const full = {
      ...experience('delegations'),
      organiser: 'Dhaka Chamber trade desk',
      participants: 'Twelve garment makers wanting fabric buyers',
    };
    (full.requirements as Record<string, unknown>).specifications = 'Knit fabrics, GOTS';
    (full.requirements as Record<string, unknown>).technicalConstraints = 'Ready by March';
    (full.requirements as Record<string, unknown>).travelDates = '2026-12-01';
    (full.requirements as Record<string, unknown>).decisionCriteria = ['Three buyer meetings'];
    const parsed = intakeExperience.parse(full);
    expect(parsed.organiser).toBe('Dhaka Chamber trade desk');
    expect(parsed.participants).toBe('Twelve garment makers wanting fabric buyers');
    expect(parsed.requirements.specifications).toBe('Knit fabrics, GOTS');
    expect(parsed.requirements.technicalConstraints).toBe('Ready by March');
    expect(parsed.requirements.travelDates).toBe('2026-12-01');
    expect(parsed.requirements.decisionCriteria).toEqual(['Three buyer meetings']);
  });
  it('keeps machinery application, quantity with unit, and budget in the original currency', () => {
    const request = experience('machinery_procurement') as {
      requirements: Record<string, unknown>;
    };
    request.requirements.machinery = { application: 'Knitting line' };
    request.requirements.quantity = '500';
    request.requirements.unit = 'kg';
    request.requirements.budgetMinor = originalAmountToMinor('12.00', 'CNY');
    request.requirements.currency = 'CNY';
    request.requirements.budgetBasis = 'Total equipment budget';
    const parsed = intakeExperience.parse(request);
    expect(parsed.requirements.machinery).toEqual({ application: 'Knitting line' });
    expect(parsed.requirements.budgetMinor).toBe('1200');
    expect(parsed.requirements.currency).toBe('CNY');
  });
  it('refuses a quantity without a unit and a partial budget', () => {
    const noUnit = experience('sourcing') as { requirements: Record<string, unknown> };
    noUnit.requirements.quantity = '500';
    expect(intakeExperience.safeParse(noUnit).success).toBe(false);
    const partial = experience('sourcing') as { requirements: Record<string, unknown> };
    partial.requirements.budgetMinor = '100';
    expect(intakeExperience.safeParse(partial).success).toBe(false);
  });
  it('refuses organiser and participants that are too short', () => {
    expect(
      intakeExperience.safeParse({ ...experience('delegations'), organiser: 'ab' }).success,
    ).toBe(false);
  });
});

describe('original currencies and exact amounts', () => {
  it('converts by each currency own decimal places, never rounding', () => {
    expect(originalAmountToMinor('12.00', 'CNY')).toBe('1200');
    expect(originalAmountToMinor('1.234', 'BHD')).toBe('1234');
    expect(originalAmountToMinor('1500', 'JPY')).toBe('1500');
    expect(() => originalAmountToMinor('1.5', 'JPY')).toThrow(/at most 0 decimal/);
    expect(() => originalAmountToMinor('1.2345', 'BHD')).toThrow(/at most 3 decimal/);
    expect(() => originalAmountToMinor('1,000', 'USD')).toThrow();
    expect(() => originalAmountToMinor('10', 'ZZZ')).toThrow();
    expect(Object.keys(currencies)).toEqual(expect.arrayContaining(['BDT', 'CNY', 'EUR', 'USD']));
  });
});

const brief = {
  objective: 'Source suppliers',
  market: 'China',
  attendance: 'Not decided',
  startDate: '',
  endDate: '',
  timezone: 'UTC',
  offer: 'Combed cotton yarn for a knitting unit',
  website: '',
  outcomes: ['Supplier visits'],
  notes: '',
  name: 'QA buyer',
  company: 'QA test company',
  email: 'QA-Buyer@example.invalid',
  acknowledged: true,
};

describe('the request brief: validation and consent', () => {
  it('accepts a complete sample request and lowercases the email', () => {
    expect(briefSchema.parse(brief).email).toBe('qa-buyer@example.invalid');
  });
  it('carries the structured experience through unchanged', () => {
    const experienceBlock = intakeExperience.parse(experience('sourcing'));
    expect(briefSchema.parse({ ...brief, experience: experienceBlock }).experience).toEqual(
      experienceBlock,
    );
  });
  it('requires consent, in the sample and the real schema', () => {
    expect(briefSchema.safeParse({ ...brief, acknowledged: false }).success).toBe(false);
    expect(
      realBriefSchema.safeParse({ ...brief, email: 'a@firm.com', acknowledged: false }).success,
    ).toBe(false);
  });
  it('keeps sample requests to invented addresses, and real ones to any valid address', () => {
    expect(briefSchema.safeParse({ ...brief, email: 'a@firm.com' }).success).toBe(false);
    expect(realBriefSchema.safeParse({ ...brief, email: 'a@firm.com' }).success).toBe(true);
  });
  it('refuses a missing objective, a short offer, no outcome, a bad website and a bad name', () => {
    for (const bad of [
      { objective: 'Anything' },
      { offer: 'too short' },
      { outcomes: [] },
      { outcomes: ['Relevant meetings', 'Relevant meetings'] },
      { website: 'ftp://example.com' },
      { name: 'A' },
      { company: 'A' },
      { market: 'C' },
      { timezone: 'Nowhere/Land' },
    ])
      expect(briefSchema.safeParse({ ...brief, ...bad }).success, JSON.stringify(bad)).toBe(false);
  });
  it('asks for visit dates only when attending in person', () => {
    expect(briefSchema.safeParse({ ...brief, attendance: 'Yes' }).success).toBe(false);
    expect(
      briefSchema.safeParse({
        ...brief,
        attendance: 'Yes',
        startDate: '2026-12-02',
        endDate: '2026-12-01',
      }).success,
    ).toBe(false);
    expect(
      briefSchema.safeParse({
        ...brief,
        attendance: 'Yes',
        startDate: '2026-12-01',
        endDate: '2026-12-05',
      }).success,
    ).toBe(true);
    expect(briefSchema.safeParse({ ...brief, startDate: '2026-12-01' }).success).toBe(false);
  });
  it('splits into five steps whose fields cover the whole brief', () => {
    const keys = intakeSteps.flatMap((step) => Object.keys(step.shape ?? {}));
    expect(new Set(keys)).toEqual(
      new Set([
        'objective',
        'market',
        'attendance',
        'startDate',
        'endDate',
        'timezone',
        'offer',
        'website',
        'outcomes',
        'notes',
        'name',
        'company',
        'email',
        'acknowledged',
      ]),
    );
  });
});

const draft: DraftForBrief = {
  family: 'SUPPLIERS_PRODUCTS',
  objective: 'Source suppliers',
  market: 'China',
  attendance: 'Not decided',
  startDate: '',
  endDate: '',
  timezone: 'UTC',
  offer: 'Synthetic combed cotton yarn for a knitting unit',
  website: '',
  outcomes: ['Supplier visits'],
  notes: '',
  requirements: [{ label: 'MOQ', value: 'Synthetic 500 kg' }],
  contactName: 'QA buyer',
  contactEmail: 'qa-buyer@example.invalid',
  companyName: 'Synthetic QA company',
};

describe('the guided draft path turns into the same request', () => {
  it('names an objective set for every family, each one a valid request objective', () => {
    expect(Object.keys(missionDraftObjectives).sort()).toEqual(
      ['BUYERS_PARTNERS', 'DELEGATION', 'OTHER', 'SUPPLIERS_PRODUCTS'].sort(),
    );
    for (const list of Object.values(missionDraftObjectives))
      for (const objective of list) expect(objectiveOptions).toContain(objective);
  });
  it('carries the customer own words unchanged and appends requirement lines after them', () => {
    expect(composeOffer(draft)).toBe(
      'Synthetic combed cotton yarn for a knitting unit\n\nRequirements:\nMOQ: Synthetic 500 kg',
    );
    expect(composeOffer({ offer: 'Only this', requirements: [] })).toBe('Only this');
  });
  it('composes a request from a ready draft and names plain gaps when it is not ready', () => {
    expect(draftReadiness(draft)).toEqual({ ready: true, gaps: [] });
    expect(composeBrief(draft)?.offer).toContain('MOQ: Synthetic 500 kg');
    const missing = draftReadiness({ ...draft, offer: '', outcomes: [], market: '' });
    expect(missing.ready).toBe(false);
    expect(missing.gaps).toEqual(
      expect.arrayContaining([
        'what you offer or need (at least 10 characters)',
        'at least one outcome you want',
        'the target country or market',
      ]),
    );
    expect(composeBrief({ ...draft, offer: 'short' })).toBeNull();
  });
  it('keeps saving rules: synthetic wording, limits, dates and unique requirement lines', () => {
    const values: DraftFormValues = {
      ...draft,
      title: 'Synthetic yarn request',
      sourcingContext: null,
      profileVersion: null,
    };
    expect(draftProblems(values)).toEqual([]);
    const fields = (v: Partial<DraftFormValues>) =>
      draftProblems({ ...values, ...v }).map((p) => p.field);
    expect(fields({ title: 'Yarn request' })).toContain('title');
    expect(fields({ offer: 'x'.repeat(2001) })).toContain('offer');
    expect(fields({ startDate: '2026-12-05', endDate: '2026-12-01' })).toContain('endDate');
    expect(fields({ contactEmail: 'a@firm.com' })).toContain('contactEmail');
    expect(fields({ outcomes: ['Supplier visits', 'Supplier visits'] })).toContain('outcomes');
    expect(
      fields({
        requirements: [
          { label: 'MOQ', value: 'Synthetic 500 kg' },
          { label: 'moq', value: 'Synthetic 600 kg' },
        ],
      }),
    ).toContain('requirements.1.label');
  });
  it('resumes safely: the same draft version always yields the same command id', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const a = await draftCommandId('send', id, 3);
    expect(await draftCommandId('send', id, 3)).toBe(a);
    expect(await draftCommandId('send', id, 4)).not.toBe(a);
    expect(await draftCommandId('close', id, 3)).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
