import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI/UX.v3 audit unit A3d, part 1: Delegation registrations. The real ParticipantAccount and the real stylesheets are
// drawn on a small bundled page inside the customer frame (no sign-in; the participant API is answered by the test), at
// the three widths of the owner's checklist. The change is presentation only, so these cases also pin what must not
// change: the withdrawal form with its reason, confirmation and payload, and the invitation check. Every case fails on
// the code before this change: there is no row menu, no spacing rule, no row title size and no primary hierarchy there.
const fixturePath = '/__audit-a3d-registrations-fixture';
const programmeId = '00000000-0000-4000-8000-000000000002';
const token = 'a'.repeat(43);
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { WorkspaceShell } from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
        import { pageFrameSlots } from ${JSON.stringify(resolve('apps/web/components/ux/page-frame.tsx'))};
        import { ParticipantAccount } from ${JSON.stringify(resolve('apps/web/app/account/delegations/participant-account.tsx'))};
        const framed = new URLSearchParams(location.search).get('framed') !== '0';
        const slots = pageFrameSlots(framed ? {
          back: { label: 'Back to my account', href: '/account' },
          helper: 'Fictional sample registration only.',
        } : undefined);
        createRoot(document.getElementById('app')).render(
          <WorkspaceShell title="Delegation registrations" customer above={slots.above} lead={slots.lead}>
            <div className="account-compact">
              <ParticipantAccount subject="synthetic-alice" issuer=${JSON.stringify(issuer)} framed={framed} />
            </div>
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
    'app/account/page-budget.css',
    'app/account/delegations/participant-account.css',
  ]
    .flatMap((file) => {
      try {
        return [readFileSync(resolve('apps/web', file), 'utf8')];
      } catch {
        return [];
      }
    })
    .join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Registrations fixture</title><style>${css}</style></head><body><div class="site-shell"><div id="app"></div></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

const expires = () => new Date(Date.now() + 3600000).toISOString();
const registration = (n: number) => ({
  id: `00000000-0000-4000-8000-00000000010${n}`,
  programmeId,
  name: `Sample Guangzhou delegation round ${n}`,
  reportingPurpose: 'Sample shared programme purpose, no private commercial details',
  displayLabel: 'Synthetic participant label',
  consentedAt: '2026-10-18T00:00:00Z',
  status: 'REGISTERED',
  synthetic: true,
});
const preview = () => ({
  programmeId,
  name: 'Sample Guangzhou delegation round 1',
  reportingPurpose: 'Sample shared programme purpose, no private commercial details',
  expiresAt: expires(),
  synthetic: true,
});

async function open(page: Page, width: number, options: { rows?: number; framed?: boolean } = {}) {
  const posts: Record<string, unknown>[] = [];
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.route('**/api/customer-programme-participants*', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          registrations: Array.from({ length: options.rows ?? 1 }, (_, n) => registration(n + 1)),
          nextAfter: null,
          synthetic: true,
        },
      });
    const value = route.request().postDataJSON() as Record<string, unknown>;
    posts.push(value);
    if (value.action === 'preview') return route.fulfill({ json: preview() });
    return route.fulfill({
      json: {
        id: value.registrationId,
        programmeId,
        status: 'WITHDRAWN',
        synthetic: true,
      },
    });
  });
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`${fixturePath}?framed=${options.framed === false ? '0' : '1'}`);
  await expect(page.getByRole('heading', { name: 'Your sample registrations' })).toBeVisible();
  return posts;
}

