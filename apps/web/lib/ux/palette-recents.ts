// The command palette's recent items (docs/revamp/specs/navigation-v1/command-palette-search.md, section 6): the
// last few missions and companies a person opened from the palette, kept on this device only, per signed-in person
// and workspace. Only the kind, the id and the name are kept; never the words typed, a detail, a status, an address
// or a time. A recent is a shortcut, never access: the page it opens still decides. Every storage call can throw
// (blocked or full storage), so each is guarded and the palette works without them. Owner: S4.

export type Recent = { kind: 'mission' | 'company'; id: string; label: string };
export type RecentsStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export const recentsPrefix = 'corridra:palette-recents:v1:';
export const recentsLimit = 8;
const rawLimit = 4096;
const labelLimit = 120;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const controls = /[\u0000-\u001f\u007f-\u009f]/g;

function attempt<T>(action: () => T): T | undefined {
  try {
    return action();
  } catch {
    return undefined;
  }
}

/** The storage key for one person in one workspace. */
export function recentsKey(subject: string, workspace: string): string {
  return recentsPrefix + encodeURIComponent(JSON.stringify([subject, workspace]));
}

const usable = (value: string) => value !== '' && value.length <= 128;

function clean(item: unknown): Recent | null {
  if (typeof item !== 'object' || item === null) return null;
  const { kind, id, label } = item as Record<string, unknown>;
  if (kind !== 'mission' && kind !== 'company') return null;
  if (typeof id !== 'string' || !uuid.test(id)) return null;
  if (typeof label !== 'string') return null;
  const text = label.replace(controls, '').trim();
  if (text === '' || text.length > labelLimit) return null;
  return { kind, id: id.toLowerCase(), label: text };
}

/** The saved recents for this person and workspace, most recent first. Invalid saved data is dropped. */
export function readRecents(
  store: RecentsStore | null,
  subject: string,
  workspace: string,
): Recent[] {
  if (!store || !usable(subject) || !usable(workspace)) return [];
  const key = recentsKey(subject, workspace);
  const raw = attempt(() => store.getItem(key));
  if (raw === null || raw === undefined) return [];
  const drop = (): Recent[] => {
    attempt(() => store.removeItem(key));
    return [];
  };
  if (raw.length > rawLimit) return drop();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return drop();
  }
  if (typeof value !== 'object' || value === null) return drop();
  const { v, items } = value as { v?: unknown; items?: unknown };
  if (v !== 1 || !Array.isArray(items)) return drop();
  const out: Recent[] = [];
  for (const entry of items) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { k, id, l } = entry as Record<string, unknown>;
    const recent = clean({
      kind: k === 'm' ? 'mission' : k === 'c' ? 'company' : null,
      id,
      label: l,
    });
    if (!recent || out.some((seen) => seen.kind === recent.kind && seen.id === recent.id)) continue;
    out.push(recent);
    if (out.length === recentsLimit) break;
  }
  return out;
}

function write(store: RecentsStore, subject: string, workspace: string, items: Recent[]) {
  const key = recentsKey(subject, workspace);
  let keep = items;
  const encode = (list: Recent[]) =>
    JSON.stringify({
      v: 1,
      items: list.map((item) => ({
        k: item.kind === 'mission' ? 'm' : 'c',
        id: item.id,
        l: item.label,
      })),
    });
  while (keep.length > 0 && encode(keep).length > rawLimit) keep = keep.slice(0, -1);
  if (keep.length === 0) attempt(() => store.removeItem(key));
  else attempt(() => store.setItem(key, encode(keep)));
}

/** Puts an item first, without repeats, at most eight. Returns the list as it now stands. */
export function rememberRecent(
  store: RecentsStore | null,
  subject: string,
  workspace: string,
  item: Recent,
): Recent[] {
  const current = readRecents(store, subject, workspace);
  const added = clean(item);
  if (!store || !added || !usable(subject) || !usable(workspace)) return current;
  const next = [
    added,
    ...current.filter((seen) => !(seen.kind === added.kind && seen.id === added.id)),
  ].slice(0, recentsLimit);
  write(store, subject, workspace, next);
  return next;
}

/** Removes the saved recents of this person in this workspace (the Clear Recents row). */
export function forgetRecents(store: RecentsStore | null, subject: string, workspace: string) {
  if (!store) return;
  attempt(() => store.removeItem(recentsKey(subject, workspace)));
}

function keysOf(store: RecentsStore): string[] {
  const keys: string[] = [];
  const count = attempt(() => store.length) ?? 0;
  for (let n = 0; n < count; n++) {
    const key = attempt(() => store.key(n));
    if (key?.startsWith(recentsPrefix)) keys.push(key);
  }
  return keys;
}

/** Removes every saved recents list on this device (sign-out). Returns how many were removed. */
export function forgetAllRecents(store: RecentsStore | null): number {
  if (!store) return 0;
  const keys = keysOf(store);
  for (const key of keys) attempt(() => store.removeItem(key));
  return keys.length;
}

/**
 * Removes every saved recents list from this device's own storage (every sign-out path). It never throws: blocked
 * or missing storage holds nothing to remove. Returns how many lists were removed.
 */
export function forgetDeviceRecents(): number {
  try {
    return forgetAllRecents(window.localStorage);
  } catch {
    return 0;
  }
}

/** Removes the lists of everyone except this person, so another person on the same device never sees them. */
export function forgetOtherRecents(store: RecentsStore | null, subject: string): number {
  if (!store) return 0;
  let removed = 0;
  for (const key of keysOf(store)) {
    const owner = attempt(() => {
      const parsed: unknown = JSON.parse(decodeURIComponent(key.slice(recentsPrefix.length)));
      return Array.isArray(parsed) && typeof parsed[0] === 'string' ? parsed[0] : null;
    });
    if (owner === subject) continue;
    attempt(() => store.removeItem(key));
    removed += 1;
  }
  return removed;
}

/**
 * The recents a role may show: a mission recent only where the role may open Missions, a company recent only
 * where it may open Companies. Not an access check (the page decides); it keeps the list honest after a role change.
 */
export function recentsForRole(recents: Recent[], actionKeys: readonly string[]): Recent[] {
  const missions = actionKeys.includes('action:workspace-missions');
  const companies = actionKeys.includes('action:workspace-research');
  return recents.filter((item) => (item.kind === 'mission' ? missions : companies));
}
