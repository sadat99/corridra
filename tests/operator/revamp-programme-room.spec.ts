import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Wave 5 organiser room, browser cases C-09 and C-10 (docs/revamp/specs/programme-consent.md). The real
// programme list and room with the real stylesheet, every API answering "unavailable" calmly, so what is
// counted is the room's own structure: which views there are, which ids and links they expose, and that each
// original view is still reachable. The views are opened generically (every button of the group), so the check
// holds however the views are grouped. Names are invented; nothing is real. Sensitive: yes (consent).
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-000000000001';
const programmeId = '00000000-0000-4000-8000-000000000002';
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const programme = {
  id: programmeId,
  workspaceId,
  name: 'Synthetic commercial delegation',
  reportingPurpose: 'Fictional participant needs and commercial objectives',
  createdAt: '2026-10-18T00:00:00Z',
  synthetic: true,
};

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{CustomerProgrammes}from ${JSON.stringify(resolve('apps/web/app/account/delegations/customer-programmes.tsx'))};
      import{ProgrammeRoomStyles}from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-room-styles.tsx'))};
      const q=new URLSearchParams(location.search);
      const room=q.get('room')==='1';
      const bare=q.get('bare')==='1';
      createRoot(document.getElementById('fixture')).render(
        <main className="operator-page ux-workspace">
          <h1>Plan delegations</h1>
          {room&&<ProgrammeRoomStyles/>}
          <CustomerProgrammes subject="synthetic-alice" issuer=${JSON.stringify(issuer)} workspaceId=${JSON.stringify(workspaceId)}
            participantsEnabled={!bare} coordinationEnabled={!bare} termsEnabled={!bare} economicsEnabled={!bare}
            templatesEnabled={false} roomEnabled={room} projectionsEnabled={q.get('proj')==='1'}/>
        </main>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css' },
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [
      {
        name: 'next-fixture',
        setup(b) {
          b.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
            contents:
              args.path === 'next/link'
                ? 'export default function Link({prefetch,...props}){return <a {...props}/>}'
                : 'const router={replace:()=>{},refresh:()=>{},push:()=>{}};export function useRouter(){return router}',
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
      return;
    }
    if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Programme fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

const frozenIds = ['overview', 'people', 'companies', 'agenda', 'plan', 'terms', 'money'];
const frozenLinks: string[] = [];
type Meetings = {
  state: 'NOT_SHARED' | 'UNAVAILABLE' | 'AVAILABLE' | 'PARTIAL';
  sharedLinks: number;
  unavailableLinks: number;
  participantsSharing: number;
  scheduled: number | null;
  qualifiedHeld: number | null;
};
const projection = (meetings: Meetings) => ({
  workspaceId,
  programmeId,
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  sendsMessages: false,
  readiness: { activeParticipants: 4, readyParticipants: 1, definition: 'x' },
  companies: [],
  nextAfter: null,
  context: null,
  agenda: [],
  conflicts: [],
  meetings,
});

async function open(
  page: Page,
  query: string,
  meetings?: Meetings,
  extra: { body?: Record<string, unknown>; economics?: Record<string, unknown> } = {},
) {
  await page.route('**/api/customer-programme-*', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  if (meetings)
    await page.route('**/api/customer-programme-projections**', (route) =>
      route.fulfill({ json: { ...projection(meetings), ...extra.body } }),
    );
  if (extra.economics)
    await page.route('**/api/customer-programme-economics**', (route) => {
      const view = new URL(route.request().url()).searchParams.get('view');
      return route.fulfill({
        json:
          view === 'summary'
            ? extra.economics
            : {
                workspaceId,
                programmeId,
                entries: [],
                nextBefore: null,
                expiresAt: new Date(Date.now() + 600000).toISOString(),
              },
      });
    });
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill({
      json: { workspaceId, programmes: [programme], nextAfter: null, synthetic: true },
    }),
  );
  await page.goto(`${origin}/?${query}`);
  await expect(page.getByRole('article', { name: programme.name })).toBeVisible();
}

// Opens every group the room offers, whatever it is called, and reports the room's structure.
async function structure(page: Page) {
  const room = page.getByRole('article', { name: programme.name });
  const views = room.getByRole('group', { name: 'Programme views' });
  const labels = await views.getByRole('button').allInnerTexts();
  const count = await views.getByRole('button').count();
  for (let index = 0; index < count; index++) await views.getByRole('button').nth(index).click();
  const found = await page.evaluate(
    ({ id }) => {
      const room = document.querySelector('article.programme-room')!;
      const sections = Array.from(room.querySelectorAll(`section[id^="${id}-"]`)).map(
        (node) => node.id,
      );
      const ids = Array.from(room.querySelectorAll('[id]'))
        .map((node) => node.id)
        .sort();
      const links = Array.from(room.querySelectorAll('a[href]'))
        .map((node) => node.getAttribute('href')!)
        .sort();
      const controlled = new Set(
        Array.from(room.querySelectorAll('.room-lens')).flatMap((node) =>
          (node.getAttribute('aria-controls') ?? '').split(' ').filter(Boolean),
        ),
      );
      // A view is reachable when a button controls it or it sits inside a section a button controls.
      const reachable = (sectionId: string) => {
        for (let node = document.getElementById(sectionId); node; node = node.parentElement)
          if (node.id && controlled.has(node.id)) return true;
        return false;
      };
      return {
        sections,
        ids,
        links,
        controlled: Array.from(controlled),
        reachable: sections.filter(reachable),
      };
    },
    { id: programmeId },
  );
  return { labels, ...found };
}

const groups = [
  'Overview',
  'Participants and eligibility',
  'Programme and meetings',
  'Terms and fees',
  'Results',
];
const oldKeys = ['overview', 'people', 'plan', 'terms', 'money'];
const section = (key: string) => `${programmeId}-${key}`;

test('C-10 with the projections switch off, companies, agenda conflicts and counts are absent and every existing view is reachable as before', async ({
  page,
}) => {
  await open(page, 'room=1&proj=0');
  const found = await structure(page);
  expect(found.labels).toEqual(groups);
  // Every original view, section id and its panel are there and reachable.
  for (const key of oldKeys) {
    expect(found.sections, key).toContain(section(key));
    expect(found.reachable, key).toContain(section(key));
  }
  // The company, agenda and count views are absent, and the counts are stated as not available, never as 0.
  for (const absent of ['companies', 'agenda'])
    expect(found.sections).not.toContain(section(absent));
  await expect(
    page.getByRole('heading', { name: /Companies and readiness|Timed agenda|Meeting results/ }),
  ).toHaveCount(0);
  await expect(page.getByText(/Meeting counts are\b(?! not available)/)).toHaveCount(0);
  await expect(page.locator('[aria-label="Programme company and meeting sharing"]')).toHaveCount(0);
  const results = page.locator(`[id="${section('results')}"]`);
  await expect(
    results.getByText('Meeting counts are not available for this programme.'),
  ).toBeVisible();
  await expect(results).not.toContainText(/Scheduled meetings|Qualified held|: 0\b/);
});

test('C-09 every original room view stays reachable under its section id, and no id or link is lost', async ({
  page,
}) => {
  await open(page, 'room=1&proj=1');
  const found = await structure(page);
  expect(found.labels).toEqual(groups);
  // The five original views and the two projection views: each one still has its section id and is reachable.
  const keys = [...oldKeys, 'companies', 'agenda'];
  for (const key of keys) {
    expect(found.sections, key).toContain(section(key));
    expect(found.reachable, key).toContain(section(key));
  }
  // No id or link of the room as it was before the regroup is gone. Frozen on 4 Nov 2026 from the room before
  // Wave 5, with every API answering unavailable: the room's own seven section ids and no links. The panels
  // inside are not touched by the regroup and have their own id and link tests.
  for (const id of frozenIds) expect(found.ids, id).toContain(section(id));
  for (const href of frozenLinks) expect(found.links, href).toContain(href);
  // The groups hold the views as agreed: nothing is in two places.
  const parentOf = async (key: string) =>
    page
      .locator(`[id="${section(key)}"]`)
      .evaluate((node) => node.parentElement?.closest('section')?.id ?? '');
  expect(await parentOf('companies')).toBe(section('people'));
  expect(await parentOf('agenda')).toBe(section('plan'));
  expect(await parentOf('money')).toBe(section('terms'));
});

// Results: the two counts, as two numbers, with the honest states. Nothing is shown as zero unless it is zero.
const shared = { sharedLinks: 3, unavailableLinks: 0, participantsSharing: 2 };
test('C-04 C-05 Results shows scheduled and qualified-held as two separate numbers', async ({
  page,
}) => {
  await open(page, 'room=1&proj=1', {
    state: 'AVAILABLE',
    ...shared,
    scheduled: 2,
    qualifiedHeld: 1,
  });
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  const results = page.locator(`[id="${section('results')}"]`);
  await expect(results.getByText('Scheduled meetings: 2')).toBeVisible();
  await expect(results.getByText('Qualified held meetings: 1')).toBeVisible();
  await expect(results.getByText(/never counts as qualified/)).toBeVisible();
});

test('C-02 C-04 Results says not shared when no participant has allowed counts, never zero', async ({
  page,
}) => {
  await open(page, 'room=1&proj=1', {
    state: 'NOT_SHARED',
    sharedLinks: 0,
    unavailableLinks: 0,
    participantsSharing: 0,
    scheduled: null,
    qualifiedHeld: null,
  });
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  const results = page.locator(`[id="${section('results')}"]`);
  await expect(results.getByText(/^Not shared/)).toBeVisible();
  await expect(results).not.toContainText(/Scheduled meetings|Qualified held/);
});

test('C-07 Results says not measured yet when the counts cannot be read, never zero', async ({
  page,
}) => {
  // Every API answers unavailable: the data was never read.
  await open(page, 'room=1&proj=1');
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  const results = page.locator(`[id="${section('results')}"]`);
  await expect(results.getByText(/^Not measured yet/)).toBeVisible();
  await expect(results).not.toContainText(/Scheduled meetings|Qualified held|: 0\b/);
  // The sources are unavailable: also not measured, not zero.
  const other = await page.context().newPage();
  await open(other, 'room=1&proj=1', {
    state: 'UNAVAILABLE',
    sharedLinks: 0,
    unavailableLinks: 2,
    participantsSharing: 0,
    scheduled: null,
    qualifiedHeld: null,
  });
  await other.getByRole('button', { name: 'Results', exact: true }).click();
  await expect(
    other.locator(`[id="${section('results')}"]`).getByText(/^Not measured yet/),
  ).toBeVisible();
});

// C-06 in the rendered organiser HTML. The projection answers with extra private fields that the organiser
// must never be sent; the room renders only what it is meant to, so none of them can appear in the page.
const seeded = {
  title: 'Seeded private meeting title',
  counterparty: 'Seeded Counterparty Trading Ltd',
  contact: 'seeded.contact@private.example',
  note: 'Seeded private negotiation note',
  opportunityValue: 'USD 99999 seeded opportunity value',
  missionId: '00000000-0000-4000-8000-0000000000aa',
};
test('C-06 the rendered organiser room shows no meeting title, counterparty, contact, note, value or mission id', async ({
  page,
}) => {
  await open(
    page,
    'room=1&proj=1',
    {
      state: 'AVAILABLE',
      sharedLinks: 2,
      unavailableLinks: 0,
      participantsSharing: 1,
      scheduled: 2,
      qualifiedHeld: 1,
      ...seeded,
    } as Meetings,
    {
      body: {
        companies: [
          {
            registrationId: '00000000-0000-4000-8000-0000000000bb',
            label: 'Synthetic participant label',
            company: {
              name: 'Synthetic shared company',
              countryCode: 'BD',
              roles: ['SELLER'],
              sectors: ['Textiles'],
              objective: 'Synthetic shared objective',
              profileVersion: 1,
              provenance: 'SELF_REPORTED',
              website: 'https://seeded-private.example',
              contactEmail: seeded.contact,
              summary: seeded.note,
            },
            ready: true,
            missing: [],
          },
        ],
      },
    },
  );
  const found = await structure(page);
  expect(found.labels).toEqual(groups);
  const room = page.getByRole('article', { name: programme.name });
  const html = await room.innerHTML();
  // Every group is searched, including the ones that are hidden after the last click.
  const text = (await room.evaluate((node) => node.textContent)) ?? '';
  // The room did render the allowed fields, so the absence below is not an empty page.
  expect(text).toContain('Synthetic shared company');
  expect(text).toContain('Scheduled meetings: 2');
  for (const secret of [...Object.values(seeded), 'seeded-private.example'])
    expect(html + text, secret).not.toContain(secret);
});

// C-07: a readiness total appears only when it was measured. Unread data is never a guessed total.
test('C-07 readiness shows N of M from the server, and not measured yet when it cannot be read', async ({
  page,
}) => {
  await open(page, 'room=1&proj=1', {
    state: 'NOT_SHARED',
    sharedLinks: 0,
    unavailableLinks: 0,
    participantsSharing: 0,
    scheduled: null,
    qualifiedHeld: null,
  });
  await page.getByRole('button', { name: 'Participants and eligibility', exact: true }).click();
  await expect(page.getByText('1 of 4 active participants ready')).toBeVisible();
  const other = await page.context().newPage();
  await open(other, 'room=1&proj=1');
  await other.getByRole('button', { name: 'Participants and eligibility', exact: true }).click();
  await other.getByRole('button', { name: 'Results', exact: true }).click();
  const room = other.getByRole('article', { name: programme.name });
  await expect(room.locator('.programme-boarding')).toContainText('Not measured yet');
  await expect(room.getByText(/^Not measured yet/).first()).toBeVisible();
  expect(await room.innerText()).not.toMatch(/\d+ of \d+ active participants ready/);
});

// C-08: organiser revenue (what participants owe the organiser) and Corridra's own fee carry their own labels,
// and nothing a participant holds about price, quote or trade value is in the organiser room.
test('C-08 organiser fees and the Corridra service fee have their own labels, with no participant price', async ({
  page,
}) => {
  const costs = {
    expenses: '100000',
    obligations: '50000',
    corridraServiceFees: '25000',
    total: '175000',
  };
  await open(page, 'room=1&proj=0', undefined, {
    economics: {
      workspaceId,
      programmeId,
      collectsPayments: false,
      verified: false,
      currencies: [
        {
          currency: 'BDT',
          feesDue: '500000',
          paymentsRecorded: '200000',
          outstanding: '300000',
          plannedCosts: costs,
          actualCosts: costs,
          marginIfPlanned: '325000',
          marginOnActual: '325000',
          cashMargin: '25000',
        },
      ],
      participants: [
        {
          registrationId: '00000000-0000-4000-8000-0000000000cc',
          label: 'Synthetic participant label',
          state: 'ACTIVE',
          amounts: [
            {
              currency: 'BDT',
              due: '500000',
              recorded: '200000',
              status: 'PART_PAID',
              quote: 'Seeded participant quote USD 7777',
            },
          ],
          tradeValue: 'Seeded participant trade value USD 8888',
          price: 'Seeded participant price USD 9999',
        },
      ],
      counts: { registered: 1, active: 1, withdrawnOrRemoved: 0 },
    },
  });
  await page.getByRole('button', { name: 'Terms and fees', exact: true }).click();
  const money = page.locator(`[id="${section('money')}"]`);
  const finances = money.getByRole('region', { name: 'Sample programme finances' });
  await expect(finances).toBeVisible();
  // Organiser income, Corridra's fee and the organiser's own costs are different rows with different words.
  await expect(
    finances.getByRole('rowheader', { name: 'Fees due from participants' }),
  ).toBeVisible();
  await expect(finances.getByRole('row', { name: /^Planned costs/ })).toContainText(
    /Corridra service fee/,
  );
  await expect(
    finances.getByText('Corridra service fee you owe under your own agreement'),
  ).toHaveCount(1);
  await expect(
    finances.getByText(
      /not verified by Corridra\. Corridra does not collect, hold or send any money/,
    ),
  ).toBeVisible();
  const text = (await money.evaluate((node) => node.textContent)) ?? '';
  expect(text).not.toMatch(/Corridra revenue/i);
  for (const secret of [
    'Seeded participant quote',
    'Seeded participant trade value',
    'Seeded participant price',
    '9999',
    '8888',
    '7777',
  ])
    expect(text, secret).not.toContain(secret);
  expect(await money.innerHTML()).not.toMatch(/Seeded participant/);
});

// Wave 5 quality pass: the five groups in every state, by keyboard, and under axe. Names are invented.
const none: Meetings = {
  state: 'NOT_SHARED',
  sharedLinks: 0,
  unavailableLinks: 0,
  participantsSharing: 0,
  scheduled: null,
  qualifiedHeld: null,
};
const broken = /\bundefined\b|\bNaN\b|\bnull\b|\[object|\{\{/;

// Opens a group by its button and returns its visible panel text.
async function groupText(page: Page, name: string) {
  const room = page.getByRole('article', { name: programme.name });
  await room.getByRole('button', { name, exact: true }).click();
  const panel = room.locator('.room-panel:not([hidden]), [role="region"]:not([hidden])').last();
  await expect(room.getByRole('button', { name, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  return room
    .evaluate((node, label) => {
      const button = Array.from(node.querySelectorAll('.room-lens')).find(
        (item) => item.textContent?.trim() === label,
      );
      const ids = (button?.getAttribute('aria-controls') ?? '').split(' ').filter(Boolean);
      return ids
        .map((id) => document.getElementById(id))
        .filter((item): item is HTMLElement => !!item && !item.hidden)
        .map((item) => item.innerText)
        .join('\n');
    }, name)
    .then((text) => ({ text, panel }));
}

for (const [label, setup] of [
  ['loading (the projection has not answered)', 'loading'],
  ['an error (503)', 'error'],
  ['denied (403)', 'denied'],
] as const) {
  test(`quality: every group says something plain while ${label}, and Results never shows 0`, async ({
    page,
  }) => {
    await page.route('**/api/customer-programme-*', (route) =>
      setup === 'loading'
        ? undefined
        : route.fulfill({ status: setup === 'denied' ? 403 : 503, json: { error: 'unavailable' } }),
    );
    await page.route('**/api/customer-programmes*', (route) =>
      route.fulfill({
        json: { workspaceId, programmes: [programme], nextAfter: null, synthetic: true },
      }),
    );
    await page.goto(`${origin}/?room=1&proj=1`);
    await expect(page.getByRole('article', { name: programme.name })).toBeVisible();
    for (const name of groups) {
      const { text } = await groupText(page, name);
      expect(text.trim().length, `${name}: something is shown`).toBeGreaterThan(20);
      expect(text, `${name}: no raw value`).not.toMatch(broken);
    }
    const { text } = await groupText(page, 'Results');
    expect(text).toMatch(/Not measured yet/);
    expect(text).not.toMatch(/Scheduled meetings|Qualified held|:\s*0\b|\b0 (meetings|of)\b/);
    // The rendered HTML of the whole room never carries a measured-looking zero in Results.
    const html = await page.locator(`[id="${section('results')}"]`).innerHTML();
    expect(html).not.toMatch(/Scheduled meetings|Qualified held/);
  });
}

test('quality: an error is announced as an alert, not only shown', async ({ page }) => {
  await open(page, 'room=1&proj=1');
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh Programme Projection' }).click();
  await expect(page.locator(`[id="${section('results')}"]`).getByRole('alert')).toContainText(
    /could not be read/,
  );
});

test('quality: empty companies and agenda say they are empty, not blank', async ({ page }) => {
  await open(page, 'room=1&proj=1', none);
  // The projection loads after the group opens, so wait for the empty state instead of reading once.
  await groupText(page, 'Participants and eligibility');
  await expect
    .poll(async () => (await groupText(page, 'Participants and eligibility')).text)
    .toMatch(/No active participants on this page/);
  await expect
    .poll(async () => (await groupText(page, 'Programme and meetings')).text)
    .toMatch(/Create a coordination task in Plan and report/);
});

test('quality: the five groups work by keyboard, one at a time', async ({ page }) => {
  await open(page, 'room=1&proj=1', none);
  const room = page.getByRole('article', { name: programme.name });
  const views = room.getByRole('group', { name: 'Programme views' });
  await views.getByRole('button').first().focus();
  for (let index = 0; index < groups.length; index++) {
    const button = views.getByRole('button').nth(index);
    await expect(button).toBeFocused();
    await page.keyboard.press(index % 2 ? 'Space' : 'Enter');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    for (let other = 0; other < groups.length; other++)
      if (other !== index)
        await expect(views.getByRole('button').nth(other)).toHaveAttribute('aria-pressed', 'false');
    // Every id the button controls exists, and the group's own panel is the only one showing.
    const controlled = (await button.getAttribute('aria-controls'))!.split(' ');
    for (const id of controlled) await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
    await expect(page.locator(`[id="${controlled[0]}"]`)).toBeVisible();
    await page.keyboard.press('Tab');
    if (index < groups.length - 1) {
      // Tab moves on inside the open panel before the next button; return to the group row.
      await views
        .getByRole('button')
        .nth(index + 1)
        .focus();
    }
  }
});

for (const width of [390, 1440]) {
  test(`quality: axe finds nothing in any of the five groups at ${width}px, with data and without`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const meetings of [
      undefined,
      { ...none, state: 'AVAILABLE', ...shared, scheduled: 2, qualifiedHeld: 1 } as Meetings,
    ]) {
      await open(page, 'room=1&proj=1', meetings);
      for (const name of groups) {
        await groupText(page, name);
        const result = await new AxeBuilder({ page }).analyze();
        expect(
          result.violations.map((v) => `${name} ${v.id}: ${v.nodes[0]?.html}`),
          `${name} ${meetings ? 'with data' : 'unavailable'}`,
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
          `${name}: no sideways scroll`,
        ).toBe(true);
      }
    }
  });
}

// Wave 6 on the organiser room (Q-01, Q-02, Q-05).
test('Q-01 choosing a group moves focus to that group heading', async ({ page }) => {
  await open(page, 'room=1&proj=1', none);
  const room = page.getByRole('article', { name: programme.name });
  for (const name of groups.slice(1)) {
    await room.getByRole('button', { name, exact: true }).click();
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return {
        tag: el?.tagName ?? '',
        text: el?.textContent?.trim().slice(0, 50) ?? '',
        inRoom: !!el?.closest('article.programme-room'),
        visible: !!el && el.getBoundingClientRect().height > 0,
      };
    });
    expect(['H2', 'H3', 'H4'], `${name}: focus is ${JSON.stringify(focused)}`).toContain(
      focused.tag,
    );
    expect(focused.inRoom && focused.visible, `${name}: heading is in the open group`).toBe(true);
  }
});

for (const width of [320, 640])
  test(`Q-02 the room reflows at ${width} in every group with no sideways scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, 'room=1&proj=1', {
      state: 'AVAILABLE',
      ...shared,
      scheduled: 2,
      qualifiedHeld: 1,
    });
    for (const name of groups) {
      await groupText(page, name);
      const over = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - innerWidth,
        cut: Array.from(
          document.querySelectorAll<HTMLElement>(
            'article.programme-room a[href],article.programme-room button,article.programme-room input,article.programme-room select,article.programme-room textarea',
          ),
        )
          .filter((el) => {
            const box = el.getBoundingClientRect();
            return box.width > 0 && !el.closest('[hidden]') && box.right > innerWidth + 1;
          })
          .map((el) => `${el.tagName} ${el.textContent?.trim().slice(0, 40)}`),
      }));
      expect(over.page, `${name}: sideways scroll`).toBeLessThanOrEqual(0);
      expect(over.cut, `${name}: actions cut off`).toEqual([]);
    }
  });

const raw =
  /unexpected|json|failed to fetch|networkerror|undefined|\bnull\b|\[object|syntax|load failed/i;
const broken503 = {
  status: 503,
  contentType: 'text/html',
  body: '<h1>Service Unavailable</h1>',
};
for (const [label, answer, says] of [
  ['offline (the request is rejected)', 'abort', /connection|offline|try again/i],
  ['409', { status: 409, json: {} }, /changed|refresh|try again/i],
  ['a 503 page instead of data', broken503, /could not|unavailable|try again|refresh/i],
] as const)
  test(`Q-05 every group reads plain words when the room APIs answer ${label}, and Refresh is there`, async ({
    page,
  }) => {
    await page.route('**/api/customer-programme-*', (route) =>
      answer === 'abort' ? route.abort('internetdisconnected') : route.fulfill(answer),
    );
    await page.route('**/api/customer-programmes*', (route) =>
      route.fulfill({
        json: { workspaceId, programmes: [programme], nextAfter: null, synthetic: true },
      }),
    );
    await page.goto(`${origin}/?room=1&proj=1`);
    await expect(page.getByRole('article', { name: programme.name })).toBeVisible();
    const room = page.getByRole('article', { name: programme.name });
    const said: string[] = [];
    for (const name of groups) {
      await room.getByRole('button', { name, exact: true }).click();
      // Give the panel's own read time to answer.
      await page.waitForTimeout(600);
      said.push(
        ...(await room.locator('[role="alert"]:visible, [role="status"]:visible').allInnerTexts()),
      );
    }
    const words = said.map((text) => text.trim()).filter(Boolean);
    expect(words.length, 'the room says something').toBeGreaterThan(0);
    expect(
      words.filter((text) => raw.test(text)),
      'raw error text',
    ).toEqual([]);
    expect(words.join(' '), 'a plain line for this state').toMatch(says);
    await expect(room.getByRole('button', { name: /^Refresh/ }).first()).toBeVisible();
  });

test('Q-05 the Results, companies and agenda views say wait and refresh on a 429, and Refresh works afterwards', async ({
  page,
}) => {
  let limited = true;
  await page.route('**/api/customer-programme-*', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await page.route('**/api/customer-programme-projections**', (route) =>
    limited ? route.fulfill({ status: 429, json: {} }) : route.fulfill({ json: projection(none) }),
  );
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill({
      json: { workspaceId, programmes: [programme], nextAfter: null, synthetic: true },
    }),
  );
  await page.goto(`${origin}/?room=1&proj=1`);
  const room = page.getByRole('article', { name: programme.name });
  await expect(room).toBeVisible();
  await room.getByRole('button', { name: 'Results', exact: true }).click();
  const results = page.locator(`[id="${section('results')}"]`);
  await expect(results.getByRole('alert')).toContainText(/Wait a minute, then refresh/);
  limited = false;
  await results.getByRole('button', { name: 'Refresh Programme Projection' }).click();
  await expect(results.getByText(/^Not shared/)).toBeVisible();
});

// Q-06: the one action the organiser room list offers to create a programme. Disabled while the request is in
// flight, one request for a double click, and the result is announced.
test('Q-06 Save sample programme is busy while in flight, sends once for a double click and announces the result', async ({
  page,
}) => {
  let posts = 0;
  const created: Record<string, unknown>[] = [];
  await page.route('**/api/customer-programme-*', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await page.route('**/api/customer-programmes*', async (route) => {
    if (route.request().method() === 'POST') {
      posts += 1;
      const command = route.request().postDataJSON() as { name: string; reportingPurpose: string };
      await new Promise((done) => setTimeout(done, 900));
      const made = {
        ...programme,
        id: '00000000-0000-4000-8000-000000000003',
        name: command.name,
        reportingPurpose: command.reportingPurpose,
      };
      created.push(made);
      return route.fulfill({ status: 201, json: made });
    }
    return route.fulfill({
      json: { workspaceId, programmes: [programme, ...created], nextAfter: null, synthetic: true },
    });
  });
  await page.goto(`${origin}/?room=1&proj=1`);
  await expect(page.getByRole('article', { name: programme.name })).toBeVisible();
  await page.getByLabel('Programme name').fill('Fictional Dhaka garment delegation');
  await page
    .getByLabel('Purpose and intended outcomes')
    .fill('Fictional purpose: meet fabric buyers in Shanghai.');
  await page.getByLabel('I am using fictional information for sample planning only.').check();
  const save = page.locator('form.operator-form .primary-link');
  await expect(save).toHaveText('Save Sample Programme');
  await save.dblclick();
  await expect(save).toBeDisabled();
  await expect(save, 'a first attempt in flight does not read as a retry').toHaveText('Saving…');
  await expect(page.getByRole('status').filter({ hasText: 'is saved' })).toBeVisible();
  expect(posts).toBe(1);
});

// Q-07 (GAP-049): screenshots of the organiser room, all five groups, at 390 and 1440, for the owner's named
// art review. Not part of the normal run: `WAVE6_EVIDENCE=1` writes the files, so a normal run never rewrites
// tracked images. The room is the real component with the real stylesheet over made-up data (notes in the Wave 6 receipt); panels whose
// service is not mocked show their calm unavailable state. No self-approval: a named human reviews these.
const evidenceDir = 'docs/design-system/evidence/revamp-wave6';
const stamp = () => new Date(Date.now() + 3600000).toISOString();
const sampleParticipants = {
  workspaceId,
  programmeId,
  invitations: [
    {
      id: '00000000-0000-4000-8000-000000000101',
      label: 'Synthetic participant invitation',
      expiresAt: stamp(),
      status: 'USED',
    },
    {
      id: '00000000-0000-4000-8000-000000000102',
      label: 'Synthetic participant invitation',
      expiresAt: stamp(),
      status: 'ISSUED',
    },
  ],
  registrations: [
    {
      id: '00000000-0000-4000-8000-000000000201',
      displayLabel: 'Synthetic participant label',
      consentedAt: '2026-10-18T00:00:00Z',
      status: 'REGISTERED',
    },
  ],
  nextInvitationAfter: null,
  nextRegistrationAfter: null,
  synthetic: true,
};
for (const width of [390, 1440])
  test(`Q-07 evidence: the five groups at ${width}`, async ({ browser }) => {
    test.skip(!process.env.WAVE6_EVIDENCE, 'evidence is written only when WAVE6_EVIDENCE=1');
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.route('**/api/customer-programme-participants*', (route) =>
      route.fulfill({ json: sampleParticipants }),
    );
    await open(page, 'room=1&proj=1', {
      state: 'AVAILABLE',
      ...shared,
      scheduled: 2,
      qualifiedHeld: 1,
    });
    const room = page.getByRole('article', { name: programme.name });
    const slugs = ['overview', 'participants', 'programme', 'terms', 'results'];
    for (const [index, name] of groups.entries()) {
      await room.getByRole('button', { name, exact: true }).click();
      await page.waitForTimeout(500);
      await room.screenshot({ path: `${evidenceDir}/${slugs[index]}-${width}.png` });
    }
    await context.close();
  });

// Q-07 defects found by looking at the screenshots (AC/1): a button must not fall back to the browser's own
// look, and the road's labels must line up.
test('Q-07 no button in any group falls back to the browser default look', async ({ page }) => {
  await page.route('**/api/customer-programme-participants*', (route) =>
    route.fulfill({ json: sampleParticipants }),
  );
  await open(page, 'room=1&proj=1', {
    state: 'AVAILABLE',
    ...shared,
    scheduled: 2,
    qualifiedHeld: 1,
  });
  const room = page.getByRole('article', { name: programme.name });
  for (const name of groups) {
    await room.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(400);
    const bare = await room.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('article.programme-room button'))
        .filter((el) => el.getBoundingClientRect().height > 0 && !el.closest('[hidden]'))
        .filter((el) => {
          const style = getComputedStyle(el);
          // The browser's own button face, with its own border: nothing in the design system looks like it.
          return style.backgroundColor === 'rgb(239, 239, 239)';
        })
        .map((el) => el.textContent?.trim()),
    );
    expect(bare, `${name}: buttons with the browser default look`).toEqual([]);
  }
});

for (const width of [390, 1440])
  test(`Q-07 the road labels line up at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, 'room=1&proj=1', none);
    const boxes = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.mr-road > li')).map((li) => {
        // The label's own text, as a person sees it: a plain label, or the label inside the Invite button.
        const label = li.querySelector<HTMLElement>('.mr-road-text b')!;
        const state = li.querySelector<HTMLElement>('.mr-road-state')!;
        const text = document.createRange();
        text.selectNodeContents(label);
        const a = text.getBoundingClientRect();
        const b = state.getBoundingClientRect();
        return { left: a.left - li.getBoundingClientRect().left, top: a.top, stateTop: b.top };
      }),
    );
    expect(boxes.length).toBe(6);
    // The Invite step is a button: it keeps the 44 px tap height the room's other controls have, even though
    // its label sits level with the plain labels (review finding on PR 288).
    const invite = await page.locator('.mr-road-text > button').boundingBox();
    expect(invite?.height, 'Invite tap height').toBeGreaterThanOrEqual(43.5);
    for (const box of boxes) {
      expect(Math.abs(box.left - boxes[0].left), 'label left edge').toBeLessThanOrEqual(1);
      if (width === 1440) {
        expect(Math.abs(box.top - boxes[0].top), 'label top').toBeLessThanOrEqual(2);
        expect(Math.abs(box.stateTop - boxes[0].stateTop), 'state top').toBeLessThanOrEqual(2);
      }
    }
  });
