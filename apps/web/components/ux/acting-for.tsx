import { Suspense } from 'react';
import { ActingForMenu } from './acting-for-menu';

/**
 * Acting for (customer account v18): the businesses the person can start requests for, read by the same list the
 * account has always used. It never throws: with nothing to read, or with the workspaces module off, nothing is drawn.
 * Choosing grants nothing; the request page and its API repeat the identity and role checks.
 */
async function ActingForList() {
  // Loaded here, as the closed-account gate loads its reads, so the frame itself carries no server-only import.
  let workspaces;
  try {
    const { actingForWorkspaces } = await import('../../lib/acting-for-workspaces');
    workspaces = await actingForWorkspaces();
  } catch {
    return null;
  }
  return workspaces.length === 0 ? null : <ActingForMenu workspaces={workspaces} />;
}

export function ActingFor() {
  return (
    <Suspense fallback={null}>
      <ActingForList />
    </Suspense>
  );
}
