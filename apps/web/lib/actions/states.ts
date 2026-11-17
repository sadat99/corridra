// The states an action can be in and the plain line for each. One copy table for AI and non-AI modes alike.
// Pure data: no imports, no I/O. The words are English only; native bn and zh copy is owner review (not here).

export const actionStates = [
  'ready',
  'preparable',
  'needs_detail',
  'needs_approval',
  'unconfirmed',
  'needs_team',
  'unknown',
  'unavailable',
  'denied',
  'needs_info',
  'needs_review',
  'submitted',
  'confirmed',
] as const;

export type ActionState = (typeof actionStates)[number];

/** A copy key is the state it speaks for, so a failure map can never name a line that does not exist. */
export type StateCopyKey = ActionState;

export type StateCopy = { line: string };

export const stateCopy: Record<StateCopyKey, StateCopy> = {
  ready: { line: 'Ready to continue' },
  preparable: { line: 'I can prepare this' },
  needs_detail: { line: 'One detail is needed' },
  needs_approval: { line: 'This action needs your approval' },
  unconfirmed: { line: "Corridra couldn't confirm this action" },
  needs_team: { line: 'This needs help from our team' },
  unknown: { line: "Corridra doesn't cover that yet. Try other words, or browse the pages." },
  unavailable: { line: 'This is not available right now' },
  // Denied explains the legitimate access path and never offers a way around it.
  denied: {
    line: 'Your account does not have access to this. Ask your workspace owner to grant it.',
  },
  needs_info: { line: 'Some information is needed before this can continue' },
  needs_review: { line: 'Please review this before it goes any further' },
  submitted: { line: 'Sent. Waiting for Corridra to confirm it' },
  confirmed: { line: 'Done and confirmed' },
};
