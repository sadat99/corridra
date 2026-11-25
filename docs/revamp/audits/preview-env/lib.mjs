import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const here = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(here, '../..');
export const baseUrl = 'http://127.0.0.1:3200';
const require = createRequire(import.meta.url);
export const pw = require('/opt/node22/lib/node_modules/playwright/index.js');
const pg = createRequire(resolve(repo, 'packages/db/package.json'))('pg');
export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
export function ownerPool() {
  const local = readJson(resolve(repo, '.cache/part03-local.json'));
  return new pg.Pool({
    host: '127.0.0.1',
    port: 54329,
    user: 'postgres',
    password: local.ownerPassword,
    database: 'corridra_browser',
    max: 2,
  });
}
/** JSON API client over a Playwright request context (cookies from a storage state or a signed-in browser context). */
export function client(request, extraHeaders = {}) {
  return async (method, path, body) => {
    const r = await request.fetch(path, {
      method,
      headers: { origin: baseUrl, ...extraHeaders },
      ...(body === undefined ? {} : { data: body }),
    });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { ok: r.ok(), status: r.status(), json, text };
  };
}

/** JSON API client over plain fetch with an explicit cookie header (Playwright's request jar does not send Secure cookies over http). */
export function cookieClient(cookie, extraHeaders = {}) {
  return async (method, path, body) => {
    const r = await fetch(baseUrl + path, {
      method,
      headers: { origin: baseUrl, cookie, 'content-type': 'application/json', ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { ok: r.ok, status: r.status, json, text };
  };
}
