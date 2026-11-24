import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Team desk v4.1, units D6 and D7, behind CORRIDRA_UX_TEAM_DESK_V41 (the page reads it on the server and hands
// it down through OperatorFlags). The mission page is bundled from the source with the real stylesheets, the shared dialog and the real
// in-place code check; every request is answered here, so no database is needed. Off, the page is what it was:
// the action buttons in Overview and the side panel. On: the stage bar the customer's Road reads, one Next step
// card with the page's one primary button, a read-only customer panel, and every action in the centred dialog
// with only its fields. The commands and their payloads are the same. D6_ROOT bundles another checkout (the old
// commit), which is how the desk cases were shown to fail before the change; D6_SHOTS names a folder for the
// screenshots at the six widths.
const root = resolve(process.env.D6_ROOT ?? '.');
const tenant = '00000000-0000-4000-8000-0000000000a1';
const mission = '00000000-0000-4000-8000-0000000000b2';
const owner = {
  user_id: '00000000-0000-4000-8000-0000000000c3',
  name: 'Invented Owner Ada',
  role: 'owner',
};
const second = {
  user_id: '00000000-0000-4000-8000-0000000000c4',
  name: 'Invented Operator Ben',
  role: 'operator',
};
const reference = '7F3A9C2E';
const refusal = `This change was not allowed in this workspace. Check you are in the right workspace, or ask a workspace owner. Quote reference ${reference}.`;
const databaseWords = /row-level security|violates|permission denied|source_record|constraint/i;

let server: Server;
let origin = '';
test.beforeAll(async () => {
  const source = (path: string) => JSON.stringify(resolve(root, path));
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{OperatorFlags}from ${source('apps/web/app/operator/operator-flags.tsx')};
      import{MissionPage}from ${source('apps/web/app/operator/[section]/[missionId]/mission-page.tsx')};
      import{StepUpDialog}from ${source('apps/web/components/ux/step-up-dialog.tsx')};
      import ${source('apps/web/app/operator/operator-overview.css')};
      const q=new URLSearchParams(location.search);
      createRoot(document.getElementById('fixture')).render(
        <main id="main" className="operator-page ux-workspace"><h1>Mission</h1>
        <OperatorFlags replyReview={false} teamDeskV41={q.get('desk')==='on'}>
          <MissionPage tenant="${tenant}" workspaceName="Sample team" missionId="${mission}"
            moveRecords={q.get('moves')==='on'}/>
        </OperatorFlags><StepUpDialog/></main>);`,
      loader: 'tsx',
      resolveDir: resolve(root, 'apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css', '.woff2': 'empty' },
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [
      {
        name: 'fixture-next',
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
                : 'export const useRouter=()=>({push(){},replace(){},refresh(){}});export const usePathname=()=>"/operator";export const useSearchParams=()=>new URLSearchParams();',
          }));
        },
      },
    ],
  });
  const bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const css = readFileSync(resolve(root, 'apps/web/app/globals.css'), 'utf8');
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(bundle);
    } else if (path === '/fixture.css') {
      res.setHeader('Content-Type', 'text/css');
      res.end(css + '\n' + componentCss);
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mission</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

type Shape = {
  status?: string;
  role?: string;
  targetProfile?: string | null;
  routeLabel?: string | null;
  replies?: { id: string; mission_id: string; body: string; created_at?: string }[];
  reports?: number;
};
const queue = (shape: Shape) => ({
  role: shape.role ?? 'owner',
  total: 1,
  owners: [owner, second],
  history: [],
  replies: shape.replies ?? [],
  missions: [
    {
      id: mission,
      status: shape.status ?? 'DRAFT',
      version: 3,
      reason: '',
      notice_version: 'invented-notice-1',
      acknowledged_at: '2026-11-01T00:00:00.000Z',
      source_kind: 'SELF_SERVE',
      claim_status: 'SELF_DECLARED',
      country_code: 'ES',
      target_profile: shape.targetProfile === undefined ? null : shape.targetProfile,
      owner_id: owner.user_id,
      due_at: '2026-12-01T09:00:00.000Z',
      updated_at: '2026-11-20T09:00:00.000Z',
      next_action: 'Review submitted brief',
      route_label: shape.routeLabel ?? null,
      brief: {
        company: 'Invented Machinery Co',
        objective: 'Source suppliers',
        market: 'Spain',
        offer: 'Invented machine parts',
        outcomes: [],
        attendance: 'No',
      },
    },
  ],
});
type Answer = { status: number; json: unknown; delay?: number };
const saved: Answer = { status: 201, json: { ok: true } };
const stepUp: Answer = {
  status: 401,
  json: { error: 'Verify your authenticator again to continue', code: 'STEP_UP_REQUIRED' },
};

/** Opens the mission page fixture. `answers` are given to each POST in order; the last one repeats. */
async function open(
  page: Page,
  desk: boolean,
  shape: Shape = {},
  answers: Answer[] = [saved],
  moves = false,
) {
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  const codes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/verify-totp')) {
      codes.push(String((request.postDataJSON() as { code?: unknown } | null)?.code));
      return route.fulfill({ json: { token: 'invented', user: { id: owner.user_id } } });
    }
    if (request.method() === 'POST') {
      sent.push({ path: url.pathname, body: request.postDataJSON() as Record<string, unknown> });
      const answer = answers[Math.min(sent.length, answers.length) - 1]!;
      if (answer.delay) await new Promise((done) => setTimeout(done, answer.delay));
      return route.fulfill({ status: answer.status, json: answer.json });
    }
    const json =
      url.pathname === '/api/team-work/mission'
        ? queue(shape)
        : url.pathname === '/api/workspace/delivery'
          ? {
              role: shape.role ?? 'owner',
              participants: [],
              owners: [],
              publications: Array.from({ length: shape.reports ?? 0 }, (_, index) => ({
                id: `00000000-0000-4000-8000-00000000d${String(index).padStart(3, '0')}`,
                mission_id: mission,
                copy: { title: `Invented report ${index + 1}`, company: 'Invented Machinery Co' },
                revoked: false,
              })),
            }
          : url.pathname === '/api/move/staff'
            ? {
                version: 1,
                moves: [
                  {
                    id: '00000000-0000-4000-8000-0000000000e1',
                    verb: 'Add',
                    object: 'the invented packing list',
                    holder: 'customer',
                    dueOn: null,
                    position: 1,
                    setAt: '2026-11-20T09:00:00.000Z',
                    closed: null,
                  },
                ],
              }
            : url.pathname === '/api/workspace/mission-catalogue'
              ? { routes: [], packs: [], types: [], requirements: [], assessments: [] }
              : url.pathname === '/api/workspace/commercial-mission'
                ? { assignments: [], quotations: [], targets: [] }
                : {};
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/?desk=${desk ? 'on' : 'off'}${moves ? '&moves=on' : ''}`);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Invented Machinery Co' }),
  ).toBeVisible();
  return { sent, codes };
}

