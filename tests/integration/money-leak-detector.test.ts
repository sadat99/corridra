import { expect, test } from 'vitest';
import { findLeaks } from './money-leaks';

// No database needed: this pins the detector that revamp-money-database.test.ts relies on.
const secrets = ['987654321', '4321', 'PRIVATE-NOTE-XYZ', 'markupBasisPoints'];
const uuid = 'f47ac10b-4321-4e5f-8a1b-0c2d3e4f5a6b';
const digest = 'a1b2c3d4' + '4321' + 'e5f6a7b8'.repeat(6) + 'c9d0';
const timestamp = '2026-11-14T04:32:10.432100Z';

test('identifiers that merely contain 4321 are not leaks', () => {
  expect(digest).toHaveLength(64);
  expect(findLeaks({ id: uuid }, secrets)).toEqual([]);
  expect(findLeaks({ digest }, secrets)).toEqual([]);
  expect(findLeaks({ at: timestamp, again: '2026-11-14 04:32:10.4321+00' }, secrets)).toEqual([]);
  expect(findLeaks({ rows: [{ id: uuid, at: timestamp, digest }] }, secrets)).toEqual([]);
});

test('a real figure is still a leak, alone or beside identifiers', () => {
  expect(findLeaks({ markup: 4321 }, secrets)).toEqual(['4321']);
  expect(findLeaks('markup 4321 basis points', secrets)).toEqual(['4321']);
  expect(findLeaks({ cost: '987654321' }, secrets)).toContain('987654321');
  expect(findLeaks({ note: 'PRIVATE-NOTE-XYZ' }, secrets)).toEqual(['PRIVATE-NOTE-XYZ']);
  expect(findLeaks({ markupBasisPoints: 1 }, secrets)).toEqual(['markupBasisPoints']);
  // Separated from an identifier by a space or a dash.
  expect(findLeaks(`id ${uuid} 4321`, secrets)).toEqual(['4321']);
  expect(findLeaks(`4321 ${uuid}`, secrets)).toEqual(['4321']);
  expect(findLeaks(`4321-${uuid}`, secrets)).toEqual(['4321']);
  expect(findLeaks(`${timestamp} 4321`, secrets)).toEqual(['4321']);
  expect(findLeaks(`${digest} 4321`, secrets)).toEqual(['4321']);
  // Glued to an identifier: the shape no longer matches, so nothing is blanked.
  expect(findLeaks(`4321${uuid}`, secrets)).toEqual(['4321']);
  expect(findLeaks(`${uuid}4321`, secrets)).toEqual(['4321']);
  expect(findLeaks(`4321${digest}`, secrets)).toEqual(['4321']);
  expect(findLeaks(`${digest}4321`, secrets)).toEqual(['4321']);
  expect(findLeaks(`4321${timestamp}`, secrets)).toEqual(['4321']);
  // Only the exact 8-4-4-4-12 shape is blanked: a longer first or last group is not an identifier.
  expect(findLeaks('194321abc-1111-2222-3333-444444444444', secrets)).toEqual(['4321']);
  expect(findLeaks('4321abcd-1111-2222-3333-4444444444441', secrets)).toEqual(['4321']);
  expect(findLeaks('e' + digest, secrets)).toEqual(['4321']);
  expect(findLeaks(digest + 'e', secrets)).toEqual(['4321']);
  // A blanked identifier is replaced by a space, so its neighbours cannot join into a figure.
  expect(findLeaks(`43-${uuid}-21`, secrets)).toEqual([]);
  expect(findLeaks(`43:${uuid}:21`, secrets)).toEqual([]);
});

test('a comma-grouped figure is a leak when it is formatted text', () => {
  expect(findLeaks({ price: '4,321' }, secrets)).toEqual(['4321']);
  expect(findLeaks({ price: 'USD 4,321.00' }, secrets)).toEqual(['4321']);
  expect(findLeaks(['x', '4,321'], secrets)).toEqual(['4321']);
  expect(findLeaks({ cost: '987,654,321' }, secrets)).toEqual(['987654321']);
  expect(findLeaks(`${uuid} 4,321`, secrets)).toEqual(['4321']);
});

test('numbers of a JSON array are not read as a grouped figure', () => {
  // Today's detector does not flag these (no '4321' substring), and the new one must not either.
  expect(JSON.stringify([4, 321])).not.toContain('4321');
  expect(findLeaks([4, 321], secrets)).toEqual([]);
  expect(findLeaks([1, 4, 321], secrets)).toEqual([]);
  expect(findLeaks([4, 321, 7], secrets)).toEqual([]);
  expect(findLeaks({ list: [9, 987, 654, 321] }, secrets)).toEqual([]);
  // A larger grouped number is a different figure.
  expect(findLeaks('14,321', secrets)).toEqual([]);
});
