import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
// Actual component protocol fixtures, not provider or database acceptance.
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';import {ProgrammeProjectionPanel,ParticipantProjectionSharing} from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-projections.tsx'))};const root=createRoot(document.getElementById('fixture'));const initial={subject:'synthetic-bob',issuer:${JSON.stringify(issuer)},workspaceId:'00000000-0000-4000-8000-000000000006',programmeId:'00000000-0000-4000-8000-000000000005',registrationId:'00000000-0000-4000-8000-000000000004',view:new URLSearchParams(location.search).get('view')??'companies'};const render=p=>{const all={...initial,...p};root.render(all.view==='own'?<ParticipantProjectionSharing {...all}/>:<ProgrammeProjectionPanel {...all}/>)};render({});window.addEventListener('fixture-customer-change',event=>render(event.detail));`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    loader: { '.css': 'empty' },
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    // Next replaces browser compile-time environment constants in its real build.
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    metafile: true,
  });
  expect(
    Object.keys(result.metafile!.inputs).some((path) => path.includes('packages/auth/src')),
  ).toBe(false);
  const javascript = result.outputFiles[0].text;
  // Use the real compiled global CSS/font class, not unprocessed Tailwind source.
  const documentResponse = await fetch('http://127.0.0.1:3200/');
  expect(documentResponse.status).toBe(200);
  const document = await documentResponse.text();
  const fontClass = document.match(/<html[^>]*class="([\w -]+)"/)?.[1];
  expect(fontClass).toBeTruthy();
  const cssPaths = [
    ...new Set(
      [...document.matchAll(/href="(\/_next\/static\/[^"?]+\.css)(?:\?[^"\s]*)?"/g)].map(
        (match) => match[1]!,
      ),
    ),
  ];
  expect(cssPaths.length).toBeGreaterThan(0);
  for (const path of cssPaths) expect(path).toMatch(/^\/_next\/static\/chunks\/[\w.-]+\.css$/);
  const css = Buffer.concat(
    await Promise.all(
      cssPaths.map((path) =>
        readFile(resolve('apps/web/.next/static', path.slice('/_next/static/'.length))),
      ),
    ),
  );
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(javascript);
    } else if (path === '/fixture.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end(css);
    } else if (/^\/_next\/static\/media\/[\w.-]+\.woff2$/.test(path)) {
      void readFile(resolve('apps/web/.next/static', path.slice('/_next/static/'.length)))
        .then((font) => {
          response.setHeader('Content-Type', 'font/woff2');
          response.end(font);
        })
        .catch(() => {
          response.statusCode = 404;
          response.end();
        });
    } else if (path === '/' || path === '/account/delegations') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic component protocol fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace" style="max-width:960px;margin:24px auto;padding:16px"><h1>Synthetic component protocol fixture</h1><div id="fixture"></div><section id="customer-missions"><h2>Existing shared mission section</h2></section></main><script type="module" src="/fixture.js"></script></body></html>`,
      );
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address unavailable');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
});

const programmeId = '00000000-0000-4000-8000-000000000005',
  workspaceId = '00000000-0000-4000-8000-000000000006',
  registrationId = '00000000-0000-4000-8000-000000000004',
  taskId = '00000000-0000-4000-8000-000000000007',
  linkId = '00000000-0000-4000-8000-000000000008';
