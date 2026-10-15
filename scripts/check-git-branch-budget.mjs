import { execFileSync } from 'node:child_process';
import { assertBranchBudget } from './branch-budget.ts';

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
if (
  remote.length > 10 ||
  (!actions && (local.length > 10 || new Set([...local, ...remote]).size > 10))
)
  throw new Error(
    'The ten-branch limit is already exceeded; preserve unfinished work and resolve it before publishing',
  );
if (!local.includes(branch)) assertBranchBudget(local.length);
if (!remote.includes(branch)) assertBranchBudget(remote.length);
// Owner rule (2026-10-15): fewer than nine Git branches including main, so at most eight.
// Retire merged branches that no longer affect the system before publishing another.
const gitMaximum = 8;
const afterPublish = new Set([...remote, branch]).size;
if (afterPublish > gitMaximum)
  throw new Error(
    `Publishing ${branch} would make ${afterPublish} remote branches. Keep fewer than nine (at most ${gitMaximum}) including main: delete merged branches that no longer affect the system first.`,
  );
console.log(JSON.stringify({ branch, localCount: local.length, remoteCount: remote.length }));
