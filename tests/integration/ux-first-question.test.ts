import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { missionCatalogue } from '../../packages/domain/src/commercial-missions';
import { missionDraftObjectives } from '../../packages/domain/src/mission-drafts';
import {
  objectiveForJob,
  pictureForJob,
  pictures,
  selectedPicture,
} from '../../apps/web/lib/first-question';

// The first question (Lane 6 of the UX update): five pictures that open the existing job types. The
// table is checked against every other place that names a job, so they cannot drift apart.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
    ...rest
  }: {
    children: unknown;
    href: string;
    className?: string;
  }) => createElement('a', { href, className, ...rest }, children as never),
}));
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const render = (type: unknown, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(type, props));
const read = (path: string) => readFileSync(resolve(path), 'utf8');

// The mapping the plan page used before this lane, frozen so the move cannot change a result.
function objectiveForJobBefore(job: string) {
  if (['sourcing', 'machinery_procurement', 'supplier_evaluation'].includes(job))
    return 'Source suppliers';
  if (job === 'delegations') return 'Run a multi-company mission';
  if (['business_trips', 'factory_visits', 'trade_fairs', 'meetings'].includes(job))
    return 'Make an upcoming business trip more productive';
  if (['customers', 'distributors', 'partners'].includes(job))
    return 'Find customers or distributors';
  return 'Sell in a new market';
}