const expiry = () => new Date(Date.now() + 60000).toISOString();
function owner() {
  return {
    workspaceId,
    programmeId,
    expiresAt: expiry(),
    sendsMessages: false,
    readiness: { activeParticipants: 28, readyParticipants: 1 },
    companies: [
      {
        registrationId,
        label: 'Synthetic participant',
        company: {
          name: 'Synthetic company',
          countryCode: 'BD',
          roles: ['SELLER'],
          sectors: ['Textiles'],
          objective: 'Synthetic shared objective',
          profileVersion: 1,
        },
        ready: true,
        missing: [],
      },
    ],
    nextAfter: null,
    context: {
      version: 1,
      startsAt: '2030-07-15T00:00:00Z',
      endsAt: '2030-07-16T00:00:00Z',
      timezone: 'Asia/Dhaka',
    },
    agenda: [
      {
        taskId,
        title: 'Synthetic activity',
        status: 'OPEN',
        version: 1,
        scheduled: true,
        startsAt: '2030-07-15T04:00:00Z',
        endsAt: '2030-07-15T05:00:00Z',
        timezone: 'Asia/Dhaka',
        audience: 'ALL',
        attendees: [],
        needsReview: false,
      },
    ],
    conflicts: [],
    meetings: {
      state: 'NOT_SHARED',
      sharedLinks: 0,
      unavailableLinks: 0,
      participantsSharing: 0,
      scheduled: null,
      qualifiedHeld: null,
    },
  };
}
function own() {
  return {
    registrationId,
    expiresAt: expiry(),
    sendsMessages: false,
    active: true,
    company: { version: 0, shared: false, sourceChanged: false, objective: null },
    profile: {
      id: '00000000-0000-4000-8000-000000000009',
      version: 2,
      name: 'Synthetic company',
      countryCode: 'BD',
      roles: ['SELLER'],
      sectors: ['Textiles'],
    },
    missionLinks: [
      {
        id: linkId,
        summary: 'Synthetic mission objective',
        version: 0,
        shared: false,
        available: true,
      },
    ],
    nextLinkAfter: null,
  };
}
function receipt(body: Record<string, unknown>) {
  return {
    commandId: body.commandId,
    resourceId: body.registrationId ?? body.linkId ?? body.taskId,
    version: Number(body.expectedVersion) + 1,
    expiresAt: expiry(),
  };
}
test('company checklist uses complete server totals and honest unshared meeting state', async ({
  page,
}) => {
  await page.route('**/api/customer-programme-projections**', (r) => r.fulfill({ json: owner() }));
  await page.goto(origin);
  await expect(page.getByText('1 of 28 active participants ready')).toBeVisible();
  await expect(page.getByText('Meeting counts are not shared.')).toBeVisible();
  await expect(page.getByText('Synthetic shared objective')).toBeVisible();
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});
test('company sharing needs explicit consent and retains exact retry after a wrong acknowledgement', async ({
  page,
}) => {
  const commands: Record<string, unknown>[] = [];
  await page.route('**/api/customer-programme-projections**', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: own() });
    const body = r.request().postDataJSON();
    commands.push(body);
    return r.fulfill({
      json: { ...receipt(body), commandId: commands.length === 1 ? 'wrong' : body.commandId },
    });
  });
  await page.goto(origin + '/?view=own');
  const save = page.getByRole('button', { name: 'Share Company Profile', exact: true });
  await expect(save).toBeDisabled();
  await page
    .getByRole('textbox', { name: /Short objective/ })
    .fill('Synthetic consented objective');
  await page.getByRole('checkbox', { name: /I agree to share/ }).check();
  await save.click();
  await expect(page.getByRole('alert')).toContainText('Save could not be confirmed');
  await page.getByRole('button', { name: 'Retry Same Change' }).click();
  await expect(save).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  expect(commands[0]).toMatchObject({
    action: 'company',
    registrationId,
    profileVersion: 2,
    shared: true,
    objective: 'Synthetic consented objective',
    acknowledged: true,
  });
});
test('mission count permission sends only explicit separate consent', async ({ page }) => {
  let command: Record<string, unknown> | null = null;
  await page.route('**/api/customer-programme-projections**', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: own() });
    command = r.request().postDataJSON();
    return r.fulfill({ json: receipt(command!) });
  });
  await page.goto(origin + '/?view=own');
  await page
    .getByRole('checkbox', { name: 'Share aggregate meeting counts for this mission' })
    .click();
  await expect
    .poll(() => command)
    .toMatchObject({ action: 'meetings', linkId, shared: true, expectedVersion: 0 });
  expect(command).not.toHaveProperty('registrationId');
});
test('agenda preserves exact instants when displaying and saving programme-local time', async ({
  page,
}) => {
  let command: Record<string, unknown> | null = null;
  await page.route('**/api/customer-programme-projections**', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: owner() });
    command = r.request().postDataJSON();
    return r.fulfill({ json: receipt(command!) });
  });
  await page.goto(origin + '/?view=agenda');
  await page.getByRole('button', { name: 'Edit schedule for Synthetic activity' }).click();
  await page.getByRole('button', { name: 'Save Activity Schedule' }).click();
  await expect
    .poll(() => command)
    .toMatchObject({
      taskId,
      workspaceId,
      programmeId,
      startsAt: '2030-07-15T04:00:00Z',
      endsAt: '2030-07-15T05:00:00Z',
      audience: 'ALL',
      attendees: [],
      expectedVersion: 1,
    });
});
for (const status of [403, 409, 503])
  test('save ' + status + ' clears private content with recovery', async ({ page }) => {
    await page.route('**/api/customer-programme-projections**', (r) =>
      r.request().method() === 'GET'
        ? r.fulfill({ json: own() })
        : r.fulfill({ status, json: { error: 'Unavailable' } }),
    );
    await page.goto(origin + '/?view=own');
    await page
      .getByRole('checkbox', { name: 'Share aggregate meeting counts for this mission' })
      .click();
    await expect(page.getByRole('alert')).toContainText('Unavailable');
    await expect(page.getByText('Synthetic company', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Refresh Sharing' })).toBeVisible();
  });
test('expiry removes private details when renewal cannot complete', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/customer-programme-projections**', async (r) => {
    if (++reads > 1) return;
    return r.fulfill({
      json: { ...owner(), expiresAt: new Date(Date.now() + 1200).toISOString() },
    });
  });
  await page.goto(origin);
  await expect(page.getByText('Synthetic shared objective')).toBeVisible();
  await expect(page.getByText('Synthetic shared objective')).toHaveCount(0, { timeout: 5000 });
});
test('late old-context response cannot restore another account data', async ({ page }) => {
  await page.route('**/api/customer-programme-projections**', async (r) => {
    if (r.request().headers()['x-corridra-customer-subject'] === 'other')
      return r.fulfill({ status: 403, json: { error: 'Denied' } });
    await new Promise((done) => setTimeout(done, 300));
    return r.fulfill({ json: owner() });
  });
  await page.goto(origin);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('fixture-customer-change', { detail: { subject: 'other' } }),
    ),
  );
  await expect(page.getByRole('alert')).toContainText('permitted programme account');
  await expect(page.getByText('Synthetic shared objective')).toHaveCount(0);
});
for (const width of [390, 1440])
  for (const view of ['companies', 'agenda', 'own'])
    test('accessible ' + view + ' at ' + width, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.route('**/api/customer-programme-projections**', (r) =>
        r.fulfill({ json: view === 'own' ? own() : owner() }),
      );
      await page.goto(origin + '/?view=' + view);
      if (view !== 'agenda')
        await expect(page.getByText('Synthetic company', { exact: false })).toBeVisible();
      if (view === 'agenda')
        await expect(
          page.getByRole('button', { name: 'Edit schedule for Synthetic activity' }),
        ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
    });

