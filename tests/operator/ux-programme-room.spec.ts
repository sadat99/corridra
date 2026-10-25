import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// The Programme Room (Lane 10 of the UX update): the real programme list, the real participants panel
// and the real stylesheets, with the room on and off. What is proved: the room wraps the same panels,
// the road and the boarding line come only from the invitations and registrations read, a panel stays
// mounted (and keeps what was typed) when the person moves to another view, a list longer than a page
// says "Not measured yet", the old buttons are exactly there with the switch off, and layout at four
// widths. Every name here is invented; nothing is real.
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
const expires = () => new Date(Date.now() + 3600000).toISOString();
const invitation = (n: number, status: 'ISSUED' | 'USED' | 'UNAVAILABLE') => ({
  id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
  label: 'Synthetic participant invitation',
  expiresAt: expires(),
  status,
});
const registration = (
  n: number,
  status: 'REGISTERED' | 'REVOKED' | 'WITHDRAWN' = 'REGISTERED',
) => ({
  id: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
  displayLabel: 'Synthetic participant label',
  consentedAt: '2026-10-18T00:00:00Z',
  status,
});
const manage = (
  invitations: unknown[],
  registrations: unknown[],
  nextInvitationAfter: string | null = null,
) => ({
  workspaceId,
  programmeId,
  invitations,
  registrations,
  nextInvitationAfter,
  nextRegistrationAfter: null,
  synthetic: true,
});

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{CustomerProgrammes}from ${JSON.stringify(resolve('apps/web/app/account/delegations/customer-programmes.tsx'))};
      import{ProgrammeRoomStyles}from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-room-styles.tsx'))};
      const q=new URLSearchParams(location.search);
      const room=q.get('room')==='1';
      createRoot(document.getElementById('fixture')).render(
        <main className="operator-page ux-workspace">
          <h1>Plan delegations</h1>
          {room&&<ProgrammeRoomStyles/>}
          <CustomerProgrammes subject="synthetic-alice" issuer=${JSON.stringify(issuer)} workspaceId=${JSON.stringify(workspaceId)}
            participantsEnabled coordinationEnabled termsEnabled economicsEnabled templatesEnabled={false}
            roomEnabled={room}/>
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

async function open(
  page: Page,
  options: { room: boolean; participants?: unknown; denied?: boolean } = { room: true },
) {
  // Any panel this spec does not exercise answers "unavailable", which each panel reads calmly.
  await page.route('**/api/customer-programme-*', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await page.route('**/api/customer-programmes*', (route) =>
    route.fulfill({
      json: { workspaceId, programmes: [programme], nextAfter: null, synthetic: true },
    }),
  );
  await page.route('**/api/customer-programme-participants*', (route) =>
    options.denied
      ? route.fulfill({ status: 403, json: { error: 'denied' } })
      : route.fulfill({
          json:
            options.participants ??
            manage([invitation(1, 'USED'), invitation(2, 'ISSUED')], [registration(1)]),
        }),
  );
  await page.goto(`${origin}/?room=${options.room ? '1' : '0'}`);
}

test('the room shows the programme, a road and a boarding line from what the panel reads', async ({
  page,
}) => {
  await open(page);
  const room = page.getByRole('article', { name: programme.name });
  await expect(room.getByRole('heading', { name: programme.name })).toBeVisible();
  await expect(room.getByText(programme.reportingPurpose)).toBeVisible();
  await expect(room.getByText('Planning record only · Sample data')).toBeVisible();
  // One invitation used out of two, one registration, one invitation still open.
  await expect(room.getByText('1 of 2 invitations used')).toBeVisible();
  const steps = room.locator('.mr-road li');
  await expect(steps).toHaveCount(6);
  await expect(steps.nth(0)).toHaveAttribute('data-state', 'done');
  await expect(steps.nth(1)).toHaveAttribute('data-state', 'done');
  await expect(steps.nth(2)).toHaveAttribute('data-state', 'now');
  await expect(steps.nth(2)).toHaveAttribute('aria-current', 'step');
  for (const index of [3, 4, 5])
    await expect(steps.nth(index)).toHaveAttribute('data-state', 'notTracked');
  await expect(room.locator('[aria-current="step"]')).toHaveCount(1);
});

test('a programme with no invitations says invite is next, and a long list is not measured', async ({
  page,
}) => {
  await open(page, { room: true, participants: manage([], []) });
  const steps = page.locator('.mr-road li');
  await expect(page.getByText('No invitations yet')).toBeVisible();
  await expect(steps.nth(1)).toHaveAttribute('data-state', 'now');
  await expect(steps.nth(2)).toHaveAttribute('data-state', 'later');
  const other = await page.context().newPage();
  await open(other, {
    room: true,
    participants: manage([invitation(1, 'USED')], [registration(1)], invitation(1, 'USED').id),
  });
  await expect(other.getByText(/Not measured yet: there are more participants/)).toBeVisible();
  await expect(other.getByText(/\d of \d invitations used/)).toHaveCount(0);
});

test('with access denied the road marks nothing it cannot read', async ({ page }) => {
  await open(page, { room: true, denied: true });
  await expect(page.locator('.programme-boarding')).toContainText('Not measured yet');
  const steps = page.locator('.mr-road li');
  await expect(steps.nth(0)).toHaveAttribute('data-state', 'done');
  await expect(steps.nth(1)).toHaveAttribute('data-state', 'notTracked');
  await expect(steps.nth(2)).toHaveAttribute('data-state', 'notTracked');
});

test('every original panel is one view away and a view keeps what was typed when the person moves on', async ({
  page,
}) => {
  await open(page);
  const views = page.getByRole('group', { name: 'Programme views' });
  for (const name of ['Overview', 'People', 'Plan and report', 'Terms and places', 'Money'])
    await expect(views.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(views.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Nothing is opened (and nothing is fetched) until a view is chosen.
  await expect(page.getByRole('heading', { name: 'Invitations' })).toHaveCount(0);
  await views.getByRole('button', { name: 'People', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invitations' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Consented registrations' })).toBeVisible();
  const label = page.getByLabel(/invitation label/i).first();
  await label.fill('Synthetic invitation kept across views');
  await views.getByRole('button', { name: 'Money', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invitations' })).toBeHidden();
  await views.getByRole('button', { name: 'People', exact: true }).click();
  await expect(page.getByLabel(/invitation label/i).first()).toHaveValue(
    'Synthetic invitation kept across views',
  );
  // A view that is not chosen is hidden, not removed: its panel is still in the page.
  await views.getByRole('button', { name: 'Money', exact: true }).click();
  const people = page.locator(`[id="${programmeId}-people"]`);
  await expect(people).toBeHidden();
  await expect(people).toHaveCount(1);
});

test('with the switch off the old toggles are exactly there and there is no room', async ({
  page,
}) => {
  await open(page, { room: false });
  await expect(page.getByRole('heading', { name: programme.name })).toBeVisible();
  await expect(page.locator('.programme-room')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage sample participants' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Coordinate and report' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Terms, eligibility and places' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record sample fees and costs' })).toBeVisible();
});

for (const width of [320, 390, 768, 1440]) {
  test(`fits at ${width} wide: no sideways scroll, 44 pixel targets, no accessibility violation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    const check = async (label: string) => {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        label,
      ).toBe(true);
      for (const control of await page.locator('.programme-room .room-lens').all()) {
        const box = await control.boundingBox();
        if (box) expect(box.height, `${label}: view button`).toBeGreaterThanOrEqual(43.5);
      }
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => `${label} ${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    };
    await expect(page.locator('.programme-room')).toBeVisible();
    await check('overview');
    await page.getByRole('button', { name: 'People', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Invitations' })).toBeVisible();
    await check('people');
    await page.getByRole('button', { name: 'Money', exact: true }).click();
    await check('money');
    if (width === 320 || width === 1440)
      await page.screenshot({
        path: `docs/design-system/evidence/lane10-programme-room/room-${width}.png`,
        fullPage: true,
      });
  });
}
