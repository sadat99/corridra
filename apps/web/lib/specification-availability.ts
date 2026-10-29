import { customerSpecificationConfirmationEnabled } from '@corridra/auth/customer-specification-confirmation';
import { foundations } from './foundations';

// Read installation metadata only after the application switch and its dependencies are on.
export async function specificationConfirmationAvailable(
  readInstalled: () => Promise<boolean>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!customerSpecificationConfirmationEnabled(env)) return false;
  try {
    return await readInstalled();
  } catch {
    return false;
  }
}

export function specificationConfirmationForPage(): Promise<boolean> {
  return specificationConfirmationAvailable(async () => {
    const services = foundations();
    if (!services) return false;
    await services.ready;
    return services.specificationConfirmations.installed();
  });
}
