import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { barePublicPages, isBarePublicPage } from '../../apps/web/lib/ux/bare-pages';

// Revamp Wave 4, spec docs/revamp/specs/decision-card-ui.md: the decision card page is bare. No header,
// footer or dock, and so nothing that asks the server who is signed in.
describe('isBarePublicPage', () => {
  it('is true only for the decision card page, with or without a trailing slash', () => {
    expect(barePublicPages).toEqual(['/decision-card']);
    expect(isBarePublicPage('/decision-card')).toBe(true);
    expect(isBarePublicPage('/decision-card/')).toBe(true);
  });
  it.each([
    '/',
    '/decision-cards',
    '/decision-card/extra',
    '/decision-card-x',
    '/account/decision-card',
    '/operator',
    '/DECISION-CARD',
    '',
    null,
    undefined,
  ])('is false for %s', (path) => {
    expect(isBarePublicPage(path as string | null | undefined)).toBe(false);
  });
});

describe('the chrome that reads the session stays out of a bare page', () => {
  const read = (path: string) => readFileSync(path, 'utf8');
  it.each([
    ['apps/web/components/ux/shell-header.tsx', 'isBarePublicPage(pathname)'],
    ['apps/web/components/site-footer-place.tsx', 'isBarePublicPage(pathname)'],
    ['apps/web/components/corner-dock.tsx', 'isBarePublicPage('],
  ])('%s checks the predicate', (file, needle) => {
    expect(read(file)).toContain(needle);
    expect(read(file)).toMatch(/import \{ isBarePublicPage \} from '[./]+\/lib\/ux\/bare-pages';/);
  });
});
