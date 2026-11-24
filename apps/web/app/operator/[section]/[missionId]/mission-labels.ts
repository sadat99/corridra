// Plain labels for stored mission codes (CQ-32, D15). The stored values never change; only what a person reads does.
import type { ChipTone } from '../../../../lib/ux/customer-road';

const stages: Record<string, string> = {
  DRAFT: 'Received, waiting for review',
  QUALIFICATION: 'Qualifying',
  ACTIVE: 'Active',
  TARGETING: 'Finding companies',
  OUTREACH: 'Introductions',
  MEETINGS: 'Meetings',
  FOLLOW_UP: 'Follow-up',
  COMMERCIAL_PIPELINE: 'Commercial follow-through',
  ON_HOLD: 'Paused',
  CANCELLED: 'Cancelled',
  CLOSED: 'Closed',
};

export function stageLabel(status: string) {
  return stages[status] ?? plainCode(status);
}

/** Chip for a mission: closed work is done or stopped, new and paused work waits, the rest is active. */
export function stageChip(status: string, overdue = false): { label: string; tone: ChipTone } {
  const label = stageLabel(status) + (overdue ? ', overdue' : '');
  if (status === 'CLOSED') return { label, tone: 'done' };
  if (status === 'CANCELLED') return { label, tone: 'stopped' };
  if (status === 'DRAFT' || status === 'ON_HOLD' || overdue) return { label, tone: 'waiting' };
  return { label, tone: 'active' };
}

const actions: Record<string, string> = {
  assign: 'Owner and next action updated',
  qualify: 'Qualification started',
  activate: 'Mission activated',
  targeting: 'Company search started',
  outreach: 'Introductions started',
  meetings: 'Meetings started',
  followup: 'Follow-up started',
  pipeline: 'Commercial follow-through started',
  close: 'Mission closed',
  pause: 'Mission paused',
  resume: 'Mission resumed',
  cancel: 'Mission cancelled',
};

export function actionLabel(action: string) {
  return actions[action] ?? plainCode(action);
}

/**
 * Trust label for where a request came from (D17 labels only). A customer's own request is
 * Self-declared until evidence is reviewed.
 */
export function sourceLabel(sourceKind: string, claimStatus: string) {
  const claim = claimStatus.toLowerCase();
  if (claim === 'verified') return 'Verified';
  if (claim === 'under_review' || claim === 'evidence_available') return 'Evidence available';
  if (sourceKind === 'self_declaration' || claim === 'self_declared') return 'Self-declared';
  return 'Self-declared';
}

/** "COMMERCIAL_PIPELINE" reads "Commercial pipeline". */
export function plainCode(code: string) {
  const words = code.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function isOverdue(dueAt: string | null | undefined, status: string) {
  return (
    !!dueAt && new Date(dueAt).getTime() < Date.now() && !['CANCELLED', 'CLOSED'].includes(status)
  );
}

/** Days without any recorded change before an open mission is called stale. */
export const staleAfterDays = 7;

/**
 * An open mission nobody has touched for `staleAfterDays`. `updatedAt` is the mission row's own change
 * stamp, which every command moves. A paused mission waits on purpose, so it is never stale.
 */
export function isStale(updatedAt: string | null | undefined, status: string, now = Date.now()) {
  if (!updatedAt || ['CANCELLED', 'CLOSED', 'ON_HOLD'].includes(status)) return false;
  const time = new Date(updatedAt).getTime();
  return !Number.isNaN(time) && now - time >= staleAfterDays * 86_400_000;
}

/** Whole days since the last change. */
export function quietDays(updatedAt: string, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(updatedAt).getTime()) / 86_400_000));
}

/**
 * "Last changed 37 days ago": how long the mission has been quiet. It is read from the last change, not the due
 * date, so it never reads as a second count of days late beside Today's "N days late".
 */
