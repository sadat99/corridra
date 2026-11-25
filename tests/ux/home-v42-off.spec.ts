import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Home page v4.2 (owner, 25 Nov 2026: "Add a switch, off by default"): with CORRIDRA_UX_HOME_V42 unset, or set to
// anything but exactly "true", the home page and its footer are exactly what they were before v4.2. The server HTML of
// <main> and <footer> on this build (the shared UX server runs with the switch unset) must equal the copy captured from
// a build of main at a054c51c before any v4.2 code existed. Only build hashes are normalised. A guard that passes on
// the old code by design. To capture again (only from an unchanged main build): HOME_OFF_FIXTURE_WRITE=1.
const fixture = resolve('tests/ux/fixtures/home-off-a054c51c.html');

function normalise(html: string): string {
  const part = (tag: string) => {
    const start = html.indexOf(`<${tag}`);
    const end = html.indexOf(`</${tag}>`, start);
    if (start < 0 || end < 0) throw new Error(`no <${tag}> in the home page`);
    return html.slice(start, end + tag.length + 3);
  };
  return [part('main'), part('footer')]
    .join('\n')
    .replace(/\/_next\/static\/[^"')\s]+/g, '/_next/static/HASH')
    .replace(/\?dpl=[^"'&\s]+/g, '');
}

test('with the switch off the home page main and footer are exactly those of main a054c51c', async ({
  request,
}) => {
  const response = await request.get('/');
  expect(response.ok()).toBe(true);
  const now = normalise(await response.text());
  if (process.env.HOME_OFF_FIXTURE_WRITE === '1') writeFileSync(fixture, now + '\n');
  expect(now + '\n').toBe(readFileSync(fixture, 'utf8'));
});
