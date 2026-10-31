// UX measures for the commercial readiness program (V-52 to V-60, 6.E harness). For each page and
// width it counts screens of content, forms, inputs and buttons, and lists forbidden words (Appendix
// B), ISO or US numeric dates, raw id fields and horizontal scroll. Run against the verification
// server (scripts/qa/verification-server.ts, port 3300):
//
//   pnpm exec tsx scripts/qa/ux-measure.ts [--base http://127.0.0.1:3300] [--report file.json] [--strict]
//
// Without --base it starts the verification server itself (it rebuilds the local verification
// database, so wrap it in the browser lock). --strict exits 1 when a page breaks a target.
// Owner: WS-E.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium, type Page } from '@playwright/test';

export const measuredWidths = [390, 768, 1280] as const;

/** Public pages every visitor can open. Signed-in pages are measured by the stream specs. */
export const measuredPages = [
  '/',
  '/how-it-works',
  '/about',
  '/trust',
  '/privacy',
  '/plan',
  '/sell',
  '/source',
  '/corridors',
  '/fairs',
  '/signin',
  '/signup',
  '/workspace',
  '/operator/signin',
] as const;

/** Appendix B, kept in step with tests/e2e/verification/fixtures.ts. */
export const forbiddenPatterns: RegExp[] = [
  /test mode/i,
  /test flow/i,
  /test mission request/i,
  /example request/i,
  /synthetic/i,
  /invented/i,
  /fictional/i,
  /demonstration channel/i,
  /sample requests from customers/i,
  /real customer mission admission/i,
  /approved test participant/i,
  /sample invitation code/i,
  /@example\.invalid/i,
  /—/,
];
const isoTimestamp = /\b\d{4}-\d{2}-\d{2}T\d{2}:/;
const isoDate = /\b\d{4}-\d{2}-\d{2}\b/;
const usDate = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/;

export type PageMeasure = {
  path: string;
  width: number;
  status: number;
  screens: number;
  forms: number;
  openForms: number;
  inputs: number;
  buttons: number;
  smallTargets: number;
  horizontalScroll: boolean;
  forbidden: string[];
  isoDates: string[];
  usDates: string[];
  rawIdFields: string[];
  h1: number;
  title: string;
};

/** Targets from the program (V-56 to V-60), applied by --strict and the WS-E specs. */
export function targetsBroken(m: PageMeasure): string[] {
  const broken: string[] = [];
  if (m.status >= 400) broken.push(`status ${m.status}`);
  if (m.horizontalScroll) broken.push('horizontal scroll');
  if (m.forbidden.length) broken.push(`forbidden words: ${m.forbidden.join(', ')}`);
  if (m.isoDates.length) broken.push(`ISO dates: ${m.isoDates.join(', ')}`);
  if (m.usDates.length) broken.push(`US dates: ${m.usDates.join(', ')}`);
  if (m.rawIdFields.length) broken.push(`raw id fields: ${m.rawIdFields.join(', ')}`);
  if (m.openForms > 1) broken.push(`${m.openForms} forms open at once`);
  if (m.h1 !== 1) broken.push(`${m.h1} h1 headings`);
  return broken;
}

