import { expect, test } from '@playwright/test';
import {
  hasDynamicSegment,
  measure,
  notMeasured,
  pageRoutes,
  viewports,
  writeReport,
  type Measurement,
} from './page-length-lib';

// Page length (docs/revamp/specs/layout-budget.md section 2), report only. It reads
// docs/revamp/COVERAGE.json and measures every page route that needs no sign-in and no fixture, at
// 390 x 844 and 1440 x 900, against the production build the UX gate already serves. A route that
// redirects to sign-in or has a dynamic segment is recorded as not measured, with the reason. Signed-in
// routes are measured by each track's own spec with its own sign-in, through ./page-length-lib. This
// test records values and never fails on one; it fails only if a page route is not accounted for.
// The last track PR switches the guard to failing over the hard limit.

const routes = pageRoutes();
// Audiences whose pages open with no sign-in: the public site and the public intake and sign-in pages.
const publicAudiences = new Set(['public', 'public intake and customer identity']);

test('page length: every page route in COVERAGE.json is measured or recorded with a reason', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const rows: Measurement[] = [];
  for (const entry of routes) {
    for (const viewport of viewports) {
      if (!publicAudiences.has(entry.audience)) {
        // A signed-in or private-link page measured without its session would be the sign-in or an
        // empty state. Its owning track measures it with its own sign-in or link fixture.
        rows.push(notMeasured(entry, viewport, 'needs a signed-in session or a private link'));
      } else if (hasDynamicSegment(entry.route)) {
        rows.push(notMeasured(entry, viewport, 'dynamic segment: needs a fixture address'));
      } else {
        rows.push(await measure(page, entry, entry.route, viewport));
      }
    }
  }
  const summary = writeReport('ux-gate', rows);
  console.log(summary);
  test.info().annotations.push({ type: 'page-length', description: summary });
  // Structural only: nothing in the inventory is silently skipped.
  expect(rows).toHaveLength(routes.length * viewports.length);
  expect(rows.filter((row) => !row.measured && !row.reason)).toEqual([]);
});
