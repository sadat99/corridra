# View-as proposal (Phase 0, item 8)

Date: 2026-10-23. Status: approved by the owner on 23 October 2026 ("yes to both, as long as safe") and recorded as [ADR 059](../adr/0059-view-as-preview.md). Stage 1 is built; later stages are not. The decisions at the end were taken at their proposed defaults.

## Goal and hard limits

The owner wants to see a customer, supplier or delegate screen as that role would see it.

| Limit            | Meaning                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------- |
| No impersonation | The screen never acts as a real person and never shows a real person's data.             |
| No real session  | No customer, delegate or supplier cookie, token or proof is ever read, copied or minted. |
| Read-only        | No action works. Nothing is saved or sent. The only write is the audit entry.            |
| Always logged    | Every open is recorded before the screen is shown.                                       |
| Real components  | Show the real components in each role's real frame. Do not draw a look-alike.            |

## What the repo does today (facts I read)

| Fact                                                                                                                                                                                                                                          | Source                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Staff identity is Better Auth with password and TOTP at `/api/operator-auth`. Customer accounts are Neon Auth. The two stores never link by email.                                                                                            | `docs/adr/0020-neon-auth-accounts-and-preserved-operator-mfa.md`                                              |
| The staff page gets the session with `s.provider.getSession(await headers())`, then lists tenants with `s.access.tenants(identity.token)`. It accepts a requested tenant only if it is in that list.                                          | `apps/web/app/operator/page.tsx`                                                                              |
| `foundations()` builds all services. The customer session reader is separate (`readCustomerSession`, Neon Auth).                                                                                                                              | `apps/web/lib/foundations.ts`                                                                                 |
| A staff actor needs a live session, two-factor on, a TOTP check within 12 hours and an enabled principal. `app.fresh_mfa()` needs a TOTP check within 5 minutes.                                                                              | `packages/db/migrations/0001_identity_tenancy.sql`                                                            |
| `withTenant` sets the session hash, reads actor and role, runs `authorize(role, permission)` and demands fresh MFA for a fixed list of permissions.                                                                                           | `packages/db/src/index.ts`                                                                                    |
| Roles are `owner`, `admin`, `operator`, `reviewer`, `viewer`. `audit.read` is owner and admin. `founderAccess` already uses `audit.read` as the "owner or admin" test and returns only the role.                                              | `packages/domain/src/index.ts`, `packages/missions/src/operations.ts`                                         |
| Customer proof "continues to yield no staff actor". A staff session has no customer authority and the reverse.                                                                                                                                | `docs/adr/0033-private-customer-request-authority.md`                                                         |
| Earlier ADRs already ban impersonation (staff, request creator, submitter).                                                                                                                                                                   | `docs/adr/0016-*.md`, `0037-*.md`, `0041-*.md`, `0042-*.md`                                                   |
| Customer features sit behind exact-value flags that are off unless set. Flags take effect on the next deployment.                                                                                                                             | `packages/auth/src/customer-production.ts`, `docs/adr/0049-synthetic-production-opt-in-and-open-admission.md` |
| Audit rows are written by a database trigger (`app.record_change`) when a table row changes. `app.audit_event` rejects update and delete. The Audit tab lists `app.domain_event` rows and shows unknown types as "Workspace change recorded". | `packages/db/migrations/0002_trust_events.sql`, `apps/web/app/operator/workspace-audit.tsx`                   |
| `/operator/:path*` and `/account/:path*` get `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The root layout says `index: true`, so a new page must set noindex itself.                                                         | `apps/web/next.config.ts`, `apps/web/app/layout.tsx`                                                          |
| The CSP allows `connect-src 'self'` and `form-action 'self'`, and sets `frame-ancestors 'none'`.                                                                                                                                              | `apps/web/next.config.ts`                                                                                     |
| The customer frame is `WorkspaceShell` with `nav`, which adds the class `ux-customer`. `CustomerShell` adds the test-mode note and `CustomerNav`. `CustomerNav` links are fixed to `/account...`.                                             | `apps/web/components/workspace-shell.tsx`, `customer-shell.tsx`, `customer-nav.tsx`                           |
| Customer client components fetch their own data from same-origin `/api/...` routes (for example `/api/customer-workspaces`).                                                                                                                  | `apps/web/app/account/customer-workspaces.tsx`                                                                |
| Test fixtures mount a real component with `createRoot`, fixed sample props, and `page.route` to answer the API calls. The fixture wrapper differs from the real frame.                                                                        | `tests/operator/v3-organisation-links-ui.spec.ts`, `docs/v3/KNOWN_ISSUES.md` (KI-16)                          |
| The design system names Meridian for customer and mission shells and Signal Desk for staff. Composition follows task, not role.                                                                                                               | `docs/design-system/README.md`                                                                                |

Two things follow. First, the real `/account` page cannot be reused as is: it reads a Neon Auth session. Second, the real client components call real APIs, so they need their data answered locally.

## Options considered

| Option                                                          | What it is                                                                                                                       | Verdict                  |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| A. Real components, sample data, role frame                     | Staff-only page mounts the same components inside the same frame. A local layer answers their data calls with fixed sample data. | Part of the answer       |
| B. Read-only preview route per role                             | One route per role under the staff area, gated and logged, that hosts option A.                                                  | Recommended (A inside B) |
| C. True impersonation (act as, or open a real person's session) | Staff signs in as, or borrows the session of, a real person.                                                                     | Rejected                 |

Why C is rejected:

- It breaks ADR-020 (separate identity stores, no link by email) and ADR-033 (no staff actor from customer proof, nothing manufactured).
- It shows real personal and commercial data to staff who have no grant for it. ADR-049 and ADR-056 say privacy and legal basis are still deferred, so there is no basis to add this exposure.
- Every action would be real. A mis-click could send, accept or pay.
- It would put a second way to make a session next to the one proven path. More paths, more attack surface.
- Audit would say a person did something that the person did not do.

Why not A alone: with no route, no gate and no log, there is no place for the banner, the permission check or the audit entry.

## Recommendation

Build B with A inside it: a read-only, staff-only, logged preview route per role. It renders the real components with fixed sample data in the real frame. It reads no customer table and uses no customer or delegate session.

### Routes and components

| Item           | Proposal                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route          | `/operator/view-as/[role]`, where role is `customer`, `delegate` or `supplier`. It sits under `/operator`, so it inherits the no-store, no-referrer headers and the proxy matcher.              |
| Customer frame | `WorkspaceShell` with `nav` (class `ux-customer`) plus `CustomerNav`, the real account components (for example `customer-requests.tsx`, `customer-workspaces.tsx`), and the Mission Room parts. |
| Delegate frame | The participant parts of `apps/web/app/account/delegations/` (for example `participant-place.tsx`, `my-reminders.tsx`), in the customer frame.                                                  |
| Supplier frame | Not confirmed (see end). Candidates: the assigned-task board `apps/web/app/contributor/task-board.tsx` and the introduction response `apps/web/app/buyer/recipient-response.tsx`.               |
| Page body      | Extract the presentational body of each real page into a shared component, so the real page and the preview cannot drift. Do this per page, in later stages.                                    |
| Frame fidelity | Use the real frame, not the test fixture wrapper (the KI-16 trap: rules written for `main.ux-customer` never apply inside the fixture).                                                         |
| Sample data    | One module of fixed sample records. Names are clearly invented. It is shared with the UI tests later, so tests and preview show the same thing.                                                 |
| Data answers   | A client layer installed before any child mounts. It answers allowed GET calls from the sample module and refuses everything else locally (see read-only below).                                |

## Exact permission checks

All checks run on the server, in this order, before anything is rendered. Any failure returns the same plain "not found" page, so the route does not announce itself.

| #   | Check                                                                                                                                                               | Existing or new                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | Own switch is exactly `true` (proposed name `CORRIDRA_VIEW_AS_ENABLED`). Default off. It is separate from every customer flag and from `CORRIDRA_REAL_USE_ENABLED`. | New                                |
| 2   | Role in the URL is one of the fixed list. No free input.                                                                                                            | New                                |
| 3   | Staff session from `s.provider.getSession(headers)`. A Neon Auth customer session is never read or accepted.                                                        | Existing                           |
| 4   | The tenant comes from `s.access.tenants(token)`. The requested tenant must be in that list.                                                                         | Existing                           |
| 5   | Role in that tenant is `owner` or `admin`. Proposed new permission `viewas.open` with `['owner','admin']`, enforced by `authorize`.                                 | New (same rule as `audit.read`)    |
| 6   | Fresh MFA: add `viewas.open` to the fresh-MFA list in `withTenant`, so a TOTP check within 5 minutes is required.                                                   | New list entry, existing mechanism |
| 7   | The audit entry is written in the same transaction as checks 4 to 6. If the write fails, nothing renders.                                                           | New                                |

Staff sign-in already requires two-factor (`app.actor_id()` needs `twoFactorEnabled` and a TOTP check within 12 hours). Check 6 adds a recent check on top. A reviewer, operator or viewer role, a customer account and a contributor invitation all fail check 5 or 3.

## How read-only is enforced

Defence in layers. No single layer is trusted alone.

| Layer              | Rule                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No server actions  | The view-as folder has no `'use server'`, no route handler, no API route. A static test fails the build if one appears.                                                                                      |
| Server method gate | In `proxy.ts` (it already matches `/operator/:path*`), answer any method other than GET or HEAD on `/operator/view-as/*` with 405. This needs a small change to the proxy, which today only redirects.       |
| No mutating fetch  | The data layer allows only GET to a fixed list of paths and answers from sample data. POST, PUT, PATCH, DELETE, unknown paths and cross-origin calls get a local refusal. Nothing leaves the browser.        |
| No forms           | The preview content area is `inert`. Nothing can be clicked, focused or submitted. A path-scoped CSP adds `form-action 'none'`.                                                                              |
| No navigation out  | `CustomerNav` has fixed `/account` links, so in the preview they must be inert or replaced by in-preview links. Inert is enough for stage 1.                                                                 |
| Network lock       | Path-scoped `connect-src 'none'` as a backstop, because the data layer needs no network. Needs a test: it is not confirmed how Next merges two header rules for one path.                                    |
| Last resort        | The staff cookie is not a customer session. Customer APIs deny it today (ADR-020, ADR-033). The preview does not rely on this.                                                                               |
| Proof by test      | A browser test opens each role, tries every control, and asserts: no request except the page and static files, no non-GET call, no write to storage that holds a draft or token. Use the KI-12 browser path. |

Open point: `inert` means the owner cannot tab between sample tabs. If the owner wants to click through views, stage 3 can add in-preview tabs that only switch local state.

## Logging

Written to the existing tenant audit trail, once per open, before render.

| Logged                                                                               | Not logged                                    |
| ------------------------------------------------------------------------------------ | --------------------------------------------- |
| Event type `view_as.open`                                                            | Names, emails, phone numbers                  |
| Staff principal id (the same internal id other audit rows use) and their tenant role | IP address, user agent, device data           |
| Tenant id and the role viewed (`customer`, `delegate`, `supplier`)                   | Any content shown (it is fixed sample data)   |
| Time, request correlation id, a preview version number                               | Any customer, delegate or supplier identifier |

Where: a new additive database function appends one `app.domain_event` and one `app.audit_event` row (both are append-only; `app.audit_event` rejects rewrites). It does not add an outbox row, so nothing is sent. The function is granted to `corridra_runtime` only, with a fixed search path, like the other `app.*` functions. Existing owner and admin Audit tab shows it (as "Workspace change recorded" until one label line is added). Retention follows the existing audit rows. Denied attempts are not in the tenant trail, because there may be no tenant; log them in the application log with the request id only. Whether the runtime role can insert these rows through such a function is not confirmed; stage 1 proves it.

## Banner

A fixed bar on every view-as page, above the real frame, in a colour no real frame uses. It cannot be dismissed.

- Text: "PREVIEW AS CUSTOMER. Sample data. This is not a real account. Nothing here can be saved or sent." (role word changes.)
- Replace the frame's own sign-out button and its "Your work stays private" note, so no real-session cue remains.
- A repeated diagonal "SAMPLE PREVIEW" mark over the content, so a cropped screenshot still shows it.
- Page title starts with "Preview:". A visible "Close preview" link back to `/operator`.
- Sample names are plainly invented. No real brand, person or company.
- The viewer's name is not shown in the page by default (decision below).

## Abuse cases

| Case                                                    | Mitigation                                                                                                                                                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff with a lower role tries it                        | Check 5 refuses. Same "not found" page. Denial logged to the application log.                                                                                                                                    |
| Staff uses it to learn how to phish or to fake a screen | Screen shows only sample data and the banner. The audit trail shows who opened what and when. Owner reviews the trail.                                                                                           |
| Someone mistakes it for a real session                  | Banner, watermark, "Preview:" title, no sign-out, inert content, different colour. Never a real name or email.                                                                                                   |
| Someone says an action happened as a customer           | Nothing can act. Audit shows only opens, never actions. Test proves zero writes.                                                                                                                                 |
| Screenshot leaks                                        | Content is sample data only, so the leak is limited to unreleased layout. The watermark marks it. No real record can appear.                                                                                     |
| Cached page, back button, shared link                   | `force-dynamic` and the existing `/operator/:path*` no-store header. A shared link opens "not found" for anyone who fails the checks. Test the header on this route.                                             |
| Search engine indexing                                  | `robots: { index: false, follow: false }` in metadata (as the operator page does), plus an `X-Robots-Tag: noindex` header. No sitemap entry. The root layout default is `index: true`, so this must be explicit. |
| Switch left on by mistake in production                 | Default off. Exact-value match. Founder activation view should list it (the existing view already reports flags). Real data is never reachable, so the cost of a mistake is low.                                 |
| Component starts a real call that the data layer misses | The layer refuses unknown calls, `connect-src 'none'` blocks the rest, the browser test fails on any request. A new component with a new endpoint fails the test until sample data is added.                     |
| Preview drifts from the real screen                     | Shared page bodies (one component for both) and a test that renders both against the same sample.                                                                                                                |
| Session replay or logging tools copy the page           | None are used in the repo that I confirmed. Do not add any to this route.                                                                                                                                        |

## Effect on RLS and existing denials

None. The preview adds no policy, no grant to customer tables and no change to any existing function, policy, ACL or role. It reads no customer, delegate, supplier or mission row. Its only database use is the existing tenant list, the existing role check and the one new append-only audit function. Every current denial (ADR-033, ADR-041, ADR-049, ADR-056) stays as tested. Do not weaken any test to fit this feature.

## Blast radius

| Area             | Size                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data exposed     | Fixed sample data only. A bug in the gate shows sample screens to the wrong staff member, not real records.                                                               |
| Code touched     | One new folder under `apps/web/app/operator/`, one proxy rule, one permission, one header rule, one shared sample module. Page-body extraction later, one page at a time. |
| Database touched | One additive function (stage 1). No table change to existing tables.                                                                                                      |
| Customers        | No effect. Customers never reach the route.                                                                                                                               |
| Real-use gates   | Unchanged. D01 to D06 and D08 stay open. This does not count toward closing them.                                                                                         |

## Rollback

1. Unset `CORRIDRA_VIEW_AS_ENABLED`. After the next deployment the route returns "not found".
2. If needed, remove the folder and the proxy rule in one revert.
3. Keep the audit rows and the function. They are append-only and harmless. Do not drop or rewrite them (same rule as ADR-033 and ADR-049).

## Staged plan

| Stage | Build                                                                                                                                                                           | Risk   | Done when                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| 0     | ADR for view-as, owner answers below. Record in the ledger.                                                                                                                     | None   | ADR accepted                                                                                                      |
| 1     | Switch, permission `viewas.open`, fresh-MFA entry, audit function, route for `customer` with banner and a static sample page (no real components yet), noindex, 405 gate, tests | Lowest | Denial matrix passes (every role, no session, customer session, flag off). Audit row appears. Zero network calls. |
| 2     | Customer role with real components: data layer, shared sample module, account home, My Work, Mission Room in the real `ux-customer` frame. Browser test for zero writes.        | Low    | Real frame screenshots match the real page at 320, 390, 768 and 1440. Zero-write test green.                      |
| 3     | Delegate role (participant parts of delegations).                                                                                                                               | Low    | Same tests                                                                                                        |
| 4     | Supplier role, after the owner picks the screen.                                                                                                                                | Low    | Same tests                                                                                                        |
| 5     | Share the sample module with `tests/operator` fixtures. Optional in-preview tabs. Add a line to the KI-16 method.                                                               | Low    | One source of sample data                                                                                         |

Stage 1 is first because it proves the gate, the audit write and the read-only rules with almost no screen code. Do not turn the switch on in production until the audit write is proven in stage 1, because "every use is logged" is a hard limit.

## Owner decisions needed

1. Approve the recommendation (read-only preview route with real components and sample data) and the rejection of true impersonation.
2. Who may use it: owner and admin only (proposed), or owner only?
3. Should the switch ever be allowed in production, or only in preview and local builds? Proposed: allowed in production but default off.
4. Fresh-MFA window: keep the existing 5 minutes (proposed)?
5. Which screens count as "supplier"? The repo has the assigned-task board and the introduction response. I could not confirm a signed-in supplier account screen.
6. Which screens first: account home, My Work, Mission Room (proposed)?
7. Inert content only at first (proposed), or in-preview tab switching in stage 2?
8. Show the viewer's name in the watermark (not logged), or keep it anonymous (proposed)?
9. OK to add one additive database function for the audit entry, with its own ADR and a hash-checked migration?
10. Should denied attempts also go to the tenant audit trail where a tenant is known, or only to the application log (proposed)?

## Built after approval: stage 1 (23 October 2026)

Everything in the stage 1 row of the staged plan, behind `CORRIDRA_VIEW_AS_ENABLED` (default off):

- Permission `viewas.open` for owner and admin, with the existing five minute authenticator check.
- `app.record_view_as_open`, one additive database function in the optional module `view-as-migrations`, installed with the owner-run workflow input `view_as_action = install`. It re-checks the member role, the authenticator and the inputs itself, and writes one event and one audit row with the shown role, the viewer's role and a preview version.
- `/operator/view-as/customer`: the bar, the diagonal mark, inert sample content, a title starting "Preview:", no real name, not indexed, not cached, no referrer. Delegate and supplier answer not found and are not logged until built.
- A 405 answer for any method but GET or HEAD under the preview path.
- Tests: a real-database denial matrix, source checks that the preview folder has no script, form, fetch, server action or outside link, and an operator browser journey (marked, inert, logged on every open, no network request of its own, axe at 1440, 768 and 390). Breaking the role check, the authenticator check, the role list, the audit write or the record contents each failed a test.

Stage 1 is reached by address only. No link to it is added to the workspace yet. Path-scoped content security rules were left out: stage 1 has no form or script to restrict, and how Next merges two header rules for one path is not confirmed.