export function quietLabel(updatedAt: string, now = Date.now()) {
  const days = quietDays(updatedAt, now);
  return `Last changed ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

type HandoverSource = {
  reason: string;
  created_at: string;
  actor_id?: string;
  details: { ownerId: string };
};

/**
 * The latest change of owner, read from the append-only command history (newest first). The reason the
 * person gave for that command is the hand-over note. Returns null while the owner never changed.
 */
export function latestHandover<T extends HandoverSource>(history: T[]) {
  for (let i = 0; i < history.length - 1; i += 1) {
    const next = history[i];
    const before = history[i + 1];
    if (
      next.details?.ownerId &&
      before.details?.ownerId &&
      next.details.ownerId !== before.details.ownerId
    )
      return { entry: next, fromOwnerId: before.details.ownerId, toOwnerId: next.details.ownerId };
  }
  return null;
}

/** Address of the mission page; the workspace is kept so a person with several workspaces lands in the right one. */
export function missionHref(missionId: string, tenant: string) {
  return `/operator/missions/${missionId}?workspace=${encodeURIComponent(tenant)}`;
}

// Team desk v4.1, units D6 and D7 (behind CORRIDRA_UX_TEAM_DESK_V41). The one step a stage offers next, the
// fields each mission action asks for, and one line saying what the change does and what the customer will
// then read. The commands, their names and their payloads are the ones the server already accepts.
export type MissionStep = { action: string; label: string; lead: string };

const steps: Record<string, MissionStep> = {
  DRAFT: {
    action: 'qualify',
    label: 'Begin Qualification',
    lead: 'Read the request, then begin qualification.',
  },
  QUALIFICATION: {
    action: 'activate',
    label: 'Activate Mission',
    lead: 'When the requirement is checked, activate the mission.',
  },
  ACTIVE: {
    action: 'targeting',
    label: 'Begin Finding Companies',
    lead: 'Start choosing which companies to approach.',
  },
  TARGETING: {
    action: 'outreach',
    label: 'Begin Introductions',
    lead: 'When the shortlist is ready, begin introductions.',
  },
  OUTREACH: {
    action: 'meetings',
    label: 'Begin Meetings',
    lead: 'When a company agrees to talk, begin meetings.',
  },
  MEETINGS: {
    action: 'followup',
    label: 'Begin Follow-Up',
    lead: 'When the meetings are held, begin follow-up.',
  },
  FOLLOW_UP: {
    action: 'pipeline',
    label: 'Begin Commercial Follow-Through',
    lead: 'When a commercial step opens, begin commercial follow-through.',
  },
  COMMERCIAL_PIPELINE: {
    action: 'close',
    label: 'Close Mission',
    lead: 'When the work is resolved, close the mission.',
  },
  ON_HOLD: {
    action: 'resume',
    label: 'Resume Mission',
    lead: 'This mission is paused. Resume it when work can continue.',
  },
};

/** The one step this stage offers next, or null when the mission is closed or cancelled. */
export function nextStep(status: string): MissionStep | null {
  return steps[status] ?? null;
}

/** What the Next step card says when no step is waiting. */
export function restingLine(status: string) {
  return status === 'CANCELLED'
    ? 'This mission was cancelled. No step is waiting.'
    : status === 'CLOSED'
      ? 'This mission is closed. No step is waiting.'
      : 'No step is recorded for this stage.';
}

const pausable = [
  'QUALIFICATION',
  'ACTIVE',
  'TARGETING',
  'OUTREACH',
  'MEETINGS',
  'FOLLOW_UP',
  'COMMERCIAL_PIPELINE',
];
export const canPause = (status: string) => pausable.includes(status);

const actionTitles: Record<string, string> = {
  assign: 'Update Mission Details',
  pause: 'Pause Mission',
  cancel: 'Cancel Mission',
};

/** The words on the button that opens an action and on its dialog. */
export function actionTitle(action: string) {
  return (
    actionTitles[action] ??
    Object.values(steps).find((step) => step.action === action)?.label ??
    plainCode(action)
  );
}

export const missionFields = [
  'owner',
  'nextAction',
  'dueAt',
  'marketCode',
  'targetProfile',
] as const;
export type MissionField = (typeof missionFields)[number];

const askedFor: Record<string, readonly MissionField[]> = {
  assign: missionFields,
  qualify: ['marketCode', 'targetProfile', 'nextAction', 'dueAt'],
  pause: [],
  cancel: [],
  close: [],
};

/**
 * The fields one action asks for. Every command still carries all of them: a field that is not asked for is
 * sent with the value the mission already holds. A value the server would refuse as too short (no next
 * action, no target profile yet) is always asked for, so no action can be sent with a gap nobody can see.
 */
export function stepFields(
  action: string,
  m: { next_action?: string | null; target_profile?: string | null },
): MissionField[] {
  const asked = new Set<MissionField>(askedFor[action] ?? ['nextAction', 'dueAt']);
  if ((m.next_action ?? '').trim().length < 3) asked.add('nextAction');
  if ((m.target_profile ?? '').trim().length < 3) asked.add('targetProfile');
  return missionFields.filter((field) => asked.has(field));
}

const resultingStage: Record<string, string> = {
  qualify: 'QUALIFICATION',
  activate: 'ACTIVE',
  targeting: 'TARGETING',
  outreach: 'OUTREACH',
  meetings: 'MEETINGS',
  followup: 'FOLLOW_UP',
  pipeline: 'COMMERCIAL_PIPELINE',
  close: 'CLOSED',
  pause: 'ON_HOLD',
  cancel: 'CANCELLED',
};

/** What a customer reads for one stage: the Road step and its line, in the words their own page uses. */
export type CustomerView = { step: string | null; words: string };

/**
 * One line for an action: what changes on the mission, and what the customer will then read. `customer` turns a
 * stage into the customer's own words (the Road), so this never states something their page does not say.
 */
export function stepStatement(
  action: string,
  status: string,
  customer: (stage: string) => CustomerView,
): { changes: string; customer: string } {
  if (action === 'assign')
    return {
      changes:
        'This updates the owner, next action, due date, market and target profile on the team record.',
      customer: 'The stage the customer sees stays the same.',
    };
  if (action === 'resume')
    return {
      changes: 'The mission returns to the stage it was paused from.',
      customer: 'The customer sees that stage again in place of the paused note.',
    };
  const stage = resultingStage[action];
  if (!stage)
    return {
      changes: 'This records a change on the mission.',
      customer: 'The stage the customer sees stays the same.',
    };
  const view = customer(stage);
  return {
    changes: `The stage changes from ${stageLabel(status)} to ${stageLabel(stage)}.`,
    customer: `The customer will see: ${view.step ? `${view.step}. ` : ''}${view.words}`,
  };
}

/** Decision 3: the route is shown in every action, and beginning qualification never needs one. */
export function routeLine(routeLabel: string | null | undefined, action: string) {
  const state = routeLabel ? `Route: ${routeLabel}.` : 'Route: not assigned yet.';
  return action === 'qualify' && !routeLabel
    ? `${state} You can begin qualification without a route.`
    : state;
}
