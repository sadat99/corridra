import { formEn } from '../../lib/i18n/form-words/en';

// How the request form reads the answers to the three requests it sends (Wave 6, Q-05).
// A failed answer is read only for the sentence the server sent; when there is none (a proxy page, an empty body)
// the status picks a sentence the form already has, so it is translated like the rest and nobody reads a raw
// parser error or faces a blank area. A good status is a success only when the body is readable and is the shape
// the request needs: an unreadable or wrong-shaped body is never reported as saved.
export type Reply = {
  error?: string;
  fields?: Record<string, string[]>;
};

export function wordsFor(
  status: number,
  said: unknown,
  fallback: string = formEn['form.message.intakeNotSaved'],
) {
  if (typeof said === 'string' && said.trim()) return said;
  return status === 429
    ? formEn['form.message.tooMany']
    : status === 409
      ? formEn['form.message.changed']
      : fallback;
}

export async function readFailure(response: Response): Promise<Reply> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Reply) : {};
  } catch {
    return {};
  }
}

export async function readSuccess<T>(
  response: Response,
  valid: (value: unknown) => value is T,
): Promise<T> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(formEn['form.message.notCompleted']);
  }
  if (!valid(value)) throw new Error(formEn['form.message.notCompleted']);
  return value;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A recorded request: a receipt, or a duplicate of one already recorded (which carries no receipt). */
export const isSent = (value: unknown): value is { receipt?: string; duplicate?: boolean } =>
  record(value) && (typeof value.receipt === 'string' || value.duplicate === true);

/** A request held for account activation. */
export const isPendingSaved = (value: unknown): value is { pending: true; expiresAt?: string } =>
  record(value) && value.pending === true;

/** A receipt check: a status and the list of replies. */
export const isReceiptStatus = (
  value: unknown,
): value is { status: string; replies: { body: string; createdAt: string }[] } =>
  record(value) && typeof value.status === 'string' && Array.isArray(value.replies);
