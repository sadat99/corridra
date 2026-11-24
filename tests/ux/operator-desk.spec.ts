import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The operator desk (unit 11 of the Signed-in Review Board, owner approved 20 November 2026): the Today table with its
// two collapsed rows, and the team sidebar with its pinned queues. No database: the real Today panel and sidebar are
// bundled with esbuild (as compare-grid.spec.ts does) and the page's own reads are answered by a fetch stand-in. The
// page tokens come from /plan. Every company, mission and number below is invented sample data.
let script = '';
let styles = '';

const entry = `
import { createRoot } from 'react-dom/client';
import '${resolve('apps/web/app/operator/operator-overview.css')}';
import { TodayPanel } from ${JSON.stringify(resolve('apps/web/app/operator/today.tsx'))};
import { TeamSidebar } from ${JSON.stringify(resolve('apps/web/components/ux/team-sidebar.tsx'))};
import { publishTeamContext } from ${JSON.stringify(resolve('apps/web/lib/ux/team-context.ts'))};

const { scenario, role, mode } = window.__desk;
const day = 86400000;
const now = Date.now();
const iso = (offsetDays) => new Date(now + offsetDays * day).toISOString();
const mission = (i, status, due) => ({
  id: 'm' + i,
  status,
  due_at: due,
  brief: { company: 'Sample Company ' + i, objective: 'Source packaging suppliers', market: 'Vietnam' },
});
const json = (body, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const many = scenario === 'many';
const none = scenario === 'empty';
const freshList = none ? [] : Array.from({ length: many ? 30 : 3 }, (_, i) => mission(i, 'DRAFT', iso(3 + i)));
const lateList = none ? [] : Array.from({ length: many ? 25 : 2 }, (_, i) => mission(100 + i, 'ACTIVE', iso(-(4 + i))));
window.fetch = (input) => {
  const url = String(input);
  if (scenario === 'failure' && url.includes('/api/workspace/missions')) return json({ error: 'x' }, 500);
  if (url.includes('/api/workspace/missions')) {
    if (url.includes('stage=DRAFT')) return json({ missions: freshList, total: many ? 80 : freshList.length });
    if (url.includes('filter=overdue')) return json({ missions: lateList, total: lateList.length });
    return json({ missions: [...freshList, ...lateList], total: freshList.length + lateList.length });
  }
  if (url.includes('/api/team-control/today'))
    return scenario === 'partfail'
      ? json({ error: 'x' }, 500)
      : json({ acceptedQuotesNotStarted: none ? 0 : 2, serviceRequestsToQuote: none ? 0 : 1, repliesToReview: none ? 0 : 4 });
  if (url.includes('/api/workspace/meetings'))
    return scenario === 'partfail'
      ? json({ error: 'x' }, 500)
      : json({
          meetings: none ? [] : [
            { id: 'a', title: 'Sample supplier call', status: 'SCHEDULED', starts_at: iso(1), due_at: iso(1), location: null },
            { id: 'b', title: 'Sample factory visit', status: 'SCHEDULED', starts_at: iso(2), due_at: iso(2), location: 'Sample City' },
          ],
          followups: [],
        });
  if (url.includes('/api/workspace/problem-reports'))
    return json({ counts: { received: none ? 0 : 2, in_review: 1 }, oldestReceivedAt: iso(-3) });
  if (url.includes('/api/workspace/customer-erasure-queue'))
    return json({
      items: none || url.includes('in_progress') ? [] : [{ id: 'e1', reference: 'ER-SAMPLE-1', dueAt: iso(-2), daysLeft: -2, status: 'received' }],
      nextAfter: null,
    });
  if (url.includes('/api/team-work/flags')) return json({ missionsV2: false });
  return json({}, 404);
};
publishTeamContext({ tenant: 'sample-workspace', role });
createRoot(document.getElementById('mount')).render(
  <main id="desk-fixture" className="ux-workspace ux-operator-home">
    <h1>Operator desk fixture, sample data</h1>
    {mode === 'sidebar' ? (
      <TeamSidebar urls={false} desk problemReports />
    ) : (
      <div className="ux-panel ux-overview">
        <TodayPanel tenant="sample-workspace" revision={0} role={role} problemReports desk />
      </div>
    )}
  </main>,
);
`;

test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: resolve('apps/web') },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    // Flag images are served by the site, not bundled: a workspace tree that draws them still builds here.
    external: ['/flags/*'],
    write: false,
    outdir: 'out',
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'css' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  script = result.outputFiles.find((f) => f.path.endsWith('.js'))!.text;
  styles = result.outputFiles.find((f) => f.path.endsWith('.css'))!.text;
});

