import { execFileSync } from 'node:child_process';

// A shallow clone turns its oldest commit into a "root" that appears to add the whole tree at once.
// Gitleaks fingerprints are commit:file:rule:line, so every .gitleaksignore entry keyed to an older
// commit stops matching and a reviewed false positive resurfaces as a new finding. CI checks out with
// fetch-depth 0, so only local and cloud checkouts hit this. Fetch the rest of the history first.
export function ensureFullHistory(cwd = process.cwd(), run = execFileSync) {
  const git = (args) =>
    run('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'true') return false;
  try {
    git(['fetch', '--unshallow', '--quiet', 'origin']);
  } catch {
    throw new Error(
      'This checkout is shallow and the history could not be completed. Run "git fetch --unshallow" and retry; a shallow scan reports false findings.',
    );
  }
  return true;
}
