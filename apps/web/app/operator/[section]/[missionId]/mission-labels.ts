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

/** Address of the mission page; the workspace is kept so a person with several workspaces lands in the right one. */
export function missionHref(missionId: string, tenant: string) {
  return `/operator/missions/${missionId}?workspace=${encodeURIComponent(tenant)}`;
}
