// What the command palette shows beside a hit (docs/revamp/specs/navigation-v1/command-palette-search.md, section 4):
// the stage of a mission and the source flag of a company, read from facts the role-checked services already
// returned, plus the check of the search answer on the client. Pure; nothing here reads data or grants access.
// A source record is not verification: nothing here says "verified" or "evidence available". Owner: S4.
import { roadSteps, statusToRoadStep } from '../../components/mr/road-status';
import { stageLabel } from '../../app/operator/[section]/[missionId]/mission-labels';

/** The facts the server may attach to a hit, keyed by `mission:<id>` or `company:<id>`. */
export type PaletteFacts = {
  status?: string;
  source?: 'SOURCE_REPORTED' | 'EXPIRED';
  close?: true;
};
export type FoundHit = { id: string; label: string; detail: string };
export type Found = {
  missions: FoundHit[];
  companies: FoundHit[];
  denied: string[];
  partial: string[];
  facts: Record<string, PaletteFacts>;
};

/** At most this many hits per scope are read from an answer, whatever the server sends. */
export const foundHitLimit = 10;
const textLimit = 200;
const statusShape = /^[A-Z][A-Z_]{0,31}$/;
const factKey =
  /^(?:mission|company):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The first 200 characters, without cutting a surrogate pair in two (no ellipsis: it would join the accessible name). */
function cut(value: string): string {
  if (value.length <= textLimit) return value;
  const code = value.charCodeAt(textLimit - 1);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? textLimit - 1 : textLimit);
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function hits(value: unknown): FoundHit[] {
  if (!Array.isArray(value)) return [];
  const out: FoundHit[] = [];
  for (const item of value) {
    if (out.length === foundHitLimit) break;
    if (!record(item)) continue;
    const { id, label, detail } = item;
    if (typeof id !== 'string' || id === '' || id.length > textLimit) continue;
    if (typeof label !== 'string') continue;
    // A long name or detail is shown cut, not dropped: the match may have come from it.
    out.push({
      id,
      label: cut(label),
      detail: typeof detail === 'string' ? cut(detail) : '',
    });
  }
  return out;
}

const scopeNames = (value: unknown, allowed: readonly string[]) =>
  Array.isArray(value) ? allowed.filter((name) => value.includes(name)) : [];

/**
 * The search answer, checked. Returns null when it is not an answer at all (the caller then shows the search as
 * failed). An answer from an older server has no `facts`: it is read as no facts, so rows show label and detail only.
 */
export function parseFound(value: unknown): Found | null {
  if (!record(value)) return null;
  if (!Array.isArray(value.missions) || !Array.isArray(value.companies)) return null;
  const facts: Record<string, PaletteFacts> = {};
  if (record(value.facts))
    for (const [key, raw] of Object.entries(value.facts)) {
      if (!factKey.test(key) || !record(raw)) continue;
      const fact: PaletteFacts = {};
      if (typeof raw.status === 'string' && statusShape.test(raw.status)) fact.status = raw.status;
      if (raw.source === 'SOURCE_REPORTED' || raw.source === 'EXPIRED') fact.source = raw.source;
      if (raw.close === true) fact.close = true;
      if (fact.status || fact.source || fact.close) facts[key.toLowerCase()] = fact;
    }
  return {
    missions: hits(value.missions),
    companies: hits(value.companies),
    denied: scopeNames(value.denied, ['missions', 'companies']),
    partial: scopeNames(value.partial, ['missions', 'companies']),
    facts,
  };
}

/** Looks a fact up by the entry key (`mission:<id>`), whatever the case of the id. */
export function factFor(found: Found | null, key: string): PaletteFacts | undefined {
  return found?.facts[key.toLowerCase()];
}

export type StageBadge = {
  /** The words in the badge: "Step 2, Find", "Paused", "Cancelled", or the plain status for an unknown one. */
  text: string;
  /** The Road step number (1 to 6), absent for a paused, cancelled or unknown mission. */
  step?: number;
  tone: 'neutral' | 'caution' | 'critical';
  /** The staff stage to put in the detail line, absent when the badge already says it. */
  stage?: string;
};

const stepNames: Record<(typeof roadSteps)[number], string> = {
  define: 'Define',
  find: 'Find',
  compare: 'Compare',
  visit: 'Visit',
  decide: 'Decide',
  follow: 'Follow through',
};

/** The stage badge for a stored mission status, by the same mapping the Road uses (ADR-0071). */
export function stageBadge(status: string): StageBadge {
  const marker = statusToRoadStep(status);
  const staff = stageLabel(status);
  if (marker.kind === 'marker') {
    const step = roadSteps.indexOf(marker.step) + 1;
    return { text: `Step ${step}, ${stepNames[marker.step]}`, step, tone: 'neutral', stage: staff };
  }
  if (marker.reason === 'on_hold') return { text: 'Paused', tone: 'caution' };
  if (marker.reason === 'cancelled') return { text: 'Cancelled', tone: 'critical' };
  return { text: staff, tone: 'neutral' };
}

export type SourceChip = { text: string; tone: 'neutral' | 'caution'; icon: 'document' | 'clock' };

/** The company chip, only where the service reported the source flag. No flag, no chip. */
export function sourceChip(source: PaletteFacts['source']): SourceChip | null {
  if (source === 'SOURCE_REPORTED')
    return { text: 'Source on record', tone: 'neutral', icon: 'document' };
  if (source === 'EXPIRED') return { text: 'Source expired', tone: 'caution', icon: 'clock' };
  return null;
}
