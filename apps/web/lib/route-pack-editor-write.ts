import type { ContentDocument, GoLiveWarning } from '@corridra/domain/route-pack-standard';
import type { ContentAppendResult } from '@corridra/missions/route-pack-content';

// Types only come from the @corridra packages (they are erased), so a test runner that does not transform package specifiers can
// load this file. ADR-093 Phase 3, PR 2a: what the one write action of the route pack editor, route-pack-facts, takes and
// answers. The handler in api/team-control/[action]/route.ts checks the switch, the 2b marker and the method first, reads the
// body with a bounded reader, then calls the content service; this file holds the name, the types and the projection of the
// answer, so no record id, pack id, route id or actor id leaves the server.
export const routePackFactsAction = 'route-pack-facts' as const;
export const isRoutePackFactsAction = (action: string): action is typeof routePackFactsAction =>
  action === routePackFactsAction;

/** The request body: the whole document at the next version, one command id, one reason (3 to 500 characters). */
export type FactsSaveBody = {
  /** The command id and the idempotency key: a retry of the same save sends the same id. */
  id: string;
  routeId: string;
  /** The facts version being written: the version read plus 1. */
  version: number;
  document: ContentDocument;
  reason: string;
};
/** 201 for a new version, 200 for an exact replay (duplicate, no warnings). */
export type FactsSaved = {
  version: number;
  duplicate: boolean;
  /** Cautions of the go-live check, never refusals. */
  warnings: GoLiveWarning[];
};

export function factsSavedAnswer(
  result: Pick<ContentAppendResult, 'version' | 'duplicate' | 'warnings'>,
): FactsSaved {
  return {
    version: result.version,
    duplicate: result.duplicate,
    warnings: result.warnings.map(({ code, keys }) => ({ code, keys: [...keys] })),
  };
}

// ---- The page's side of the write (ADR-093 Phase 3, PR 2b): what an answer means, its words, and the command id ---------------
// Pure and import-free (no value comes from a @corridra package), so a test runner that does not transform package specifiers
// can load this file.

export type FactsOutcome =
  | 'saved'
  | 'conflict'
  | 'commandReused'
  | 'customKeyConflict'
  | 'invalid'
  | 'tooLarge'
  /** 401 without the authenticator step: the session has ended. */
  | 'signedOut'
  /** 401 STEP_UP_REQUIRED that is still standing: the person closed the authenticator check. */
  | 'stepUp'
  | 'denied'
  | 'notFound'
  /** A network failure or a server error: nothing is known to be saved. */
  | 'offline';
const stepUpRequired = 'STEP_UP_REQUIRED';
/** What a status, a code and the server's words mean for the editor. 200 and 201 are a save (201 new, 200 an exact replay). */
export function factsOutcome(status: number, code?: string | null): FactsOutcome {
  if (status === 200 || status === 201) return 'saved';
  if (status === 409) {
    if (code === 'ROUTE_PACK_CONTENT_CHANGED') return 'conflict';
    if (code === 'ROUTE_PACK_COMMAND_REUSED') return 'commandReused';
    if (code === 'ROUTE_PACK_CUSTOM_KEY_CONFLICT') return 'customKeyConflict';
    // Any other 409 is a refusal the server explains (a go-live check, for one): its words are shown, never "Try again".
    return 'invalid';
  }
  if (status === 400) return code === 'ROUTE_PACK_TOO_LARGE' ? 'tooLarge' : 'invalid';
  if (status === 413) return 'tooLarge';
  if (status === 401) return code === stepUpRequired ? 'stepUp' : 'signedOut';
  if (status === 403) return 'denied';
  if (status === 404) return 'notFound';
  return 'offline';
}
/** Shown when the check is closed without a code (the same words as `stepUpKeptMessage` of lib/ux/step-up.ts). */
const stepUpWords = 'Confirm your authenticator code to finish this. Your changes are kept.';
const keyShape = /custom\.[a-z][a-z0-9_]{0,59}|\b[a-z]+\.[A-Za-z_]+\b/g;
/** The words of a server message with each field key it names replaced by its label (a key with no label is left as it is). */
export function replaceKeysWithLabels(
  message: string,
  label: (key: string) => string | null | undefined,
): string {
  return message.replace(keyShape, (key) => label(key) ?? key);
}
const withoutStop = (text: string) => text.trim().replace(/[.\s]+$/, '');
/**
 * The line a failed save shows, in the words of the spec (9.1). `error` is the server's own words and `label` names a key.
 * Never says that anything was saved; every line says the changes are still here, or that they are kept.
 */
export function outcomeWords(
  outcome: Exclude<FactsOutcome, 'saved' | 'conflict'>,
  error: string | null | undefined,
  label: (key: string) => string | null | undefined = () => null,
): string {
  const server = error ? replaceKeysWithLabels(error, label) : '';
  switch (outcome) {
    case 'invalid':
      return server
        ? `The save was refused: ${withoutStop(server)}. Nothing was saved. Your changes are still here.`
        : 'The save was refused. Nothing was saved. Your changes are still here.';
    case 'customKeyConflict':
      return `${server ? `${withoutStop(server)}. ` : ''}Undo Change on that field, then add it again with another name.`;
    case 'commandReused':
      return 'This save could not be repeated because its details changed. Check the summary, then save again.';
    case 'tooLarge':
      return 'This route content is too large to save. Shorten notes or long lists.';
    case 'signedOut':
      return 'Your session has ended. Sign in again, then open this route and save again.';
    case 'stepUp':
      return stepUpWords;
    case 'denied':
      return 'You can no longer save route facts. Only the owner can.';
    case 'notFound':
    case 'offline':
      return 'Not saved. Your changes are still here. Try again.';
  }
}

/** What identifies one save to the server: the route, the version, the document and the reason (never the id). */
export const commandFingerprint = (body: Omit<FactsSaveBody, 'id'>) =>
  JSON.stringify([body.routeId, body.version, body.document, body.reason]);
export type Command = { id: string; fingerprint: string };
/**
 * The command id of the next send. The same route, version, document and reason keep the id (a retry is the same command, so
 * nothing is saved twice); any change, or no earlier command, makes a new id. `makeId` is `crypto.randomUUID`.
 */
export function nextCommand(
  previous: Command | null,
  body: Omit<FactsSaveBody, 'id'>,
  makeId: () => string,
): Command {
  const fingerprint = commandFingerprint(body);
  return previous && previous.fingerprint === fingerprint
    ? previous
    : { id: makeId(), fingerprint };
}
