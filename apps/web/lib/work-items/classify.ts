// Classification is explicit only (docs/revamp/specs/work-items.md). A family comes from a stored field
// that names it, or the item is UNCLASSIFIED. Titles, companies, emails, countries and labels are never
// read here.
import { missionDraftObjectives, type MissionDraftFamily } from '@corridra/domain/mission-drafts';
import type { WorkFamily } from './types';

const familyOfDraft: Record<MissionDraftFamily, WorkFamily> = {
  BUYERS_PARTNERS: 'SELL',
  SUPPLIERS_PRODUCTS: 'SOURCE',
  DELEGATION: 'ORGANISE',
  OTHER: 'UNCLASSIFIED',
};

/** The family a stored draft names. An unknown value is UNCLASSIFIED, never a guess. */
export function classifyDraftFamily(family: string): WorkFamily {
  return Object.hasOwn(familyOfDraft, family)
    ? familyOfDraft[family as MissionDraftFamily]
    : 'UNCLASSIFIED';
}

/**
 * The family a request's stored objective names, only when that objective appears in exactly one family
 * of the table. The table is read at run time, never copied.
 */
export function classifyObjective(
  objective: unknown,
  table: Record<string, readonly string[]> = missionDraftObjectives,
): WorkFamily {
  if (typeof objective !== 'string') return 'UNCLASSIFIED';
  const owners = Object.keys(table).filter((family) => table[family]!.includes(objective));
  return owners.length === 1 ? classifyDraftFamily(owners[0]!) : 'UNCLASSIFIED';
}
