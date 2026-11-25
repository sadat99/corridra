import Link from 'next/link';
import { WorkspaceShell } from './workspace-shell';

/**
 * What a helper sees where assigned-task access is not configured: the task page and its sign-in page show
 * this one page, so the two cannot drift. It collects nothing.
 */
export function ContributorUnavailable() {
  return (
    <WorkspaceShell eyebrow="Assigned work" title="Your assigned tasks." compact>
      <p>
        Assigned-task access is not configured in this environment. Keep the invitation supplied by
        the Corridra team.
      </p>
      <Link prefetch={false} className="text-link" href="/network">
        How assigned work works
      </Link>
      <Link prefetch={false} className="text-link" href="/signin">
        Other sign-in options
      </Link>
      <Link prefetch={false} className="text-link" href="/">
        Corridra Home
      </Link>
    </WorkspaceShell>
  );
}
