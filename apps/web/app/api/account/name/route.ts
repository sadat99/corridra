import { DomainError } from '@corridra/domain';
import { z } from 'zod';
import {
  accountNameRequestHash,
  characters,
  personalProfileNoWorkspaceMessage,
  personalTextRefused,
} from '@corridra/auth/customer-personal-profiles';
import { foundations } from '../../../../lib/foundations';
import { boundedBody, deliveryHeaders } from '../../../../lib/delivery-http';
import { accountSecurityCapabilities } from '../../../../lib/account-security-capabilities';
import {
  accountProviderGuard,
  providerUnavailableCode,
} from '../../../../lib/account-provider-guard';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ADR-086. Change the display name the sign-in provider holds, server side only, through the pinned SDK server method
// updateUser({ name }). The auth proxy allowlist is not widened. Checks run in this order: origin, the capability
// (404 while off), JSON, size, the name, the fresh provider session, then in the database the account state, the workspace,
// the hourly budget and a replay of the same command (the same command with another name is refused). The name is never
// logged, and the change is recorded in the account security record by command id with a keyed hash of the name.
// A name of 1 to 100 characters (code points), with no control character (C0 or C1) and no line or paragraph separator.
const input = z
  .object({
    commandId: z.uuid(),
    name: z
      .string()
      .trim()
      .refine((v) => characters(v) >= 1 && characters(v) <= 100 && !personalTextRefused.test(v)),
  })
  .strict();
const answer = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: deliveryHeaders });
const refuse = (status: number, code: string, error: string) => answer(status, { error, code });
// Logs carry a code and a status only.
const log = (code: string, status: number) => console.warn(JSON.stringify({ code, status }));

export async function POST(request: Request) {
  try {
    const s = foundations();
    if (!s) return refuse(503, 'module_unavailable', 'Account changes are not available yet.');
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      return refuse(403, 'origin_refused', 'Request origin is not allowed');
    // A control that is not proven yet answers 404 before anything else is read, as if the route did not exist.
    if (!accountSecurityCapabilities.updateName) return refuse(404, 'not_found', 'Not found');
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return refuse(415, 'json_required', 'JSON required');
    let body: unknown;
    try {
      body = JSON.parse((await boundedBody(request, 1024)).toString('utf8'));
    } catch (error) {
      if (error instanceof DomainError && error.status === 413)
        return refuse(413, 'too_large', 'Request is too large');
      return refuse(400, 'invalid', 'Enter a name of 1 to 100 characters.');
    }
    const parsed = input.safeParse(body);
    if (!parsed.success) return refuse(400, 'invalid', 'Enter a name of 1 to 100 characters.');
    const { auth, subject, issuer } = await accountProviderGuard(request);
    await s.ready;
    const { commandId, name } = parsed.data;
    const requestHash = accountNameRequestHash(s.config.AUTH_SECRET, name);
    const pre = await s.customerPersonalProfiles.nameChangePreflight(
      commandId,
      requestHash,
      subject,
      issuer,
    );
    if (pre.limited)
      return refuse(429, 'rate_limited', 'Too many name changes. Try again in an hour.');
    if (pre.noted) return answer(200, { commandId, replayed: true });
    let result: { error?: { status?: number } | null } | null;
    try {
      result = (await auth.updateUser({ name })) as typeof result;
    } catch {
      result = { error: { status: 502 } };
    }
    if (result?.error) {
      const status = result.error.status ?? 502;
      log('account_name_provider_error', status);
      if (status === 401) return refuse(401, 'signed_out', 'Sign in to continue');
      if (status >= 500 || status === 429)
        return refuse(
          503,
          providerUnavailableCode,
          'We cannot reach the sign-in service. Your name was not changed. Try again in a few minutes.',
        );
      return refuse(400, 'provider_refused', 'Your name was not changed. Check it and try again.');
    }
    try {
      await s.customerPersonalProfiles.noteSecurityChange(
        commandId,
        'name_changed',
        requestHash,
        subject,
        issuer,
      );
    } catch (error) {
      // The provider already changed the name: never a 500 for a change that happened.
      const reason = (error as { code?: unknown }).code;
      console.warn(
        JSON.stringify({
          code: 'account_name_missing_audit',
          status: 200,
          reason:
            typeof reason === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(reason) ? reason : 'unknown',
        }),
      );
    }
    return answer(200, { commandId, replayed: false });
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (error instanceof DomainError)
      return refuse(error.status, error.code ?? 'refused', error.message);
    if (['42P01', '3F000', '42883'].includes(code))
      return refuse(503, 'module_unavailable', 'Personal details are not available yet.');
    if (code === '23514' && (error as Error).message === personalProfileNoWorkspaceMessage)
      return refuse(409, 'no_workspace', personalProfileNoWorkspaceMessage);
    if (code === '23514' && (error as Error).message === 'Command conflicts with original request')
      return refuse(409, 'command_conflict', 'This change conflicts with an earlier one. Reload.');
    if (code === '42501') return refuse(403, 'account_inactive', 'This account cannot be changed.');
    log('account_name_failed', 500);
    return refuse(500, 'failed', 'The request could not be completed. Please try again.');
  }
}
