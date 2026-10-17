import { execFileSync } from 'node:child_process';
import { assertGitBranchBudget } from './git-branch-budget.ts';

// Read-only preflight before creating or publishing a product branch. Preserve open PRs.
const [branch] = process.argv.slice(2);
if (!branch || process.argv.length !== 3)
  throw new Error('Usage: node scripts/check-git-branch-budget.mjs <intended branch>');
execFileSync('git', ['check-ref-format', '--branch', branch], { stdio: 'pipe' });
const local = execFileSync('git', ['branch', '--format=%(refname:short)'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);
const actions = process.env.GITHUB_ACTIONS === 'true';
// CI has an ephemeral PR merge checkout, not another product branch. Use the
// checkout's read-only Git credential instead of requesting additional API scope.
const remote = actions
  ? execFileSync('git', ['ls-remote', '--heads', 'origin'], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[1].replace('refs/heads/', ''))
  : execFileSync(
      'gh',
      ['api', 'repos/sadat99/corridra/branches', '--paginate', '--jq', '.[].name'],
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter(Boolean);
const distinctCount = assertGitBranchBudget(local, remote, branch, actions);
console.log(
  JSON.stringify({ branch, localCount: local.length, remoteCount: remote.length, distinctCount }),
);
