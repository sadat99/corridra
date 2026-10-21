import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyInstallHead } from '../scripts/verify-real-use-install-head.mjs';

const sha = 'a'.repeat(40);
const languages = ['actions', 'javascript-typescript', 'python'];
function evidence(overrides = {}) {
  const runs = ['CI', 'CodeQL Advanced'].map((name, id) => ({
    id,
    name,
    head_sha: sha,
    event: 'push',
    status: 'completed',
    conclusion: 'success',
  }));
  const ci = ['checks', 'browser', 'operator (1)', 'operator (2)', 'operator (3)', 'validate'];
  return {
    ...{
      repository: 'owner/repo',
      sha,
      ref: 'refs/heads/main',
      request: async (path) => {
        if (path.includes('/actions/runs?')) return { workflow_runs: runs };
        if (path.includes('/actions/runs/0/jobs'))
          return { jobs: ci.map((name) => ({ name, status: 'completed', conclusion: 'success' })) };
        if (path.includes('/jobs?'))
          return {
            jobs: languages.map((language) => ({
              name: `Analyze (${language})`,
              status: 'completed',
              conclusion: 'success',
            })),
          };
        return languages.map((language) => ({
          commit_sha: sha,
          category: `/language:${language}`,
          error: '',
        }));
      },
    },
    ...overrides,
  };
}
test('only complete CI and uploaded analyses on the exact main source authorize installation', async () => {
  await verifyInstallHead(evidence());
  await assert.rejects(verifyInstallHead(evidence({ ref: 'refs/heads/feature' })), /exact main/);
});
test('a successful workflow cannot hide a skipped required job', async () => {
  const baseline = evidence();
  await assert.rejects(
    verifyInstallHead(
      evidence({
        request: async (path) => {
          const value = await baseline.request(path);
          if (path.includes('/actions/runs/0/jobs')) value.jobs[0].conclusion = 'skipped';
          return value;
        },
      }),
    ),
    /successful job: checks/,
  );
});
test('old or absent uploaded analyses do not count as current CodeQL evidence', async () => {
  const baseline = evidence();
  await assert.rejects(
    verifyInstallHead(
      evidence({
        request: async (path) => {
          const value = await baseline.request(path);
          return path.includes('/code-scanning/')
            ? value.map((row) => ({ ...row, commit_sha: 'b'.repeat(40) }))
            : value;
        },
      }),
    ),
    /uploaded CodeQL/,
  );
});
