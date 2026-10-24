import { pathToFileURL } from 'node:url';

// Installation credentials are released only by the protected environment. In
// addition, require completed evidence for this exact main revision.
export async function verifyInstallHead({ repository, sha, ref, request }) {
  if (ref !== 'refs/heads/main' || !/^[a-f0-9]{40}$/.test(sha))
    throw new Error('Installation requires an exact main revision');
  const base = `/repos/${repository}`;
  const runs = (await request(`${base}/actions/runs?head_sha=${sha}&per_page=100`)).workflow_runs;
  for (const name of ['CI', 'CodeQL Advanced']) {
    const run = runs.find(
      (row) => row.name === name && row.head_sha === sha && row.event === 'push',
    );
    if (!run || run.status !== 'completed' || run.conclusion !== 'success')
      throw new Error(`Exact revision requires successful ${name}`);
    const jobs = (await request(`${base}/actions/runs/${run.id}/jobs?per_page=100`)).jobs;
    const expected =
      name === 'CI'
        ? [
            'changes',
            'checks',
            'browser',
            'ux (1)',
            'ux (2)',
            'ux (3)',
            'operator (1)',
            'operator (2)',
            'operator (3)',
            'validate',
          ]
        : ['Analyze (actions)', 'Analyze (javascript-typescript)', 'Analyze (python)'];
    for (const job of expected)
      if (
        !jobs.some(
          (row) => row.name === job && row.status === 'completed' && row.conclusion === 'success',
        )
      )
        throw new Error(`Exact revision requires successful job: ${job}`);
  }
  const analyses = await request(
    `${base}/code-scanning/analyses?ref=refs%2Fheads%2Fmain&per_page=100`,
  );
  for (const language of ['actions', 'javascript-typescript', 'python'])
    if (
      !analyses.some(
        (row) => row.commit_sha === sha && row.category === `/language:${language}` && !row.error,
      )
    )
      throw new Error(`Exact revision requires uploaded CodeQL analysis: ${language}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyInstallHead({
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    ref: process.env.GITHUB_REF,
    request: async (path) => {
      const response = await fetch(`https://api.github.com${path}`, {
        headers: {
          Authorization: `Bearer ${process.env.GH_TOKEN}`,
          Accept: 'application/vnd.github+json',
        },
      });
      if (!response.ok) throw new Error(`Release evidence unavailable (HTTP ${response.status})`);
      return response.json();
    },
  });
  console.log('Exact main revision: CI jobs and three uploaded CodeQL analyses passed.');
}