test('refreshed company profile requires consent to the newly displayed version', async ({
  page,
}) => {
  let version = 2;
  await page.route('**/api/customer-programme-projections**', (r) =>
    r.fulfill({
      json: {
        ...own(),
        profile: {
          ...own().profile,
          version,
          id: version === 2 ? own().profile.id : '00000000-0000-4000-8000-000000000010',
        },
      },
    }),
  );
  await page.goto(origin + '/?view=own');
  await page.getByRole('checkbox', { name: /I agree to share/ }).check();
  await expect(
    page.getByRole('button', { name: 'Share Company Profile', exact: true }),
  ).toBeEnabled();
  version = 3;
  await page.getByRole('button', { name: 'Refresh Sharing', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /I agree to share/ })).not.toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Share Company Profile', exact: true }),
  ).toBeDisabled();
});

test('another company with the same version also requires fresh consent', async ({ page }) => {
  let id = own().profile.id;
  await page.route('**/api/customer-programme-projections**', (r) =>
    r.fulfill({ json: { ...own(), profile: { ...own().profile, id } } }),
  );
  await page.goto(origin + '/?view=own');
  await page.getByRole('checkbox', { name: /I agree to share/ }).check();
  await expect(
    page.getByRole('button', { name: 'Share Company Profile', exact: true }),
  ).toBeEnabled();
  id = '00000000-0000-4000-8000-000000000010';
  await page.getByRole('button', { name: 'Refresh Sharing', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /I agree to share/ })).not.toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Share Company Profile', exact: true }),
  ).toBeDisabled();
});

