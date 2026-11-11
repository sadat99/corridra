// The Programme Room (Lane 10 of the UX update): pure rules, tested without a browser. The room only
// regroups panels that already exist, so everything here is a reading of records the participants panel and the
// programme projection already return. A step is marked from a record or it is a plain grey segment; nothing is
// estimated.
export const programmeRoadSteps = [
  { key: 'setup', label: 'Set up' },
  { key: 'invite', label: 'Invite' },
  { key: 'register', label: 'Register' },
  { key: 'plan', label: 'Plan the days' },
  { key: 'run', label: 'Run' },
  { key: 'report', label: 'Report' },
] as const;
export type ProgrammeStepKey = (typeof programmeRoadSteps)[number]['key'];
export type ProgrammeStepState = 'done' | 'now' | 'later' | 'notTracked';

type InvitationStatus = 'ISSUED' | 'USED' | 'UNAVAILABLE';
type RegistrationStatus = 'REGISTERED' | 'REVOKED' | 'WITHDRAWN';

/** What the participants panel returned for one programme. `more` is true when a list had a next page. */
export type Boarding = {
  invitations: { status: InvitationStatus }[];
  registrations: { status: RegistrationStatus }[];
  moreInvitations: boolean;
  moreRegistrations: boolean;
};

export type BoardingCounts = {
  /** Invitations read, and how many of them were used. */
  invitations: number;
  used: number;
  open: number;
  registered: number;
  /** False when a list was longer than the page, so a total would be a guess. */
  complete: boolean;
};

export function boardingCounts(boarding: Boarding): BoardingCounts {
  const used = boarding.invitations.filter((i) => i.status === 'USED').length;
  const open = boarding.invitations.filter((i) => i.status === 'ISSUED').length;
  return {
    invitations: boarding.invitations.length,
    used,
    open,
    registered: boarding.registrations.filter((r) => r.status === 'REGISTERED').length,
    complete: !boarding.moreInvitations && !boarding.moreRegistrations,
  };
}

/**
 * The words for the boarding line. Counts are always out of a total; when a list was longer than the
 * page the total is not known, and the line says "Not measured yet" instead of a number that is wrong.
 */
export function boardingLine(counts: BoardingCounts | null): string {
  if (!counts) return 'Not measured yet';
  if (!counts.complete) return 'Not measured yet: there are more participants than are loaded here';
  if (counts.invitations === 0) return 'No invitations yet';
  return `${counts.used} of ${counts.invitations} invitations used`;
}

/**
 * Where the programme stands, only from records the room can read. Set up is done because the programme
 * exists. Invite and Register come from the invitations and consented registrations. The days, the run
 * and the report are read by panels this room does not summarise, so they are "not tracked yet". At most
 * one step is "now".
 */
export function programmeRoadStates(
  counts: BoardingCounts | null,
  projection?: ProgrammePlanSource | null,
): Record<ProgrammeStepKey, ProgrammeStepState> {
  const states = boardingRoadStates(counts);
  // Plan the days is done only from a record: the projection lists at least one activity, every one is
  // scheduled and none needs review. Without a projection, or with any other reading, it stays "not tracked".
  // Never "now": the boarding steps own the one current stage.
  if (projection && planIsDone(projection.agenda)) states.plan = 'done';
  return states;
}

/** The part of the programme projection the road reads: the agenda only. */
export type ProgrammePlanSource = {
  agenda: { scheduled?: boolean; needsReview: boolean | null; status?: string }[];
};
/** A cancelled activity is no longer part of the plan, as the projection's overlap check also treats it. */
const live = <T extends { status?: string }>(agenda: T[]) =>
  agenda.filter((a) => a.status !== 'CANCELLED');
function planIsDone(agenda: ProgrammePlanSource['agenda']): boolean {
  const items = live(agenda);
  return items.length > 0 && items.every((a) => a.scheduled === true && a.needsReview === false);
}

function boardingRoadStates(
  counts: BoardingCounts | null,
): Record<ProgrammeStepKey, ProgrammeStepState> {
  const states: Record<ProgrammeStepKey, ProgrammeStepState> = {
    setup: 'done',
    invite: 'notTracked',
    register: 'notTracked',
    plan: 'notTracked',
    run: 'notTracked',
    report: 'notTracked',
  };
  if (!counts) return states;
  if (counts.invitations === 0 && counts.complete) {
    states.invite = 'now';
    states.register = 'later';
    return states;
  }
  // A list longer than the page is only a sample. An invitation still open proves Register is now; that no
  // invitation is open, or that everyone registered, cannot be known from a sample, so it is not marked.
  if (!counts.complete) {
    states.invite = counts.invitations > 0 ? 'done' : 'notTracked';
    states.register = counts.open > 0 ? 'now' : 'notTracked';
    return states;
  }
  states.invite = 'done';
  states.register = counts.open > 0 || counts.registered === 0 ? 'now' : 'done';
  return states;
}