/** Measures the page as it is now. Text inside "(madeup)" panels and the deferred register is skipped. */
export async function measurePage(page: Page, path: string, status: number): Promise<PageMeasure> {
  const raw = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll('[data-madeup-panel], [data-deferred-register], script, style, noscript')
      .forEach((node) => node.remove());
    const visible = (el: Element) => {
      const box = (el as HTMLElement).getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden';
    };
    const main = document.getElementById('main') ?? document.body;
    const inputs = Array.from(main.querySelectorAll('input, select, textarea')).filter(
      (el) => (el as HTMLInputElement).type !== 'hidden' && visible(el),
    );
    const labelOf = (el: Element) => {
      const id = el.getAttribute('id');
      const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      return (
        label?.textContent ??
        el.closest('label')?.textContent ??
        el.getAttribute('aria-label') ??
        ''
      ).trim();
    };
    const rawIdFields = inputs
      .filter((el) => {
        const text = `${el.getAttribute('name') ?? ''} ${labelOf(el)}`;
        return /(?:^|[\s_-])(?:uuid|id)(?:$|[\s_-])|\bID\b|_id\b|Id\b/.test(text);
      })
      .map((el) => labelOf(el) || el.getAttribute('name') || 'unnamed field');
    const targets = Array.from(
      document.querySelectorAll('a[href], button, input, select, textarea, summary'),
    )
      .filter(visible)
      .filter((el) => {
        if (el.closest('p, li') && el.tagName === 'A') return false; // inline text links are exempt
        const box = el.getBoundingClientRect();
        return box.height < 43.5 && box.width < 43.5;
      }).length;
    const forms = Array.from(main.querySelectorAll('form'));
    return {
      text: clone.innerText,
      screens: document.documentElement.scrollHeight / window.innerHeight,
      forms: forms.length,
      openForms: forms.filter(visible).length,
      inputs: inputs.length,
      buttons: Array.from(main.querySelectorAll('button')).filter(visible).length,
      smallTargets: targets,
      horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      rawIdFields,
      h1: document.querySelectorAll('h1').length,
      title: document.title,
    };
  });
  const width = page.viewportSize()?.width ?? 0;
  const matches = (pattern: RegExp) => {
    const global = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g',
    );
    return [...new Set(raw.text.match(global) ?? [])].slice(0, 5);
  };
  return {
    path,
    width,
    status,
    screens: Math.round(raw.screens * 10) / 10,
    forms: raw.forms,
    openForms: raw.openForms,
    inputs: raw.inputs,
    buttons: raw.buttons,
    smallTargets: raw.smallTargets,
    horizontalScroll: raw.horizontalScroll,
    forbidden: forbiddenPatterns.filter((pattern) => pattern.test(raw.text)).map(String),
    isoDates: [...matches(isoTimestamp), ...matches(isoDate)],
    usDates: matches(usDate),
    rawIdFields: raw.rawIdFields,
    h1: raw.h1,
    title: raw.title,
  };
}

async function reachable(base: string) {
  try {
    return (await fetch(base, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const strict = args.includes('--strict');
  let base = option('--base') ?? 'http://127.0.0.1:3300';
  base = base.replace(/\/+$/, '');
  let server: ChildProcess | null = null;
  if (!(await reachable(base))) {
    if (option('--base')) throw new Error(`Nothing answers at ${base}`);
    server = spawn('pnpm', ['exec', 'tsx', 'scripts/qa/verification-server.ts'], {
      stdio: 'ignore',
      detached: true,
    });
    const until = Date.now() + 120000;
    while (!(await reachable(base))) {
      if (Date.now() > until) throw new Error('The verification server did not start');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  );
  const results: (PageMeasure & { broken: string[] })[] = [];
  try {
    for (const width of measuredWidths) {
      const page = await browser.newPage({ viewport: { width, height: width < 700 ? 844 : 900 } });
      for (const path of measuredPages) {
        const response = await page.goto(base + path, { waitUntil: 'networkidle' });
        const measure = await measurePage(page, path, response?.status() ?? 0);
        results.push({ ...measure, broken: targetsBroken(measure) });
      }
      await page.close();
    }
  } finally {
    await browser.close();
    if (server?.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        /* Already stopped. */
      }
    }
  }
  const report = option('--report');
  if (report) {
    await mkdir(dirname(report), { recursive: true });
    await writeFile(
      report,
      JSON.stringify({ base, measuredAt: new Date().toISOString(), results }, null, 2),
    );
  }
  for (const r of results)
    console.log(
      [
        String(r.width).padStart(4),
        r.path.padEnd(18),
        `screens ${r.screens}`,
        `forms ${r.forms}`,
        `inputs ${r.inputs}`,
        `buttons ${r.buttons}`,
        `small targets ${r.smallTargets}`,
        r.broken.length ? `BROKEN: ${r.broken.join('; ')}` : 'ok',
      ].join(' | '),
    );
  const failing = results.filter((r) => r.broken.length);
  console.log(`${results.length} measures, ${failing.length} with a broken target.`);
  if (strict && failing.length) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
