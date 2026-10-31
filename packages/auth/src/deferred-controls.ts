// Deferred controls register for the live product (commercial readiness program, D2 and section 9).
// The owner decided to run Corridra live at small scale and defer these controls. Each one is shown
// as deferred by that decision, with one plain risk line. None of them is ever shown as passed,
// approved or closed. The owner page, the readiness page and the control center read this list, so
// the three never disagree. The detailed work for D01 to D08 stays in
// docs/implementation/deferred-controls.md.

/** Service state shown at the top of the owner, readiness and control center pages. */
export const LIVE_STATE = 'Live, small scale';

/**
 * Date of the owner decision that deferred these controls. The program says "date of merge"; the
 * lead sets this to the merge day if it differs.
 */
export const DEFERRED_DECISION_DATE = '31 Oct 2026';

export const DEFERRED_LABEL = `Deferred by owner decision on ${DEFERRED_DECISION_DATE}`;

export type DeferredControlId =
  'D01' | 'D02' | 'D03' | 'D04' | 'D05' | 'D06' | 'D08' | 'OUTREACH' | 'AI' | 'RESTORE' | 'WRITE';

export type DeferredControl = {
  id: DeferredControlId;
  name: string;
  /** One plain line: what could go wrong while this stays deferred. */
  risk: string;
  /** What keeps the risk small in the meantime. */
  mitigation: string;
  /** Who acts to close it. */
  whoActs: string;
};

export const deferredControls: readonly DeferredControl[] = [
  {
    id: 'D01',
    name: 'Malware scanning for uploads',
    risk: 'An uploaded file is not checked for viruses, so a harmful file could reach a reviewer.',
    mitigation: 'Only team members upload. Files are checked for type and size.',
    whoActs: 'Infrastructure owner',
  },
  {
    id: 'D02',
    name: 'Enforced branch protection',
    risk: 'A change could reach production without the required checks if someone bypasses review.',
    mitigation: 'Every pull request still needs the CI validate check before merge.',
    whoActs: 'GitHub account owner',
  },
  {
    id: 'D03',
    name: 'Secret scanning and push protection',
    risk: 'A credential committed by mistake would not be blocked by GitHub.',
    mitigation: 'Gitleaks runs in CI and no secrets are kept in code.',
    whoActs: 'GitHub account owner',
  },
  {
    id: 'D04',
    name: 'Code security analysis',
    risk: 'Some code weaknesses may go unnoticed until a manual review finds them.',
    mitigation: 'Local Semgrep rules and reviewed pull requests.',
    whoActs: 'GitHub account owner',
  },
  {
    id: 'D05',
    name: 'EU production evidence storage',
    risk: 'Evidence files stay in the current storage, which is not the planned EU bucket.',
    mitigation: 'Existing private storage; nothing is deleted.',
    whoActs: 'Infrastructure owner',
  },
  {
    id: 'D06',
    name: 'Stored file cleanup',
    risk: 'Old files are kept longer than a final retention policy would allow.',
    mitigation: 'Nothing is deleted until a reviewed cleanup runs.',
    whoActs: 'Account owner',
  },
  {
    id: 'D08',
    name: 'Legal review, data requests and processing agreements',
    risk: 'A data request or legal question is handled by hand, which is slower and easier to get wrong.',
    mitigation: 'The privacy notice is accurate and a manual data request runbook exists.',
    whoActs: 'Account owner and legal reviewer',
  },
  {
    id: 'OUTREACH',
    name: 'Automated outreach',
    risk: 'Contacting companies takes manual work, so it is slower.',
    mitigation: 'Automated outreach stays off and is labelled as off.',
    whoActs: 'Account owner and legal reviewer',
  },
  {
    id: 'AI',
    name: 'Live AI assistance',
    risk: 'The team does research and drafting by hand.',
    mitigation: 'Live AI stays off and is labelled as off.',
    whoActs: 'Account owner',
  },
  {
    id: 'RESTORE',
    name: 'Backup restore drill',
    risk: 'A restore from backup has not been rehearsed, so recovery could take longer than expected.',
    mitigation: 'Point-in-time recovery is checked and its retention recorded.',
    whoActs: 'Infrastructure owner',
  },
  {
    id: 'WRITE',
    name: 'Production write acceptance test',
    risk: 'Some commercial write paths have not had a separate acceptance run in production.',
    mitigation: 'Every write path keeps its automated tests and audit history.',
    whoActs: 'Account owner',
  },
];

/** Items that are blocked rather than deferred. Real invoicing waits for real legal details (D3). */
export const blockedItems: readonly {
  id: string;
  name: string;
  reason: string;
  whoActs: string;
}[] = [
  {
    id: 'INVOICE',
    name: 'Real invoices',
    reason:
      'Blocked while any supplier legal detail is marked (madeup). Sample invoices still work.',
    whoActs: 'Account owner',
  },
];

/** The one line shown next to evidence uploads (CQ-35). Logged as D01 above. */
export const SCANNER_LINE = 'Files are checked for type and size. Virus scanning is deferred.';
