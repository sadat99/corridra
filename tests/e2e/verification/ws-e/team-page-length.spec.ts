import { test, expect, signInOwner, qaSeed } from '../fixtures';
import type { Page } from '@playwright/test';
import { operatorSlugs } from '../../../../apps/web/lib/operator-urls';
import { measure, viewports, writeReport, type Measurement } from '../../../ux/page-length-lib';

// Page length of the team workspace (docs/revamp/specs/layout-budget.md section 2), report only. It
// signs in once as the seeded owner and measures Today, every section address, the Owner page and a
// mission page at 390 x 844 and 1440 x 900 with the shared measure in tests/ux/page-length-lib.ts. The
// values go to work/page-length/team.json. It never fails on a value; the last track PR switches the
// guard to failing over the hard limit. The contributor board needs an invited contributor session
// and is measured where that fixture exists (tests/operator/real-network-work.spec.ts).
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'w1280', 'Runs once; it switches viewports itself.');
});

// The workspace reads its data after load: wait until no loading line is left, as a person would.
async function settle(page: Page) {
  await expect(page.getByText(/Loading (workspace|today|operations|missions)/i)).toHaveCount(0, {
    timeout: 20000,
  });
  await page.waitForTimeout(800);
}

test('team page length is measured and recorded (report only)', async ({ page, browser }) => {
  test.setTimeout(900_000);
  await signInOwner(page);
  const tenant = qaSeed().tenantId;
  const missions = await page.request.get(`/api/workspace/missions?tenant=${tenant}&offset=0`);
  const first = missions.ok()
    ? ((await missions.json()) as { missions?: { id: string }[] }).missions?.[0]?.id
    : undefined;
  const addresses = [
    { route: '/operator', url: `/operator?workspace=${tenant}` },
    ...Object.values(operatorSlugs).map((slug) => ({
      route: `/operator/${slug}`,
      url: `/operator/${slug}?workspace=${tenant}`,
    })),
    { route: '/operator/owner', url: `/operator/owner?workspace=${tenant}` },
    ...(first
      ? [
          {
            route: '/operator/[section]/[missionId]',
            url: `/operator/missions/${first}?workspace=${tenant}`,
          },
        ]
      : []),
  ];
  const rows: Measurement[] = [];
  for (const address of addresses) {
    for (const viewport of viewports) {
      rows.push(
        await measure(
          page,
          { route: address.route, audience: 'staff' },
          address.url,
          viewport,
          settle,
        ),
      );
    }
  }
  // The staff and contributor pages that open with no session, measured in a clean browser context. The
  // two mute pages take a made-up request id: they render their form whatever the id.
  const anonymous = await (
    await browser.newContext({ baseURL: 'http://127.0.0.1:3300' })
  ).newPage();
  const noSession = [
    { route: '/operator/signin', url: '/operator/signin', audience: 'staff' },
    { route: '/operator/forgot-password', url: '/operator/forgot-password', audience: 'staff' },
    { route: '/operator/reset-password', url: '/operator/reset-password', audience: 'staff' },
    { route: '/operator/setup', url: '/operator/setup', audience: 'staff' },
    { route: '/contributor/setup', url: '/contributor/setup', audience: 'contributor' },
    {
      route: '/mute/[requestId]',
      url: '/mute/00000000-0000-4000-8000-000000000001',
      audience: 'recipient or private link',
    },
    {
      route: '/pulse/mute/[requestId]',
      url: '/pulse/mute/00000000-0000-4000-8000-000000000001',
      audience: 'recipient or private link',
    },
  ];
  for (const address of noSession) {
    for (const viewport of viewports) {
      rows.push(
        await measure(
          anonymous,
          { route: address.route, audience: address.audience },
          address.url,
          viewport,
        ),
      );
    }
  }
  await anonymous.context().close();
  const summary = writeReport('team', rows);
  console.log(summary);
  test.info().annotations.push({ type: 'page-length', description: summary });
  expect(rows.length).toBe((addresses.length + noSession.length) * viewports.length);
  expect(rows.filter((row) => !row.measured && !row.reason)).toEqual([]);
});