const next = (page: Page) => page.getByRole('region', { name: 'Next step' });
const customer = (page: Page) =>
  page.getByRole('complementary', { name: 'What the customer sees' });
const actionDialog = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true });
const codeCheck = (page: Page) => page.getByRole('dialog', { name: 'Confirm it is you' });
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page })
      .include('.mission-page')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
  ).violations.map((v) => v.id);
async function other(page: Page, name: string) {
  const more = next(page).locator('details.mission-more');
  if (!(await more.evaluate((node: HTMLDetailsElement) => node.open)))
    await next(page).getByText('Other Actions').click();
  await next(page).getByRole('button', { name, exact: true }).click();
}

test('D6 off: the mission page is what it was, with its Overview buttons and side panel', async ({
  page,
}) => {
  await open(page, false);
  await expect(page.getByRole('heading', { name: 'Next step' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'What the customer sees' })).toHaveCount(0);
  await expect(page.locator('.mr-stage')).toHaveCount(0);
  await expect(page.locator('.mission-page .primary-link')).toHaveCount(0);
  const actions = page.getByLabel('Mission actions');
  await expect(actions.getByRole('button')).toHaveText([
    'Change Stage, Owner or Next Action',
    'Assign Route',
    'Reply on the Receipt',
  ]);
  await actions.getByRole('button', { name: 'Change Stage, Owner or Next Action' }).click();
  const panel = page.locator('aside.mission-panel');
  await expect(
    panel.getByRole('heading', { name: 'Change stage, owner or next action' }),
  ).toBeFocused();
  await expect(panel.locator('select[name="action"]')).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.mission-desk')).toHaveCount(0);
});

