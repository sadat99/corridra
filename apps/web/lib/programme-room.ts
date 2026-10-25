// The Programme Room (Lane 10 of the UX update): pure rules, tested without a browser. The room only
// regroups panels that already exist, so everything here is a reading of records the participants panel
// already returns. A step is marked from a record or it is "not tracked yet"; nothing is estimated.
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

/** What "not tracked yet" means on the programme Road: the room reads only invitations and registrations. */
export const programmeRoadLegend =
  "Not tracked yet means this room does not read that step's records, or could not read them just now.";

/** The views of a programme room, in order. A view appears only where its panel is on. */
export const roomLenses = [
  { key: 'overview', label: 'Overview' },
  { key: 'people', label: 'People' },
  { key: 'plan', label: 'Plan and report' },
  { key: 'terms', label: 'Terms and places' },
  { key: 'money', label: 'Money' },
] as const;
export type RoomLensKey = (typeof roomLenses)[number]['key'];