describe('the mapping table is complete', () => {
  const catalogue = missionCatalogue.map((job) => job.key as string);
  const listed = pictures.flatMap((picture) => [...picture.jobs]);

  it('has the five pictures in order', () => {
    expect(pictures.map((p) => p.key)).toEqual([
      'buy-products',
      'buy-machine',
      'sell-abroad',
      'group-trip',
      'something-else',
    ]);
  });
  it('opens every job type the code holds, each under exactly one picture', () => {
    expect([...listed].sort()).toEqual([...catalogue].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });
  it('names no job the code does not hold', () => {
    for (const job of listed) expect(catalogue, job).toContain(job);
  });
  it('starts a picture on one of its own jobs, or leaves the choice to the person', () => {
    for (const picture of pictures)
      if (picture.defaultJob) expect(picture.jobs, picture.key).toContain(picture.defaultJob);
    expect(pictures.find((p) => p.key === 'something-else')?.defaultJob).toBeNull();
  });
});

describe('the three places that name a job agree', () => {
  it('the request objective that goes with each job is unchanged from before', () => {
    for (const job of [...missionCatalogue.map((j) => j.key as string), 'nonsense', ''])
      expect(objectiveForJob(job), job).toBe(objectiveForJobBefore(job));
  });
  it('the guided-draft starters accept the objective of every job a picture opens', () => {
    for (const picture of pictures)
      for (const job of picture.jobs)
        expect(missionDraftObjectives[picture.family], `${picture.key} / ${job}`).toContain(
          objectiveForJob(job),
        );
  });
  it('the home cards open jobs that sit under the picture of the same name', () => {
    const home = read('apps/web/app/page.tsx');
    const jobs = [...home.matchAll(/\/plan\?job=([a-z_]+)/g)].map((m) => m[1]);
    expect(jobs.sort()).toEqual(['buyers', 'delegations', 'sourcing']);
    expect(pictureForJob('buyers')).toBe('sell-abroad');
    expect(pictureForJob('sourcing')).toBe('buy-products');
    expect(pictureForJob('delegations')).toBe('group-trip');
  });
  it('every public page that opens the plan opens a job a picture holds', () => {
    // Read as text: the content file is page data that imports a component, which the package check cannot compile.
    const pages = read('apps/web/content/public-pages.ts');
    const jobs = [...pages.matchAll(/intakeJob(?:\?)?\s*[:=]\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(jobs.length).toBeGreaterThanOrEqual(6);
    for (const job of jobs) expect(pictureForJob(job), job).not.toBeNull();
    expect(pictureForJob('machinery_procurement')).toBe('buy-machine');
  });
});

describe('which picture is chosen', () => {
  it('follows the objective "Something else" first, then the job', () => {
    expect(selectedPicture('', '')).toBeNull();
    expect(selectedPicture('Something else', 'market_validation')).toBe('something-else');
    expect(selectedPicture('Sell in a new market', 'buyers')).toBe('sell-abroad');
    expect(selectedPicture('Source suppliers', 'machinery_procurement')).toBe('buy-machine');
    expect(
      selectedPicture('Make an upcoming business trip more productive', 'business_trips'),
    ).toBe('something-else');
  });
});

describe('the picture with no default job', () => {
  it('leaves the job for the person to choose instead of using the older objective default', () => {
    const intake = readFileSync(resolve('apps/web/app/plan/intake.tsx'), 'utf8');
    expect(intake).toContain("change('objective', 'Something else', true)");
    expect(intake).toContain('openJob = false');
    // The older radios still get their older default, so the switch-off behaviour is unchanged.
    expect(intake).toContain("'Something else': 'market_validation'");
    expect(intake).toContain("onChange={() => change('objective', v)}");
  });
});

describe('the pictures', () => {
  it('are five real radio buttons with an icon, a label and a line of help, and mark the chosen one by more than colour', async () => {
    const { FirstQuestion } = await load('components/mr/first-question');
    const html = render(FirstQuestion, { value: 'buy-machine', onChoose: () => {} });
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    expect(html.match(/name="first-question"/g)).toHaveLength(5);
    for (const label of [
      'Buy products',
      'Buy a machine',
      'Sell abroad',
      'Lead a group trip',
      'Trips, visits or fairs',
    ])
      expect(html).toContain(label);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain('data-checked="true"');
    // The check mark is drawn for the chosen card, so the choice never depends on colour alone.
    expect(html.match(/mr-fq-check/g)).toHaveLength(5);
    expect(html).toContain('role="radiogroup"');
  });
});

describe('the plan page keeps everything it had', () => {
  const intake = read('apps/web/app/plan/intake.tsx');
  it('leaves the original radios, the full job list and the draft handling in place', () => {
    expect(intake).toContain('objectiveOptions.map');
    expect(intake).toContain('missionCatalogue.map');
    expect(intake).toContain('firstQuestion = false');
    expect(intake).toContain('corridra-mission-draft');
    expect(intake).toContain('const suggestedJob = query.get');
    expect(intake).toContain('86400000');
  });
  it('is switched on from the server only', () => {
    expect(read('apps/web/app/plan/page.tsx')).toContain(
      "firstQuestion={uxSwitchOn('CORRIDRA_UX_FIRSTQ')}",
    );
  });
});

describe('one Sample or Real label per site', () => {
  // The header reads the app router for sign-out; the app resolves its own copy of next, so mock that one.
  vi.doMock(web.resolve('next/navigation'), () => ({
    useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }),
    usePathname: () => '/',
  }));
  it('with the switch off the start button is exactly as it was, with its screen-reader text', async () => {
    const { SiteHeader } = await load('components/site-header');
    const html = render(SiteHeader, { accounts: false });
    expect(html).toContain('Start a request <span class="sr-only">(sample request)</span>');
    expect(html).not.toContain('mr-mode');
  });
  it('with the switch on there is one visible label and no repeated suffix', async () => {
    const { SiteHeader } = await load('components/site-header');
    const sample = render(SiteHeader, { accounts: false, mode: 'sample' });
    expect(sample.match(/class="mr-mode"/g)).toHaveLength(1);
    expect(sample).toContain('data-mode="sample"');
    expect(sample).toContain('>Sample<');
    expect(sample).not.toContain('(sample request)');
    expect(sample).toContain('>Start a request<');
    const real = render(SiteHeader, { accounts: false, mode: 'real' });
    expect(real).toContain('data-mode="real"');
    expect(real).toContain('>Real<');
    expect(real).not.toContain('(sample request)');
  });
  it('is chosen by the server layout from the switch and the real-use state', () => {
    const layout = read('apps/web/app/layout.tsx');
    expect(layout).toContain("uxSwitchOn('CORRIDRA_UX_FIRSTQ')");
    expect(layout).toMatch(/realUseEnabled\(\)\s*\?\s*'real'\s*:\s*'sample'/);
  });
});
