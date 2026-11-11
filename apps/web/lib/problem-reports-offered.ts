import { foundations } from './foundations';

/**
 * Whether Report a Problem is offered in the menus: its database module and the customer's own word removal are both
 * installed. Server only. Anything that cannot be read (no database, a slow start, a failed read) is not offered, so
 * the menus say Coming soon and the pages stay as they are.
 */
export async function problemReportsOffered() {
  const services = foundations();
  if (!services) return false;
  try {
    await services.ready;
    return await services.problemReportsOffered();
  } catch {
    return false;
  }
}
