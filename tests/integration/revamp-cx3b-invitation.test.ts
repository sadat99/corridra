import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// CX PR 3b, the Reports page: one "Open an Invitation" action and one dialog replace the paste fields and the
// link spread over the page. Case ids: CX-02 (every way in is still there) and CX-06 (no new control outside
// the dialog). The behaviour is in tests/operator/revamp-cx3b-invitation.spec.ts; these read the source.
const read = (path: string) => readFileSync(resolve(path), 'utf8');

describe('the Reports page has one way in for an invitation', () => {
  const page = read('apps/web/app/account/page.tsx');
  const reports = page.slice(page.indexOf("view === 'results'"), page.indexOf("view === 'more'"));

  it('puts the one button and the dialog above the tabs', () => {
    expect(reports).toContain('<InvitationProvider>');
    expect(reports).toContain('<OpenInvitationButton />');
    expect(reports.indexOf('<OpenInvitationButton />')).toBeLessThan(
      reports.indexOf('<ReportsTabs'),
    );
  });

  it('keeps both existing forms, drawn into the dialog and unchanged where there is no provider', () => {
    const shared = read('apps/web/app/account/customer-missions.tsx');
    const saved = read('apps/web/app/account/saved-missions.tsx');
    for (const needle of [
      'Private mission invitation',
      'Open Shared Mission',
      'kind="open"',
      'invite?.finish(place.current)',
    ])
      expect(shared).toContain(needle);
    for (const needle of [
      'Private client mission invitation',
      'Save Invitation to This Account',
      'Retry Same Invitation',
      'Clear Invitation From This Page',
      'kind="save"',
      'Save an invitation',
      'Open an original shared mission invitation',
      'invite?.finish(place.current)',
    ])
      expect(saved).toContain(needle);
  });

  it('reads, keeps and sends nothing itself', () => {
    const dialog = read('apps/web/app/account/invitation-dialog.tsx');
    expect(dialog).not.toMatch(/fetch\(|localStorage|sessionStorage|FormData/);
  });
});
