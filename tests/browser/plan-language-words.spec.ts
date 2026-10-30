import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The request form's words in other languages load on demand (Lane 11). Each language is its own file, fetched
// only where the owner has released it in CORRIDRA_LANGUAGES_FORM and a person has chosen it. This build has the
// release unset, as the site is deployed, so no page may fetch any of them, and no page's first load may carry them.
const codes = ['bn', 'zh', 'es', 'ar', 'fr', 'de'] as const;
// A sentence only that language's file holds: its translation of the line about English parts.
const marks = Object.fromEntries(
  codes.map((code) => {
    const source = readFileSync(resolve(`apps/web/lib/i18n/form-words/${code}.ts`), 'utf8');
    const words = source.match(/'form\.notice\.englishParts':\s*'([^']+)'/)?.[1];
    if (!words) throw new Error(`No mark found for ${code}`);
    return [code, words];
  }),
) as Record<(typeof codes)[number], string>;
const chunks = resolve('apps/web/.next/static/chunks');
const builtFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? builtFiles(join(dir, entry.name))
      : entry.name.endsWith('.js')
        ? [join(dir, entry.name)]
        : [],
  );

for (const path of ['/', '/plan'])
  for (const chosen of ['en', 'de'])
    test(`${path} with ${chosen} chosen fetches no translated form words`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('corridra.language', value), chosen);
      const scripts: string[] = [];
      page.on('response', async (response) => {
        if (response.url().endsWith('.js')) scripts.push(await response.text());
      });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(scripts.length).toBeGreaterThan(0);
      for (const code of codes)
        for (const script of scripts) expect(script.includes(marks[code]), code).toBe(false);
      if (path === '/plan') await expect(page.locator('main#main')).toHaveAttribute('lang', 'en');
    });

test("each language's form words are one file of their own, never part of a page's first load", async ({
  request,
}) => {
  const files = builtFiles(chunks).map((file) => ({ file, text: readFileSync(file, 'utf8') }));
  const html = await (await request.get('/plan')).text();
  const firstLoad = [...html.matchAll(/(?:src|href)="\/_next\/static\/chunks\/([^"?]+\.js)/g)].map(
    (match) => match[1],
  );
  expect(firstLoad.length).toBeGreaterThan(0);
  const seen = new Set<string>();
  for (const code of codes) {
    const holding = files.filter(({ text }) => text.includes(marks[code]));
    expect(
      holding.map(({ file }) => file.slice(chunks.length + 1)),
      code,
    ).toHaveLength(1);
    const [only] = holding;
    for (const other of codes)
      if (other !== code)
        expect(only.text.includes(marks[other]), `${code} holds ${other}`).toBe(false);
    expect(firstLoad, code).not.toContain(only.file.slice(chunks.length + 1));
    seen.add(only.file);
  }
  expect(seen.size).toBe(codes.length);
});
