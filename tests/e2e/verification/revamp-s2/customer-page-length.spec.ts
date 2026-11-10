import { test, expect, signInCustomer } from '../fixtures';
import { measure, viewports } from '../../../ux/page-length-lib';

// CX-01 (docs/revamp/specs/customer-experience.md): a customer page is at most 1.0 screen at 1440 x 900 and
// at most 2.0 screens at 390 x 844. Home is held to it from CX PR 2a, Requests from 2b, and Reports and Account from
// CX PR 3, and Meetings from W8 (docs/revamp/specs/workflow-intelligence.md). The verification seed has no requests, so
// this measures the empty state; the filled state (five active-work rows) is measured in
// tests/operator/revamp-cx2-home.spec.ts, and the filled Meetings page in the real shell in tests/operator/w8-meetings.spec.ts.
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'w1280', 'Runs once; it switches viewports itself.');
});

const pages = [
  { name: 'Home', url: '/account', held: true },
  { name: 'Requests', url: '/account?view=work', held: true },
  { name: 'Reports', url: '/account?view=results', held: true },
  { name: 'Account', url: '/account?view=more', held: true },
  { name: 'Meetings', url: '/account/meetings', held: true },
];

for (const entry of pages)
  test(`CX-01 ${entry.name} length at 390 and 1440${entry.held ? '' : ' (reported)'}`, async ({
    page,
    context,
  }) => {
    await signInCustomer(context);
    for (const viewport of viewports) {
      const row = await measure(
        page,
        { route: entry.url, audience: 'customer' },
        entry.url,
        viewport,
        async (p) => {
          await p.waitForTimeout(800);
        },
      );
      expect(row.measured, `${entry.name} at ${viewport.width}`).toBe(true);
      if (row.measured) {
        console.log(`${entry.name} ${viewport.width}: ${row.screens} screens (${row.verdict})`);
        if (entry.held)
          expect(row.verdict, `${entry.name} at ${viewport.width}`).not.toBe('over hard limit');
      }
    }
  });
