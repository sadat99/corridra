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

test('with the switch off the home page main and footer are exactly those of main a054c51c, with the pc-10 actions', async ({
  request,
}) => {
  const response = await request.get('/');
  expect(response.ok()).toBe(true);
  const now = normalise(await response.text());
  if (process.env.HOME_OFF_FIXTURE_WRITE === '1') writeFileSync(fixture, now + '\n');
  // The one change made on purpose since that capture (audit row public-customer-10, team desk v4.1 later fixes): the
  // section actions are quiet text links, so #home-start is the one primary in main. Each edit must apply exactly once,
  // so any other difference still fails.
  let expected = readFileSync(fixture, 'utf8');
  for (const [before, after] of [
    [
      '<a class="primary-link" id="brief-start" href="/plan">',
      '<a data-start-action="true" class="ac1-quiet" id="brief-start" href="/plan">',
    ],
    [
      '<a class="primary-link" id="final-start" href="/plan">',
      '<a data-start-action="true" class="ac1-quiet tr-light-link" id="final-start" href="/plan">',
    ],
  ] as const) {
    expect(expected.split(before)).toHaveLength(2);
    expected = expected.replace(before, after);
  }
  expect(now + '\n').toBe(expected);
});

// G63 audit of 8c11a01: the off build still linked the v4.2 stylesheet in <head>. HomeV42 is now a lazy client chunk
// (components/home-v42-page.tsx), so with the switch off the home page names no v4.2 code and links no stylesheet
// that holds a v4.2 rule; with it on, Next.js hoists that one stylesheet into <head> from the server HTML.
test('with the switch off the home page links no v4.2 stylesheet and names no v4.2 code', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();
  expect(html).not.toMatch(/hv42|home-v42|HomeV42/);
  const sheets = [...html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map((m) => m[1]!);
  expect(sheets.length).toBeGreaterThan(0);
  for (const sheet of sheets) {
    const css = await (await request.get(sheet)).text();
    expect(css, sheet).not.toContain('.hv42');
  }
});
