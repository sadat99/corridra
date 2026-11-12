import { describe, expect, test } from 'vitest';
import { moveSelection, selectionIndex } from '../../apps/web/lib/ux/palette';

// The palette's selected row (docs/revamp/specs/navigation-v1/command-palette-search.md, section 7): the selection
// is clamped to the rows that exist, so pressing Up or Down while no row is listed cannot leave it at -1 when
// results arrive. moveSelection itself is pinned by team-palette.test.ts and does not change.
describe('R2-1 the selection is clamped to the rows that exist', () => {
  test('a stored -1 or an index past the end lands on a real row', () => {
    expect(selectionIndex(-1, 5)).toBe(0);
    expect(selectionIndex(9, 5)).toBe(4);
    expect(selectionIndex(0, 5)).toBe(0);
    expect(selectionIndex(3, 5)).toBe(3);
    expect(selectionIndex(4, 5)).toBe(4);
  });
  test('with no rows there is no selection', () => {
    expect(selectionIndex(0, 0)).toBe(-1);
    expect(selectionIndex(-1, 0)).toBe(-1);
    expect(selectionIndex(7, 0)).toBe(-1);
  });
  test('moveSelection is unchanged: it stops at the ends and an empty list is -1', () => {
    expect(moveSelection(0, 'ArrowDown', 3)).toBe(1);
    expect(moveSelection(2, 'ArrowDown', 3)).toBe(2);
    expect(moveSelection(0, 'ArrowUp', 3)).toBe(0);
    expect(moveSelection(0, 'ArrowDown', 0)).toBe(-1);
  });
  test('Down then results: the row the keys left behind is a real one', () => {
    // The state machine stores moveSelection(active, key, count) only when rows exist; a stale -1 is clamped.
    const stored = moveSelection(-1, 'ArrowDown', 0);
    expect(stored).toBe(-1);
    expect(selectionIndex(stored, 5)).toBe(0);
  });
});
