'use client';
import Link from 'next/link';
import { WorkspaceShell } from '../../components/workspace-shell';
import { AccessState } from '../../components/access-state';
export default function WorkspaceError() {
  return (
    <WorkspaceShell
      eyebrow="WORKSPACE ACCESS"
      title="The workspace is temporarily unavailable."
      compact
    >
      <AccessState kind="unavailable">
        <p>
          A connection or page could not be loaded. Your stored records remain available when the
          connection recovers.
        </p>
      </AccessState>
      <a
        className="primary-link"
        href=""
        onClick={(event) => {
          event.preventDefault();
          // A full document request rechecks server readiness and retains the selected fragment.
          window.location.reload();
        }}
      >
        Retry workspace
      </a>
      <nav className="access-options" aria-label="Workspace recovery">
        <Link className="text-link" href="/operator/signin">
          Verify operator access
        </Link>
        <Link className="text-link" href="/workspace">
          All workspaces and tools
        </Link>
        <Link className="text-link" href="/">
          Back to Corridra
        </Link>
      </nav>
    </WorkspaceShell>
  );
}
