import { readFileSync } from 'node:fs';
import { test as base, expect, type Page } from '@playwright/test';

// Shared fixture for the commercial readiness verification suite (program section 8). Every case
// takes a screenshot, checks the final network status and makes a database or API assertion.
// The server is scripts/qa/verification-server.ts on port 3300 with the program flags on.

export type QaSeed = {
  tenantId: string;
  principalId: string;
  owner: { email: string; password: string };
  streams: Record<string, Record<string, unknown>>;
};

export function qaSeed(): QaSeed {
  return JSON.parse(readFileSync('.cache/qa-verification.json', 'utf8')) as QaSeed;
}

/** Appendix B patterns. Case-insensitive, checked against rendered text. */
export const forbiddenCopy: RegExp[] = [
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
  /\d{4}-\d{2}-\d{2}T\d{2}:/,
];

/** Rendered text of the page outside "(madeup)" demo panels and the deferred register. */
export async function visibleCopy(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll('[data-madeup-panel], [data-deferred-register], script, style, noscript')
      .forEach((node) => node.remove());
    return clone.innerText;
  });
}

export async function expectNoForbiddenCopy(page: Page) {
  const text = await visibleCopy(page);
  const hits = forbiddenCopy.filter((pattern) => pattern.test(text)).map(String);
  expect(hits, `forbidden copy on ${page.url()}`).toEqual([]);
}

/** Saves a screenshot under test-results/verification/<case>.png for RESULTS.md. */
export async function evidence(page: Page, caseId: string) {
  await page.screenshot({ path: `test-results/verification/${caseId}.png`, fullPage: false });
}

export const test = base;
export { expect };
