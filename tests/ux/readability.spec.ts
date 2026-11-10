import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  kindChangeError,
  mergeBaseline,
  readabilityViolations,
  scoreProse,
  words,
  type Entry,
  type Measured,
  type ProseScore,
} from './readability-lib';
import { gateRoutes } from './static-routes';

// Reading-level gate (docs/revamp/specs/workflow-intelligence.md, section 4, batch W1). For every
// static page the UX gate walks, it reads the visible English prose at 1440 x 900 in the default state
// (no clicks, closed `details` stay closed), scores it with ./readability-lib and fails when a route gets
// harder than tests/ux/readability-baseline.json: the long-sentence and hard-sentence counts may not rise
// and the grade may not rise by more than 0.5. Lower the baseline when copy improves; never raise it.
// The grade is an approximation for English. It guides plain wording and never replaces native review.
//
// Route set. Exactly the UX gate's: the walk over apps/web/app and the corridor pages live in
// ./static-routes and both specs import them. A page a signed-out visitor cannot open shows up as a
// redirect to sign-in or as unavailable, and is recorded that way.
//
// What is read. Prose inside the site header (`header.site-header`, public and signed-in), any `nav` and
// the site footer (`footer.guide-footer` or `footer.site-footer`) is left out. Headers and footers that
// belong to the page content, such as a page lead or a phase header, are read. The site footer is the
// same on every page, so it is read once, on the home, under its own key.
//
// Update mode (READABILITY_UPDATE_BASELINE=1) never lets a route get worse: see mergeBaseline.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const baselinePath = join(here, 'readability-baseline.json');
// CI uploads work/ux-gate/ for the ux job, so the report lands there.
const reportPath = join(root, 'work', 'ux-gate', 'readability-report.json');
const update = process.env.READABILITY_UPDATE_BASELINE === '1';

const routes = gateRoutes();

/** The footer is the same on every page, so it is measured once, on the home, under this key. */
const footerKey = '/#footer';

/** The site header, any navigation and the site footer: the chrome around the page, not its prose. */
const chromeSelector = 'header.site-header, nav, footer.guide-footer, footer.site-footer';
const footerSelector = 'footer.guide-footer, footer.site-footer';
const proseSelector =
  'p, li, dd, figcaption, [role="alert"], [role="status"], .guide-hint, .field-hint';
const minBlockWords = 5;

type Reported = Entry | (Measured & { worst: ProseScore['worst'] });

const baseline: Record<string, Entry> = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, 'utf8'))
  : {};
const report: Record<string, Reported> = {};
const recorded: Record<string, Entry> = {};

/** Visible English prose blocks of one scope of the current page, in reading order. */
async function proseBlocks(page: Page, scope: 'page' | 'footer'): Promise<string[]> {
  const texts = await page.evaluate(
    ({ selector, scope: area, chrome, footer }) => {
      return [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((el) => {
          // A block that holds another prose block is measured through the inner one, once.
          if (el.querySelector(selector)) return false;
          if (area === 'page') {
            if (el.closest(chrome)) return false;
          } else if (!el.closest(footer) || el.closest('nav')) {
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
    { selector: proseSelector, scope, chrome: chromeSelector, footer: footerSelector },
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

    for (const key of keys) {
      const before = baseline[key];
      if (update) {
        // Update mode records new routes and lower numbers, but a change of kind still fails.
        const error = before ? kindChangeError(key, recorded[key], before) : null;
        expect.soft(error, `${key} readability`).toBeNull();
        continue;
      }
      const worst = 'worst' in report[key] ? report[key].worst : [];
      const found = readabilityViolations(key, recorded[key], before, worst);
      expect.soft(found.join('\n'), `${key} readability`).toBe('');
    }
  });
}

test.afterAll(() => {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(sortKeys(report), null, 2) + '\n');
  if (update) {
    const { merged, errors } = mergeBaseline(baseline, recorded);
    // A kind change fails its own test; write nothing so the file is never half updated.
    if (errors.length === 0) {
      writeFileSync(baselinePath, JSON.stringify(sortKeys(merged), null, 2) + '\n');
    }
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
