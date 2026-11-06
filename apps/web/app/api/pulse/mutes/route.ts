import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import {
  customerNotificationsEnabled,
  customerNotificationWithdrawalEnabled,
  mailMuteInput,
} from '@corridra/auth/customer-notifications';
import { foundations } from '../../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A person sees the requests they stopped emails about and can stop them again or let them start again. The
// signed-in session decides who is acting and the database repeats every rule: only the person the request
// belongs to, one command id per decision, and turning emails back on needs the sending control open.
// With `CORRIDRA_PULSE_ENABLED` off the route still lists and still stops emails (saying no never depends on a
// switch); anything that turns emails back on is refused (503), exactly as the email choices are.
async function services(resuming = false) {
  if (!customerNotificationsEnabled() && !(!resuming && customerNotificationWithdrawalEnabled()))
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
    return deliveryError(new DomainError(error.issues[0]?.message ?? 'Check your choice', 400));
  return deliveryError(error);
}
const subject = (request: Request) =>
  request.headers.get('x-corridra-customer-subject') ?? undefined;
const issuer = (request: Request) => request.headers.get('x-corridra-customer-issuer') ?? undefined;

export async function GET(request: Request) {
  try {
    const s = await services();
    return Response.json(
      { mutes: await s.customerNotifications.mutes(subject(request), issuer(request)) },
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const value = mailMuteInput.parse(
      JSON.parse((await boundedBody(request, 1000)).toString('utf8')),
    );
    const s = await services(!value.muted);
    if (request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin)
      throw new DomainError('Request origin is not allowed');
    return Response.json(
      await s.customerNotifications.setMute(value, subject(request), issuer(request)),
      {
        headers: deliveryHeaders,
      },
    );
  } catch (error) {
    return failure(error);
  }
}
