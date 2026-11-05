// Reads the numbers Home's journey cards show (see ./facts.ts), for one signed-in person. Server only and
// read only: it calls the session-checked services the report, Organiser Room and registrations pages
// already call, adds no table, route or write, and never calls a read that records anything (the places
// report is left out for that reason). Each part is behind its existing switch, bounded, and independent:
// a part that is off or fails is null, and its card keeps the plain count it showed before.
import { customerDeliveryEnabled } from '@corridra/auth/customer-assigned-missions';
import { customerParticipantsEnabled } from '@corridra/auth/customer-participants';
import { customerProgrammeProjectionsEnabled } from '@corridra/auth/customer-programme-projections';
import { customerSavedMissionsEnabled } from '@corridra/auth/customer-saved-missions';
import { foundations } from '../foundations';
import { movePageCap } from '../move-constants';
import { followPages } from '../move-pages';
import {
  experiencesOf,
  organiseFacts,
  participantFacts,
  sellFacts,
  sourceFacts,
  type OrganiseFacts,
  type ParticipantFacts,
  type SellFacts,
  type SourceFacts,
} from './facts';

export type JourneyTargets = {
  /** The request the Sourcing card shows, when its newest piece of work is a sent request. */
  source?: string | null;
  sell?: string | null;
  organise?: { workspaceId: string; programmeId: string } | null;
};
export type JourneyFacts = {
  source: SourceFacts | null;
  sell: SellFacts | null;
  organise: OrganiseFacts | null;
  participant: ParticipantFacts | null;
};

/** At most this many approved reports are opened for one request. */
export const reportsPerRequest = 3;

type Assignment = { requestId?: unknown; savedResourceId?: unknown; available?: unknown };

async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

export async function loadJourneyFacts(
  subject: string,
  issuer: string,
  targets: JourneyTargets,
): Promise<JourneyFacts> {
  const none: JourneyFacts = { source: null, sell: null, organise: null, participant: null };
  const services = foundations();
  if (!services) return none;
  try {
    await services.ready;
  } catch {
    return none;
  }

  const wanted = [targets.source, targets.sell].filter((id): id is string => !!id);
  const reports = customerDeliveryEnabled() && customerSavedMissionsEnabled() && wanted.length > 0;

  const experiencesFor = async (requestId: string | null | undefined, all: Assignment[] | null) => {
    if (!requestId || !all) return null;
    const saved = all
      .filter(
        (a) =>
          a.requestId === requestId &&
          a.available === true &&
          typeof a.savedResourceId === 'string',
      )
      .slice(0, reportsPerRequest)
      .map((a) => a.savedResourceId as string);
    // A request with no saved, available report has nothing to count yet: that is not a zero.
    if (saved.length === 0) return null;
    const read = await Promise.all(
      saved.map((resourceId) =>
        attempt(() =>
          services.customerSavedMissions.command(
            { action: 'view', resourceId, audience: 'CLIENT_PROGRESS' },
            subject,
            issuer,
          ),
        ),
      ),
    );
    if (read.some((value) => value === null)) return null;
    const experiences = read.flatMap((value) =>
      experiencesOf((value as { report?: unknown }).report),
    );
    // A report without an approved mission detail has no offers or visits to count.
    return experiences.length > 0 ? experiences : null;
  };

  const [assignments, projection, participants, own] = await Promise.all([
    reports
      ? followPages(async (after) => {
          const page = (await services.customerAssignedMissions.list(
            { pageSize: 25, ...(after ? { after } : {}) },
            subject,
            issuer,
          )) as { assignments?: Assignment[]; nextAfter?: string | null };
          return { items: page.assignments ?? [], nextAfter: page.nextAfter };
        }, movePageCap)
      : null,
    targets.organise && customerProgrammeProjectionsEnabled()
      ? attempt(() =>
          services.customerProgrammeProjections.owner(
            { ...targets.organise!, pageSize: 1 },
            subject,
            issuer,
          ),
        )
      : null,
    targets.organise && customerParticipantsEnabled()
      ? attempt(() =>
          services.customerParticipants.list(
            { ...targets.organise!, pageSize: 25 },
            subject,
            issuer,
          ),
        )
      : null,
    customerParticipantsEnabled()
      ? attempt(() => services.customerParticipants.own({ pageSize: 25 }, subject, issuer))
      : null,
  ]);

  // An assignment list that failed or was cut short cannot prove which reports belong to a request.
  const all = assignments && !assignments.failed && assignments.complete ? assignments.items : null;
  const [source, sell] = await Promise.all([
    experiencesFor(targets.source, all),
    experiencesFor(targets.sell, all),
  ]);
  return {
    source: source ? sourceFacts(source) : null,
    sell: sell ? sellFacts(sell) : null,
    organise: organiseFacts(projection as never, participants as never),
    participant: participantFacts(own),
  };
}
