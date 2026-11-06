// A short, non-sensitive code that says why a panel could not load, so a person can report it.
// It never carries server text, identifiers or personal details: only an HTTP status, a timeout,
// a network failure or which reply check failed.
export class ReplyError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}
export function loadReason(error: unknown, aborted: boolean): string {
  if (error instanceof ReplyError) return error.reason;
  if (aborted) return 'timed out';
  if (error instanceof SyntaxError) return 'unreadable reply';
  if (error instanceof TypeError) return 'network';
  return 'unexpected';
}
export const withReason = (text: string, reason: string) =>
  text.replace(/\.(?= Try again\.$)/, ` (code: ${reason}).`);