test('D6 on: the stage bar reads the customer marker, one Next step card holds the one primary button, and the customer panel is read-only', async ({
  page,
}) => {
  await open(page, true, {
    replies: [
      {
        id: '00000000-0000-4000-8000-0000000000f2',
        mission_id: mission,
        body: 'Invented second reply',
        created_at: '2026-11-21T09:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-0000000000f1',
        mission_id: mission,
        body: 'Invented first reply',
      },
    ],
    reports: 2,
  });
  // The same six stages and the same marker as the customer's Road: a received request sits on Define.
  const bar = page.getByRole('list', { name: 'Stage of Invented Machinery Co' });
  await expect(bar.getByRole('listitem')).toHaveCount(6);
  await expect(bar.locator('[aria-current="step"]')).toHaveText(/Define/);
  await expect(next(page)).toContainText('Read the request, then begin qualification.');
  // One primary button on the page, not two.
  const primary = page.locator('.mission-page .primary-link');
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveText('Begin Qualification');
  await expect(next(page).locator('.primary-link')).toHaveCount(1);
  // The old Overview buttons and the side panel are gone; nothing is offered twice.
  await expect(
    page.getByRole('button', { name: 'Change Stage, Owner or Next Action' }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Mission actions', { exact: true })).toHaveCount(0);
  // The other actions wait behind one named disclosure. A received request cannot be paused.
  await expect(next(page).getByRole('button', { name: 'Assign Route' })).toBeHidden();
  await next(page).getByText('Other Actions').click();
  await expect(next(page).getByLabel('Other mission actions').getByRole('button')).toHaveText([
    'Update Mission Details',
    'Cancel Mission',
    'Assign Route',
    'Reply on the Receipt',
  ]);
  // The customer panel: their own words for the stage, the replies and the approved reports. No control in it.
  const panel = customer(page);
  await expect(panel.locator('[data-customer-stage]')).toHaveText(
    'Define. Received, waiting for review.',
  );
  await expect(panel.locator('[data-customer-replies]')).toContainText('2 posted. Latest');
  await expect(panel.locator('[data-customer-replies]')).toContainText('Invented second reply');
  await expect(panel.locator('[data-customer-reports]')).toHaveText('2 approved for the customer.');
  await expect(panel.locator('button, a, input, select, textarea')).toHaveCount(0);
  await expect(panel.locator('[data-customer-moves]')).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
});

test('D6 on: empty, closed, paused and read-only states say what is true', async ({ page }) => {
  await open(page, true, { status: 'CLOSED' });
  await expect(next(page)).toContainText('This mission is closed. No step is waiting.');
  await expect(page.locator('.mission-page .primary-link')).toHaveCount(0);
  await expect(customer(page).locator('[data-customer-stage]')).toHaveText(
    'Follow through. This request is closed.',
  );
  await expect(customer(page).locator('[data-customer-replies]')).toHaveText('None posted yet.');
  await expect(customer(page).locator('[data-customer-reports]')).toHaveText('None approved yet.');
  await next(page).getByText('Other Actions').click();
  await expect(next(page).getByLabel('Other mission actions').getByRole('button')).toHaveText([
    'Assign Route',
    'Reply on the Receipt',
  ]);
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  await open(page, true, { status: 'ON_HOLD' });
  await expect(page.locator('.mission-page .primary-link')).toHaveText('Resume Mission');
  await expect(page.locator('.mission-desk .mr-stage [aria-current="step"]')).toHaveCount(0);
  await expect(customer(page).locator('[data-customer-stage]')).toContainText('On hold.');
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // A role that can only read gets no button, and the reason is written.
  await open(page, true, { role: 'viewer' });
  await expect(next(page).getByRole('button')).toHaveCount(0);
  await expect(next(page).getByText('Other Actions')).toHaveCount(0);
  await expect(next(page)).toContainText(
    'Your role can read this mission. An owner, admin or operator makes changes.',
  );
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // Where Move records are on, the open Moves the customer reads are listed, and the action is offered.
  await open(page, true, {}, [saved], true);
  await expect(customer(page).locator('[data-customer-moves]')).toHaveText(
    'Add the invented packing list',
  );
  await other(page, "Set the Customer's Next Move");
  await expect(actionDialog(page, "Set the Customer's Next Move")).toBeVisible();
});

test('D7: Begin Qualification opens in the centred dialog with only its fields, the route state and what the customer will see, and sends the same command', async ({
  page,
}) => {
  const { sent } = await open(page, true);
  const trigger = next(page).getByRole('button', { name: 'Begin Qualification' });
  await trigger.click();
  const dialog = actionDialog(page, 'Begin Qualification');
  await expect(dialog).toBeVisible();
  // Centred in the window, never a right-hand panel (decision 4).
  const box = (await dialog.boundingBox())!;
  const view = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - view.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y + box.height / 2 - view.height / 2)).toBeLessThanOrEqual(2);
  await expect(page.locator('aside.mission-panel')).toHaveCount(0);
  // What changes, what the customer will see, and the route state: qualification never needs a route.
  await expect(dialog.locator('[data-step-changes]')).toHaveText(
    'The stage changes from Received, waiting for review to Qualifying.',
  );
  await expect(dialog.locator('[data-step-customer]')).toHaveText(
    'The customer will see: Define. The Corridra team is checking your requirement.',
  );
  await expect(dialog.locator('[data-step-route]')).toHaveText(
    'Route: not assigned yet. You can begin qualification without a route.',
  );
  // Only its fields: no action chooser and no owner chooser; the rest travel unchanged.
  const form = dialog.locator('form');
  await expect(form.locator('select, textarea, input:not([type="hidden"])')).toHaveCount(5);
  await expect(form.locator('select[name="action"]')).toHaveCount(0);
  await expect(form.locator('select[name="owner"]')).toHaveCount(0);
  await expect(form.locator('input[type="hidden"][name="action"]')).toHaveValue('qualify');
  await expect(form.locator('input[type="hidden"][name="owner"]')).toHaveValue(owner.user_id);
  await expect(form.locator('select[name="marketCode"]')).toHaveValue('ES');
  await form.locator('input[name="nextAction"]').fill('Call the invented buyer on Monday');
  await form.locator('textarea[name="targetProfile"]').fill('Invented mills with export licences');
  await form.locator('textarea[name="reason"]').fill('Brief is complete, start qualification');
  await form.getByRole('button', { name: 'Begin Qualification' }).click();
  await expect(dialog).toBeHidden();
  await expect(next(page).getByText('Mission saved.')).toBeVisible();
  await expect(trigger).toBeFocused();
  expect(sent).toHaveLength(1);
  expect(sent[0]!.path).toBe('/api/workspace/mission');
  // The same payload the old form sent: the same ten names, nothing added.
  expect(Object.keys(sent[0]!.body).sort()).toEqual(
    [
      'action',
      'commandId',
      'dueAt',
      'id',
      'marketCode',
      'nextAction',
      'ownerId',
      'reason',
      'targetProfile',
      'version',
    ].sort(),
  );
  expect(sent[0]!.body).toMatchObject({
    id: mission,
    version: 3,
    action: 'qualify',
    ownerId: owner.user_id,
    nextAction: 'Call the invented buyer on Monday',
    dueAt: '2026-12-01T09:00:00.000Z',
    marketCode: 'ES',
    targetProfile: 'Invented mills with export licences',
    reason: 'Brief is complete, start qualification',
  });
  expect(String(sent[0]!.body.commandId)).toMatch(/^[0-9a-f-]{36}$/);
});

