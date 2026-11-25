// Audit-only preload (NODE_OPTIONS --import). Active ONLY inside the Next server that scripts/operator-browser-server.ts
// spawns (APP_ORIGIN 127.0.0.1:3200 + synthetic). That script strips the NEON_AUTH_* settings, so they are set again here
// and the repository's own test sign-in stand-in (scripts/qa/fake-neon-auth.mjs) is loaded for the synthetic customers.
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const f = process.env.AUDIT_CUSTOMERS_FILE;
if (
  process.env.APP_ORIGIN === 'http://127.0.0.1:3200' &&
  process.env.DATA_ENVIRONMENT === 'synthetic' &&
  !process.env.VERCEL_ENV &&
  f && existsSync(f)
) {
  const c = JSON.parse(readFileSync(f, 'utf8'));
  process.env.CORRIDRA_NEON_AUTH_ENABLED = 'true';
  process.env.NEON_AUTH_BASE_URL = c.base;
  process.env.NEON_AUTH_COOKIE_SECRET = c.cookieSecret;
  process.env.QA_FAKE_NEON_AUTH_BASE_URL = c.base;
  process.env.QA_FAKE_NEON_AUTH_USERS = JSON.stringify(c.users);
  await import(pathToFileURL(process.env.AUDIT_REPO + '/scripts/qa/fake-neon-auth.mjs').href);
}
