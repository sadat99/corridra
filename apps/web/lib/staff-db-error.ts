// How the Corridra team's routes (Move records, reply review) turn a refusal from the database into a
// status and a plain message. The functions in those modules write short, plain messages of their own
// ("Verify your authenticator again to continue", "At most five open Moves per request"), and those
// are passed on. A message that comes from Postgres itself names a table, a constraint or a policy, so it
// is replaced by a fixed one. Never the raw text of an unknown error.
const unsafe =
  /permission denied|violates|row-level security|relation "|table "|column "|schema "|constraint|policy|\bfunction\b|\bsyntax\b/i;

/**
 * The one table from a database code to a status and fixed words. Both refusal helpers below read it, so
 * the same code never means two things on two team routes.
 */
const table: Record<string, { status: 400 | 403 | 409; message: string }> = {
  '42501': { status: 403, message: 'Access denied' },
  '23514': { status: 409, message: 'That change is not allowed' },
  '23505': { status: 409, message: 'That already exists' },
  '22007': { status: 400, message: 'Check the values and try again' },
  '22008': { status: 400, message: 'Check the values and try again' },
  '22P02': { status: 400, message: 'Check the values and try again' },
};
const codeOf = (error: unknown) => {
  const raw = (error as { code?: unknown } | null)?.code;
  return typeof raw === 'string' && /^[0-9A-Z]{5}$/.test(raw) ? raw : '';
};

export function staffRefusal(error: unknown): { status: number; message: string } | null {
  const e = error as { message?: unknown } | null;
  const row = table[codeOf(error)];
  if (!row) return null;
  // A short, plain message written by one of our own functions is passed on for a refused or disallowed
  // change; anything that reads like the database's own words is replaced by the fixed ones.
  const written =
    typeof e?.message === 'string' &&
    e.message.length > 0 &&
    e.message.length <= 160 &&
    !unsafe.test(e.message)
      ? e.message
      : null;
  return {
    status: row.status,
    message:
      codeOf(error) === '42501' || codeOf(error) === '23514'
        ? (written ?? row.message)
        : row.message,
  };
}

/** The short reference a refused person can quote: the first eight characters of the request's correlation id. */
export function refusalReference(correlationId: string) {
  return correlationId.slice(0, 8).toUpperCase();
}

/**
 * The workspace route's answer to a failure it did not write itself (team desk v4.1, unit D2): the shared
 * table above, plus the reference, plus what only that route has. No message of the error is ever passed
 * on here, so the database's words cannot leave the server; every refusal says what to do and ends with
 * the reference, which finds the log line. `replyPath` keeps ADR-081 (a reply function that is not
 * installed is "unavailable", never a plain 500).
 */
export function workspaceRefusal(
  error: unknown,
  reference: string,
  { replyPath }: { replyPath: boolean },
): { status: 400 | 403 | 409 | 500 | 503; message: string; code: string } {
  const code = codeOf(error) || 'UNKNOWN';
  if (replyPath && ['42883', '42P01', '3F000'].includes(code))
    return {
      status: 503,
      code,
      message: `This is not available right now. Try again later. If it continues, quote reference ${reference}.`,
    };
  if (['23503', 'P0001', '54000'].includes(code))
    return {
      status: 409,
      code,
      message: `The record or policy changed. Check its status and refresh before retrying. If it is refused again, quote reference ${reference}.`,
    };
  const row = table[code];
  if (!row)
    return {
      status: 500,
      code,
      message: `The request could not be completed. Try again. If it fails again, quote reference ${reference}.`,
    };
  if (row.status === 400) return { status: 400, code, message: row.message };
  return {
    status: row.status,
    code,
    // A refused write or read is not always a question of role: row-level rules refuse owners too.
    message:
      code === '42501'
        ? `This change was not allowed in this workspace. Check you are in the right workspace, or ask a workspace owner. Quote reference ${reference}.`
        : `${row.message}. Quote reference ${reference}.`,
  };
}
