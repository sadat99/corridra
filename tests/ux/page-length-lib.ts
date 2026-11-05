import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

// The shared page-length measure (owner decision of 4 November 2026, docs/revamp/specs/layout-budget.md
// section 2). Page length is the full document height (header, content and footer) divided by the
// viewport height. Target and hard limit per viewport:
//   390 x 844   target 1.5 screens, hard limit 2.0
//   1440 x 900  target 1.0 screen,  hard limit 1.5
// The routes come from docs/revamp/COVERAGE.json, page routes only (the file is a page.tsx; the
// inventory also lists route.ts endpoints). This guard only REPORTS: it never fails on a value. The
// last track PR switches it to failing over the hard limit. Each track reuses this module with its own
// sign-in or fixtures, so every track measures the same way.

const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, '..', '..');

export type Viewport = {
  name: 'phone' | 'desktop';
  width: number;
  height: number;
  target: number;
  hard: number;
};
export const viewports: readonly Viewport[] = [
  { name: 'phone', width: 390, height: 844, target: 1.5, hard: 2.0 },
  { name: 'desktop', width: 1440, height: 900, target: 1.0, hard: 1.5 },
];

export type CoverageRoute = { route: string; file: string; audience: string; state: string };
export type Verdict = 'within target' | 'over target' | 'over hard limit';
/** The track that owns measuring a route (layout budget, ownership table). */
export type Track =
  'S2 customer' | 'S3 public and organiser' | 'S4 team and contributor' | 'unassigned';
export type Measurement = {
  route: string;
  audience: string;
  /** Who measures this route: S2 customer, S3 public and organiser, S4 team and contributor. */
  owner: Track;
  viewport: Viewport['name'];
  /** True only when the page itself was measured: not redirected, not an error page. */
  measured: boolean;
  reason?: string;
  landedPath?: string;
  status?: number;
  documentHeight?: number;
  screens?: number;
  verdict?: Verdict;
};

/** Every page route in the inventory (the file is a page.tsx), in the order it lists them. */
export function pageRoutes(): CoverageRoute[] {
  const coverage = JSON.parse(readFileSync(join(root, 'docs/revamp/COVERAGE.json'), 'utf8')) as {
    routes: CoverageRoute[];
  };
  return coverage.routes.filter((entry) => entry.file.endsWith('page.tsx'));
}

/**
 * The track that owns the measurement of a route, from its audience and address. A route no track
 * is named for is 'unassigned' and is listed so the Conductor can assign it: by the last layout PR the
 * union of every track's spec must cover every page route.
 */
export function trackFor(entry: Pick<CoverageRoute, 'route' | 'audience'>): Track {
  const { route, audience } = entry;
  if (audience === 'customer') return 'S2 customer';
  if (audience === 'staff' || audience === 'contributor') return 'S4 team and contributor';
  if (audience === 'public' || audience === 'public intake and customer identity')
    return 'S3 public and organiser';
  if (/^\/(mute|pulse|network)(\/|$)/.test(route)) return 'S4 team and contributor';
  if (route === '/programme' || route.startsWith('/programme/')) return 'S3 public and organiser';
  return 'unassigned';
}

export const hasDynamicSegment = (route: string) => route.includes('[');

export function verdictFor(screens: number, viewport: Viewport): Verdict {
  return screens > viewport.hard
    ? 'over hard limit'
    : screens > viewport.target
      ? 'over target'
      : 'within target';
}

/** The full document height over the viewport height, rounded to two places. */
export function screensOf(documentHeight: number, viewport: Viewport) {
  return Math.round((documentHeight / viewport.height) * 100) / 100;
}

/**
 * Opens one address at the viewport and measures it. A page that redirects (to sign-in, for
 * instance) or answers an error is recorded as not measured with the reason, never as a value: a
 * sign-in page's height says nothing about the page that was asked for.
 */
export async function measure(
  page: Page,
  entry: Pick<CoverageRoute, 'route' | 'audience'>,
  url: string,
  viewport: Viewport,
  settle?: (page: Page) => Promise<void>,
): Promise<Measurement> {
  const base = {
    route: entry.route,
    audience: entry.audience,
    owner: trackFor(entry),
    viewport: viewport.name,
  };
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const response = await page.goto(url, { waitUntil: 'load' }).catch(() => null);
  if (!response) return { ...base, measured: false, reason: 'the page did not load' };
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  if (settle) await settle(page);
  const landedPath = new URL(page.url()).pathname;
  const status = response.status();
  const asked = new URL(url, page.url()).pathname;
  if (status >= 400)
    return { ...base, measured: false, reason: `the page answered ${status}`, landedPath, status };
  if (landedPath !== asked)
    return { ...base, measured: false, reason: `redirected to ${landedPath}`, landedPath, status };
  const documentHeight = await page.evaluate(() =>
    Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
  );
  const screens = screensOf(documentHeight, viewport);
  return {
    ...base,
    measured: true,
    landedPath,
    status,
    documentHeight,
    screens,
    verdict: verdictFor(screens, viewport),
  };
}

/** The route is listed but has no address to open (a dynamic segment with no fixture yet). */
export function notMeasured(
  entry: Pick<CoverageRoute, 'route' | 'audience'>,
  viewport: Viewport,
  reason: string,
): Measurement {
  return {
    route: entry.route,
    audience: entry.audience,
    owner: trackFor(entry),
    viewport: viewport.name,
    measured: false,
    reason,
  };
}

/** Writes work/page-length/<name>.json and returns a short text summary for the log. */
export function writeReport(name: string, rows: Measurement[]): string {
  const directory = join(root, 'work', 'page-length');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${name}.json`),
    JSON.stringify({ viewports, rows }, null, 2) + '\n',
  );
  const measured = rows.filter((row) => row.measured);
  const count = (verdict: Verdict, viewport: Viewport['name']) =>
    measured.filter((row) => row.viewport === viewport && row.verdict === verdict).length;
  const lines = [`page length ${name}: ${measured.length} of ${rows.length} measurements taken`];
  for (const viewport of viewports) {
    lines.push(
      `  ${viewport.width}x${viewport.height}: ${count('within target', viewport.name)} within target, ` +
        `${count('over target', viewport.name)} over target, ${count('over hard limit', viewport.name)} over the hard limit`,
    );
  }
  // Every route not measured here, grouped by the track that owns measuring it.
  const missing = new Map<string, Set<string>>();
  for (const row of rows.filter((r) => !r.measured)) {
    const set = missing.get(row.owner) ?? new Set<string>();
    set.add(`${row.route} (${row.reason})`);
    missing.set(row.owner, set);
  }
  for (const [owner, set] of [...missing].sort()) {
    lines.push(`  not measured here, owner ${owner}: ${set.size} route(s)`);
    for (const item of [...set].sort()) lines.push(`    ${item}`);
  }
  const worst = [...measured]
    .sort((a, b) => (b.screens ?? 0) / viewportOf(b).hard - (a.screens ?? 0) / viewportOf(a).hard)
    .slice(0, 8)
    .map((row) => `  ${row.viewport} ${row.route}: ${row.screens} screens (${row.verdict})`);
  return [
    ...lines,
    ...(worst.length ? ['  longest relative to the hard limit:', ...worst] : []),
  ].join('\n');
}

const viewportOf = (row: Measurement) => viewports.find((v) => v.name === row.viewport)!;