/**
 * The stage bar (approved work rooms, 5 Nov 2026; CX-06). The same reading as `programmeRoadStates`, drawn the
 * way every room draws a stage: a stage with a record is done or current, and any other stage is a plain grey
 * segment with no words. It never says "not tracked yet" and never guesses a later stage.
 */
export type ProgrammeStageShown = 'done' | 'now' | 'grey';
export function programmeStage(
  counts: BoardingCounts | null,
  projection?: ProgrammePlanSource | null,
): {
  states: Record<ProgrammeStepKey, ProgrammeStageShown>;
  current: ProgrammeStepKey | null;
} {
  const road = programmeRoadStates(counts, projection);
  const states = {} as Record<ProgrammeStepKey, ProgrammeStageShown>;
  let current: ProgrammeStepKey | null = null;
  for (const step of programmeRoadSteps) {
    const state = road[step.key];
    states[step.key] = state === 'done' || state === 'now' ? state : 'grey';
    if (state === 'now') current = step.key;
  }
  return { states, current };
}

/** The one next step the room offers, read from the boarding counts only. `target` is the view it opens. */
export type ProgrammeNextStep = { title: string; target: 'people' | 'plan' };
export function programmeNextStep(counts: BoardingCounts | null): ProgrammeNextStep {
  if (!counts) return { title: 'See where your participants stand', target: 'people' };
  if (!counts.complete) return { title: 'Review your participants', target: 'people' };
  if (counts.invitations === 0) return { title: 'Invite your participants', target: 'people' };
  if (counts.open > 0)
    return { title: 'Get the remaining participants registered', target: 'people' };
  if (counts.registered === 0)
    return { title: 'Get your participants registered', target: 'people' };
  return { title: 'Plan the days', target: 'plan' };
}

/** What the Overview's "At a glance" reads from the programme projection: counts only, never a record. */
export type ProgrammeGlanceSource = {
  readiness: { activeParticipants: number; readyParticipants: number; definition?: string };
  meetings: {
    state: 'NOT_SHARED' | 'UNAVAILABLE' | 'AVAILABLE' | 'PARTIAL';
    scheduled: number | null;
    qualifiedHeld: number | null;
    /** How many active participants allowed their shared missions to be counted. */
    participantsSharing?: number;
  };
  agenda: { scheduled?: boolean; needsReview: boolean | null; status?: string }[];
  conflicts: unknown[];
  /** Present on the real projection; the readiness definition is the system's own wording for "ready". */
  context?: { startsAt: string; endsAt: string; timezone: string } | null;
};
export type GlanceTile = {
  key: string;
  /** The number as text, or the words for a count that cannot be given. Never a zero for an unknown. */
  value: string;
  known: boolean;
  of?: string;
  label: string;
};
const notMeasured = 'Not measured yet';

/**
 * The tiles of "At a glance". The boarding tiles come from the participants panel's read and say "Not measured
 * yet" when that read was partial or failed. The readiness and meeting tiles come from the projection; they are
 * left out where the projections are off, say "Not measured yet" while it cannot be read, and the meeting
 * tiles say "Not shared" where no participant has allowed counts (C-02, C-07): never zero for an unknown.
 */
export function programmeGlance(
  counts: BoardingCounts | null,
  projection: ProgrammeGlanceSource | null,
  projectionsOn: boolean,
): GlanceTile[] {
  const boarded = counts?.complete ? counts : null;
  const count = (value: number | null | undefined, words = notMeasured) =>
    value === null || value === undefined
      ? { value: words, known: false }
      : { value: String(value), known: true };
  const tiles: GlanceTile[] = [
    { key: 'registered', ...count(boarded?.registered), label: 'registered' },
    { key: 'open', ...count(boarded?.open), label: 'invitations open' },
  ];
  if (!projectionsOn) return tiles;
  const r = projection?.readiness;
  tiles.push({
    key: 'ready',
    ...count(r?.readyParticipants),
    of: r ? `of ${r.activeParticipants}` : undefined,
    label: 'participants ready',
  });
  // A meeting count is a total only when every shared link was read (AVAILABLE). A partial read leaves links out,
  // so even its zero is not a total: it is not measured yet, as on Home (organiseFacts). Results explains coverage.
  const m = projection?.meetings;
  const complete = m?.state === 'AVAILABLE';
  const meetingWords = m?.state === 'NOT_SHARED' ? 'Not shared' : notMeasured;
  tiles.push(
    {
      key: 'scheduled',
      ...count(complete ? m.scheduled : null, meetingWords),
      label: 'meetings scheduled',
    },
    {
      key: 'held',
      ...count(complete ? m.qualifiedHeld : null, meetingWords),
      label: 'qualified meetings held',
    },
  );
  return tiles;
}

