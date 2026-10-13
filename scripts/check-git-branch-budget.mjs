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
const remote = execFileSync(
  'gh',
  ['api', 'repos/sadat99/corridra/branches', '--paginate', '--jq', '.[].name'],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean);
if (!local.includes(branch)) assertBranchBudget(local.length);
if (!remote.includes(branch)) assertBranchBudget(remote.length);
console.log(JSON.stringify({ branch, localCount: local.length, remoteCount: remote.length }));
