// The words a person reads and types when closing an account or asking for erasure. All of it is pending the
// owner's named review of the privacy wording: a changed word is a change to this file only. The phrase to type
// must equal accountLifecycleWords.closePhrase in packages/auth (a test holds the two together).
export const accountWords = {
  // pending the owner's named review
  closePhrase: 'Close my account',
  // pending the owner's named review: wording A
  closeTitle: 'Close Your Account?',
  closeBody:
    'Your account and workspaces are hidden. You have 30 days to undo this. After that it is final. We keep records the law requires, such as invoices and signed decisions.',
  // pending the owner's named review: wording B
  erasureTitle: 'Ask Us to Erase Your Personal Data',
  erasureBody:
    'Staff will reply within 30 days. We keep records we must keep by law, for example invoices, signed decisions and audit history, and we will tell you which ones and why. Files are removed in a separate reviewed step.',
  // pending the owner's named review
  sectionHeading: 'Close Account or Erase Data',
  closeRow: 'Hide your account and workspaces. You can undo this for 30 days.',
  erasureRow: 'Ask the Corridra team to erase your personal data.',
  blockedNotice:
    'You are the only owner of these workspaces. Transfer ownership or archive each one before you close your account.',
  closedHeading: 'Your Account Is Closed',
  reopened: 'Your account is open again.',
  finalNotice: 'Your account was closed and can no longer be reopened.',
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