/**
 * What the meeting tiles cover, said beside them as Results says it (ADR-075 §5): counts come only from missions
 * participants chose to share and allowed to be counted, so they never stand for all private activity.
 */
export function meetingCoverage(projection: ProgrammeGlanceSource | null): string | null {
  const m = projection?.meetings;
  if (!projection || m?.state !== 'AVAILABLE' || m.participantsSharing === undefined) return null;
  const of = projection.readiness.activeParticipants;
  return `Meetings from ${m.participantsSharing} of ${of} participants who allowed counting; not all activity.`;
}

/** What the checklist reads from the existing terms 'state' view: whether terms exist and the places set. */
export type ChecklistTerms = {
  termsSet: boolean;
  minimum: number | null;
  maximum: number | null;
};
/** Reads the checklist's terms facts out of the terms 'state' view; the shape is the one `parseState` returns. */
export function checklistTermsFrom(state: {
  terms: { current: unknown | null };
  places: { minimum: number | null; maximum: number | null };
}): ChecklistTerms {
  return {
    termsSet: state.terms.current !== null,
    minimum: state.places.minimum,
    maximum: state.places.maximum,
  };
}
export type ChecklistFact = {
  key: string;
  fact: string;
  /** From a record, or "Not measured yet" when the record is not loaded or its switch is off. */
  value: string;
  /** False for "Not measured yet", so the row can be drawn quietly. Never a zero for an unknown. */
  known: boolean;
  /** The system's own wording, shown where one exists. */
  note?: string;
};

