import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import {
  customerNotificationsEnabled,
  customerNotificationWithdrawalEnabled,
} from '@corridra/auth/customer-notifications';
import { notificationPreferencesInput } from '@corridra/domain/notifications';
import { foundations } from '../../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A person reads and saves their own email choices. The signed-in session decides who is acting; the
// database repeats every rule and stays closed until the owner opens it.
// With `CORRIDRA_PULSE_ENABLED` off the route still answers a signed-in person who wants to switch email off:
// saying no never depends on a switch. Anything that would switch email on is refused (503), as before.
async function services(switchingOff = false) {
  if (!customerNotificationsEnabled() && !(switchingOff && customerNotificationWithdrawalEnabled()))
    throw new DomainError('Email choices are unavailable', 503);
  const services = foundations();
  if (!services) throw new DomainError('Email choices are unavailable', 503);
  await services.ready;
  return services;
}
function failure(error: unknown) {
  if (['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? ''))
    return deliveryError(new DomainError('Email choices are unavailable', 503));
  if (error instanceof z.ZodError)
    return deliveryError(new DomainError(error.issues[0]?.message ?? 'Check your choices', 400));
  return deliveryError(error);
}
const subject = (request: Request) =>
  request.headers.get('x-corridra-customer-subject') ?? undefined;
const issuer = (request: Request) => request.headers.get('x-corridra-customer-issuer') ?? undefined;

export async function GET(request: Request) {
  try {
    const s = await services(true);
    return Response.json(await s.customerNotifications.read(subject(request), issuer(request)), {
      headers: deliveryHeaders,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const body = (await boundedBody(request, 2000)).toString('utf8');
    const value = JSON.parse(body);
    const switchingOff = notificationPreferencesInput.safeParse(value).data?.kinds.length === 0;
    const s = await services(switchingOff);
    if (request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin)
      throw new DomainError('Request origin is not allowed');
    return Response.json(
      await s.customerNotifications.save(value, subject(request), issuer(request)),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
