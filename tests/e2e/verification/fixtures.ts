import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

/** The authenticator code for the current 30 second window (RFC 6238, SHA-1, six digits). */
export function totp(secret: string, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, ''))
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

const authenticatorFile = '.cache/qa-verification-authenticator.json';
type SavedAuthenticator = { tenantId: string; secret: string; lastWindow: number };

/**
 * Signs the seeded QA owner in to the team workspace. The first sign-in of a run enrols the
 * authenticator and keeps its key (local file, this run's tenant only) so later tests and other
 * streams can sign in again. A code is never reused within its 30 second window (replay rule).
 */
export async function signInOwner(page: Page, next = '/operator') {
  const seed = qaSeed();
  let saved: SavedAuthenticator | null = null;
  if (existsSync(authenticatorFile)) {
    const value = JSON.parse(readFileSync(authenticatorFile, 'utf8')) as SavedAuthenticator;
    if (value.tenantId === seed.tenantId) saved = value;
  }
  await page.goto('/operator/signin?next=' + encodeURIComponent(next));
  await page.getByLabel('Email', { exact: true }).fill(seed.owner.email);
  await page.getByLabel('Password', { exact: true }).fill(seed.owner.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: /Set up your authenticator|Verify your authenticator/ }),
  ).toBeVisible({ timeout: 20000 });
  let secret = saved?.secret ?? '';
  if (await page.getByRole('heading', { name: 'Set up your authenticator' }).isVisible()) {
    await page.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
    secret = await page.getByLabel('Authenticator setup key').inputValue();
  }
  if (!secret) throw new Error('No authenticator key for this run');
  const lastWindow = saved?.lastWindow ?? 0;
  while (Math.floor(Date.now() / 30000) <= lastWindow) await page.waitForTimeout(1000);
  const window = Math.floor(Date.now() / 30000);
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  writeFileSync(
    authenticatorFile,
    JSON.stringify({ tenantId: seed.tenantId, secret, lastWindow: window }),
    { mode: 0o600 },
  );
  await page.getByRole('button', { name: 'Verify and open workspace' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/operator/signin'), { timeout: 20000 });
  return seed;
}

export const test = base;
export { expect };
