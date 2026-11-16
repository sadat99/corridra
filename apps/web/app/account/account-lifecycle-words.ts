// The words a person reads and types when closing an account or asking for erasure. Wording A and wording B, the
// two dialog texts (closeBody and erasureBody, not their titles), were approved by the owner, 10 November 2026
// (answer to the conductor: "Approve both as live (Recommended)"). On 16 November 2026 every sentence here was checked
// against what the code does (customer-account-lifecycle migration 0001): closing deletes nothing, day 30 only
// ends the undo, erasure is a request staff answer by hand, and a closed person can still file one. closeBody,
// closeTitle, sectionHeading and the closed screen were corrected to say exactly that, under the owner's delegation
// ("as per your best judgement"). No legal review is recorded. A changed word is a change to this file only,
// and any later wording change needs the owner again. The phrase to type must equal accountLifecycleWords.closePhrase
// in packages/auth (a test holds the two together).
export const accountWords = {
  // pending the owner's named review
  closePhrase: 'Close my account',
  // pending the owner's named review
  closeTitle: 'Close Your Account?',
  // wording A, approved by the owner, 10 November 2026 (answer to the conductor: "Approve both as live (Recommended)")
  closeBody:
    'You have 30 days to undo this. After that you cannot reopen it. Closing does not delete anything. While your account is closed you cannot use it, but you can still ask for erasure. Even then we keep records the law requires, such as invoices and signed decisions.',
  // pending the owner's named review
  erasureTitle: 'Ask Us to Erase Your Personal Data',
  // wording B, approved by the owner, 10 November 2026 (answer to the conductor: "Approve both as live (Recommended)")
  erasureBody:
    'Staff will reply within 30 days. We keep records we must keep by law, for example invoices, signed decisions and audit history, and we will tell you which ones and why.',
  // pending the owner's named review
  sectionHeading: 'Close Account or Ask for Erasure',
  closeRow: 'Close your account. You can undo this for 30 days.',
  erasureRow: 'Ask the Corridra team to erase your personal data.',
  blockedNotice:
    'You are the only owner of these workspaces. Transfer ownership or archive each one before you close your account.',
  closedHeading: 'Your Account Is Closed',
  reopened: 'Your account is open again.',
  closedNotice: 'You can still ask us to erase your personal data while your account is closed.',
  finalNotice: 'Your account was closed and can no longer be reopened.',
  closedUndo: (until: string) =>
    `Your account is closed. You can undo this until ${until}. After that you cannot reopen it. Closing does not delete anything.`,
} as const;

export const erasureStatusWords = {
  received: ['Received', 'We have your request. Staff will reply by the date shown.'],
  in_progress: ['In Review', 'Staff are looking at your request.'],
  completed: [
    'Completed',
    'Staff have finished with your request. Read their note if there is one.',
  ],
  declined: ['Declined', 'Staff cannot erase this. Read their note if there is one.'],
} as const;
