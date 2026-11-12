import { foundations } from './foundations';

/**
 * Whether the staff list of programme applications is offered in Settings (ADR-080): the programme pages switch is on
 * and the database module has its staff read. Server only. Anything that cannot be read is not offered.
 */
export async function programmeApplicationsOffered() {
  const services = foundations();
  if (!services) return false;
  try {
    await services.ready;
    return await services.staffProgrammeApplications.offered();
  } catch {
    return false;
  }
}
