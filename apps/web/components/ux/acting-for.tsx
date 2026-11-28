import { Suspense } from 'react';
import { activeWorkspaces } from '../../lib/workspace-choice';
import { ActingForMenu } from './acting-for-menu';

/**
 * Acting for (customer account v18): the businesses the person can start requests for, read by the same list the
 * account has always used. It never throws: with nothing to read, or with the workspaces module off, nothing is drawn.
 * Choosing grants nothing; the request page and its API repeat the identity and role checks.
 */
async function ActingForList() {
  let rows;
  try {
    // Loaded here, as the closed-account gate does, so the frame itself carries no server-only import.
    const { foundations } = await import('../../lib/foundations');
    const s = foundations();
    if (!s) return null;
    await s.ready;
    rows = await s.customerWorkspaces.list();
  } catch {
    return null;
  }
  const workspaces = activeWorkspaces(rows).map((w) => ({ id: w.id, name: w.name, role: w.role }));
  return workspaces.length === 0 ? null : <ActingForMenu workspaces={workspaces} />;
}

export function ActingFor() {
  return (
    <Suspense fallback={null}>
      <ActingForList />
    </Suspense>
  );
}
