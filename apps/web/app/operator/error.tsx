'use client';
import Link from 'next/link';
export default function WorkspaceError() {
  return (
    <main id="main" tabIndex={-1} className="operator-page">
      <p className="label">WORKSPACE ACCESS</p>
      <h1>The workspace is temporarily unavailable.</h1>
      <p>
        A connection or page could not be loaded. Your stored records remain available when the
        connection recovers.
      </p>
      <a className="primary-link" href="">
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
    </main>
  );
}
