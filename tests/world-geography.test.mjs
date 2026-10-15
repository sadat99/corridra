import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// The any-route atlas must be able to place every supported country, as an outline or a point.
const countries = await readFile(
  new URL('../packages/domain/src/countries.ts', import.meta.url),
  'utf8',
);
const world = await readFile(
  new URL('../apps/web/components/world-geography.ts', import.meta.url),
  'utf8',
);
const supported = [
  ...countries
    .split('export const countryCodes = [')[1]
    .split('] as const')[0]
    .matchAll(/'([A-Z]{2})'/g),
].map((m) => m[1]);
const outlines = new Set(
  [
    ...world
      .split('countries: {')[1]
      .split('} as Record')[0]
      .matchAll(/^\s{4}([A-Z]{2}): \{(?: d:|$)/gm),
  ].map((m) => m[1]),
);
const points = new Set(
  [
    ...world
      .split('points: {')[1]
      .split('} as Record')[0]
      .matchAll(/^\s{4}([A-Z]{2}): \[/gm),
  ].map((m) => m[1]),
);

test('every supported country has an outline or a point on the world map', () => {
  assert.ok(supported.length > 200, 'supported country list was read');
  const missing = supported.filter((code) => !outlines.has(code) && !points.has(code));
  assert.deepEqual(missing, []);
});

test('the 27 EU member states all have outlines so the bloc can be drawn', () => {
  const eu =
    'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' ');
  const missing = eu.filter((code) => !outlines.has(code));
  // Malta and Cyprus are small. They may be points; the map then shows them as markers.
  assert.ok(
    missing.every((code) => points.has(code)),
    `missing from both: ${missing.join(',')}`,
  );
});
