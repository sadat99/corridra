# Customer account v18 (canvas Home_V18_Account, 28 Nov 2026)

No switch: this is the customer account for everyone once merged (owner, 28 Nov 2026: "removing it is best"). Presentation over existing pages; no new server command, migration or permission.

## Built

- Navigation: Home, My Work, Companies, Delegations, More (`customerTabs({ v18: true })`, `components/customer-shell.tsx`).
- My Work: Requests, Meetings, Results as one row of tabs (`components/ux/my-work-tabs.tsx`); each tab is the page that always held it. Meetings appears with `CORRIDRA_UX_SHELLS_V2`.
- Acting for: the person's active businesses (`components/ux/acting-for*.tsx`); a browser-only display choice; Start a Request opens `/account/request/<id>`, which checks the role again.
- Delegations hub `/account/delegation-hub`: Organise, Participate; Ask Corridra to Run One is Coming soon.
- My Businesses `/account/businesses`: the existing workspace list, team, profile, plan and invoices. While customer requests and workspaces are on, a Requests list reads this person's businesses on the server and links Start a Request to `/account/request/<id>` (which checks membership again) and My Requests to `/account?view=work`; an archived business shows Archived and no link (`app/account/businesses/business-requests.tsx`, `tests/integration/business-requests-rights.test.ts`). No count is shown.
- Working features and where v18 reaches them: restoring a withdrawn request (My Work, Requests, `/account?view=work`, the request row); the workspace invitation code, not email (My Businesses, a business's actions, Manage Team, owner only); workspace rename, archive and restore (My Businesses, a business's actions; archived ones under Archived); Report a Problem (Help menu in the header on every account page, `/account/problem-reports`, while its module is installed); programme rename, archive and restore (Delegations, Organise, choose the business, `/account/delegations/<id>`; also a business's actions, Plan Delegations); billing view (More, Plan and Invoices, `/account/billing`, and a business's actions, Plan and Billing, `/account/billing/<id>`), each showing the server's own reply.
- More: My Businesses, Plan and Invoices, Notifications, All Tools, Help and Support.
- Companies: Fit and Evidence columns from the approved report contexts; "Your submitted information" line removed.
- No Listen in the signed-in menus and header (public header and the rail Help sheet still offer it).
- Search still finds Meetings and Results by name; the old Programmes and Registrations rail links stay under the hub.

## Needs server work first (shown as Coming soon or not offered)

A request list the whole business shares (requests belong to the person who sent them; `customer.private_requests` lists only the person's own); invitations by email; versioned request edits; request attachments; invoice download; billing visibility by role on the server; programme cancel and announcements; data export request; email change; support ticket tracking; Ask Corridra to Run One; analytics events; personal workspace naming.

## Not verified

Tests, lint and Prettier were not run locally. No signed-in pass: the branch preview has no customer sign-in settings. Pixel match to the canvas not checked. Native review of new words not done.