test('D7: an action with no fields of its own asks only for the reason and carries the mission values unchanged', async ({
  page,
}) => {
  const { sent } = await open(page, true, {
    status: 'ACTIVE',
    targetProfile: 'Invented mills with export licences',
    routeLabel: 'BD to CN',
  });
  await expect(page.locator('.mission-page .primary-link')).toHaveText('Begin Finding Companies');
  await other(page, 'Pause Mission');
  const dialog = actionDialog(page, 'Pause Mission');
  await expect(dialog.locator('[data-step-changes]')).toHaveText(
    'The stage changes from Active to Paused.',
  );
  await expect(dialog.locator('[data-step-customer]')).toContainText(
    'The customer will see: On hold.',
  );
  await expect(dialog.locator('[data-step-route]')).toHaveText('Route: BD to CN.');
  const form = dialog.locator('form');
  await expect(form.locator('select, textarea, input:not([type="hidden"])')).toHaveCount(1);
  await form.locator('textarea[name="reason"]').fill('Waiting for the invented buyer');
  await form.getByRole('button', { name: 'Pause Mission' }).click();
  await expect(dialog).toBeHidden();
  expect(sent[0]!.body).toMatchObject({
    id: mission,
    version: 3,
    action: 'pause',
    ownerId: owner.user_id,
    nextAction: 'Review submitted brief',
    dueAt: '2026-12-01T09:00:00.000Z',
    marketCode: 'ES',
    targetProfile: 'Invented mills with export licences',
    reason: 'Waiting for the invented buyer',
  });
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // Update Mission Details keeps every field the old form had, so nothing can no longer be changed.
  const again = await open(page, true, { status: 'ACTIVE', targetProfile: 'Invented mills' });
  await other(page, 'Update Mission Details');
  const details = actionDialog(page, 'Update Mission Details').locator('form');
  await expect(details.locator('select, textarea, input:not([type="hidden"])')).toHaveCount(6);
  await details.locator('select[name="owner"]').selectOption(second.user_id);
  await details.locator('textarea[name="reason"]').fill('Invented hand-over to Ben');
  await details.getByRole('button', { name: 'Update Mission Details' }).click();
  await expect(next(page).getByText('Mission saved.')).toBeVisible();
  expect(again.sent[0]!.body).toMatchObject({ action: 'assign', ownerId: second.user_id });
});

