'use client';
import Link from 'next/link';
import { WorkspaceShell } from '../../components/workspace-shell';
import { AccessState } from '../../components/access-state';
export default function ContributorError() {
  return (
    <WorkspaceShell
      eyebrow="ASSIGNED EXECUTION WORK"
      title="Assigned work is temporarily unavailable."
      compact
    >
      <AccessState kind="unavailable">
        <p>
          A connection or page could not be loaded. Stored assignments remain subject to their
          original scope when access recovers.
        </p>
      </AccessState>
      <a
        className="primary-link"
        href=""
        onClick={(event) => {
          event.preventDefault();
          window.location.reload();
        }}
      >
        Retry assigned work
      </a>
      <nav className="access-options" aria-label="Assigned work recovery">
        <Link className="text-link" href="/signin">
          Choose your sign-in route
        </Link>
        <Link className="text-link" href="/workspace">
          All workspaces and tools
        </Link>
      </nav>
    </WorkspaceShell>
  );
}