async function mount(
  page: Page,
  width: number,
  scenario: string,
  { role = 'owner', mode = 'today' }: { role?: string; mode?: 'today' | 'sidebar' } = {},
) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/plan');
  await expect(
    page.getByRole('button', { name: /^(Continue|Pick One to Continue)$/ }),
  ).toBeEnabled();
  await page.evaluate(
    ({ css, desk }) => {
      document.body.innerHTML = '<div id="mount"></div>';
      document.body.className = '';
      (window as unknown as { __desk: unknown }).__desk = desk;
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
    },
    { css: styles, desk: { scenario, role, mode } },
  );
  await page.addScriptTag({ content: 'window.process = { env: { NODE_ENV: "production" } };' });
  await page.addScriptTag({ content: script, type: 'module' });
  await page.waitForSelector(
    mode === 'sidebar'
      ? '#desk-fixture nav'
      : '#desk-fixture .ux-desk .ux-desk-sentence, #desk-fixture .ux-today-state',
  );
}

const shots = process.env.COMPARE_SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const width of [320, 390, 768, 1440]) {
  test(`Today at ${width}px: sentence, table, chips, targets, no overflow, axe clean`, async ({
    page,
  }) => {
    await mount(page, width, 'busy');
    await expect(page.locator('.ux-desk-sentence')).toHaveText(
      '6 things need you now. 3 are late.',
    );
    // Table semantics: a caption, column headers with scope, one row header per row, Open named by its row.
    const table = page.getByRole('table', { name: 'Things that need you now, latest first' });
    await expect(table).toBeVisible();
    expect(await table.locator('thead th[scope="col"]').count()).toBeGreaterThanOrEqual(3);
    const rows = table.locator('tbody tr:not([hidden])');
    const rowCount = await rows.count();
    expect(await table.locator('tbody tr:not([hidden]) th[scope="row"]').count()).toBe(rowCount);
    const opens = await table.getByRole('link', { name: /^Open / }).count();
    expect(opens).toBe(rowCount);
    // Late is never colour alone: an icon and the word with its days.
    const lateChip = page.locator('.ux-desk-chip[data-tone="late"]').first();
    await expect(lateChip).toHaveText(/^Late, \d+ days?$/);
    expect(await lateChip.locator('svg').count()).toBe(1);
    expect(await page.locator('.ux-desk-chip[data-tone="new"]').first().innerText()).toBe('New');
    // Targets: Open and every Show button are at least 44 px tall; the chip is 28 px.
    for (const box of await page
      .locator('a.ux-desk-open, .ux-desk-toggle')
      .evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => el.getBoundingClientRect()),
      ))
      expect(box.height).toBeGreaterThanOrEqual(43.5);
    expect((await lateChip.boundingBox())!.height).toBeGreaterThanOrEqual(27.5);
    expect(await noOverflow(page)).toBe(true);
    // Also waiting and This week start closed and open with their button.
    for (const title of ['Also waiting', 'This week']) {
      const button = page.getByRole('button', { name: `Show ${title}` });
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await button.click();
      await expect(page.getByRole('button', { name: `Hide ${title}` })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    }
    expect(await noOverflow(page)).toBe(true);
    const axe = await new AxeBuilder({ page }).include('#desk-fixture').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await shot(page, `today-${width}`);
  });
}

