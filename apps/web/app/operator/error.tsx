'use client';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { operatorSignInPage, operatorSignInPath } from '../../lib/workspace-navigation';
import { operatorPlaceFor } from '../../lib/operator-urls';
import { subscribeToHash } from '../../lib/address-store';
import { WorkspaceShell } from '../../components/workspace-shell';
import { AccessState } from '../../components/access-state';
export default function WorkspaceError() {
  // The server and the hydrating render read '' and link to the plain sign-in page; right after,
  // the link carries the workspace and section this page was showing, and follows a `#` change.
  const address = useSyncExternalStore(
    subscribeToHash,
    () => window.location.href,
    () => '',
  );
  const place = address ? operatorPlaceFor(new URL(address)) : null;
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
        <a
          className="text-link"
          href={place ? operatorSignInPath(place.workspace, place.section) : operatorSignInPage}
        >
          Verify operator access
        </a>
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
