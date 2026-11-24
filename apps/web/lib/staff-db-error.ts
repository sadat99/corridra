// How the Corridra team's routes (Move records, reply review) turn a refusal from the database into a
// status and a plain message. The functions in those modules write short, plain messages of their own
// ("Verify your authenticator again to continue", "At most five open Moves per request"), and those
// are passed on. A message that comes from Postgres itself names a table, a constraint or a policy, so it
// is replaced by a fixed one. Never the raw text of an unknown error.
const unsafe =
  /permission denied|violates|row-level security|relation "|table "|column "|schema "|constraint|policy|\bfunction\b|\bsyntax\b/i;

export function staffRefusal(error: unknown): { status: number; message: string } | null {
  const e = error as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  const message =
    typeof e?.message === 'string' &&
    e.message.length > 0 &&
    e.message.length <= 160 &&
    !unsafe.test(e.message)
      ? e.message
      : null;
  if (code === '42501') return { status: 403, message: message ?? 'Access denied' };
  if (code === '23514') return { status: 409, message: message ?? 'That change is not allowed' };
  if (code === '23505') return { status: 409, message: 'That already exists' };
  if (['22007', '22008', '22P02'].includes(code))
    return { status: 400, message: 'Check the values and try again' };
  return null;
}

/** The short reference a refused person can quote: the first eight characters of the request's correlation id. */
export function refusalReference(correlationId: string) {
  return correlationId.slice(0, 8).toUpperCase();
}

/**
 * The workspace route's answer to a failure it did not write itself (team desk v4.1, unit D2). Same rule
 * as above: the database's own words never leave the server. Every message here is fixed, says what to do
 * and ends with the reference, so the person can quote it and the team can find the log line by it.
 * `write` picks "make this change" or "open this"; `replyPath` keeps ADR-081 (a reply function that is
 * not installed is "unavailable", never a plain 500).
 */
export function workspaceRefusal(
  error: unknown,
  reference: string,
  { write, replyPath }: { write: boolean; replyPath: boolean },
): { status: 403 | 409 | 500 | 503; message: string; code: string } {
  const raw = (error as { code?: unknown } | null)?.code;
  const code = typeof raw === 'string' && /^[0-9A-Z]{5}$/.test(raw) ? raw : 'UNKNOWN';
  if (replyPath && ['42883', '42P01', '3F000'].includes(code))
    return {
      status: 503,
      code,
      message: `This is not available right now. Try again later. If it continues, quote reference ${reference}.`,
    };
  if (['23514', '23503', '23505', 'P0001', '54000'].includes(code))
    return {
      status: 409,
      code,
      message: `The record or policy changed. Check its status and refresh before retrying. If it is refused again, quote reference ${reference}.`,
    };
  if (code === '42501')
    return {
      status: 403,
      code,
      message: `You cannot ${write ? 'make this change' : 'open this'} in this workspace. Ask a workspace owner and quote reference ${reference}.`,
    };
  return {
    status: 500,
    code,
    message: `The request could not be completed. Try again. If it fails again, quote reference ${reference}.`,
  };
}
