import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Team desk v4.1, unit D2. The mission forms (the queue cards and the mission page) are bundled from the
// source with the real stylesheets and the real in-place code check, and every request is answered here,
// so no database is needed. A refusal that needs a fresh authenticator code opens the check in place,
// keeps what was typed and sends the same change once more; any other refusal is shown beside the form
// with its reference. D2_ROOT bundles another checkout (a worktree of the old commit) in the same frame,
// which is how the step-up cases were shown to fail before the change. D2_SHOTS names a folder for the
// screenshots at the six widths. `shells: false` leaves the code check out of the page, as the team pages are
// while CORRIDRA_UX_SHELLS_V2 is off (the team frame mounts it): the form then shows the server's own words.
const root = resolve(process.env.D2_ROOT ?? '.');
const tenant = '00000000-0000-4000-8000-0000000000a1';
const mission = '00000000-0000-4000-8000-0000000000b2';
const owner = {
  user_id: '00000000-0000-4000-8000-0000000000c3',
  name: 'Invented Owner Ada',
  role: 'owner',
};
const reference = '7F3A9C2E';
const refusal = `This change was not allowed in this workspace. Check you are in the right workspace, or ask a workspace owner. Quote reference ${reference}.`;
const serverAsk = 'Verify your authenticator again to continue';
const keptLine = 'Confirm your authenticator code to finish this. Your changes are kept.';
const databaseWords = /row-level security|violates|permission denied|source_record|constraint/i;

let server: Server;
let origin = '';
test.beforeAll(async () => {
  const source = (path: string) => JSON.stringify(resolve(root, path));
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{OperatorFlags}from ${source('apps/web/app/operator/operator-flags.tsx')};
      import{Missions}from ${source('apps/web/app/operator/missions.tsx')};
      import{MissionPage}from ${source('apps/web/app/operator/[section]/[missionId]/mission-page.tsx')};
      import{StepUpDialog}from ${source('apps/web/components/ux/step-up-dialog.tsx')};
      import ${source('apps/web/app/operator/operator-overview.css')};
      const q=new URLSearchParams(location.search);const page=q.get('page');
      createRoot(document.getElementById('fixture')).render(
        <main id="main" className="operator-page ux-workspace"><h1>Missions</h1>
        <OperatorFlags replyReview={false}>
        {page==='mission'
          ?<MissionPage tenant="${tenant}" workspaceName="Sample team" missionId="${mission}" moveRecords={false}/>
          :<Missions tenant="${tenant}"/>}
        </OperatorFlags>{q.get('shells')==='off'?null:<StepUpDialog/>}</main>);`,
      loader: 'tsx',
      resolveDir: resolve(root, 'apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css', '.woff2': 'empty' },
    // The flag pictures are static files of the site, not modules to bundle.
    external: ['/flags/*'],
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
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Missions</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

const queue = {
  role: 'owner',
  total: 1,
  owners: [owner],
  history: [],
  replies: [],
  missions: [
    {
      id: mission,
      status: 'DRAFT',
      version: 1,
      reason: '',
      notice_version: 'invented-notice-1',
      acknowledged_at: '2026-11-01T00:00:00.000Z',
      source_kind: 'SELF_SERVE',
      claim_status: 'SELF_DECLARED',
      country_code: 'ES',
      target_profile: null,
      owner_id: owner.user_id,
      due_at: '2026-12-01T09:00:00.000Z',
      updated_at: '2026-11-20T09:00:00.000Z',
      next_action: 'Review submitted brief',
      route_label: null,
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
};
type Answer = { status: number; json: unknown; delay?: number };
const saved: Answer = { status: 201, json: { ok: true } };
const stepUp: Answer = {
  status: 401,
  json: { error: 'Verify your authenticator again to continue', code: 'STEP_UP_REQUIRED' },
};

/** Opens the fixture. `answers` are given to the mission command in order; the last one repeats. */
async function open(page: Page, where: 'queue' | 'mission', answers: Answer[], shells = true) {
  const sent: Record<string, unknown>[] = [];
  const codes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/verify-totp')) {
      codes.push(String((request.postDataJSON() as { code?: unknown } | null)?.code));
      return route.fulfill({ json: { token: 'invented', user: { id: owner.user_id } } });
    }
    if (url.pathname === '/api/workspace/mission' && request.method() === 'POST') {
      sent.push(request.postDataJSON() as Record<string, unknown>);
      const answer = answers[Math.min(sent.length, answers.length) - 1]!;
      if (answer.delay) await new Promise((done) => setTimeout(done, answer.delay));
      return route.fulfill({ status: answer.status, json: answer.json });
    }
    const json =
      url.pathname === '/api/workspace/missions' || url.pathname === '/api/team-work/mission'
        ? queue
        : url.pathname === '/api/team-work/flags'
          ? { missionsV2: false }
          : url.pathname === '/api/workspace/mission-catalogue'
            ? { routes: [], packs: [], types: [], requirements: [], assessments: [] }
            : url.pathname === '/api/workspace/commercial-mission'
              ? {
                  role: 'owner',
                  mission: { id: mission, version: 1, created_at: '2026-11-17T07:00:00Z' },
                  assignments: [],
                  requirements: [],
                  assessments: [],
                  rfqs: [],
                  quotations: [],
                  decisions: [],
                  schedules: [],
                  meetings: [],
                  targets: [],
                  owners: [],
                  comparison: [],
                }
              : url.pathname === '/api/workspace/workspace'
                ? { sources: [], claims: [] }
                : url.pathname === '/api/workspace/meetings'
                  ? { meetings: [], meetingsTotal: 0, next: null }
                  : {};
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/?page=${where}${shells ? '' : '&shells=off'}`);
  if (where === 'mission')
    await page.getByRole('button', { name: 'Change Stage, Owner or Next Action' }).click();
  const form = page.locator('form.operator-form', {
    has: page.getByRole('button', { name: 'Save Mission Action' }),
  });
  await expect(form).toBeVisible();
  return { sent, codes, form };
}