// A programme server that keeps activities and answers the way the database does: a save made against an older
// version than the current one is refused with the existing "Activity changed; reload" message, and a command
// sent again with the same id gets its original receipt back.
const secondTaskId = '00000000-0000-4000-8000-00000000000a';
async function activityServer(page: Page, ids = [taskId]) {
  const tasks = new Map(
    ids.map((id) => [
      id,
      { version: 1, startsAt: '2030-07-15T04:00:00Z', endsAt: '2030-07-15T05:00:00Z' },
    ]),
  );
  const receipts = new Map<string, ReturnType<typeof receipt>>();
  const server = {
    posts: [] as Record<string, unknown>[],
    // The next save is committed but its reply does not match the request, as when a response is lost.
    loseNextReply: false,
    version: (id = taskId) => tasks.get(id)!.version,
    change(startsAt: string, endsAt: string, id = taskId) {
      const task = tasks.get(id)!;
      task.version += 1;
      task.startsAt = startsAt;
      task.endsAt = endsAt;
    },
  };
  await page.route('**/api/customer-programme-projections**', (r) => {
    if (r.request().method() === 'GET') {
      const view = owner();
      view.agenda = ids.map((id, index) => ({
        ...view.agenda[0]!,
        taskId: id,
        title: index === 0 ? 'Synthetic activity' : 'Synthetic second activity',
        ...tasks.get(id)!,
      }));
      return r.fulfill({ json: view });
    }
    const body = r.request().postDataJSON();
    server.posts.push(body);
    const replay = receipts.get(String(body.commandId));
    if (replay) return r.fulfill({ json: replay });
    const task = tasks.get(String(body.taskId))!;
    if (body.expectedVersion !== task.version)
      return r.fulfill({ status: 409, json: { error: 'Activity changed; reload' } });
    task.version += 1;
    const saved = receipt(body);
    receipts.set(String(body.commandId), saved);
    if (server.loseNextReply) {
      server.loseNextReply = false;
      return r.fulfill({ json: { ...saved, commandId: 'wrong' } });
    }
    return r.fulfill({ json: saved });
  });
  return server;
}
const changedNotice = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'This activity changed after you opened it' });
const axeResults = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();

