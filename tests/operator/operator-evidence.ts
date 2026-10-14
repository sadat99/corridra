import { expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
export async function operatorEvidence(page: Page, root: Locator, name: string) {
  const stage = process.env.UX04_EVIDENCE_STAGE;
  if (!stage || !['baseline', 'after'].includes(stage)) return;
  if (!/^[a-z-]+$/.test(name)) throw Error('Invalid evidence label');
  const directory = `.cache/ux04/${stage}`;
  await mkdir(directory, { recursive: true });
  const original = page.viewportSize();
  const observations = [];
  await root.evaluate((node, label) => node.setAttribute('data-ux04-evidence', label), name);
  try {
    for (const width of [1440, 1280, 768, 390, 360, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const axe = await new AxeBuilder({ page })
        .include(`[data-ux04-evidence="${name}"]`)
        .analyze();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      observations.push({
        name,
        width,
        overflow,
        violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact })),
      });
      await root.screenshot({
        path: `${directory}/${name}-${width}.png`,
        mask: [root.locator('input[readonly], textarea[readonly], input[type="password"]')],
      });
      if (stage === 'after') {
        expect(overflow, `${name} document overflow at ${width}`).toBe(false);
        expect(axe.violations, `${name} accessibility at ${width}`).toEqual([]);
      }
    }
  } finally {
    if (original) await page.setViewportSize(original);
    await root.evaluate((node) => node.removeAttribute('data-ux04-evidence')).catch(() => {});
    await writeFile(`${directory}/${name}.json`, JSON.stringify(observations, null, 2) + '\n');
  }
}