async function fill(form: ReturnType<Page['locator']>) {
  await form.locator('select[name="action"]').selectOption('qualify');
  await form.locator('input[name="nextAction"]').fill('Call the invented buyer on Monday');
  await form.locator('textarea[name="targetProfile"]').fill('Invented mills with export licences');
  await form.locator('textarea[name="reason"]').fill('Brief is complete, start qualification');
}
async function expectKept(form: ReturnType<Page['locator']>) {
  await expect(form.locator('select[name="action"]')).toHaveValue('qualify');
  await expect(form.locator('input[name="nextAction"]')).toHaveValue(
    'Call the invented buyer on Monday',
  );
  await expect(form.locator('textarea[name="targetProfile"]')).toHaveValue(
    'Invented mills with export licences',
  );
  await expect(form.locator('textarea[name="reason"]')).toHaveValue(
    'Brief is complete, start qualification',
  );
}
const save = (form: ReturnType<Page['locator']>) =>
  form.getByRole('button', { name: 'Save Mission Action' });
const codeCheck = (page: Page) => page.getByRole('dialog', { name: 'Confirm it is you' });
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page })
      .include('form.operator-form')
      .include('dialog[open]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
  ).violations.map((v) => v.id);

for (const where of ['queue', 'mission'] as const) {
  test(`D2 ${where}: a fresh authenticator refusal asks for the code in place, keeps the form and sends the change once more`, async ({
    page,
  }) => {
    const { sent, codes, form } = await open(page, where, [stepUp, saved]);
    await fill(form);
    await save(form).click();
    const dialog = codeCheck(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      'For this step we need a fresh authenticator code. Your work on the page is kept.',
    );
    await expectKept(form);
    expect(sent).toHaveLength(1);
    await dialog.getByLabel('Six-digit code').fill('123456');
    await dialog.getByRole('button', { name: 'Confirm and continue' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Mission saved.')).toBeVisible();
    expect(codes).toEqual(['123456']);
    // Exactly one retry, and it is the same command: same id, same typed values.
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]).toMatchObject({
      id: mission,
      version: 1,
      action: 'qualify',
      nextAction: 'Call the invented buyer on Monday',
      targetProfile: 'Invented mills with export licences',
      reason: 'Brief is complete, start qualification',
    });
    expect(String(sent[0]!.commandId)).toMatch(/^[0-9a-f-]{36}$/);
  });

  test(`D2 ${where}: closing the code check keeps the form and says so; a second refusal is not retried again`, async ({
    page,
  }) => {
    const { sent, form } = await open(page, where, [stepUp]);
    await fill(form);
    await save(form).click();
    await codeCheck(page).getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByText(keptLine)).toBeVisible();
    await expectKept(form);
    expect(sent).toHaveLength(1);
    await expect(save(form)).toBeEnabled();
    // Asked again and confirmed, the change is sent once more only: a refusal after the code is shown, not looped.
    await save(form).click();
    await codeCheck(page).getByLabel('Six-digit code').fill('123456');
    await codeCheck(page).getByRole('button', { name: 'Confirm and continue' }).click();
    await expect(page.getByText('Verify your authenticator again to continue')).toBeVisible();
    await expect(codeCheck(page)).toBeHidden();
    expect(sent).toHaveLength(3);
    await expectKept(form);
  });

  test(`D2 ${where}: with the team shell switch off there is no code check; the form is kept and shows the server's own words`, async ({
    page,
  }) => {
    const { sent, form } = await open(page, where, [stepUp, saved], false);
    await fill(form);
    await save(form).click();
    await expect(page.getByText(serverAsk)).toBeVisible();
    await expect(page.getByText(keptLine)).toHaveCount(0);
    await expect(codeCheck(page)).toHaveCount(0);
    await expectKept(form);
    await expect(save(form)).toBeEnabled();
    expect(sent).toHaveLength(1);
    expect(await axe(page)).toEqual([]);
  });

  test(`D2 ${where}: a refusal written by the product keeps its words and gains the reference on the page`, async ({
    page,
  }) => {
    const { form } = await open(page, where, [
      { status: 403, json: { error: 'Access denied', correlationId: 'invented', reference } },
    ]);
    await fill(form);
    await save(form).click();
    await expect(page.getByText(`Access denied. Quote reference ${reference}.`)).toBeVisible();
    await expectKept(form);
    // A sentence that already ends with a stop gets no second one, and 401 and 400 are shown as sent.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const stale = await open(page, where, [
      {
        status: 409,
        json: {
          error: 'Mission changed; refresh and retry.',
          correlationId: 'invented',
          reference,
        },
      },
    ]);
    await fill(stale.form);
    await save(stale.form).click();
    await expect(
      page.getByText(`Mission changed; refresh and retry. Quote reference ${reference}.`),
    ).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const bad = await open(page, where, [
      {
        status: 400,
        json: { error: 'Check the submitted values', correlationId: 'invented', reference },
      },
    ]);
    await fill(bad.form);
    await save(bad.form).click();
    await expect(page.getByText('Check the submitted values', { exact: true })).toBeVisible();
    await expect(page.locator('main')).not.toContainText(reference);
  });

  test(`D2 ${where}: a refused change shows what to do with its reference, keeps the form and shows no database words`, async ({
    page,
  }) => {
    const { sent, form } = await open(page, where, [
      { status: 403, json: { error: refusal, correlationId: 'invented', reference } },
    ]);
    await fill(form);
    await save(form).click();
    await expect(page.getByText(refusal)).toBeVisible();
    await expect(codeCheck(page)).toBeHidden();
    await expectKept(form);
    await expect(save(form)).toBeEnabled();
    expect(sent).toHaveLength(1);
    await expect(page.locator('main')).not.toContainText(databaseWords);
    expect(await axe(page)).toEqual([]);
  });

  test(`D2 ${where}: on a slow network the button is busy and a second submit sends nothing`, async ({
    page,
  }) => {
    const { sent, form } = await open(page, where, [{ ...saved, delay: 1500 }]);
    await fill(form);
    await save(form).click();
    await expect(save(form)).toBeDisabled();
    await form.locator('input[name="nextAction"]').press('Enter');
    await form.evaluate((node: HTMLFormElement) => node.requestSubmit());
    await expect(page.getByText('Mission saved.')).toBeVisible();
    expect(sent).toHaveLength(1);
  });

  test(`D2 ${where}: an expired session is shown as before, with no code check`, async ({
    page,
  }) => {
    const { sent, form } = await open(page, where, [
      { status: 401, json: { error: 'Sign in to continue', correlationId: 'invented', reference } },
    ]);
    await fill(form);
    await save(form).click();
    await expect(page.getByText('Sign in to continue')).toBeVisible();
    await expect(codeCheck(page)).toBeHidden();
    await expectKept(form);
    expect(sent).toHaveLength(1);
  });
}

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`D2 at ${width} px the refusal and the code check fit the window and pass axe`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const shots = process.env.D2_SHOTS;
    if (shots) mkdirSync(shots, { recursive: true });
    for (const where of ['queue', 'mission'] as const) {
      const refused = await open(page, where, [
        { status: 403, json: { error: refusal, correlationId: 'invented', reference } },
      ]);
      await fill(refused.form);
      await save(refused.form).click();
      const line = page.getByText(refusal);
      await expect(line).toBeVisible();
      await line.scrollIntoViewIfNeeded();
      const box = (await line.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      expect(await axe(page)).toEqual([]);
      if (shots) await page.screenshot({ path: `${shots}/refusal-${where}-${width}.png` });

      const asked = await open(page, where, [stepUp, saved]);
      await fill(asked.form);
      await save(asked.form).click();
      const dialog = codeCheck(page);
      await expect(dialog).toBeVisible();
      const frame = (await dialog.boundingBox())!;
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(width);
      expect(await axe(page)).toEqual([]);
      if (shots) await page.screenshot({ path: `${shots}/code-check-${where}-${width}.png` });
      await page.unrouteAll({ behavior: 'ignoreErrors' });

      const plain = await open(page, where, [stepUp, saved], false);
      await fill(plain.form);
      await save(plain.form).click();
      const asked2 = page.getByText(serverAsk);
      await expect(asked2).toBeVisible();
      await asked2.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      expect(await axe(page)).toEqual([]);
      if (shots) await page.screenshot({ path: `${shots}/shell-off-${where}-${width}.png` });
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
}
