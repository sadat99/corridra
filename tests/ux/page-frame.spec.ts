import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI/UX.v3 consistency pass, unit A2: the shared page frame, the fee schedule row menu and the icon-only Refresh, drawn
// with the real components and the real stylesheets on a small bundled page (no server data, no sign-in), at the three
// widths of the owner's checklist. Every case fails on the code before this change: the frame, the menu and the icon
// variant do not exist there.
const fixturePath = '/__page-frame-fixture';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { WorkspaceShell } from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
        import { pageFrameSlots } from ${JSON.stringify(resolve('apps/web/components/ux/page-frame.tsx'))};
        import { FeeScheduleActions } from ${JSON.stringify(resolve('apps/web/app/account/delegations/fee-schedule-actions.tsx'))};
        import { RefreshButton } from ${JSON.stringify(resolve('apps/web/app/account/refresh-button.tsx'))};
        const query = new URLSearchParams(location.search);
        const scenario = query.get('s');
        window.__toggled = 0; window.__edited = 0;
        const slots = pageFrameSlots({
          back: { label: 'Back to my account', href: '/account' },
          chips: [{ label: 'Planning record only', tone: 'waiting' }],
          helper: 'An invitation gives no access to the organiser workspace.',
          primary: <a className="primary-link" href="/go">Open Participants</a>,
          tabs: <nav aria-label="Sections"><a href="#a" aria-current="page">Terms</a><a href="#b">Results</a></nav>,
        });
        const body = scenario === 'fee' || scenario === 'feeRetired'
          ? <ul><li><strong>Sample trip fees</strong> <FeeScheduleActions name="Sample trip fees" retired={scenario === 'feeRetired'} busy={false}
              onEdit={() => { window.__edited += 1; }} onToggleRetired={() => { window.__toggled += 1; }} /></li></ul>
          : scenario === 'refresh'
            ? <div className="ux-section-head"><h2>Workspaces</h2><RefreshButton label="workspaces" iconOnly onClick={() => {}} /></div>
            : <section><h2>Your registrations</h2><p>Body text of the page.</p></section>;
        createRoot(document.getElementById('app')).render(
          <WorkspaceShell title="Delegation registrations" customer above={slots.above} lead={slots.lead} nav={slots.tabs}>
            {body}
          </WorkspaceShell>);`,
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
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const css = [
    'app/globals.css',
    'components/ux/shells.css',
    'components/ux/page-frame.css',
    'components/ux/overflow-menu.css',
    'app/account/delegations/fee-schedule-actions.css',
    'app/account/refresh-button.css',
  ]
    .map((file) => readFileSync(resolve('apps/web', file), 'utf8'))
    .join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page frame fixture</title><style>${css}</style></head><body><div class="site-shell"><div id="app"></div></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

async function open(page: Page, width: number, scenario = 'frame') {
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`${fixturePath}?s=${scenario}`);
  await expect(page.locator('h1')).toHaveText('Delegation registrations');
}

for (const width of [390, 768, 1440]) {
  test.describe(`${width} px`, () => {
    test('the frame runs back link, chips, title, one helper line, one primary action, tabs, then the page', async ({
      page,
    }) => {
      await open(page, width);
      const box = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())!;
      const back = await box(page.getByRole('link', { name: 'Back to my account' }));
      const chip = await box(page.getByText('Planning record only'));
      const title = await box(page.locator('h1'));
      const helper = await box(page.locator('.ux-frame-helper'));
      const primary = await box(page.getByRole('link', { name: 'Open Participants' }));
      const tabs = await box(page.getByRole('navigation', { name: 'Sections' }));
      const body = await box(page.getByText('Body text of the page.'));
      expect(back.y + back.height).toBeLessThanOrEqual(title.y);
      expect(chip.y + chip.height).toBeLessThanOrEqual(title.y);
      expect(title.y + title.height).toBeLessThanOrEqual(helper.y + 1);
      // The primary sits right of the helper on a wide screen and under it on a phone; never above the title.
      expect(primary.y + primary.height).toBeGreaterThan(title.y + title.height);
      if (width < 768) expect(helper.y + helper.height).toBeLessThanOrEqual(primary.y + 1);
      expect(Math.max(helper.y + helper.height, primary.y + primary.height)).toBeLessThanOrEqual(
        tabs.y + 1,
      );
      expect(tabs.y + tabs.height).toBeLessThanOrEqual(body.y);
      await expect(page.locator('.primary-link')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveCount(1);
    });

    test('the helper is one 14 px line of secondary text, the edges line up and nothing scrolls sideways', async ({
      page,
    }) => {
      await open(page, width);
      expect(
        await page.locator('.ux-frame-helper').evaluate((el) => getComputedStyle(el).fontSize),
      ).toBe('14px');
      const lefts = await page.evaluate(() =>
        [
          document.querySelector('.ux-back'),
          document.querySelector('h1'),
          document.querySelector('.ux-frame-helper'),
        ].map((el) => Math.round(el!.getBoundingClientRect().left)),
      );
      expect(new Set(lefts).size).toBe(1);
      if (width === 390) expect(lefts[0]).toBeGreaterThanOrEqual(16);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    });
  });
}

test('on a phone the back link and the primary action are 44 px targets', async ({ page }) => {
  await open(page, 390);
  for (const name of ['Back to my account', 'Open Participants'])
    expect((await page.getByRole('link', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(
      44,
    );
});

test.describe('fee schedule row actions', () => {
  for (const width of [390, 1440]) {
    test(`${width} px: Retire is one tap deeper in a menu named for the record, and asks before it acts`, async ({
      page,
    }) => {
      await open(page, width, 'fee');
      await expect(
        page.getByRole('button', { name: 'Edit Fee Schedule Sample trip fees', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('menuitem', { name: /Retire Fee Schedule/ })).toHaveCount(0);
      const trigger = page.getByRole('button', {
        name: 'More actions for Sample trip fees',
        exact: true,
      });
      expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await trigger.click();
      const retire = page.getByRole('menuitem', {
        name: 'Retire Fee Schedule Sample trip fees',
        exact: true,
      });
      await expect(retire).toBeVisible();
      await retire.click();
      // Nothing happened yet: the confirm step comes first.
      expect(
        await page.evaluate(() => (window as unknown as { __toggled: number }).__toggled),
      ).toBe(0);
      const confirm = page.getByRole('group', { name: 'Confirm retiring Sample trip fees' });
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: 'Keep Sample trip fees' }).click();
      await expect(confirm).toHaveCount(0);
      expect(
        await page.evaluate(() => (window as unknown as { __toggled: number }).__toggled),
      ).toBe(0);
      await trigger.click();
      await page.getByRole('menuitem', { name: 'Retire Fee Schedule Sample trip fees' }).click();
      await confirm.getByRole('button', { name: 'Retire Sample trip fees' }).click();
      expect(
        await page.evaluate(() => (window as unknown as { __toggled: number }).__toggled),
      ).toBe(1);
    });
  }

  test('Restore needs no confirm step and is in the same menu', async ({ page }) => {
    await open(page, 390, 'feeRetired');
    await page.getByRole('button', { name: 'More actions for Sample trip fees' }).click();
    await page.getByRole('menuitem', { name: 'Restore Fee Schedule Sample trip fees' }).click();
    expect(await page.evaluate(() => (window as unknown as { __toggled: number }).__toggled)).toBe(
      1,
    );
    await expect(page.getByRole('group', { name: /Confirm retiring/ })).toHaveCount(0);
  });

  test('the menu opens from the keyboard and Escape returns focus to its button', async ({
    page,
  }) => {
    await open(page, 1440, 'fee');
    const trigger = page.getByRole('button', { name: 'More actions for Sample trip fees' });
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await expect(
      page.getByRole('menuitem', { name: 'Retire Fee Schedule Sample trip fees' }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
});

test('Refresh as an icon keeps its name, its words and a 44 px target', async ({ page }) => {
  await open(page, 390, 'refresh');
  const refresh = page.getByRole('button', { name: 'Refresh workspaces', exact: true });
  await expect(refresh).toBeVisible();
  expect(((await refresh.textContent()) ?? '').trim()).toBe('');
  const size = (await refresh.boundingBox())!;
  expect(size.height).toBeGreaterThanOrEqual(44);
  expect(size.width).toBeGreaterThanOrEqual(44);
});