function formatDay(iso: string, timezone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso.slice(0, 10);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: timezone,
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/**
 * The programme checklist: plain facts read from records the room already has, each one a value or "Not measured
 * yet". There is deliberately no overall "ready" verdict (GAP-039): the organiser reads the facts. Registered
 * counts need the whole participants list (a partial page is only a sample). The places and terms facts need the
 * terms read, the dates, activities, overlaps, review flags and readiness need the programme projection.
 */
export function programmeChecklist(
  counts: BoardingCounts | null,
  projection: ProgrammeGlanceSource | null,
  terms: ChecklistTerms | null,
): ChecklistFact[] {
  const registered = counts?.complete ? counts.registered : null;
  const fact = (
    key: string,
    label: string,
    value: string | null,
    note?: string,
  ): ChecklistFact => ({
    key,
    fact: label,
    value: value ?? notMeasured,
    known: value !== null,
    ...(note && value !== null ? { note } : {}),
  });
  const of = (n: number | null, total: number) => (n === null ? null : `${n} of ${total}`);
  const agenda = projection ? live(projection.agenda) : null;
  const scheduled = agenda ? agenda.filter((a) => a.scheduled === true).length : null;
  const reviewing = agenda ? agenda.filter((a) => a.needsReview === true).length : null;
  // A review flag of null is not "no": it is unknown, so the count is not given unless it is complete.
  const reviewKnown = agenda
    ? agenda.every((a) => a.scheduled !== true || a.needsReview !== null)
    : false;
  const r = projection?.readiness;
  const context = projection?.context;
  return [
    fact('registered', 'Registered', registered === null ? null : String(registered)),
    fact(
      'capacity',
      'Registered against the maximum places',
      !terms
        ? null
        : terms.maximum === null
          ? 'No maximum set'
          : registered === null
            ? null
            : `${registered} of ${terms.maximum}`,
    ),
    fact(
      'minimum',
      'Registered against the minimum to run',
      !terms
        ? null
        : terms.minimum === null
          ? 'No minimum set'
          : registered === null
            ? null
            : `${registered} of ${terms.minimum}`,
    ),
    fact('terms', 'Terms', !terms ? null : terms.termsSet ? 'Set' : 'Not set yet'),
    fact(
      'dates',
      'Programme dates',
      !projection
        ? null
        : context
          ? `${formatDay(context.startsAt, context.timezone)} to ${formatDay(context.endsAt, context.timezone)}`
          : context === null
            ? 'Not set yet'
            : null,
    ),
    fact(
      'activities',
      'Activities scheduled',
      agenda === null || scheduled === null
        ? null
        : agenda.length === 0
          ? 'No activities yet'
          : of(scheduled, agenda.length),
    ),
    fact(
      'overlaps',
      'Attendee overlaps',
      !projection
        ? null
        : projection.conflicts.length === 0
          ? 'None found'
          : String(projection.conflicts.length) +
            plural(projection.conflicts.length, ' pair overlaps', ' pairs overlap'),
    ),
    fact(
      'review',
      'Activities needing review',
      agenda === null || reviewing === null
        ? null
        : reviewing > 0 || reviewKnown
          ? String(reviewing)
          : null,
    ),
    fact(
      'ready',
      'Participants ready',
      r ? `${r.readyParticipants} of ${r.activeParticipants}` : null,
      r?.definition,
    ),
  ];
}

/** One thing that needs the organiser, with the view that resolves it. */
export type AttentionItem = {
  key: 'overlaps' | 'review' | 'readiness';
  title: string;
  detail: string;
  action: string;
  target: 'plan' | 'people';
  tone: 'warning' | 'info';
};
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "Needs your attention", from the projection's own flags: overlaps, changed dates and readiness. */
export function programmeAttention(projection: ProgrammeGlanceSource | null): AttentionItem[] {
  if (!projection) return [];
  const items: AttentionItem[] = [];
  const overlaps = projection.conflicts.length;
  if (overlaps > 0)
    items.push({
      key: 'overlaps',
      title: `${overlaps} ${plural(overlaps, 'pair of activities overlaps', 'pairs of activities overlap')}`,
      detail: 'The same attendee is in both at once.',
      action: 'Open Programme and Meetings',
      target: 'plan',
      tone: 'warning',
    });
  const review = projection.agenda.filter((a) => a.needsReview === true).length;
  if (review > 0)
    items.push({
      key: 'review',
      title: `${review} ${plural(review, 'activity needs', 'activities need')} review`,
      detail: 'The programme dates changed after it was planned.',
      action: 'Review',
      target: 'plan',
      tone: 'info',
    });
  const { activeParticipants, readyParticipants } = projection.readiness;
  const waiting = activeParticipants - readyParticipants;
  if (waiting > 0)
    items.push({
      key: 'readiness',
      title: `${waiting} ${plural(waiting, 'participant is', 'participants are')} not ready yet`,
      detail: 'A place, eligibility, terms or a shared company profile is still needed.',
      action: 'Open Participants',
      target: 'people',
      tone: 'info',
    });
  return items;
}

/** The views of a programme room, in order. A view appears only where its panel is on. */
export const roomLenses = [
  { key: 'overview', label: 'Overview' },
  { key: 'people', label: 'People' },
  { key: 'plan', label: 'Plan and report' },
  { key: 'terms', label: 'Terms and places' },
  { key: 'money', label: 'Money' },
] as const;
export type RoomLensKey = (typeof roomLenses)[number]['key'];

/**
 * The five groups the organiser room shows (Wave 5), in order. Each group holds existing views, kept under their
 * own section ids: nothing is removed or moved. A group appears only where one of its views has a panel.
 */
export const roomGroups = [
  { key: 'overview', label: 'Overview', members: ['overview'] },
  {
    key: 'people',
    label: 'Participants and eligibility',
    members: ['people', 'companies', 'page'],
  },
  { key: 'plan', label: 'Programme and meetings', members: ['plan', 'agenda'] },
  { key: 'terms', label: 'Terms and fees', members: ['terms', 'money'] },
  { key: 'results', label: 'Results', members: ['results'] },
] as const;
export type RoomGroupKey = (typeof roomGroups)[number]['key'];
/** The words a view keeps as the name of its section inside a group. */
export const roomViewLabels = {
  overview: 'Overview',
  people: 'People',
  companies: 'Companies',
  page: 'Public page and applications',
  plan: 'Plan and report',
  agenda: 'Agenda',
  terms: 'Terms and places',
  money: 'Money',
  results: 'Results',
} as const;

/** Optional ADR075 views; the original five views and off path stay unchanged. */
export const programmeProjectionLenses = [
  { key: 'companies', label: 'Companies' },
  { key: 'agenda', label: 'Agenda' },
] as const;
