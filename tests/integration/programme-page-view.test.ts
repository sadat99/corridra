import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  programmePublicCopy,
  type PublicProgrammePage,
} from '../../packages/auth/src/customer-programme-publication';

// The public programme page (ADR-080), rendered as the server renders it. The same component draws the organiser's
// preview, so what is previewed is what is published.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
// The path is assembled at run time: the packages type project does not compile the web application's screens.
const view = 'app/delegations/[address]/programme-page-view';
const load = async () =>
  (await import(/* @vite-ignore */ `../../apps/web/${view}`)) as { ProgrammePageView: unknown };

const address = 'china-agri-machinery-2027-k3f9x2ab7q';
const programme = programmePublicCopy.parse({
  title: 'China agricultural machinery delegation',
  organiser: 'Dhaka Agro Traders Association',
  summary: 'A ten company buying delegation to compare rice transplanters before the next season.',
  destination: 'Guangzhou and Foshan, China',
  dates: '12 to 18 April 2027, to be confirmed',
  focus: 'Agricultural machinery',
  audience: 'Owners and buyers of importers and dealers.',
  eligibility: 'A registered business that imports or sells farm machinery.',
  activities: [
    { label: 'Factory visits in Foshan', status: 'PLANNED' },
    { label: 'Opening briefing', status: 'CONFIRMED' },
  ],
  included: ['Programme coordination'],
  excluded: ['Flights'],
  fee: 'BDT 45,000 per company, paid to the organiser',
  capacity: 10,
});
const page = (over: Partial<PublicProgrammePage> = {}): PublicProgrammePage => ({
  state: 'OPEN',
  programme,
  address,
  version: 2,
  closesAt: '2027-02-01T23:59:00.000000Z',
  publishedAt: '2026-11-11T10:00:00.000000Z',
  sample: false,
  ...over,
});
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('the public programme page', () => {
  it('shows every published field, one Apply action that keeps the address, and who is responsible', async () => {
    const { ProgrammePageView } = await load();
    const html = render(
      ce(ProgrammePageView, {
        page: page(),
        url: `https://corridra.example/delegations/${address}`,
      }),
    );
    const words = text(html);
    for (const value of [
      programme.summary,
      programme.organiser,
      programme.destination,
      programme.dates,
      programme.focus,
      programme.audience,
      programme.eligibility,
      programme.fee!,
      '10 planned',
      'Programme coordination',
      'Flights',
    ])
      expect(words).toContain(value);
    expect(html.match(/class="primary-link"/g)).toHaveLength(1);
    expect(html).toContain(`href="/account/delegations?apply=${address}"`);
    // The facts a person weighs before applying sit with the action, and what follows it is said in three lines.
    expect(words).toMatch(/Applications close\s+1 Feb 2027 \(UTC\)/);
    expect(words).toContain('What happens next');
    expect(words).toContain(
      'If you are invited, you join and read the terms and the fee before you accept them.',
    );
    expect(words).toContain('1 confirmed, 1 planned');
    expect(words).toContain('Applying is not a booking and no fee is taken on this page.');
    expect(words).toContain(
      'Corridra is not the travel operator and has not checked these details.',
    );
    // A planned visit is never shown as confirmed.
    expect(words).toMatch(/Factory visits in Foshan\s+Planned/);
    expect(words).toMatch(/Opening briefing\s+Confirmed/);
    expect(words).not.toContain('sample');
    expect(html).not.toContain('—');
  });

  it('says so when applications are closed and offers no Apply action', async () => {
    const { ProgrammePageView } = await load();
    const html = render(ce(ProgrammePageView, { page: page({ state: 'CLOSED' }) }));
    expect(text(html)).toContain('Applications are closed');
    expect(text(html)).toMatch(/Applications closed\s+1 Feb 2027 \(UTC\)/);
    expect(text(html)).not.toContain('What happens next');
    expect(html).not.toContain('primary-link');
    expect(html).not.toContain('/account/delegations?apply=');
  });

  it('marks a sample page and states unknown facts as not stated, never as zero', async () => {
    const { ProgrammePageView } = await load();
    const { fee: _fee, capacity: _capacity, ...rest } = programme;
    void _fee;
    void _capacity;
    const html = render(
      ce(ProgrammePageView, {
        page: page({
          sample: true,
          programme: { ...rest, activities: [], included: [], excluded: [] },
        }),
      }),
    );
    const words = text(html);
    expect(words).toContain('This is a sample page.');
    expect(words.match(/Not stated yet/g)).toHaveLength(2);
    expect(words).not.toContain('The programme Planned');
    expect(html).not.toContain('programme-plan-title');
  });

  it('draws the organiser preview with the same words and no working Apply or share action', async () => {
    const { ProgrammePageView } = await load();
    const { address: _address, ...withoutAddress } = page();
    void _address;
    const html = render(ce(ProgrammePageView, { page: withoutAddress, preview: true }));
    expect(text(html)).toContain(programme.summary);
    expect(text(html)).toContain('The Apply button appears here on the published page.');
    expect(html).not.toContain('primary-link');
    expect(html).not.toContain('Share this page');
  });
});

it('programme pages are kept from search engines by a response header, and the apply reminder follows the switch', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = (path: string) => readFile(new URL('../../' + path, import.meta.url), 'utf8');
  const config = (await source('apps/web/next.config.ts')).replace(/\s+/g, ' ');
  expect(config).toContain(
    "source: '/delegations/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]",
  );
  for (const page of ['apps/web/app/account/page.tsx', 'apps/web/app/account/move/page.tsx']) {
    const text = await source(page);
    expect(text).toContain('{customerProgrammePagesEnabled() && <ProgrammeApplyNotice />}');
    expect(text.match(/<ProgrammeApplyNotice \/>/g)).toHaveLength(1);
  }
});