test('D7: the code check opens in place over the dialog, the form is kept and the same command is sent once more', async ({
  page,
}) => {
  const { sent, codes } = await open(page, true, { targetProfile: 'Invented mills' }, [
    stepUp,
    saved,
  ]);
  await next(page).getByRole('button', { name: 'Begin Qualification' }).click();
  const dialog = actionDialog(page, 'Begin Qualification');
  const form = dialog.locator('form');
  await form.locator('textarea[name="reason"]').fill('Brief is complete, start qualification');
  await form.getByRole('button', { name: 'Begin Qualification' }).click();
  const check = codeCheck(page);
  await expect(check).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(form.locator('textarea[name="reason"]')).toHaveValue(
    'Brief is complete, start qualification',
  );
  expect(sent).toHaveLength(1);
  await check.getByLabel('Six-digit code').fill('123456');
  await check.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(check).toBeHidden();
  await expect(dialog).toBeHidden();
  await expect(next(page).getByText('Mission saved.')).toBeVisible();
  expect(codes).toEqual(['123456']);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
});

test('D7: a refusal stays in the dialog with its reference, keeps the form, shows no database words and reuses the command id', async ({
  page,
}) => {
  const { sent } = await open(page, true, { targetProfile: 'Invented mills' }, [
    { status: 403, json: { error: refusal, correlationId: 'invented', reference } },
  ]);
  await next(page).getByRole('button', { name: 'Begin Qualification' }).click();
  const dialog = actionDialog(page, 'Begin Qualification');
  const form = dialog.locator('form');
  await form.locator('textarea[name="reason"]').fill('Brief is complete, start qualification');
  await form.getByRole('button', { name: 'Begin Qualification' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(refusal);
  await expect(dialog).toBeVisible();
  await expect(codeCheck(page)).toBeHidden();
  await expect(form.locator('textarea[name="reason"]')).toHaveValue(
    'Brief is complete, start qualification',
  );
  await expect(page.locator('main')).not.toContainText(databaseWords);
  await expect(form.getByRole('button', { name: 'Begin Qualification' })).toBeEnabled();
  await form.getByRole('button', { name: 'Begin Qualification' }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]!.body.commandId).toBe(sent[0]!.body.commandId);
  // Escape closes the dialog and focus goes back to the button that opened it.
  await expect(form.getByRole('button', { name: 'Begin Qualification' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(next(page).getByRole('button', { name: 'Begin Qualification' })).toBeFocused();
});

test('D7: while a change is out the dialog cannot be closed and a second submit sends nothing', async ({
  page,
}) => {
  const { sent } = await open(page, true, { targetProfile: 'Invented mills' }, [
    { ...saved, delay: 1500 },
  ]);
  await next(page).getByRole('button', { name: 'Begin Qualification' }).click();
  const dialog = actionDialog(page, 'Begin Qualification');
  const form = dialog.locator('form');
  await form.locator('textarea[name="reason"]').fill('Brief is complete, start qualification');
  await form.getByRole('button', { name: 'Begin Qualification' }).click();
  await expect(form.getByRole('button', { name: 'Begin Qualification' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await form.evaluate((node: HTMLFormElement) => node.requestSubmit());
  await expect(next(page).getByText('Mission saved.')).toBeVisible();
  expect(sent).toHaveLength(1);
});

test('D7: Reply on the Receipt and Assign Route open in the same dialog and send what they always sent', async ({
  page,
}) => {
  const { sent } = await open(page, true);
  await other(page, 'Reply on the Receipt');
  const reply = actionDialog(page, 'Reply on the Receipt');
  await expect(reply).toContainText('The customer will read it on their private receipt');
  await reply.getByLabel('Reply visible on the private receipt').fill('Invented reply words');
  await reply.getByRole('button', { name: 'Post Receipt Reply' }).click();
  await expect(reply).toBeHidden();
  await expect(next(page).getByText('Reply posted.')).toBeVisible();
  expect(sent[0]!.path).toBe('/api/workspace/mission-reply');
  expect(Object.keys(sent[0]!.body).sort()).toEqual(['body', 'id', 'replyId']);
  expect(sent[0]!.body).toMatchObject({ id: mission, body: 'Invented reply words' });
  await other(page, 'Assign Route');
  const route = actionDialog(page, 'Assign Route');
  await expect(route.locator('[data-step-route]')).toHaveText('Route: not assigned yet.');
  await expect(route).toContainText('No reviewed route packs yet.');
});

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`D6 and D7 at ${width} px: off and on fit the window, the dialog is centred and axe is clean`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const shots = process.env.D6_SHOTS;
    if (shots) mkdirSync(shots, { recursive: true });
    const fits = async () =>
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    await open(page, false);
    await fits();
    expect(await axe(page)).toEqual([]);
    if (shots) await page.screenshot({ path: `${shots}/mission-off-${width}.png`, fullPage: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    await open(page, true, { reports: 1 }, [
      { status: 403, json: { error: refusal, correlationId: 'invented', reference } },
    ]);
    await fits();
    expect(await axe(page)).toEqual([]);
    // Touch targets: the primary button and the disclosure are at least 44 px tall.
    for (const target of [
      next(page).getByRole('button', { name: 'Begin Qualification' }),
      next(page).getByText('Other Actions'),
    ])
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (shots) await page.screenshot({ path: `${shots}/mission-on-${width}.png`, fullPage: true });
    await next(page).getByText('Other Actions').click();
    await fits();
    if (shots)
      await page.screenshot({ path: `${shots}/mission-on-other-${width}.png`, fullPage: true });
    await next(page).getByRole('button', { name: 'Begin Qualification' }).click();
    const dialog = actionDialog(page, 'Begin Qualification');
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThanOrEqual(2);
    await fits();
    expect(await axe(page)).toEqual([]);
    if (shots) await page.screenshot({ path: `${shots}/dialog-${width}.png` });
    const form = dialog.locator('form');
    await form.locator('textarea[name="targetProfile"]').fill('Invented mills');
    await form.locator('textarea[name="reason"]').fill('Brief is complete, start qualification');
    await form.getByRole('button', { name: 'Begin Qualification' }).click();
    const line = dialog.getByRole('alert');
    await expect(line).toHaveText(refusal);
    await line.scrollIntoViewIfNeeded();
    const words = (await line.boundingBox())!;
    expect(words.x).toBeGreaterThanOrEqual(box.x);
    expect(words.x + words.width).toBeLessThanOrEqual(box.x + box.width);
    expect(await axe(page)).toEqual([]);
    if (shots) await page.screenshot({ path: `${shots}/dialog-refused-${width}.png` });
  });
}
