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

/** The one plain note shown when the asked-for mission is not among the missions the section lists. */
export const missionHintNote = 'This mission is not in the list shown here.';
