// Home's journey numbers (owner-approved role mockup, 5 Nov 2026). Pure, so every rule is tested without a
// database. Each number is a count of records the person can already open; nothing is estimated, and a
// number that could not be read is null, never zero. No amount, price, contact or private participant
// detail is carried: the counts are all Home ever shows.
import type { MissionExperience } from '@corridra/delivery/report';
import { compareExperienceOffers, isCurrentOffer } from '../experience-offers';
import { factNameFor } from '../quote-cards';

/** Sourcing: the offers that answer the current request, and how far each one is backed. */
export type SourceFacts = {
  quotes: number;
  notComparable: number;
  verified: number;
  evidence: number;
  selfDeclared: number;
};
/** Selling: the companies shortlisted and the visits proposed, confirmed and held. */
export type SellFacts = { shortlisted: number; proposed: number; confirmed: number; held: number };
/** Organising: shared counts for one programme. A number is null where participants have not shared it. */
export type OrganiseFacts = {
  participants: number;
  ready: number;
  invitationsOpen: string | null;
  scheduled: number | null;
  qualifiedHeld: number | null;
  conflicts: number;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
};
/** Taking part: the programmes the person is registered for, in the order the list gives them. */
export type ParticipantFacts = {
  registered: number;
  /** More registrations than the page read: the count is then "or more". */
  more: boolean;
  name: string;
  consented: boolean;
  href: string;
};

const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export type Assignment = { requestId?: unknown; savedResourceId?: unknown; available?: unknown };

/**
 * The saved reports Home may count for one request, or null when it must show no numbers: no saved, available
 * report yet (that is not a zero), a report the person has not saved, or more reports than Home opens (either
 * would make a count partial).
 */
export function savedReportIds(all: Assignment[], requestId: string, cap: number): string[] | null {
  const open = all.filter((a) => a.requestId === requestId && a.available === true);
  const saved = open
    .filter((a) => typeof a.savedResourceId === 'string')
    .map((a) => a.savedResourceId as string);
  if (saved.length === 0 || saved.length < open.length || saved.length > cap) return null;
  return saved;
}

/** Approved experiences from one saved-mission report, ignoring anything that is not well formed. */
export function experiencesOf(report: unknown): MissionExperience[] {
  const missions = list<{ experience?: unknown }>(
    (report as { missions?: unknown } | null | undefined)?.missions,
  );
  return missions
    .map((mission) => mission?.experience)
    .filter(
      (e): e is MissionExperience =>
        !!e &&
        typeof e === 'object' &&
        Array.isArray((e as MissionExperience).quotations) &&
        Array.isArray((e as MissionExperience).shortlist) &&
        Array.isArray((e as MissionExperience).agenda),
    );
}

// Two saved reports of one request show the same records (each report works out what is current when it is
// read), so every quote, company, visit and meeting is counted once, by its own id.
export function sourceFacts(experiences: MissionExperience[], at?: string): SourceFacts {
  const facts: SourceFacts = {
    quotes: 0,
    notComparable: 0,
    verified: 0,
    evidence: 0,
    selfDeclared: 0,
  };
  const seen = new Set<string>();
  for (const e of experiences) {
    const verdicts = compareExperienceOffers(e, at);
    e.quotations.forEach((q, index) => {
      if (!isCurrentOffer(e, q) || seen.has(q.id)) return;
      seen.add(q.id);
      facts.quotes += 1;
      if (verdicts[index]?.status !== 'COMPARABLE ON SUPPLIED TERMS') facts.notComparable += 1;
      const trust = factNameFor(q.claimStatus);
      if (trust === 'Verified') facts.verified += 1;
      else if (trust === 'Evidence available') facts.evidence += 1;
      else if (trust === 'Self-declared') facts.selfDeclared += 1;
    });
  }
  return facts;
}

export function sellFacts(experiences: MissionExperience[]): SellFacts {
  const companies = new Set<string>();
  const proposed = new Set<string>();
  const confirmed = new Set<string>();
  const held = new Set<string>();
  // An agenda item keeps its id across versions; only its newest version counts.
  const newest = new Map<string, MissionExperience['agenda'][number]>();
  for (const e of experiences) {
    for (const target of e.shortlist) companies.add(target.id);
    for (const item of e.agenda) {
      const key = item.itemId || item.id;
      const known = newest.get(key);
      if (!known || item.version > known.version) newest.set(key, item);
    }
  }
  for (const [key, item] of newest) {
    if (item.state === 'PROPOSED') proposed.add(key);
    else if (item.state === 'CONFIRMED') confirmed.add(key);
    // A meeting shared by two agenda items is one held meeting, as the report counts it.
    for (const meeting of list<{ id?: unknown; status?: unknown }>(item.meetings))
      if (meeting.status === 'HELD' && typeof meeting.id === 'string') held.add(meeting.id);
  }
  return {
    shortlisted: companies.size,
    proposed: proposed.size,
    confirmed: confirmed.size,
    held: held.size,
  };
}

type Projection = {
  readiness?: { activeParticipants?: unknown; readyParticipants?: unknown };
  meetings?: { scheduled?: unknown; qualifiedHeld?: unknown };
  conflicts?: unknown;
  context?: { startsAt?: unknown; endsAt?: unknown; timezone?: unknown } | null;
};
type Participants = { invitations?: unknown; nextInvitationAfter?: unknown };
const count = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
const words = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null);

export function organiseFacts(
  projection: Projection | null,
  participants: Participants | null,
): OrganiseFacts | null {
  if (!projection) return null;
  const open = participants
    ? list<{ status?: unknown }>(participants.invitations).filter((i) => i.status === 'ISSUED')
        .length
    : null;
  return {
    participants: count(projection.readiness?.activeParticipants) ?? 0,
    ready: count(projection.readiness?.readyParticipants) ?? 0,
    // One page of invitations is read; more pages make the number a floor, said as "or more".
    invitationsOpen:
      open === null ? null : participants?.nextInvitationAfter ? `${open} or more` : String(open),
    scheduled: count(projection.meetings?.scheduled),
    qualifiedHeld: count(projection.meetings?.qualifiedHeld),
    conflicts: list(projection.conflicts).length,
    startsAt: words(projection.context?.startsAt),
    endsAt: words(projection.context?.endsAt),
    timezone: words(projection.context?.timezone),
  };
}

export function participantFacts(own: unknown): ParticipantFacts | null {
  const registered = list<{ status?: unknown; name?: unknown; consentedAt?: unknown }>(
    (own as { registrations?: unknown } | null | undefined)?.registrations,
  ).filter((r) => r.status === 'REGISTERED' && typeof r.name === 'string' && r.name.length > 0);
  const first = registered[0];
  if (!first) return null;
  return {
    registered: registered.length,
    more: !!(own as { nextAfter?: unknown }).nextAfter,
    name: first.name as string,
    consented: typeof first.consentedAt === 'string' && first.consentedAt.length > 0,
    href: '/account/delegations',
  };
}
