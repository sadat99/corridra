// The check every saved commercial report passes before it is shown. It is the report page's own check, moved
// here unchanged so the Meetings page reads reports by the same rule. A report that does not pass throws.
import type { DeliveryReport } from '@corridra/delivery/report';
import { missionStatus } from '@corridra/domain/missions';
import { timeZone } from '@corridra/domain/geography';
import { displayMoney } from '@corridra/domain/locale';
import { currency } from '@corridra/domain/opportunities';
import { requirementFields, offerTerms } from '@corridra/domain/commercial-missions';
function date(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function text(value: unknown): value is string {
  return typeof value === 'string';
}
export function report(value: unknown, id: string): DeliveryReport {
  const wrapper = value as { resourceId?: unknown; report?: DeliveryReport } | null;
  const r = wrapper?.report;
  if (
    wrapper?.resourceId !== id ||
    !r ||
    r.schemaVersion !== 1 ||
    r.audience !== 'CLIENT_PROGRESS' ||
    r.allowExport !== false ||
    !date(r.expiresAt) ||
    !text(r.purpose) ||
    !text(r.attribution) ||
    !Array.isArray(r.missions) ||
    r.missions.length !== 1
  )
    throw new Error('failed');
  for (const m of r.missions) {
    if (
      !text(m.publicationId) ||
      !text(m.title) ||
      !text(m.company) ||
      !text(m.objective) ||
      !text(m.brief) ||
      !text(m.nextAction) ||
      !date(m.dueAt) ||
      !date(m.reviewedAt) ||
      !date(m.updatedAt) ||
      !missionStatus.options.includes(m.status as (typeof missionStatus.options)[number]) ||
      !Array.isArray(m.itinerary) ||
      !Array.isArray(m.totals) ||
      !m.outcomes ||
      ![
        'opportunities',
        'qualified',
        'proposals',
        'contracts',
        'rfqs',
        'samples',
        'heldMeetings',
      ].every(
        (key) =>
          Number.isInteger(m.outcomes[key as keyof typeof m.outcomes]) &&
          m.outcomes[key as keyof typeof m.outcomes] >= 0,
      )
    )
      throw new Error('failed');
    if (
      !m.itinerary.every(
        (mt) =>
          text(mt.label) &&
          text(mt.status) &&
          typeof mt.scheduleChanged === 'boolean' &&
          (mt.startsAt === undefined || date(mt.startsAt)) &&
          (mt.endsAt === undefined || date(mt.endsAt)) &&
          (mt.timezone === undefined || timeZone.safeParse(mt.timezone).success) &&
          (mt.location === undefined || text(mt.location)),
      )
    )
      throw new Error('failed');
    for (const t of m.totals)
      for (const key of [
        'contractMinor',
        'invoiceMinor',
        'confirmedCashMinor',
        'repeatCashMinor',
      ] as const)
        try {
          displayMoney(t[key], t.currency);
        } catch {
          throw new Error('failed');
        }
    const e = m.experience;
    if (e) {
      if (
        e.schemaVersion !== 1 ||
        !Array.isArray(e.shortlist) ||
        !Array.isArray(e.quotations) ||
        !Array.isArray(e.agenda) ||
        !text(e.documentAccess) ||
        (e.requirements !== null &&
          (!e.requirements ||
            !requirementFields.safeParse(e.requirements.fields).success ||
            typeof e.requirements.current !== 'boolean' ||
            !text(e.requirements.sourceKind) ||
            !text(e.requirements.claimStatus)))
      )
        throw new Error('failed');
      if (
        !e.shortlist.every((t) =>
          [
            'id',
            'company',
            'country',
            'fit',
            'rationale',
            'uncertainty',
            'gaps',
            'verification',
          ].every((k) => text(t[k as keyof typeof t])),
        )
      )
        throw new Error('failed');
      if (
        !e.quotations.every(
          (q) =>
            offerTerms.safeParse(q.terms).success &&
            currency.safeParse(q.currency).success &&
            text(q.targetId) &&
            text(q.id) &&
            text(q.uncertainties) &&
            text(q.sourceKind) &&
            text(q.claimStatus) &&
            typeof q.superseded === 'boolean' &&
            typeof q.assignmentCurrent === 'boolean' &&
            Number.isInteger(q.revision) &&
            q.revision > 0,
        )
      )
        throw new Error('failed');
      if (
        !e.agenda.every(
          (a) =>
            text(a.id) &&
            text(a.label) &&
            text(a.state) &&
            text(a.nextAction) &&
            text(a.responsibility) &&
            date(a.dueAt) &&
            Array.isArray(a.meetings) &&
            a.meetings.every(
              (mt) =>
                text(mt.id) &&
                text(mt.status) &&
                typeof mt.scheduleChanged === 'boolean' &&
                (mt.startsAt === undefined || date(mt.startsAt)) &&
                (mt.timezone === undefined || timeZone.safeParse(mt.timezone).success),
            ),
        )
      )
        throw new Error('failed');
    }
    if (
      m.requests &&
      !m.requests.every(
        (q) =>
          text(q.id) &&
          text(q.title) &&
          text(q.instructions) &&
          date(q.dueAt) &&
          text(q.status) &&
          (q.response === undefined || text(q.response)),
      )
    )
      throw new Error('failed');
  }
  return r;
}
