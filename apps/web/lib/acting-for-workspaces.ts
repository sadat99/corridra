import { foundations } from './foundations';
import { activeWorkspaces } from './workspace-choice';

export type ActingForChoice = { id: string; name: string; role: 'owner' | 'admin' | 'member' };

/**
 * The businesses the signed-in person can start requests for, for the Acting for menu (customer account v18). Server
 * only: the list is read under the current provider session, as the account has always read it. Anything that cannot
 * be read (no database, a slow start, the workspaces module off) is an empty list, so the menu is simply not drawn.
 * The result is for display; choosing one grants nothing, and the request page and its API check the role again.
 */
export async function actingForWorkspaces(): Promise<ActingForChoice[]> {
  const services = foundations();
  if (!services) return [];
  try {
    await services.ready;
    const rows = await services.customerWorkspaces.list();
    return activeWorkspaces(rows).map((w) => ({ id: w.id, name: w.name, role: w.role }));
  } catch {
    return [];
  }
}
