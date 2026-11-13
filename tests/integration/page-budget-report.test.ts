import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  budgetBreaches,
  budgetRouteKey,
  parseReport,
  type BudgetRow,
} from '../../scripts/qa/page-budget-report';

// L20: the customer page budget. The fixtures hold the sweep's own measurements (scripts/qa/signed-in-sweep.ts,
// customer, organiser, participant and seller at 390 and 1440 px, production build, disclosures closed): "before" is
// main at 8c4500b, "after" is this change. The report check must fail on the first and pass on the second.
const load = (name: string) =>
  JSON.parse(readFileSync(`tests/integration/fixtures/${name}`, 'utf8')) as BudgetRow[];
const row = (route: string, width: number, screens: number, openForms = 0): BudgetRow => ({
  role: 'customer',
  width,
  route,
  measure: { screens, openForms },
});

describe('page budget report', () => {
  test('judges desktop at 1 screen and phone at 2, and skips 768 and the account home', () => {
    const breaches = budgetBreaches([
      row('/account/profile', 1440, 1.1),
      row('/account/profile', 1440, 1),
      row('/account/billing', 390, 2.1),
      row('/account/billing', 390, 2),
      row('/account/billing', 768, 3),
      row('/account', 1440, 3),
      row('/account/x', 1440, 0.5, 2),
    ]);
    expect(breaches.map((b) => `${b.route}@${b.width}`)).toEqual([
      '/account/billing@390',
      '/account/profile@1440',
      '/account/x@1440',
    ]);
    expect(breaches[2]!.openForms).toBe(2);
  });
  test('keeps the worst reading of one page and folds ids', () => {
    const a = '/account/profile/392c666b-60af-41ad-ac48-f5bb179f8254';
    expect(budgetRouteKey(a)).toBe('/account/profile/<id>');
    const worst = budgetBreaches([row(a, 1440, 1.2), row(a, 1440, 3.2)]);
    expect(worst).toHaveLength(1);
    expect(worst[0]!.screens).toBe(3.2);
  });
  test('reads a report.jsonl and ignores rows that were not measured', () => {
    const rows = parseReport(
      JSON.stringify(row('/account/a', 1440, 2)) +
        '\n\n' +
        JSON.stringify({ role: 'c', width: 1440, route: '/account/b' }),
    );
    expect(budgetBreaches(rows)).toHaveLength(1);
  });
  test('main before this change breaks the budget on every page the owner listed', () => {
    const pages = new Set(
      budgetBreaches(load('l20-sweep-before.json')).map((b) => b.route.split(' [tab')[0]),
    );
    for (const page of [
      '/account/delegations',
      '/account/profile',
      '/account/profile/<id>',
      '/account/billing',
      '/account/billing/<id>',
      '/account/all-tools',
      '/account/delegations/<id>',
      '/account/delegations/organise',
      '/account/request/<id>',
      '/account/drafts/<id>',
      '/account/problem-reports/new',
      '/account/service-requests',
      '/account/service-requests/<id>',
      '/account/service-requests/<id>/<id>',
    ])
      expect(pages, page).toContain(page);
    const forms = budgetBreaches(load('l20-sweep-before.json')).filter((b) => b.openForms > 1);
    expect(forms.map((b) => b.route)).toEqual(
      expect.arrayContaining(['/account/profile', '/account/delegations']),
    );
  });
  test('this change keeps every customer page inside the budget', () => {
    expect(budgetBreaches(load('l20-sweep-after.json'))).toEqual([]);
  });
});
