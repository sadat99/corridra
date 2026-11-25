// The words for a team screen that could not read its data (Wave 6, Q-05). One place, so every
// screen says the same thing for the same cause: the person's role, too many requests, or anything
// else (an unavailable service or no connection). The raw server or browser message is never shown.
// Presentation only: the server still decides who may read what.
export type ReadFailureKind = 'denied' | 'later' | 'unavailable';

export function readFailureKind(error: unknown): ReadFailureKind {
  const status = (error as { status?: number } | null)?.status;
  return status === 401 || status === 403 ? 'denied' : status === 429 ? 'later' : 'unavailable';
}

export function readFailureWords(kind: ReadFailureKind): string {
  return kind === 'denied'
    ? 'Your role is not allowed to read this. Ask your workspace owner to review your access.'
    : kind === 'later'
      ? 'There have been too many requests. Try again later.'
      : 'Check your connection and try again.';
}

/**
 * The words for one part of a screen that could not be read while the rest worked (operator desk). The part is named
 * as the person sees it, one name or several ("Erasure requests and problem reports"), so the sentence never needs a
 * verb that must agree with it. An unavailable read says so and that their work is safe; a refusal keeps the role
 * words (and no retry is offered, since asking again cannot change it); too many requests keeps its words and may be
 * retried.
 */
export function partFailureWords(part: string, kind: ReadFailureKind): string {
  return kind === 'unavailable'
    ? `${part} could not be read just now. Your work is safe.`
    : `${part} could not be read. ${readFailureWords(kind)}`;
}

/** "Erasure requests, problem reports and meetings": several part names as one, the first keeping its capital. */
export function joinParts(parts: string[]): string {
  const names = parts.map((part, index) =>
    index === 0 ? part : part.charAt(0).toLowerCase() + part.slice(1),
  );
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Try Again is shown for an unavailable read and for "later"; never for a refusal. */
export const readFailureCanRetry = (kind: ReadFailureKind) => kind !== 'denied';
