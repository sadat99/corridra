import 'server-only';
import { DomainError } from '@corridra/domain';
import { realUseEnabled } from '@corridra/auth/customer-production';
import { foundations } from './foundations';
export const pendingRequestCookieName = 'corridra-pending-request';
export async function pendingRequestServices(request: Request, write = false) {
  if (!realUseEnabled()) throw new DomainError('Real request intake is unavailable', 503);
  const s = foundations();
  if (!s) throw new DomainError('Request intake is unavailable', 503);
  await s.ready;
  if (write && request.headers.get('origin') !== s.config.APP_ORIGIN)
    throw new DomainError('Request origin is not allowed', 403);
  if (write && !request.headers.get('content-type')?.startsWith('application/json'))
    throw new DomainError('JSON required', 415);
  if (write) {
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
  }
  return s;
}
