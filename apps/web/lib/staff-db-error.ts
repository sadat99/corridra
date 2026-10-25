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
