import type { PackChangeBody, PackPreview, PackPublished } from './route-pack-editor-publish';

// ADR-093 Phase 3, PR 3b: the page's side of route-pack-publish, the one pack write of the route pack editor. Pure and free of
// value imports (types only come from other files, and they are erased), so the browser tests in tests/operator can load it.
// It builds the bodies of a preview and of a publish, keeps the command id of one publish, and says what an answer means.

/** The pack statuses, in the order the dialog lists them. */
export const packStatusOrder = ['DRAFT', 'TESTING', 'LIMITED', 'ACTIVE', 'PAUSED'] as const;
export type PackStatusValue = (typeof packStatusOrder)[number];
/** The four lists the guided form already draws as boxes. */
export const guidedListKeys = ['missionTypes', 'languages', 'currencies', 'timeZones'] as const;
/** The seven lists the guided form does not draw: short keys typed in one at a time. */
export const keyListKeys = [
  'localities',
  'clusters',
  'evidenceTypes',
  'sourceCategories',
  'coverage',
  'requiredCapabilities',
  'operatorCapabilities',
] as const;
export type GuidedListKey = (typeof guidedListKeys)[number];
export type KeyListKey = (typeof keyListKeys)[number];
export type ListKey = GuidedListKey | KeyListKey;
/** The pack settings a Locked row changes: the eleven lists and the channel. */
export type SettingKey = ListKey | 'channels';
export const isListKey = (key: string): key is ListKey =>
  (guidedListKeys as readonly string[]).includes(key) ||
  (keyListKeys as readonly string[]).includes(key);
export const isKeyListKey = (key: string): key is KeyListKey =>
  (keyListKeys as readonly string[]).includes(key);
export const isSettingKey = (key: string): key is SettingKey =>
  key === 'channels' || isListKey(key);

/** One change of one pack, as the person made it. Nothing in it identifies the person or the reason. */
export type PackEdit =
  | { kind: 'list'; key: ListKey; value: string[] }
  | { kind: 'channel'; manual: boolean }
  | { kind: 'removeSourcing' }
  | { kind: 'status'; status: PackStatusValue };

/**
 * The reason a preview is sent with. The PR 3a schema asks every change for a reason, also a preview, but the person types the
 * one reason on Review, after the preview. A preview writes nothing and records nothing, so it carries this constant; it is
 * never shown, stored, logged or sent with a publish (spec 17A, "Command ids").
 */
export const previewReason = 'Preview of a pack change' as const;

/** The pack version a change writes: the version read plus 1, or 1 for a route with no pack. */
export const nextPackVersion = (packVersion: number | null) => (packVersion ?? 0) + 1;

type Change = PackChangeBody['change'];
function changeOf(
  edit: PackEdit,
  routeId: string,
  packVersion: number | null,
  commandId: string,
  reason: string,
): Change {
  const base = { commandId, routeId, version: nextPackVersion(packVersion), reason };
  switch (edit.kind) {
    case 'status':
      return { kind: 'status', ...base, status: edit.status };
    case 'list':
      return { kind: 'settings', ...base, [edit.key]: [...edit.value] };
    case 'channel':
      return { kind: 'settings', ...base, manualChannel: edit.manual };
    case 'removeSourcing':
      return { kind: 'settings', ...base, removeSourcingProfile: true };
  }
}

/** The body of a preview: a fresh command id every time (never reused, so a changed first step never meets a stored one). */
export function previewBody(
  edit: PackEdit,
  routeId: string,
  packVersion: number | null,
  makeId: () => string,
): PackChangeBody {
  return { mode: 'preview', change: changeOf(edit, routeId, packVersion, makeId(), previewReason) };
}

/** What identifies one publish to the server: the change, the route, the version and the reason as sent (never the id). */
export const packFingerprint = (
  edit: PackEdit,
  routeId: string,
  packVersion: number | null,
  reason: string,
) => JSON.stringify([edit, routeId, nextPackVersion(packVersion), reason.trim()]);
export type PackCommand = { id: string; fingerprint: string };
/**
 * The command id of the next publish. The same change, route, version and reason keep the id (Try Publishing Again is the same
 * command, so nothing is published twice); any change of them, or no earlier publish, makes a new id. `makeId` is
 * `crypto.randomUUID`. A preview never goes through here.
 */
