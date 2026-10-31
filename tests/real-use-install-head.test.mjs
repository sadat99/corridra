import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { REQUIRED_CI_JOBS, verifyInstallHead } from '../scripts/verify-real-use-install-head.mjs';

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
  const ci = [
    'changes',
    'checks',
    'browser',
    'ux (1)',
    'ux (2)',
    'ux (3)',
    'operator (1)',
    'operator (2)',
    'operator (3)',
    'operator (4)',
    'operator (5)',
    'operator (6)',
    'validate',
  ];
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
  for (const skipped of ['checks', 'changes', 'ux (2)', 'operator (3)', 'operator (6)']) {
    await assert.rejects(
      verifyInstallHead(
        evidence({
          request: async (path) => {
            const value = await baseline.request(path);
            if (path.includes('/actions/runs/0/jobs'))
              value.jobs.find((job) => job.name === skipped).conclusion = 'skipped';
            return value;
          },
        }),
      ),
      (error) => error.message.includes(`successful job: ${skipped}`),
    );
  }
});
test('a three-shard CI run does not authorize installation', async () => {
  const baseline = evidence();
  await assert.rejects(
    verifyInstallHead(
      evidence({
        request: async (path) => {
          const value = await baseline.request(path);
          if (path.includes('/actions/runs/0/jobs'))
            value.jobs = value.jobs.filter(
              (job) => !['operator (4)', 'operator (5)', 'operator (6)'].includes(job.name),
            );
          return value;
        },
      }),
    ),
    (error) => error.message.includes('successful job: operator (4)'),
  );
});
test('the verifier requires exactly the jobs ci.yml defines', () => {
  const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const defined = Object.entries(workflow.jobs).flatMap(([id, job]) => {
    const matrix = job.strategy?.matrix;
    if (!matrix) return [id];
    const dimensions = Object.keys(matrix);
    assert.equal(dimensions.length, 1, `${id} must have a single matrix dimension`);
    return matrix[dimensions[0]].map((value) => `${id} (${value})`);
  });
  assert.deepEqual([...REQUIRED_CI_JOBS].sort(), defined.sort());
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
