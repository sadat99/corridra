import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

// The shared page-length measure (owner decision of 4 November 2026, docs/revamp/specs/layout-budget.md
// section 2). Page length is the full document height (header, content and footer) divided by the
// viewport height. Target and hard limit per viewport:
//   390 x 844   target 1.5 screens, hard limit 2.0
//   1440 x 900  target 1.0 screen,  hard limit 1.0 (owner, 5 November 2026)
// Public pages (owner, 6 November 2026, with the Ledger footer): up to 3.0 phone and 2.0 desktop screens, footer
// included. The home keeps its own rule (at most 3.5 phone and 2.5 desktop screens). The sign-in pages
// are not public pages here: they keep the limits above, as do the signed-in pages. /plan has its own limits
// (`planLimits` below, S5 conductor proposal of 9 November 2026 after measuring; owner confirmation pending).
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
  { name: 'desktop', width: 1440, height: 900, target: 1.0, hard: 1.0 },
];

/** The page-length limits for one kind of page at one viewport. */
export type Limits = Pick<Viewport, 'target' | 'hard'>;
/** Public pages other than the home (owner decision of 6 November 2026). */
export const publicPageLimits: Record<Viewport['name'], Limits> = {
  phone: { target: 3.0, hard: 3.0 },
  desktop: { target: 2.0, hard: 2.0 },
};
/** The home's own rule (docs/revamp/specs/public-home.md; owner, 6 November 2026, with the Ledger footer): 2.0 to 3.0
 * desktop screens, at most 4.25 phone. */
export const homeLimits: Record<Viewport['name'], Limits> = {
  phone: { target: 4.25, hard: 4.25 },
  desktop: { target: 3.0, hard: 3.0 },
};
/**
 * The request page. Target: the owner's 9 November 2026 targets (2.4 phone, 1.8 desktop). Hard: the limits pinned by
 * tests/browser/layout-budget-plan.spec.ts after measuring (2.53 and 1.80); owner confirmation pending.
 */
const planLimits: Record<Viewport['name'], Limits> = {
  phone: { target: 2.4, hard: 2.55 },
  desktop: { target: 1.8, hard: 1.85 },
};
/** Sign-in and account recovery pages show the public footer, so they follow the public page limits. `/plan` has its own limits. */
const publicIdentityPages = [
  '/signin',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
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
  /** The hard limit the page was judged against (it depends on the kind of page). */
  hard?: number;
  verdict?: Verdict;
  /** For a page over its hard limit: the tallest blocks of the page content, to show what makes it long. */
  blocks?: { label: string; height: number }[];
  /** For a page over its hard limit: the page frame around the content (header, footer, the rest). */
  frame?: { header: number; footer: number; other: number };
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

/** The limits a route is judged against: the public page and home limits, or the viewport's own. */
export function limitsFor(
  entry: Pick<CoverageRoute, 'route' | 'audience'>,
  viewport: Viewport,
): Limits {
  if (entry.audience === 'public')
    return entry.route === '/' ? homeLimits[viewport.name] : publicPageLimits[viewport.name];
  if (entry.route === '/plan') return planLimits[viewport.name];
  if (publicIdentityPages.includes(entry.route)) return publicPageLimits[viewport.name];
  return { target: viewport.target, hard: viewport.hard };
}

export function verdictFor(screens: number, limits: Limits): Verdict {
  return screens > limits.hard
    ? 'over hard limit'
    : screens > limits.target
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
  const limits = limitsFor(entry, viewport);
  const verdict = verdictFor(screens, limits);
  return {
    ...base,
    measured: true,
    landedPath,
    status,
    documentHeight,
    screens,
    hard: limits.hard,
    verdict,
    ...(verdict === 'over hard limit'
      ? { blocks: await tallestBlocks(page), frame: await frameOf(page, documentHeight) }
      : {}),
  };
}

/** How much of the document height is the header and the footer, and how much is the rest. */
export async function frameOf(page: Page, documentHeight: number) {
  const { header, footer } = await page.evaluate(() => {
    const height = (selector: string) =>
      Array.from(document.querySelectorAll(selector))
        .filter((el) => !el.closest('main'))
        .reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);
    return { header: height('header'), footer: height('footer') };
  });
  return {
    header: Math.round(header),
    footer: Math.round(footer),
    other: Math.round(documentHeight - header - footer),
  };
}

/**
 * The four tallest blocks of the page content. It starts at <main> and goes down through a wrapper
 * that holds most of the height, so the list names the sections (a form, a list, a panel) and not
 * the page frame. Report only: it helps a track see what to move into tabs or disclosures.
 */
export async function tallestBlocks(page: Page): Promise<{ label: string; height: number }[]> {
  return page.evaluate(() => {
    const label = (el: Element) => {
      const heading = el.querySelector('h1, h2, h3, legend, summary');
      const text = (heading?.textContent ?? el.getAttribute('aria-label') ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 48);
      return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${text ? ' "' + text + '"' : ''}`;
    };
    const tall = (el: Element) => el.getBoundingClientRect().height;
    let container: Element = document.querySelector('main') ?? document.body;
    for (let depth = 0; depth < 5; depth++) {
      const total = tall(container);
      const big = Array.from(container.children).find((child) => tall(child) > total * 0.7);
      if (!big) break;
      container = big;
    }
    return Array.from(container.children)
      .map((child) => ({ label: label(child), height: Math.round(tall(child)) }))
      .filter((block) => block.height > 0)
      .sort((a, b) => b.height - a.height)
      .slice(0, 4);
  });
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
    .sort((a, b) => (b.screens ?? 0) / hardOf(b) - (a.screens ?? 0) / hardOf(a))
    .slice(0, 8)
    .map((row) => `  ${row.viewport} ${row.route}: ${row.screens} screens (${row.verdict})`);
  return [
    ...lines,
    ...(worst.length ? ['  longest relative to the hard limit:', ...worst] : []),
  ].join('\n');
}

const hardOf = (row: Measurement) =>
  row.hard ?? viewports.find((v) => v.name === row.viewport)!.hard;