export function nextPackCommand(
  previous: PackCommand | null,
  fingerprint: string,
  makeId: () => string,
): PackCommand {
  return previous && previous.fingerprint === fingerprint
    ? previous
    : { id: makeId(), fingerprint };
}
/** The body of a publish, under the command id kept for it and the reason the person typed (trimmed, as the server keeps it). */
export function publishBody(
  edit: PackEdit,
  routeId: string,
  packVersion: number | null,
  reason: string,
  command: PackCommand,
): PackChangeBody {
  return {
    mode: 'publish',
    change: changeOf(edit, routeId, packVersion, command.id, reason.trim()),
  };
}

// ---- What an answer means -----------------------------------------------------------------------------------------------
/**
 * The last words of a refusal that came after the proposal was saved (routePackWords.notPublished of the domain, pinned to it
 * by a test): propose and decide are two steps, so the server says the proposal stays.
 */
export const notPublishedWords =
  'The proposal was saved but not published. Send the same request again to publish it.';
/**
 * The server's words when the proposal of a publish is too large to review (routePackWords.proposalTooLarge, pinned by a test).
 * A preview is sized with the short internal reason and a publish with the typed one, so near the limit a preview can pass and
 * the publish be refused with these words: the page then says the change is too large, not that it is invalid.
 */
export const proposalTooLargeWords = 'This route pack is too large to review. Shorten long lists.';
/**
 * The code a refusal for size carries. The page keys on it (and on 413), so a change of the server's words never turns a size
 * refusal into "invalid"; the words above stay as the fallback for an answer with only the generic invalid code.
 */
export const packTooLargeCode = 'ROUTE_PACK_TOO_LARGE';
export type PackOutcome =
  /** 200 to a preview. */
  | 'previewed'
  /** 201 or 200 (an exact replay) to a publish. */
  | 'published'
  /** The proposal was saved but the publish was refused: with one person publishing, Try Publishing Again. */
  | 'savedNotPublished'
  /** Before the one-person module: the proposal waits for a second owner in Control Center. */
  | 'proposed'
  | 'stale'
  | 'noChange'
  | 'commandReused'
  | 'blocked'
  | 'invalid'
  | 'tooLarge'
  /** 401 without the authenticator step: the session has ended. */
  | 'signedOut'
  /** 401 STEP_UP_REQUIRED still standing: the person closed the authenticator check. */
  | 'stepUp'
  | 'denied'
  | 'notFound'
  /** A network failure or a server error: nothing is known to be published. */
  | 'offline';
export function packOutcome(
  mode: PackChangeBody['mode'],
  status: number,
  code: string | null,
  error: string | null,
  onePersonPublication: boolean,
): PackOutcome {
  if (status === 200 || status === 201) return mode === 'preview' ? 'previewed' : 'published';
  if (mode === 'publish' && error && error.trim().endsWith(notPublishedWords))
    return onePersonPublication ? 'savedNotPublished' : 'proposed';
  if (status === 409) {
    if (code === 'ROUTE_PACK_PACK_CHANGED') return 'stale';
    if (code === 'ROUTE_PACK_NO_CHANGE') return 'noChange';
    if (code === 'ROUTE_PACK_COMMAND_REUSED') return 'commandReused';
    if (code === 'ROUTE_PACK_LOCKED_CORE_EMPTIED') return 'blocked';
    return 'invalid';
  }
  if (status === 400)
    return code === packTooLargeCode || error?.trim() === proposalTooLargeWords
      ? 'tooLarge'
      : 'invalid';
  if (status === 413) return 'tooLarge';
  if (status === 401) return code === 'STEP_UP_REQUIRED' ? 'stepUp' : 'signedOut';
  if (status === 403) return 'denied';
  if (status === 404) return 'notFound';
  return 'offline';
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const readWarnings = (value: unknown): PackPublished['warnings'] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = (item ?? {}) as { code?: unknown; keys?: unknown };
        return typeof record.code === 'string' && isStringArray(record.keys)
          ? [{ code: record.code as PackPublished['warnings'][number]['code'], keys: record.keys }]
          : [];
      })
    : [];
