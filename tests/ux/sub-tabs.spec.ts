import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// L-03, the REFERENCE for the shared sub-tabs (docs/revamp/specs/layout-budget.md section 2). It renders
// apps/web/components/ux/sub-tabs.tsx on a small bundled page (no server and no sign-in) and proves what
// every track inherits: a tab by ?tab=, an old #id (a tab, an alias, an element inside a panel) landing
// on the right tab, arrow keys with Home and End (mirrored right to left), hidden panels kept in the
// page, entries kept across a switch, 44 px tabs that wrap on a phone, and a clean axe run.

const fixturePath = '/__sub-tabs-fixture';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { SubTabs, openSubTab } from ${JSON.stringify(resolve('apps/web/components/ux/sub-tabs.tsx'))};
        import { LanguageProvider } from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
        const tabs = [
          { id: 'people', label: 'People and access', panel: <section><h2 id="people-heading" tabIndex={-1}>People</h2><label>Note <input id="note" /></label><button type="button" id="go-invite" onClick={(e) => openSubTab(e.currentTarget, 'invite')}>Go to invite</button><button type="button" id="go-missing" onClick={(e) => openSubTab(e.currentTarget, 'missing')}>Go to a missing tab</button></section> },
          { id: 'tools', label: 'Tools', aliases: ['old-tools'], panel: <section><h2>Tools</h2><p>{'Tool text. '.repeat(30)}</p><h3 id="deep-heading" tabIndex={-1}>Deep heading</h3></section> },
          { id: 'invite', label: 'Invite a team member', anchor: 'workspace-invite', panel: <section><h2>Invite</h2><button type="button">Send invite</button></section> },
        ];
        createRoot(document.getElementById('app')).render(
          <LanguageProvider offered={[{ code: 'en', draft: false }, { code: 'ar', draft: false }]}>
            <main id="main"><h1>Controls</h1><a id="outside" href="#outside">Outside the tabs</a><button type="button" id="go-outside" onClick={(e) => openSubTab(e.currentTarget, 'invite')}>Outside button</button><SubTabs label="Controls sections" tabs={tabs} /></main>
          </LanguageProvider>,
        );`,
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
  const css = ['app/globals.css', 'components/ux/sub-tabs.css']
    .map((file) => readFileSync(resolve('apps/web', file), 'utf8'))
    .join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sub-tabs fixture</title><style>${css}</style></head><body><div id="app"></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

async function open(page: Page, width: number, query = '', hash = '', language = 'en') {
  await page.addInitScript((code) => {
    try {
      window.localStorage.setItem('corridra.language', code);
    } catch {
      /* The fixture then stays in English. */
    }
  }, language);
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.setViewportSize({ width, height: 800 });
  await page.goto(fixturePath + query + hash);
  await expect(page.getByRole('tablist', { name: 'Controls sections' })).toBeVisible();
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });

test('the first tab shows, the others stay in the page hidden', async ({ page }) => {
  await open(page, 1280);
  await expect(tab(page, 'People and access')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'People and access' })).toBeVisible();
  await expect(page.locator('#workspace-invite')).toBeHidden();
  // Hidden panels are still in the page.
  await expect(page.locator('[role="tabpanel"]')).toHaveCount(3);
  await expect(page.locator('#deep-heading')).toBeAttached();
  // Only the selected tab is in the tab order.
  await expect(tab(page, 'People and access')).toHaveAttribute('tabindex', '0');
  await expect(tab(page, 'Tools')).toHaveAttribute('tabindex', '-1');
});

test('choosing a tab shows it, writes ?tab= and keeps the other words', async ({ page }) => {
  await open(page, 1280, '?workspace=abc', '#people-heading');
  await tab(page, 'Invite a team member').click();
  await expect(page.locator('#workspace-invite')).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'People and access' })).toBeHidden();
  const url = new URL(page.url());
  expect(url.searchParams.get('tab')).toBe('invite');
  expect(url.searchParams.get('workspace')).toBe('abc');
  expect(url.hash).toBe('');
});

test('a hash that is not inside the tabs stays when a tab is chosen', async ({ page }) => {
  // On the team workspace the hash names the section being shown; the tabs must not drop it.
  await open(page, 1280, '', '#outside');
  await tab(page, 'Tools').click();
  await expect(tab(page, 'Tools')).toHaveAttribute('aria-selected', 'true');
  expect(new URL(page.url()).hash).toBe('#outside');
  expect(new URL(page.url()).searchParams.get('tab')).toBe('tools');
  // Reloading with both keeps the tab and the hash.
  await page.reload();
  await expect(tab(page, 'Tools')).toHaveAttribute('aria-selected', 'true');
  expect(new URL(page.url()).hash).toBe('#outside');
});

test('a hash that cannot be decoded shows the first tab and raises no page error', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, 1280, '', '#%E0%A4%A');
  await expect(tab(page, 'People and access')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'People and access' })).toBeVisible();
  // Choosing a tab still works, and the bad hash raises nothing there either.
  await tab(page, 'Tools').click();
  await expect(tab(page, 'Tools')).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('an action inside one tab can open another tab', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, 1280);
  await page.locator('#go-invite').click();
  await expect(tab(page, 'Invite a team member')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#workspace-invite')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('tab')).toBe('invite');
  // A tab that does not exist, or a button outside the tabs, does nothing and raises nothing.
  await tab(page, 'People and access').click();
  await page.locator('#go-missing').click();
  await page.locator('#go-outside').click();
  await expect(tab(page, 'People and access')).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('?tab= opens that tab on load, and a word that is not a tab opens the first', async ({
  page,
}) => {
  await open(page, 1280, '?tab=tools');
  await expect(tab(page, 'Tools')).toHaveAttribute('aria-selected', 'true');
  await page.goto(fixturePath + '?tab=nope');
  await expect(tab(page, 'People and access')).toHaveAttribute('aria-selected', 'true');
});

test('an old #id lands: a tab id, an alias, the panel anchor, and an element inside a panel', async ({
  page,
}) => {
  await open(page, 1280, '', '#old-tools');
  await expect(tab(page, 'Tools')).toHaveAttribute('aria-selected', 'true');
  await page.goto(fixturePath + '#workspace-invite');
  await expect(tab(page, 'Invite a team member')).toHaveAttribute('aria-selected', 'true');
  await page.goto(fixturePath + '#tools');
  await expect(tab(page, 'Tools')).toHaveAttribute('aria-selected', 'true');
  // An element deep inside a hidden panel: its tab opens and the element gets focus.
  await page.goto(fixturePath + '#deep-heading');
  await expect(tab(page, 'Tools')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#deep-heading')).toBeVisible();
  await expect(page.locator('#deep-heading')).toBeFocused();
  // A hash change inside the page (an old in-page link) switches tab too.
  await page.evaluate(() => {
    window.location.hash = 'people-heading';
  });
  await expect(tab(page, 'People and access')).toHaveAttribute('aria-selected', 'true');
});

test('arrow keys, Home and End move between tabs and wrap', async ({ page }) => {
  await open(page, 1280);
  await tab(page, 'People and access').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Tools')).toBeFocused();
  await expect(tab(page, 'Tools')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tab(page, 'Invite a team member')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'People and access')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, 'Invite a team member')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab(page, 'People and access')).toBeFocused();
  // Tab leaves the tablist for the panel content, not the next tab.
  await page.keyboard.press('Tab');
  await expect(page.locator('#note')).toBeFocused();
});

test('the arrows mirror in a right-to-left page', async ({ page }) => {
  await open(page, 1280, '', '', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await tab(page, 'People and access').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, 'Tools')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'People and access')).toBeFocused();
});

test('an entry in a hidden panel survives a switch', async ({ page }) => {
  await open(page, 1280);
  await page.locator('#note').fill('half written');
  await tab(page, 'Tools').click();
  await tab(page, 'People and access').click();
  await expect(page.locator('#note')).toHaveValue('half written');
});

test('tabs are 44 px, wrap on a phone and never scroll the page sideways', async ({ page }) => {
  await open(page, 390);
  for (const name of ['People and access', 'Tools', 'Invite a team member'])
    expect((await tab(page, name).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  // Every tab is inside the screen: none is cut off.
  for (const name of ['People and access', 'Tools', 'Invite a team member']) {
    const box = (await tab(page, name).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
  }
});

test('axe finds nothing on any tab, left to right and right to left', async ({ page }) => {
  for (const language of ['en', 'ar']) {
    await open(page, 1280, '', '', language);
    for (const name of ['People and access', 'Tools', 'Invite a team member']) {
      await tab(page, name).click();
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(
        result.violations.map((v) => v.id),
        `${language} ${name}`,
      ).toEqual([]);
    }
  }
});
