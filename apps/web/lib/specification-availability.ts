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
  } catch (error) {
    // Fail closed, and log only the error code: never the message, which can hold SQL text.
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : undefined;
    console.error(JSON.stringify({ event: 'specification_availability_check_failed', code }));
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