/** A preview answer this page can draw, or null (then the preview is not claimed). */
export function readPreview(json: unknown): PackPreview | null {
  const r = (json && typeof json === 'object' ? json : null) as Record<string, unknown> | null;
  if (!r || typeof r.newVersion !== 'number' || !Number.isInteger(r.newVersion)) return null;
  const blocked = r.blocked as { code?: unknown; keys?: unknown } | null | undefined;
  return {
    kind: r.kind === 'status' ? 'status' : 'settings',
    statusFrom: (typeof r.statusFrom === 'string'
      ? r.statusFrom
      : null) as PackPreview['statusFrom'],
    statusTo: r.statusTo as PackPreview['statusTo'],
    changedKeys: isStringArray(r.changedKeys) ? r.changedKeys : [],
    baseVersion: typeof r.baseVersion === 'number' ? r.baseVersion : null,
    newVersion: r.newVersion,
    duplicate: r.duplicate === true,
    historicalAssignmentsPreserved:
      typeof r.historicalAssignmentsPreserved === 'number' ? r.historicalAssignmentsPreserved : 0,
    warnings: readWarnings(r.warnings),
    blocked:
      blocked && isStringArray(blocked.keys)
        ? { code: 'ROUTE_PACK_LOCKED_CORE_EMPTIED', keys: blocked.keys }
        : null,
    onePersonPublication: r.onePersonPublication === true,
    removedPolicies: isStringArray(r.removedPolicies) ? r.removedPolicies : [],
  };
}
/** A publish answer this page can read, or null (then the publish is not claimed). */
export function readPublished(json: unknown): PackPublished | null {
  const r = (json && typeof json === 'object' ? json : null) as Record<string, unknown> | null;
  if (!r || typeof r.version !== 'number' || !Number.isInteger(r.version)) return null;
  return {
    version: r.version,
    duplicate: r.duplicate === true,
    warnings: readWarnings(r.warnings),
    removedPolicies: isStringArray(r.removedPolicies) ? r.removedPolicies : [],
  };
}

// ---- The key lists ----------------------------------------------------------------------------------------------------
/** The shape of a pack key the server takes (keyList of packages/missions/src/route-pack-form.ts, pinned by a test). */
export const packKeyPattern = /^[a-z][a-z0-9_.-]{0,79}$/;
export const keyListMax = 50;
export const keyMaxLength = 80;
export type KeyIssue =
  | { kind: 'empty' }
  | { kind: 'characters' }
  | { kind: 'start' }
  | { kind: 'tooLong'; length: number }
  | { kind: 'repeated'; key: string }
  | { kind: 'full' };
/** What stops a typed key from joining the list, checked as typed; null when it may be added. */
export function keyIssue(typed: string, list: readonly string[]): KeyIssue | null {
  const key = typed.trim();
  if (list.length >= keyListMax) return { kind: 'full' };
  if (!key) return { kind: 'empty' };
  if (key.length > keyMaxLength) return { kind: 'tooLong', length: key.length };
  if (!/^[a-z0-9_.-]+$/.test(key)) return { kind: 'characters' };
  if (!packKeyPattern.test(key)) return { kind: 'start' };
  if (list.includes(key)) return { kind: 'repeated', key };
  return null;
}

/** Every value a box list offers: the fixed choices, then any value the pack holds that they lack, so none drops silently. */
export function listOptions(
  fixed: readonly (readonly [string, string])[],
  current: readonly string[],
): [string, string][] {
  const known = new Set(fixed.map(([value]) => value));
  return [
    ...fixed.map(([value, label]) => [value, label] as [string, string]),
    ...current
      .filter((value) => !known.has(value))
      .map((value) => [value, value] as [string, string]),
  ];
}
/** True when the pack contacts companies by hand (the channel MANUAL). */
export const manualOf = (channels: readonly string[] | undefined) => !!channels?.includes('MANUAL');
/** True when an edit sets nothing new against the pack as read (Next stays off, with its reason). */
export function sameAsPack(
  edit: PackEdit,
  configuration: Record<string, unknown> | null,
  status: string | null,
): boolean {
  switch (edit.kind) {
    case 'status':
      return edit.status === status;
    case 'channel':
      return !!configuration && edit.manual === manualOf(configuration.channels as string[]);
    case 'list': {
      const now = (configuration?.[edit.key] as string[] | undefined) ?? [];
      return (
        !!configuration &&
        now.length === edit.value.length &&
        now.every((value) => edit.value.includes(value))
      );
    }
    case 'removeSourcing':
      return false;
  }
}

/** What a Locked row offers the owner: Change for the twelve pack settings, Remove for a filled sourcing profile, or nothing. */
export function packRowAction(
  row: { key: string; part: string; state: string },
  role: string,
  configurationKey: string | undefined,
  /** False on a route with no pack yet: the server refuses a first pack without mission types, so only that row offers Change. */
  hasPack: boolean,
): { kind: 'change'; key: SettingKey } | { kind: 'removeSourcing' } | null {
  if (role !== 'owner' || row.part !== 'Locked') return null;
  if (configurationKey && isSettingKey(configurationKey))
    return hasPack || configurationKey === 'missionTypes'
      ? { kind: 'change', key: configurationKey }
      : null;
  if (row.key === 'sourcing.profile' && row.state === 'FILLED') return { kind: 'removeSourcing' };
  return null;
}
