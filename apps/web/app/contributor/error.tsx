'use client';
import { AccessOptions } from '../../components/access-options';
import { accessHelp } from '../../lib/access-doors';
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
        Retry Assigned Work
      </a>
      <AccessOptions {...accessHelp.contributorError} />
    </WorkspaceShell>
  );
}
