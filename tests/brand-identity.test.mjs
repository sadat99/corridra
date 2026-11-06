import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

// Keeps the Corridra logo and icons one identity. Spec: docs/brand/CORRIDRA_BRAND_IDENTITY.md.
const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const css = await read('apps/web/app/globals.css');
const palette = new Set(
  [...css.matchAll(/--ac-[a-z-]+:\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => m[1].toLowerCase()),
);
const tokens = JSON.parse(await read('docs/brand/brand-identity.tokens.json'));
const png = async (path) => {
  const bytes = await readFile(new URL(path, root));
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG', `${path} is a PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

test('every asset the registry names exists', async () => {
  for (const asset of Object.values(tokens.assets)) {
    for (const variant of Object.values(asset.variants)) {
      for (const file of [variant.svg, variant.png]) await readFile(new URL(file, root));
    }
  }
});

test('logo SVGs use only AC/1 colours (black only in mono-black)', async () => {
  const dirs = ['apps/web/public/brand', 'docs/brand/assets/svg', 'docs/brand/assets/app-icons'];
  let checked = 0;
  for (const dir of dirs) {
    for (const file of (await readdir(new URL(dir + '/', root))).filter((f) =>
      f.endsWith('.svg'),
    )) {
      const source = await read(`${dir}/${file}`);
      const allowed = file.includes('mono-black') ? new Set([...palette, '#000000']) : palette;
      const unknown = (source.match(/#[0-9a-fA-F]{6}\b/g) ?? []).filter(
        (v) => !allowed.has(v.toLowerCase()),
      );
      assert.deepEqual(unknown, [], `${dir}/${file} has a colour outside AC/1`);
      checked += 1;
    }
  }
  assert.ok(checked > 40, 'logo files discovered');
});

test('icons and social images have the sizes the platforms expect', async () => {
  assert.deepEqual(await png('apps/web/app/apple-icon.png'), [180, 180]);
  assert.deepEqual(await png('apps/web/app/opengraph-image.png'), [1200, 630]);
  assert.deepEqual(await png('apps/web/app/twitter-image.png'), [1200, 630]);
  assert.deepEqual(await png('apps/web/public/brand/android-chrome-192.png'), [192, 192]);
  assert.deepEqual(await png('apps/web/public/brand/android-chrome-512.png'), [512, 512]);
  assert.deepEqual(await png('apps/web/public/brand/maskable-512.png'), [512, 512]);
  const ico = await readFile(new URL('apps/web/app/favicon.ico', root));
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0], 'favicon.ico header');
  assert.match(await read('apps/web/app/icon.svg'), /<svg[^>]+viewBox="0 0 64 64"/);
});

test('product code draws the logo in one place, from tokens, without the tagline or old colours', async () => {
  const header = await read('apps/web/components/site-header.tsx');
  assert.match(header, /export function BrandLockup/);
  assert.match(header, /fill="currentColor"/);
  const paths = await read('apps/web/components/brand-paths.ts');
  assert.match(paths, /export const ORB/);
  assert.match(paths, /export const WORDMARK/);
  // The inline geometry must equal the published SVG assets, so the two cannot drift apart.
  const [orbPath, wordPath] = [...paths.matchAll(/\bd: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(orbPath && wordPath, 'path data found in brand-paths.ts');
  assert.ok(
    (await read('apps/web/public/brand/corridra-orb-cobalt.svg')).includes(`d="${orbPath}"`),
  );
  assert.ok(
    (await read('apps/web/public/brand/corridra-wordmark-navy.svg')).includes(`d="${wordPath}"`),
  );
  const sources = (await readdir(new URL('apps/web/', root), { recursive: true })).filter(
    (f) => /\.(?:tsx|ts|css)$/.test(f) && !/(?:^|\/)(?:node_modules|\.next)\//.test(f),
  );
  for (const file of sources) {
    const source = await read(`apps/web/${file}`);
    assert.doesNotMatch(
      source,
      /legacy-orange|fe8e03|041b46/i,
      `${file} uses the retired artwork colours`,
    );
    assert.doesNotMatch(
      source,
      /-tagline\.(?:svg|png)/,
      `${file} uses a tagline lockup in product UI`,
    );
  }
  assert.match(css, /\.brand \.brand-mark\s*\{[^}]*var\(--brand\)/);
  assert.match(css, /\.brand \.brand-word\s*\{[^}]*var\(--brand-deep\)/);
});

test('brand documents follow the no em dash rule', async () => {
  for (const file of [
    'docs/brand/CORRIDRA_BRAND_IDENTITY.md',
    'docs/brand/LOGO_IMPLEMENTATION_RUNBOOK.md',
    'docs/adr/0077-corridra-visual-identity.md',
    '.claude/skills/corridra-brand/SKILL.md',
  ]) {
    assert.doesNotMatch(await read(file), /\u2014/, `${file} contains an em dash`);
  }
});
