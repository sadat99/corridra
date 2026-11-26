import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Home page v4.3 (owner, 26 Nov 2026, via the Guardian: "update as per attachment 100% correctly"): with
// CORRIDRA_UX_HOME_V43 unset, or anything but exactly "true", the public header, the footer and /corridors are what
// they were. The shared UX server runs with the switch unset. The header must equal the copy captured on 26 Nov 2026
// from an unchanged build of c783c0f (tests/ux/fixtures/header-off-c783c0f.html, same normaliser as home-v42-off.spec.ts,
// never regenerated), and nothing of v4.3 may be named in the HTML or in any linked stylesheet. The home page itself is
// checked by home-v42-off.spec.ts, which stays as it was.
const fixture = resolve('tests/ux/fixtures/header-off-c783c0f.html');

function part(html: string, tag: string): string {
  const start = html.indexOf(`<${tag}`);
  const end = html.indexOf(`</${tag}>`, start);
  if (start < 0 || end < 0) throw new Error(`no <${tag}> in the page`);
  return html.slice(start, end + tag.length + 3);
}
const normalise = (text: string) =>
  text.replace(/\/_next\/static\/[^"')\s]+/g, '/_next/static/HASH').replace(/\?dpl=[^"'&\s]+/g, '');

const named =
  /hv43|home-v43|HomeV43|homeV43|guide-footer-pack|gfp-|data-v43|site-header-solutions|ux-dossier/;
const inStyles = [
  '.hv43',
  'data-v43',
  '.gfp-',
  'guide-footer-pack',
  '.ux-dossier',
  '.public-jobs-sol',
];

test('with the switch off the public header is exactly the one captured from c783c0f', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();
  expect(normalise(part(html, 'header')) + '\n').toBe(readFileSync(fixture, 'utf8'));
});

for (const path of ['/', '/about', '/corridors', '/how-it-works']) {
  test(`with the switch off ${path} names no v4.3 code and links no v4.3 rule`, async ({
    request,
  }) => {
    const html = await (await request.get(path)).text();
    expect(html).not.toMatch(named);
    expect(html).toContain('What We Do');
    expect(html).not.toContain('>Solutions<');
    const sheets = [...html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map((m) => m[1]!);
    expect(sheets.length).toBeGreaterThan(0);
    for (const sheet of sheets) {
      const css = await (await request.get(sheet)).text();
      for (const rule of inStyles) expect(css, `${sheet} ${rule}`).not.toContain(rule);
    }
  });
}

test('with the switch off the request page keeps its compact footer and the public header', async ({
  request,
}) => {
  const html = await (await request.get('/plan')).text();
  expect(html).not.toMatch(named);
  expect(html).toContain('guide-footer-compact');
});
