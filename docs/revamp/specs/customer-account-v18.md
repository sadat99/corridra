# Customer account v18 (canvas Home_V18_Account, 28 Nov 2026)

Switch: `CORRIDRA_UX_ACCOUNT_V18` (on only when exactly `true`, off by default; off, every page is unchanged). Presentation over existing pages; no new server command, migration or permission.

## Built (behind the switch)

- Navigation: Home, My Work, Companies, Delegations, More (`customerTabs({ v18: true })`, `components/customer-shell.tsx`).
- My Work: Requests, Meetings, Results as one row of tabs (`components/ux/my-work-tabs.tsx`); each tab is the page that always held it. Meetings appears with `CORRIDRA_UX_SHELLS_V2`.
- Acting for: the person's active businesses (`components/ux/acting-for*.tsx`); a browser-only display choice; Start a Request opens `/account/request/<id>`, which checks the role again.
- Delegations hub `/account/delegation-hub`: Organise, Participate; Ask Corridra to Run One is Coming soon.
- My Businesses `/account/businesses`: the existing workspace list, team, profile, plan and invoices.
- More: My Businesses, Plan and Invoices, Notifications, All Tools, Help and Support.
- Companies: Fit and Evidence columns from the approved report contexts; "Your submitted information" line removed.
- No Listen in the signed-in menus and header while the switch is on (public header and the rail Help sheet still offer it).

## Needs server work first (shown as Coming soon or not offered)

Requests owned by a business; invitations by email; versioned request edits and restoring a withdrawn request; request attachments; invoice download check; billing visibility by role on the server; programme cancel and announcements; data export request; email change; support ticket tracking; Ask Corridra to Run One; analytics events; personal workspace naming.

## Not verified

Tests, lint and Prettier were not run locally. No signed-in pass: the branch preview has no customer sign-in settings. Pixel match to the canvas not checked. Native review of new words not done.
