import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
/** Captures only invented fixture views; no capability URLs, cookies or auth state. */
export async function participantEvidence(page: Page, name: string) {
  const stage = process.env.UX03_EVIDENCE_STAGE;
  if (!stage || !['baseline', 'after'].includes(stage)) return;
  const directory = `.cache/ux03/${stage}`;
  await mkdir(directory, { recursive: true });
  const original = page.viewportSize();
  const observations = [];
  try {
    for (const width of [1440, 1280, 768, 390, 360, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const axe = await new AxeBuilder({ page }).analyze();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      observations.push({
        name,
        width,
        overflow,
        violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact })),
        paint: await page.evaluate(() =>
          performance
            .getEntriesByType('paint')
            .map((p) => ({ name: p.name, startTime: p.startTime })),
        ),
      });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `${directory}/${name}-${width}.png`,
        fullPage: true,
        mask: [page.locator('input[type="password"], input[name="invitation"]')],
      });
      if (stage === 'after') {
        expect(overflow, `${name} overflow at ${width}`).toBe(false);
        expect(axe.violations, `${name} accessibility at ${width}`).toEqual([]);
      }
    }
  } finally {
    if (original) await page.setViewportSize(original);
    await writeFile(`${directory}/${name}.json`, JSON.stringify(observations, null, 2) + '\n');
  }
}