for (const width of [390, 768, 1440]) {
  test.describe(`${width} px`, () => {
    test('Withdraw From Programme is one tap deeper in a menu named for the programme, and asks before it acts', async ({
      page,
    }) => {
      const posts = await open(page, width);
      await expect(page.getByRole('button', { name: 'Withdraw From Programme' })).toHaveCount(0);
      const more = page.getByRole('button', {
        name: 'More actions for Sample Guangzhou delegation round 1',
        exact: true,
      });
      // The programme name is in the accessible name only; the visible button is an icon.
      expect(((await more.textContent()) ?? '').trim()).toBe('');
      await more.click();
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      await page.getByRole('menuitem', { name: 'Withdraw From Programme', exact: true }).click();
      // The existing confirm step: a reason, the confirmation box and the Confirm Withdrawal button. Nothing is sent yet.
      const reason = page.getByLabel('Reason for withdrawal', { exact: true });
      await expect(reason).toBeVisible();
      await expect(reason).toBeFocused();
      await expect(page.getByRole('button', { name: 'Confirm Withdrawal' })).toBeDisabled();
      expect(posts).toHaveLength(0);
      await reason.fill('The dates no longer suit my team.');
      await page.getByRole('checkbox', { name: /I confirm withdrawal/ }).check();
      await page.getByRole('button', { name: 'Confirm Withdrawal' }).click();
      await expect.poll(() => posts.length).toBe(1);
      expect(Object.keys(posts[0]!).sort()).toEqual([
        'acknowledged',
        'action',
        'commandId',
        'reason',
        'registrationId',
      ]);
      expect(posts[0]).toMatchObject({
        action: 'withdraw',
        registrationId: registration(1).id,
        reason: 'The dates no longer suit my team.',
        acknowledged: true,
      });
    });

    test('rows are 12 px inside and 24 px apart, the row title is 18 px and the section title follows the scale', async ({
      page,
    }) => {
      await open(page, width, { rows: 2 });
      const sizes = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.ux-reg-list > li')];
        const [first, second] = rows as HTMLElement[];
        const title = first!.querySelector('h3')!;
        const facts = [...first!.querySelectorAll(':scope > p')].at(-1)!;
        const details = first!.querySelector(':scope > details')!;
        const section = document.querySelector('.ux-reg > h2')!;
        const gap = (above: Element, below: Element) =>
          Math.round(below.getBoundingClientRect().top - above.getBoundingClientRect().bottom);
        return {
          // The last margin of a row is part of its box, so the distance between two rows is measured edge to edge.
          between: gap(first!, second!),
          inside: gap(facts, details),
          rowTitle: getComputedStyle(title).fontSize,
          rowTitleWeight: getComputedStyle(title).fontWeight,
          sectionTitle: getComputedStyle(section).fontSize,
        };
      });
      expect(sizes.between).toBe(24);
      expect(sizes.inside).toBe(12);
      expect(sizes.rowTitle).toBe('18px');
      expect(sizes.rowTitleWeight).toBe('600');
      expect(sizes.sectionTitle).toBe(width < 768 ? '22px' : '24px');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    });

    test('the invitation check has one primary action: Preview, then Register once a preview is shown', async ({
      page,
    }) => {
      const posts = await open(page, width);
      await page.locator('summary', { hasText: /invitation$/ }).click();
      const section = page.locator('section.ux-reg');
      await expect(section.locator('.primary-link')).toHaveCount(1);
      await expect(section.getByRole('button', { name: 'Preview Sample Invitation' })).toHaveClass(
        /primary-link/,
      );
      await page.getByLabel('Private sample invitation code', { exact: true }).fill(token);
      await page.getByRole('button', { name: 'Preview Sample Invitation' }).click();
      await expect(
        page.getByRole('button', { name: 'Register for Sample Programme' }),
      ).toBeVisible();
      expect(posts).toHaveLength(1);
      await expect(section.locator('.primary-link')).toHaveCount(1);
      await expect(
        section.getByRole('button', { name: 'Register for Sample Programme' }),
      ).toHaveClass(/primary-link/);
      await expect(
        section.getByRole('button', { name: 'Preview Sample Invitation' }),
      ).not.toHaveClass(/primary-link/);
    });
  });
}

test('on a phone the row menu, the reload button and the invitation summary are 44 px targets', async ({
  page,
}) => {
  await open(page, 390);
  const heights = await Promise.all(
    [
      page.getByRole('button', { name: /More actions for/ }),
      page.getByRole('button', { name: 'Reload My Sample Registrations' }),
      page.locator('summary', { hasText: /invitation$/ }),
    ].map(async (locator) => (await locator.boundingBox())!.height),
  );
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
});

test('the section drawn on its own keeps the direct Withdraw button; only the framed page gets the menu', async ({
  page,
}) => {
  await open(page, 1440, { framed: false });
  await expect(
    page.getByRole('button', { name: 'Withdraw From Programme', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.ux-menu')).toHaveCount(0);
  await page.unroute('**/api/customer-programme-participants*');
  await page.unroute('**' + fixturePath + '*');
  await open(page, 1440);
  await expect(page.locator('.ux-menu')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Withdraw From Programme', exact: true }),
  ).toHaveCount(0);
});
