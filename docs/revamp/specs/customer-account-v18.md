# Customer account v18 (canvas Home_V18_Account, 28 Nov 2026)

No switch: this is the customer account for everyone once merged (owner, 28 Nov 2026: "removing it is best"). Presentation over existing pages; no new server command, migration or permission.

## Built

- Navigation: Home, My Work, Companies, Delegations, More (`customerTabs({ v18: true })`, `components/customer-shell.tsx`).
- My Work: Requests, Meetings, Results as one row of tabs (`components/ux/my-work-tabs.tsx`); each tab is the page that always held it. Meetings appears with `CORRIDRA_UX_SHELLS_V2`.
- Acting for: the person's active businesses (`components/ux/acting-for*.tsx`); a browser-only display choice; Start a Request opens `/account/request/<id>`, which checks the role again.
- Delegations hub `/account/delegation-hub`: Organise, Participate; Ask Corridra to Run One is Coming soon.
- My Businesses `/account/businesses`: the existing workspace list, team, profile, plan and invoices.
- More: My Businesses, Plan and Invoices, Notifications, All Tools, Help and Support.
- Companies: Fit and Evidence columns from the approved report contexts; "Your submitted information" line removed.
- No Listen in the signed-in menus and header (public header and the rail Help sheet still offer it).
- Search still finds Meetings and Results by name; the old Programmes and Registrations rail links stay under the hub.

## Needs server work first (shown as Coming soon or not offered)

Requests owned by a business; invitations by email; versioned request edits and restoring a withdrawn request; request attachments; invoice download check; billing visibility by role on the server; programme cancel and announcements; data export request; email change; support ticket tracking; Ask Corridra to Run One; analytics events; personal workspace naming.

## Not verified

Tests, lint and Prettier were not run locally. No signed-in pass: the branch preview has no customer sign-in settings. Pixel match to the canvas not checked. Native review of new words not done.
