import { describe, expect, it } from 'vitest';
import { assertGitBranchBudget } from '../../scripts/git-branch-budget';
import { assertBranchBudget } from '../../scripts/branch-budget';

describe('owner Git branch ceiling', () => {
  const eight = ['main', ...Array.from({ length: 7 }, (_, i) => `unfinished-${i}`)];

  it('allows eight distinct names without double-counting local/remote copies', () => {
    expect(assertGitBranchBudget(eight, eight, eight[1]!)).toBe(8);
    expect(assertGitBranchBudget(eight.slice(0, 7), eight.slice(0, 7), eight[7]!)).toBe(8);
  });

  it('rejects a ninth intended name and an already exceeded budget', () => {
    expect(() => assertGitBranchBudget(eight, eight, 'new-work')).toThrow('nine');
    expect(() => assertGitBranchBudget([...eight, 'ninth'], [], 'main')).toThrow('9 distinct');
  });

  it('counts unfinished local-only and remote-only names together', () => {
    const local = ['main', 'local-a', 'local-b', 'local-c'];
    const remote = ['main', 'dependency-a', 'dependency-b', 'remote-c', 'remote-d'];
    expect(assertGitBranchBudget(local, remote, 'local-a')).toBe(8);
    expect(() => assertGitBranchBudget(local, remote, 'new-work')).toThrow('9 distinct');
  });

  it('ignores the ephemeral CI checkout but still rejects a ninth remote/intended branch', () => {
    expect(assertGitBranchBudget(['ephemeral-merge'], eight, eight[1]!, true)).toBe(8);
    expect(() => assertGitBranchBudget(['ephemeral-merge'], eight, 'new-work', true)).toThrow(
      '9 distinct',
    );
  });

  it('preserves the independently tested ten-branch Neon budget', () => {
    expect(() => assertBranchBudget(9)).not.toThrow();
    expect(() => assertBranchBudget(10)).toThrow();
  });
});