test('the place line says how many meetings lack a place, and Why explains it', async ({
  page,
}) => {
  await mount(page, 390, 'busy');
  const line = page.locator('.ux-desk-place');
  await expect(line).toContainText('Place not entered for 1 of 2 meetings.');
  const why = line.getByRole('button', { name: 'Why' });
  await expect(why).toHaveAttribute('aria-expanded', 'false');
  await why.click();
  await expect(line).toContainText('No place was entered when the meeting was booked.');
  expect((await why.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
});

test('many items: five rows, Show N More, and the cut is never silent', async ({ page }) => {
  await mount(page, 390, 'many');
  await expect(page.locator('.ux-desk-sentence')).toContainText('At least');
  const visibleRows = () => page.locator('.ux-desk-table tbody tr:not([hidden])').count();
  expect(await visibleRows()).toBe(5);
  const more = page.getByRole('button', { name: /^Show \d+ More$/ });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.ux-today-more', { hasText: 'The full list' })).toContainText(
    'The full list is in Missions.',
  );
  await more.click();
  expect(await visibleRows()).toBeGreaterThan(5);
  await expect(page.getByRole('button', { name: 'Show Fewer' })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await shot(page, 'today-many-390');
});

test('empty: nothing needs you now', async ({ page }) => {
  await mount(page, 390, 'empty');
  await expect(page.locator('.ux-desk-sentence')).toHaveText('Nothing needs you now.');
  const axe = await new AxeBuilder({ page }).include('#desk-fixture').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  await shot(page, 'today-empty-390');
});

test('the whole list failing says so and offers Try Again', async ({ page }) => {
  await mount(page, 390, 'failure');
  await expect(page.locator('.ux-today-state')).toContainText("Today's list could not be loaded.");
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
  await shot(page, 'today-failure-390');
});

test('one part failing names the part, keeps the rest and offers Try Again', async ({ page }) => {
  await mount(page, 390, 'partfail');
  await expect(page.locator('.ux-desk-table')).toBeVisible();
  // Closed, each failed row already says so.
  for (const [title, words] of [
    ['Also waiting', 'Partly not available'],
    ['This week', 'Not available'],
  ] as const)
    await expect(
      page.locator('.ux-desk-fold', { hasText: title }).locator('.ux-desk-fold-summary'),
    ).toHaveText(words);
  await page.getByRole('button', { name: 'Show Also waiting' }).click();
  await page.getByRole('button', { name: 'Show This week' }).click();
  await expect(
    page.getByText(
      'Also waiting is not available. It could not be read just now. Your work is safe.',
    ),
  ).toBeVisible();
  await expect(
    page.getByText('This week is not available. It could not be read just now. Your work is safe.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try Again' }).first()).toBeVisible();
  await shot(page, 'today-partfail-390');
});

test('forced colours keep a border on the Late chip and the collapsed rows', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await mount(page, 390, 'busy');
  const widths = await page.evaluate(() => ({
    chip: getComputedStyle(document.querySelector('.ux-desk-chip[data-tone="late"]')!)
      .borderTopWidth,
    fold: getComputedStyle(document.querySelector('.ux-desk-fold')!).borderTopWidth,
  }));
  expect(parseFloat(widths.chip)).toBeGreaterThanOrEqual(1);
  expect(parseFloat(widths.fold)).toBeGreaterThanOrEqual(1);
});

test('page length at 1440 with the rows closed is measured', async ({ page }) => {
  await mount(page, 1440, 'busy');
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  test.info().annotations.push({ type: 'page-length-1440', description: `${height}px` });
  console.log(`operator desk Today page length at 1440: ${height}px (viewport 900px)`);
  if (shots) {
    mkdirSync(shots, { recursive: true });
    writeFileSync(`${shots}/page-length-1440.txt`, `${height}px with rows closed\n`);
  }
  expect(height).toBeLessThan(1800);
});

for (const width of [320, 390, 768, 1440]) {
  test(`sidebar at ${width}px: the owner has five groups and the Queues list`, async ({ page }) => {
    await mount(page, width, 'busy', { role: 'owner', mode: 'sidebar' });
    const nav = page.locator('nav.ux-team-sidebar');
    await expect(nav).toHaveAttribute('data-desk', 'true');
    const groups = await nav.locator(':scope > ul:not(.ux-team-pins) > li > a').allInnerTexts();
    expect(groups).toEqual(['Today', 'Missions', 'Companies', 'Money']);
    await expect(nav.locator('summary')).toContainText('Settings and checks');
    const queues = nav.getByRole('list', { name: 'Queues' });
    await expect(queues.getByRole('link')).toHaveText(['Problem Reports', 'Erasure Requests']);
    // No count is shown until a successful read published one.
    await expect(queues.locator('.ux-team-pin-count')).toHaveCount(0);
    for (const box of await nav
      .locator('a, summary')
      .evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => el.getBoundingClientRect()),
      ))
      expect(box.height).toBeGreaterThanOrEqual(43.5);
    expect(await noOverflow(page)).toBe(true);
    // The current page is marked: Today is the page of the fixture.
    await expect(nav.locator('a[aria-current="page"]')).toHaveText('Today');
    const axe = await new AxeBuilder({ page }).include('#desk-fixture').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await shot(page, `sidebar-owner-${width}`);
  });
}

test('an operator sees neither Settings and checks nor the Queues list', async ({ page }) => {
  await mount(page, 390, 'busy', { role: 'operator', mode: 'sidebar' });
  const nav = page.locator('nav.ux-team-sidebar');
  await expect(nav.getByRole('link', { name: 'Today' })).toBeVisible();
  await expect(nav.locator('summary')).toHaveCount(0);
  await expect(nav.getByText('Settings and checks')).toHaveCount(0);
  await expect(nav.getByRole('list', { name: 'Queues' })).toHaveCount(0);
  await shot(page, 'sidebar-operator-390');
});
