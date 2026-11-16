import { describe, expect, test } from 'vitest';
import { needsFilterFromSearch, searchWithNeedsFilter } from '../../apps/web/lib/ux/team-today';

// Item 27 (owner, 16 Nov 2026): the Home list opens on All and keeps the chosen filter in the address.
describe('Home list filter in the address', () => {
  test('opens on All with no parameter, an empty one or an unknown one', () => {
    expect(needsFilterFromSearch('')).toBe('all');
    expect(needsFilterFromSearch('?needs=')).toBe('all');
    expect(needsFilterFromSearch('?needs=everything')).toBe('all');
    expect(needsFilterFromSearch('?needs=all')).toBe('all');
  });

  test('reads New and Past due back from the address', () => {
    expect(needsFilterFromSearch('?needs=new')).toBe('new');
    expect(needsFilterFromSearch('?workspace=abc&needs=overdue')).toBe('overdue');
  });

  test('writes the choice, keeps other parameters, and leaves nothing behind for All', () => {
    expect(searchWithNeedsFilter('', 'overdue')).toBe('?needs=overdue');
    expect(searchWithNeedsFilter('?workspace=abc', 'new')).toBe('?workspace=abc&needs=new');
    expect(searchWithNeedsFilter('?workspace=abc&needs=new', 'overdue')).toBe(
      '?workspace=abc&needs=overdue',
    );
    expect(searchWithNeedsFilter('?workspace=abc&needs=new', 'all')).toBe('?workspace=abc');
    expect(searchWithNeedsFilter('?needs=new', 'all')).toBe('');
  });
});
