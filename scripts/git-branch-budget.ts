const maximumGitBranches = 8;

/** CI's detached/merge checkout is ephemeral; local product branches count elsewhere. */
export function assertGitBranchBudget(
  local: readonly string[],
  remote: readonly string[],
  intended: string,
  actions = false,
) {
  const names = new Set([...(actions ? [] : local), ...remote, intended]);
  if (names.size > maximumGitBranches)
    throw new Error(
      `Working on ${intended} would require ${names.size} distinct Git branches. Keep fewer than nine (at most eight) including main; preserve unfinished work and open PRs when retiring completed branches.`,
    );
  return names.size;
}
