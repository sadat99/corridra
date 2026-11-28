import type { KeyIssue } from '../../lib/route-pack-editor-pack';

// ADR-093 Phase 3, PR 3b: the words of the pack dialogs (spec 8.9, 10, 11.1 to 11.6, and the designer's UI spec for PR 3b).
// Pure and free of value imports, so the browser tests can load it. English only: the native language review is open.
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export const packWords = {
  changeSettingTitle: 'Change Pack Setting',
  changeStatusTitle: 'Change Pack Status',
  removeSourcingTitle: 'Remove Sourcing Profile',
  stepValue: 'Step 1 of 2: Value · Next: Review',
  stepStatus: 'Step 1 of 2: Status · Next: Review',
  stepReview: 'Step 2 of 2: Review',
  next: 'Next',
  back: 'Back',
  cancel: 'Cancel',
  close: 'Close',
  checking: 'Checking…',
  checkingLine: 'Checking this change…',
  publishing: 'Publishing…',
  publishingLine: 'Publishing this change…',
  publishPack: 'Publish Pack Change',
  publishStatus: 'Publish Status Change',
  removeSourcing: 'Remove Sourcing Profile',
  proposePack: 'Propose Pack Change',
  tryAgain: 'Try Publishing Again',
  checkAgain: 'Check Again',
  reloadRoute: 'Reload Route',
  changeValueFirst: 'Change the value to continue.',
  pickStatusFirst: 'Pick a new status to continue.',
  missionTypesNeeded: 'Choose at least one mission type.',
  startsDraft: 'This starts the pack as Draft, not used yet.',
  manualChannel: 'The team contacts companies by hand (manual channel)',
  notClearance:
    'A pack status is not clearance. Real payments, outreach and payouts stay closed until the owner decides each gate.',
  onePerson:
    'You are proposing and publishing this yourself. Both steps are recorded under your name.',
  secondOwner: 'A second owner has to publish this. One-person publishing is not installed yet.',
  settingsKept: 'Every pack setting stays as it is',
  removeStatement:
    "This removes the buying profile from the pack. Buyers' comparison for this route stops using it.",
  noSourcing: 'There is no buying profile in this pack now. Nothing was removed.',
  reasonLabel: 'Reason',
  reasonHint: 'For example: added Chinese after the buyers asked for it',
  reasonShort: 'Give a reason of at least 3 characters.',
  savedNotPublished: 'The change is saved as a proposal but not published yet.',
  stale:
    'Another change to this pack was published first. Nothing was published. Open the route again to see the current pack, then make your change again.',
  denied: 'Only the owner can publish pack changes.',
  notFound: 'Pack changes are not available right now.',
  commandReused: 'Something changed while this was open. Review it again, then press the button.',
  previewOffline: 'This change could not be checked. Check your connection and try again.',
  publishOffline:
    'The change was not confirmed. Check your connection, then press Try Publishing Again. Sending it again cannot publish it twice.',
  signedOut:
    'Your session has ended. Sign in again, then open this route and make the change again.',
  tooLarge: 'This change is too large to send. Shorten long lists.',
  notSent: 'This change could not be sent. Try again.',
  stepUpKept: 'Confirm your authenticator code to finish this. Your changes are kept.',
  emptyList: 'No keys. Saving this empties the list.',
  addKey: 'Add Key',
  addKeyLabel: 'Add a key',
  remove: 'Remove',
  change: 'Change',
  manualYes: 'By hand',
  manualNo: 'Not by hand',
  sourcingRemoved: 'Sourcing profile: removed',
  now: 'Now',
} as const;

export const nowStatus = (status: string) => `Current status: ${status}`;
/** The line over a setting's first step; null is an empty list, said as nothing set (never as the list word none). */
export const nowValue = (value: string | null) =>
  `Current setting: ${value === null ? 'nothing is set' : value}`;
export const basedOn = (version: number) => `Based on pack version ${version}`;
export const becomes = (version: number) =>
  version === 1 ? 'This starts pack version 1' : `Becomes pack version ${version}`;
export const statusLine = (from: string, to: string) => `Status: ${from} to ${to}`;
export const versionLine = (from: number, to: number) => `Pack version ${from} becomes ${to}`;
export const assignmentsKept = (count: number) => `Mission assignments kept: ${count}`;
export const changedLine = (label: string, before: string, after: string) =>
  `${label}: ${before} to ${after}`;
export const noneWords = 'none';
export const readinessWarning = (version: number) =>
  `This publishes pack version ${version}. Readiness has to be recorded again for every dimension before this route can be released. Route facts, sources and dates are not affected.`;
export const blockedLine = (labels: string) =>
  `The route is live, so these fields cannot be emptied: ${labels}.`;
export const pendingCaution = (labels: string) =>
  `These Core fields are still Pending: ${labels}. This does not mean the route is cleared.`;
export const showFields = (count: number) =>
  `Show the ${count} ${plural(count, 'field', 'fields')}`;
export const alsoRemoved = (names: string) => `Also removed: ${names}`;
export const publishedLine = (version: number) =>
  `Pack version ${version} is published. Readiness is not recorded for it yet.`;
export const duplicateLine = (version: number) =>
  `This change was already published as pack version ${version}. Nothing was added.`;
export const proposedLine = (version: number) =>
  `Pack version ${version} is proposed. It waits in Control Center for a second owner to publish it.`;
export const changeRow = (label: string) => `Change ${label}`;
export const reasonCount = (length: number) => `${length} of 500`;
export const keyCount = (count: number) => `${count} of 50 keys`;
export const keyAdded = (key: string, count: number) => `Added ${key}. ${keyCount(count)}.`;
export const keyRemoved = (key: string, count: number) => `Removed ${key}. ${keyCount(count)}.`;
export const removeKey = (key: string) => `Remove ${key}`;
export function keyIssueWords(issue: KeyIssue): string {
  switch (issue.kind) {
    case 'empty':
      return 'Type a key first.';
    case 'characters':
      return 'Use lowercase letters, digits, underscore, dot and hyphen only.';
    case 'start':
      return 'Start the key with a lowercase letter.';
    case 'tooLong':
      return `A key can have at most 80 characters. This one has ${issue.length}.`;
    case 'repeated':
      return `${issue.key} is already in the list.`;
    case 'full':
      return 'A list can hold 50 keys. Remove one to add another.';
  }
}
