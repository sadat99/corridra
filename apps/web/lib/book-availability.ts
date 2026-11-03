import { customerBooksEnabled } from '@corridra/auth/customer-books';
import { foundations } from './foundations';

// Read installation metadata only after the application switch and its dependencies are on.
export async function booksAvailable(
  readInstalled: () => Promise<boolean>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!customerBooksEnabled(env)) return false;
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
    console.error(JSON.stringify({ event: 'book_availability_check_failed', code }));
    return false;
  }
}

export function booksForPage(): Promise<boolean> {
  return booksAvailable(async () => {
    const services = foundations();
    if (!services) return false;
    await services.ready;
    return services.customerBooks.installed();
  });
}
