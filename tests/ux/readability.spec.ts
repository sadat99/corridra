import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corridorPages } from '../../apps/web/content/corridors';
import { hasDynamicSegment, pageRoutes } from './page-length-lib';
import { scoreProse, words, type ProseScore } from './readability-lib';

// Reading-level gate (docs/revamp/specs/workflow-intelligence.md, section 4, batch W1). For every
// public static page it reads the visible English prose at 1440 x 900 in the default state (no clicks,
// closed `details` stay closed), scores it with ./readability-lib and fails when a route gets harder
// than tests/ux/readability-baseline.json: the long-sentence and hard-sentence counts may not rise and
// the grade may not rise by more than 0.5. Lower the baseline when copy improves; never raise it.
// The grade is an approximation for English. It guides plain wording and never replaces native review.
//
// Route set. The UX gate's own route walk (`staticRoutes` in ux-gate.spec.ts) is not exported, and
// importing that spec would register its tests here. So this spec uses `pageRoutes()` from
// ./page-length-lib (docs/revamp/COVERAGE.json, page files only) filtered to the two public audiences
// the page-length spec also treats as opening with no sign-in, and with no dynamic segment. It adds the
// corridor pages that generateStaticParams() renders from content/corridors.ts, exactly as the UX gate
// does. Signed-in static routes are left out on purpose: the gate only sees them redirect to sign-in,
// which would measure the sign-in page again under another name.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const baselinePath = join(here, 'readability-baseline.json');
const reportPath = join(root, 'work', 'readability-report.json');
const update = process.env.READABILITY_UPDATE_BASELINE === '1';

const publicAudiences = new Set(['public', 'public intake and customer identity']);
const inventoryRoutes = pageRoutes()
  .filter((entry) => publicAudiences.has(entry.audience) && !hasDynamicSegment(entry.route))
  .map((entry) => entry.route);
const generatedRoutes = Object.keys(corridorPages).map((slug) => `/corridors/${slug}`);
const routes = [...new Set([...inventoryRoutes, ...generatedRoutes])].sort();

/** The footer is the same on every page, so it is measured once, on the home, under this key. */
const footerKey = '/#footer';

const proseSelector =
  'p, li, dd, figcaption, [role="alert"], [role="status"], .guide-hint, .field-hint';
const minBlockWords = 5;
const maxGradeRise = 0.5;

type Measured = Pick<ProseScore, 'words' | 'sentences' | 'grade' | 'long' | 'hard'>;
type Entry = Measured | { redirectsTo: string } | { unavailable: true };
type Reported = Entry | (Measured & { worst: ProseScore['worst'] });

const baseline: Record<string, Entry> = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, 'utf8'))
  : {};
const report: Record<string, Reported> = {};
const recorded: Record<string, Entry> = {};

const isMeasured = (entry: Entry | undefined): entry is Measured =>
  !!entry && 'grade' in entry && 'hard' in entry;

/** Visible English prose blocks of one scope of the current page, in reading order. */
async function proseBlocks(page: Page, scope: 'page' | 'footer'): Promise<string[]> {
  const texts = await page.evaluate(
    ({ selector, scope: area }) => {
      return [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((el) => {
          // A block that holds another prose block is measured through the inner one, once.
          if (el.querySelector(selector)) return false;
          if (area === 'page') {
            if (el.closest('header, nav, footer')) return false;
          } else if (!el.closest('footer') || el.closest('header, nav')) {
            return false;
          }
          // English only: the closest lang attribute is absent, empty or starts with "en".
          const lang = el.closest('[lang]')?.getAttribute('lang') ?? '';
          if (lang && !lang.toLowerCase().startsWith('en')) return false;
          // Closed disclosure content stays out; the summary line is visible.
          const closed = el.closest('details:not([open])');
          if (closed && !closed.querySelector(':scope > summary')?.contains(el)) return false;
          if (!el.checkVisibility({ checkVisibilityCSS: true })) return false;
          return el.innerText.trim() !== '';
        })
        .map((el) => el.innerText.replace(/\s+/g, ' ').trim());
    },
    { selector: proseSelector, scope },
  );
  return texts.filter((text) => words(text).length >= minBlockWords);
}

function toEntry(score: ProseScore): Measured {
  return {
    words: score.words,
    sentences: score.sentences,
    grade: score.grade,
    long: score.long,
    hard: score.hard,
  };
}

/** What is worse than the baseline, as plain messages. Empty when the route is no harder than before. */
function violations(key: string, now: Entry, before: Entry | undefined): string[] {
  if (!before) {
    return [
      `${key} has no readability baseline entry. Run with READABILITY_UPDATE_BASELINE=1 to record it. ` +
        'That flag is only for recording existing text, never for hiding a rise: fix the copy instead.',
    ];
  }
  if (isMeasured(now) && isMeasured(before)) {
    const found: string[] = [];
    if (now.long > before.long) {
      found.push(`${key}: sentences over 20 words rose from ${before.long} to ${now.long}`);
    }
    if (now.hard > before.hard) {
      found.push(`${key}: hard sentences rose from ${before.hard} to ${now.hard}`);
    }
    if (now.grade - before.grade > maxGradeRise + 1e-9) {
      found.push(
        `${key}: grade rose from ${before.grade} to ${now.grade} (allowed rise ${maxGradeRise})`,
      );
    }
    return found;
  }
  // The page was measured and still is, or it changed kind (now a redirect or unavailable).
  return JSON.stringify(now) === JSON.stringify(before)
    ? []
    : [`${key}: was ${JSON.stringify(before)}, now ${JSON.stringify(now)}`];
}

function record(key: string, entry: Entry, detail?: ProseScore) {
  recorded[key] = entry;
  report[key] = detail ? { ...toEntry(detail), worst: detail.worst } : entry;
}

for (const route of routes) {
  test(`readability ${route}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const response = await page.goto(route, { waitUntil: 'networkidle' });
    const finalPath = new URL(page.url()).pathname;
    const keys = route === '/' ? [route, footerKey] : [route];

    if (!response || response.status() >= 400) {
      for (const key of keys) record(key, { unavailable: true });
    } else if (finalPath !== route) {
      // Its prose belongs to the page it lands on, which is measured under that route.
      for (const key of keys) record(key, { redirectsTo: finalPath });
    } else {
      const score = scoreProse(await proseBlocks(page, 'page'));
      record(route, toEntry(score), score);
      if (route === '/') {
        const footer = scoreProse(await proseBlocks(page, 'footer'));
        record(footerKey, toEntry(footer), footer);
      }
    }

    if (update) return;
    for (const key of keys) {
      expect.soft(violations(key, recorded[key], baseline[key]), `${key} readability`).toEqual([]);
    }
  });
}

test.afterAll(() => {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(sortKeys(report), null, 2) + '\n');
  if (update) {
    writeFileSync(
      baselinePath,
      JSON.stringify(sortKeys({ ...baseline, ...recorded }), null, 2) + '\n',
    );
  }
});

/** Keys in a stable order (routes, then each entry's fields) so a regenerated file diffs cleanly. */
function sortKeys<T extends Record<string, object>>(table: T): T {
  return Object.fromEntries(
    Object.keys(table)
      .sort()
      .map((key) => [
        key,
        Object.fromEntries(Object.entries(table[key]).sort(([a], [b]) => (a < b ? -1 : 1))),
      ]),
  ) as T;
}