test('an activity changed by someone else after it was opened cannot be overwritten', async ({
  page,
}) => {
  const server = await activityServer(page);
  await page.goto(origin + '/?view=agenda');
  await page.getByRole('button', { name: 'Edit schedule for Synthetic activity' }).click();
  const starts = page.getByLabel(/Activity starts/);
  await expect(starts).toHaveValue('2030-07-15T10:00');
  await starts.fill('2030-07-15T14:00');
  server.change('2030-07-15T06:00:00Z', '2030-07-15T07:00:00Z');
  await page.getByRole('button', { name: 'Refresh Programme Projection' }).click();
  await expect(changedNotice(page)).toBeVisible();
  await expect(changedNotice(page)).toContainText('replaces the entries currently typed');
  await expect(page.getByRole('button', { name: 'Save Activity Schedule' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Remove Schedule' })).toBeDisabled();
  // The disabled buttons point at the notice that explains why.
  for (const name of ['Save Activity Schedule', 'Remove Schedule']) {
    const id = await page.getByRole('button', { name }).getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(await page.locator(`[id="${id}"]`).textContent()).toContain(
      'This activity changed after you opened it',
    );
  }
  expect((await axeResults(page)).violations).toEqual([]);
  // Nothing is re-seeded without consent: the typed value is still there and nothing was sent.
  await expect(starts).toHaveValue('2030-07-15T14:00');
  expect(server.posts).toHaveLength(0);
  await page.getByRole('button', { name: 'Reload This Activity' }).click();
  await expect(changedNotice(page)).toHaveCount(0);
  // Focus stays in the form instead of falling to the page when the button leaves.
  await expect(page.getByRole('combobox', { name: /^Activity/ })).toBeFocused();
  expect((await axeResults(page)).violations).toEqual([]);
  await expect(starts).toHaveValue('2030-07-15T12:00');
  await page.getByRole('button', { name: 'Save Activity Schedule' }).click();
  await expect.poll(() => server.posts.length).toBe(1);
  expect(server.posts[0]).toMatchObject({ expectedVersion: 2, startsAt: '2030-07-15T06:00:00Z' });
});
test('a save made before the page noticed another change is refused and recovers after reload', async ({
  page,
}) => {
  const server = await activityServer(page);
  await page.goto(origin + '/?view=agenda');
  await page.getByRole('button', { name: 'Edit schedule for Synthetic activity' }).click();
  server.change('2030-07-15T06:00:00Z', '2030-07-15T07:00:00Z');
  await page.getByRole('button', { name: 'Save Activity Schedule' }).click();
  await expect(page.getByRole('alert')).toContainText('Activity changed; reload');
  expect(server.posts).toHaveLength(1);
  expect(server.posts[0]).toMatchObject({ expectedVersion: 1 });
  await expect(page.getByText('Synthetic activity', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh Programme Projection' }).click();
  await expect(changedNotice(page)).toBeVisible();
  await page.getByRole('button', { name: 'Reload This Activity' }).click();
  await page.getByRole('button', { name: 'Save Activity Schedule' }).click();
  await expect.poll(() => server.posts.length).toBe(2);
  expect(server.posts[1]).toMatchObject({ expectedVersion: 2, startsAt: '2030-07-15T06:00:00Z' });
});
test('saving twice in a row shows no false change notice and uses the next version', async ({
  page,
}) => {
  const server = await activityServer(page);
  await page.goto(origin + '/?view=agenda');
  await page.getByRole('button', { name: 'Edit schedule for Synthetic activity' }).click();
  const save = page.getByRole('button', { name: 'Save Activity Schedule' });
  await save.click();
  await expect.poll(() => server.posts.length).toBe(1);
  await expect(save).toBeEnabled();
  await expect(changedNotice(page)).toHaveCount(0);
  await save.click();
  await expect.poll(() => server.posts.length).toBe(2);
  expect(server.posts.map((post) => post.expectedVersion)).toEqual([1, 2]);
});
test('removing a schedule needs the version the organiser saw', async ({ page }) => {
  const server = await activityServer(page);
  await page.goto(origin + '/?view=agenda');
  await page.getByRole('button', { name: 'Edit schedule for Synthetic activity' }).click();
  server.change('2030-07-15T06:00:00Z', '2030-07-15T07:00:00Z');
  await page.getByRole('button', { name: 'Refresh Programme Projection' }).click();
  const remove = page.getByRole('button', { name: 'Remove Schedule' });
  await expect(remove).toBeDisabled();
  await page.getByRole('button', { name: 'Reload This Activity' }).click();
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect.poll(() => server.posts.length).toBe(1);
  expect(server.posts[0]).toMatchObject({ scheduled: false, expectedVersion: 2 });
});
test('a company that changed after sharing is not shared until the participant shares again', async ({
  page,
}) => {
  const commands: Record<string, unknown>[] = [];
  await page.route('**/api/customer-programme-projections**', (r) => {
    if (r.request().method() === 'GET')
      return r.fulfill({
        json: {
          ...own(),
          company: {
            version: 2,
            shared: false,
            sourceChanged: true,
            objective: 'Synthetic earlier objective',
          },
        },
      });
    const body = r.request().postDataJSON();
    commands.push(body);
    return r.fulfill({ json: receipt(body) });
  });
  await page.goto(origin + '/?view=own');
  await expect(
    page.getByRole('status').filter({ hasText: 'company for this place changed' }),
  ).toHaveText(
    'Your company for this place changed after you shared. Programme organisers do not see a company until you review it and share again.',
  );
  await expect(page.getByText('Company sharing is on')).toHaveCount(0);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByRole('button', { name: 'Clear Earlier Company Permission' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    action: 'company',
    registrationId,
    expectedVersion: 2,
    shared: false,
  });
  expect(commands[0]).not.toHaveProperty('profileId');
  await page.getByRole('textbox', { name: /Short objective/ }).fill('Synthetic fresh objective');
  await page.getByRole('checkbox', { name: /I agree to share/ }).check();
  await page.getByRole('button', { name: 'Share Company Profile', exact: true }).click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1]).toMatchObject({
    action: 'company',
    expectedVersion: 2,
    shared: true,
    profileVersion: 2,
    objective: 'Synthetic fresh objective',
  });
});
test('a change left unconfirmed for one activity is not retried against another', async ({
  page,
}) => {
  const server = await activityServer(page, [taskId, secondTaskId]);
  await page.goto(origin + '/?view=agenda');
  await page.getByRole('button', { name: 'Edit schedule for Synthetic activity' }).click();
  server.loseNextReply = true;
  await page.getByRole('button', { name: 'Save Activity Schedule' }).click();
  await expect(page.getByRole('alert')).toContainText('Save could not be confirmed');
  await page.getByRole('button', { name: 'Refresh Programme Projection' }).click();
  await page.getByRole('button', { name: 'Edit schedule for Synthetic second activity' }).click();
  // Moving to the other activity drops the retry, so the first save cannot land on this form.
  await expect(page.getByRole('button', { name: 'Retry Same Change' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  // Another organiser changes the second activity; it stays blocked until reloaded.
  server.change('2030-07-15T06:00:00Z', '2030-07-15T07:00:00Z', secondTaskId);
  await page.getByRole('button', { name: 'Refresh Programme Projection' }).click();
  await expect(changedNotice(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Activity Schedule' })).toBeDisabled();
  expect(server.posts).toHaveLength(1);
});
test('a save whose reply was lost is recognised as the organiser own save when retried', async ({
  page,
}) => {
  const server = await activityServer(page);
  await page.goto(origin + '/?view=agenda');
  await page.getByRole('button', { name: 'Edit schedule for Synthetic activity' }).click();
  server.loseNextReply = true;
  await page.getByRole('button', { name: 'Save Activity Schedule' }).click();
  await expect(page.getByRole('alert')).toContainText('Save could not be confirmed');
  await page.getByRole('button', { name: 'Refresh Programme Projection' }).click();
  // The save did commit, so the page says the activity changed and names that possibility.
  await expect(changedNotice(page)).toContainText(
    'your own earlier save that could not be confirmed',
  );
  await page.getByRole('button', { name: 'Retry Same Change' }).click();
  await expect.poll(() => server.posts.length).toBe(2);
  expect(server.posts[1]).toEqual(server.posts[0]);
  await expect(changedNotice(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save Activity Schedule' })).toBeEnabled();
  expect(server.posts).toHaveLength(2);
});
test('reloading after a lost reply drops the retry so it cannot loop into a second notice', async ({
  page,
}) => {
  const server = await activityServer(page);
  await page.goto(origin + '/?view=agenda');
  await page.getByRole('button', { name: 'Edit schedule for Synthetic activity' }).click();
  server.loseNextReply = true;
  await page.getByRole('button', { name: 'Save Activity Schedule' }).click();
  await expect(page.getByRole('alert')).toContainText('Save could not be confirmed');
  await page.getByRole('button', { name: 'Refresh Programme Projection' }).click();
  await expect(changedNotice(page)).toBeVisible();
  await page.getByRole('button', { name: 'Reload This Activity' }).click();
  await expect(page.getByRole('button', { name: 'Retry Same Change' })).toHaveCount(0);
  await expect(changedNotice(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save Activity Schedule' })).toBeEnabled();
  expect(server.posts).toHaveLength(1);
});
test('clearing the earlier company permission keeps focus in the sharing section', async ({
  page,
}) => {
  let cleared = false;
  await page.route('**/api/customer-programme-projections**', (r) => {
    if (r.request().method() === 'GET')
      return r.fulfill({
        json: {
          ...own(),
          company: { version: 2, shared: false, sourceChanged: !cleared, objective: null },
        },
      });
    cleared = true;
    return r.fulfill({ json: receipt(r.request().postDataJSON()) });
  });
  await page.goto(origin + '/?view=own');
  await page.getByRole('button', { name: 'Clear Earlier Company Permission' }).click();
  await expect(page.getByRole('button', { name: 'Clear Earlier Company Permission' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('heading', { name: 'Company and meeting sharing' })).toBeFocused();
});
test('the changed-company notice does not point at a review form that is not shown', async ({
  page,
}) => {
  await page.route('**/api/customer-programme-projections**', (r) =>
    r.fulfill({
      json: {
        ...own(),
        active: false,
        company: { version: 2, shared: false, sourceChanged: true, objective: null },
      },
    }),
  );
  await page.goto(origin + '/?view=own');
  await expect(
    page.getByRole('status').filter({ hasText: 'company for this place changed' }),
  ).toHaveText(
    'Your company for this place changed after you shared. Programme organisers do not see a company until you share again.',
  );
  await expect(
    page.getByRole('button', { name: 'Clear Earlier Company Permission' }),
  ).toBeVisible();
});
test('moving to another activity after an unconfirmed save says that the earlier change may or may not be saved', async ({
  page,
}) => {
  const server = await activityServer(page, [taskId, secondTaskId]);
  const warning = page.getByRole('status').filter({ hasText: 'could not be confirmed' });
  await page.goto(origin + '/?view=agenda');
  await page.getByRole('button', { name: 'Edit schedule for Synthetic activity' }).click();
  // Nothing was pending, so there is nothing to warn about.
  await page.getByRole('button', { name: 'Edit schedule for Synthetic second activity' }).click();
  await expect(warning).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit schedule for Synthetic activity' }).click();
  server.loseNextReply = true;
  await page.getByRole('button', { name: 'Save Activity Schedule' }).click();
  await expect(page.getByRole('alert')).toContainText('Save could not be confirmed');
  await page.getByRole('button', { name: 'Refresh Programme Projection' }).click();
  const other = page.getByRole('button', { name: 'Edit schedule for Synthetic second activity' });
  await other.click();
  await expect(warning).toHaveText(
    'An earlier change to Synthetic activity could not be confirmed and may or may not have been saved. Check its schedule in the list before changing it again.',
  );
  // The message does not take focus from what the organiser just used.
  await expect(other).toBeFocused();
  expect((await axeResults(page)).violations).toEqual([]);
  expect(server.posts).toHaveLength(1);
});
