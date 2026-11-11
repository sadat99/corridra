import { fragmentFor, sectionForSlug } from '../../lib/operator-urls';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * W5: the mission a link from a mission page asks a section to open on (`?mission=<id>`). Only a
 * well-formed id counts; anything else is ignored. The value is a hint to choose from what the
 * section already lists, never a way to load or show anything new.
 */
export function missionFromAddress(search: string): string | null {
  const value = new URLSearchParams(search).get('mission');
  return value && uuid.test(value) ? value.toLowerCase() : null;
}

/**
 * The section an operator address names: the `#` part, or else the word after /operator, the same rule the
 * workspace uses to choose what to show. Null when the address names none.
 */
export function missionHintSection(address: Pick<URL, 'pathname' | 'hash'>): string | null {
  const slug = /^\/operator\/([^/]+)$/.exec(address.pathname)?.[1];
  const named = slug === undefined ? null : sectionForSlug(slug);
  return fragmentFor(address.hash, named ?? '') || null;
}

// Hints already used in this page load, one entry per section and mission. A section that is closed and opened
// again (the team shell draws only the section in view) starts empty, so without this the old hint would
// overwrite what the operator had chosen. A full page load is the only reset.
const used = new Set<string>();

/**
 * The mission this section should open on, or null. Each section calls this once its own list has loaded. It
 * answers only for the section the address names, and only the first time in a page load for that section and
 * mission, so the other panel mounted beside it, and a section opened again later, are left as they are.
 */
export function takeMissionHint(
  section: string,
  address: Pick<URL, 'pathname' | 'search' | 'hash'>,
): string | null {
  const asked = missionFromAddress(address.search);
  if (!asked || missionHintSection(address) !== section) return null;
  const key = `${section}:${asked}`;
  if (used.has(key)) return null;
  used.add(key);
  return asked;
}

/** The one plain note shown when the asked-for mission is not among the missions the section lists. */
export const missionHintNote =
  'This mission is not in the list shown here. Choose a mission from the list, or open the mission page again.';
