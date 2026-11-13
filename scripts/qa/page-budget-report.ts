// Page budget check for the signed-in customer pages (task L20; owner rule 4 and 5 Nov 2026, kept 13 Nov 2026):
// a desktop page is at most 1 screen and a phone page at most 2, measured with disclosures closed, and no page opens
// more than one form at once. It reads the report.jsonl that scripts/qa/signed-in-sweep.ts writes, so the numbers
// are the sweep's own measurements. /account and the home page are judged under their own limits and are skipped.
//   pnpm exec tsx scripts/qa/page-budget-report.ts work/signed-in-sweep/<time>/report.jsonl [--prefix /account/]
// Exit 1 when any page is over the limit. Imported by tests/integration/page-budget-report.test.ts.
import { readFileSync } from 'node:fs';
import { screenLimitFor } from './ux-measure';

export type BudgetRow = {
  role: string;
  width: number;
  route: string;
  measure?: { screens: number; openForms: number } | null;
};
export type BudgetBreach = {
  route: string;
  width: number;
  role: string;
  screens: number;
  limit: number | null;
  openForms: number;
};

/** A route with ids and the long query words folded so the same page reads as one line. */
export const budgetRouteKey = (route: string) =>
  route.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');

export function budgetBreaches(rows: BudgetRow[], prefix = '/account/'): BudgetBreach[] {
  const worst = new Map<string, BudgetBreach>();
  for (const row of rows) {
    if (!row.measure || !row.route.startsWith(prefix)) continue;
    const limit = screenLimitFor(row.width);
    const over = limit !== null && row.measure.screens > limit;
    const forms = row.measure.openForms > 1;
    if (!over && !forms) continue;
    const key = `${budgetRouteKey(row.route)}@${row.width}`;
    const seen = worst.get(key);
    if (!seen || row.measure.screens > seen.screens)
      worst.set(key, {
        route: budgetRouteKey(row.route),
        width: row.width,
        role: row.role,
        screens: row.measure.screens,
        limit,
        openForms: row.measure.openForms,
      });
  }
  return [...worst.values()].sort((a, b) => a.route.localeCompare(b.route) || a.width - b.width);
}

export function parseReport(text: string): BudgetRow[] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BudgetRow);
}

if (process.argv[1]?.endsWith('page-budget-report.ts')) {
  const file = process.argv[2];
  if (!file) throw new Error('usage: page-budget-report.ts <report.jsonl> [--prefix /account/]');
  const at = process.argv.indexOf('--prefix');
  const breaches = budgetBreaches(
    parseReport(readFileSync(file, 'utf8')),
    at >= 0 ? process.argv[at + 1] : undefined,
  );
  for (const b of breaches)
    console.log(
      `${b.route} at ${b.width}: ${b.screens} screens (limit ${b.limit}), ${b.openForms} forms open (${b.role})`,
    );
  console.log(
    breaches.length ? `${breaches.length} over the budget` : 'every page is within budget',
  );
  process.exit(breaches.length ? 1 : 0);
}
