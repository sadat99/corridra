# ADR-058: Emailed request status link

Status: proposed on 23 October 2026. The owner has not approved it. No code, no migration and no email setting is part of this ADR. It changes who can see a request, so it touches [ADR-033](0033-private-customer-request-authority.md) and needs explicit owner approval before any work starts.

## Goal

The owner wants a link in the request confirmation email. The link shows the status of the request without sign-in. It works for 90 days. The person can renew it.

## What the code does today

These facts come from the files named here.

- **Receipt.** A receipt is a 64-character hex string. The route accepts only `^[a-f0-9]{64}$` (`apps/web/app/api/intake/receipt/route.ts`). The server makes it with an HMAC of the request key (`prepareIntake` in `packages/missions/src/index.ts`).
- **Server keeps a digest only.** The database stores `receipt_hash`, which is the SHA-256 of the receipt (`digest` in `packages/missions/src/index.ts`; `app.mission_intake` in `packages/db/migrations/0007_mission_core.sql`).
- **Browser keeps the receipt in sessionStorage.** After a sample (synthetic) guest submits, the page stores it under `corridra-mission-receipt` (`apps/web/app/plan/intake.tsx`). The page reads it back only when the form is not in private or real mode. A failed save shows a "copy the private code" notice.
- **Check page.** The check form is the section `id="receipt-check"` on `/plan` (`apps/web/app/plan/intake.tsx`). It posts the code to `/api/intake/receipt`. The account page links to `/plan#receipt-check` (`apps/web/app/account/page.tsx`).
- **What the check returns.** `app.mission_receipt` returns only the status, the received time and the operator replies (`0007_mission_core.sql`). It returns nothing once `retention_until` has passed. That column defaults to 30 days after creation. The privacy page also says the intake retention window is 30 days (`apps/web/app/privacy/page.tsx`).
- **No rate limit on the check route.** The receipt route checks the origin and the body size. It does not call `intake_budget`. The 64-hex code is the only guard.
- **Real mode: guest cannot submit.** When `realUseEnabled()` is true, `POST /api/intake` returns 409 with "Finish account activation to submit your request" (`apps/web/app/api/intake/route.ts`).
- **Real mode: draft held 24 hours.** `/api/intake/pending` stages the draft. The cookie is HttpOnly with `maxAge: 86400`, and the database row expires after 24 hours (`apps/web/app/api/intake/pending/route.ts`; `packages/db/customer-real-use-migrations/0001_verified_guest_handoff.sql`).
- **Which email the intake collects.** The final step asks for "Work email" (`intake.tsx`). In sample mode the schema accepts only addresses ending in `@example.invalid` (`packages/domain/src/missions.ts`), so no real inbox can receive mail. In real mode it must be a valid address, and it is lowercased. A signed-in person must use the email on the account (`intake.tsx`). The address is stored on the brief and in `app.mission_participant` (`0007_mission_core.sql`).
- **No confirmation email exists.** The intake page says "Email delivery is not enabled". The privacy page says mission reply emails are not sent. ADR-056 says not to promise mission email. `deferred-controls.md` says the outreach adapter does not send email and that mail is for identity only (Neon Auth with Resend SMTP). The only app-side mailer in `packages/auth/src/recovery-mail.ts` is for operator password reset.

So this ADR is not only a link. It also needs a new way to send mission email. That is a separate capability and a separate owner decision.

## Existing bearer-link model to reuse

- **Staff delivery links** (`packages/db/migrations/0016_scoped_delivery.sql`, `packages/delivery/src/index.ts`). The server makes the token with an HMAC of tenant and command, so a retry gives the same token. The database stores `token_hash` (unique, 64 hex). Expiry is a column, and a check caps it at 30 days. Revocation is a separate append-only row with a reason of 3 to 500 characters. A read checks the hash, the expiry and the revocation in one function. Reads use `app.intake_budget` with 60 per hour per client and 60 per hour per token.
- **Fragment.** The link is built as `origin + path + '#' + token` (`apps/web/app/operator/delivery.tsx`). A hook reads `window.location.hash` and sends the token in a POST body (`apps/web/components/private-capability.ts`). The `/buyer` page sets `robots` to no-index and `referrer: 'no-referrer'` (`apps/web/app/buyer/page.tsx`). Delivery responses send `Cache-Control: no-store` and `Referrer-Policy: no-referrer` (`apps/web/lib/delivery-http.ts`).
- **Workspace invitations** use the same `token_hash` pattern with a 24-hour life and a revocation table (`packages/db/customer-migrations/0002_workspace_collaboration.sql`). **Operator password reset** lasts 30 minutes and works once (`recovery-mail.ts`).
- **Budget function.** `app.intake_budget(key, max)` counts per hour and accepts only a maximum of 6 or 60 (`0007_mission_core.sql`).

## Proposed decision

Every number below is a proposal for the owner to accept or change.

### What the link shows

The link shows the same bounded progress that `app.mission_receipt` shows today:

- the request status;
- the time it was received;
- operator replies, with their times;
- the date the link expires, and a button to renew it.

### What the link never shows

- The brief, notes, offer, name, company or email.
- Quotes, prices, fees, money of any kind, contracts or negotiations.
- Contact details of any other party.
- Evidence, files, sources or internal notes.
- Staff names or staff tools.
- Any other request, workspace, member or list of requests.
- Any action that changes data. The link is read-only. Renewal and revocation are not done with the link alone (see below).

This follows ADR-033, which keeps a private request binding apart from client publication and bars it from disclosing quotes, contacts, negotiations, contracts or money.

### Token design

1. **A new token, not the receipt.** The link carries a new random token. The receipt stays as it is. Revoking the link does not break the receipt. The receipt secret is never put in an email.
2. **Hashed at rest.** The server stores the SHA-256 digest only, with a unique 64-hex check, as `token_hash` does today. The plain token exists in the email and nowhere else. A retry of the same command gives the same token, as delivery links do. Each renewal uses a new command, so it makes a new token.
3. **Fragment, not path or query.** The URL looks like `/<status page>#<token>`. The page name is not fixed here. The browser does not send a fragment to the server. The page script reads it and posts it in a body. The page is no-index, `no-referrer` and `no-store`, as `/buyer` is. The script clears the fragment from the address bar after it reads it. A browser that blocks scripts cannot show the status.
4. **Read through the unchanged function.** The link read calls the same progress function with the stored original receipt digest. It therefore inherits the retention check.
5. **Expiry is 90 days, never past retention.** Today a request is readable for 30 days and the longest bearer link is 30 days. A 90-day link is longer than both. The link ends at the earlier of 90 days and `retention_until`. Making the link last 90 days in practice means the owner must also approve a longer retention for the receipt view. That is a D08 decision (see gates).
6. **Rate limits.** Reuse `intake_budget`: 60 reads per hour per client and 60 per hour per token. Cap renewal and resend emails at 6 per hour per request, because 6 is the only other value the function accepts. Add a hard total, for example 3 renewals per request. Also add the budget to the existing receipt check route, which has none today. That is a separate fix and the owner should decide it.
7. **Constant answer.** A wrong, expired or revoked token gets one plain answer: "This link is unavailable or expired." It must not say which.

### Who can renew or revoke

- **Renew.**
  - The request creator, when signed in (the sole owner under ADR-033).
  - A person who holds a live link may ask for a renewal. The new link goes by email to the address on record. It is never shown on screen. A stolen link then cannot extend itself, and it cannot send a new link anywhere else.
  - A staff member with an owner or admin role and current MFA may ask for a resend to the address on record, with a reason. Staff never see the token.
  - Renewal makes a new token and revokes the old one. Renewal never passes the retention date.
- **Revoke.**
  - The request creator, when signed in.
  - Staff owner or admin with current MFA, with a reason of 3 to 500 characters.
  - Automatic: at expiry, when the creator's resource grant is revoked, and when the customer principal is disabled.
  - Revocation is an append-only row. Nothing is deleted, and a revoked link is never revived.

### Effect on ADR-033

ADR-033 gives a private request to its creator alone. It requires fresh, verified, active proof for reads. It also says no receipt secret is placed in a URL or browser storage. This ADR adds a second read path that needs only a bearer link. It is a deliberate, narrow exception, and it must be said plainly:

- Anyone who holds the link can read the status and replies of that one request until it ends.
- Ownership does not change. The creator is still the only owner. The workspace owner, members, organisers and participants gain nothing.
- The token is a new secret in a URL fragment, not the receipt secret.
- Revoking the creator's grant, disabling the principal or reaching retention ends the link. No recovery or re-invitation revives it. This keeps ADR-033's rule that a revoked resource stays revoked.
- ADR-033 would need a short dated amendment when the owner approves this. That amendment would say this path exists. It would change nothing else in ADR-033.

### Abuse cases

| Case                           | What can go wrong                               | Mitigation                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email is forwarded             | A third person reads the status.                | The link shows only status and replies. The email says to keep it private. The creator can revoke. Staff can revoke. It expires.                                                                                                                                                                                                                            |
| Shared or group inbox          | Many people can open it.                        | Same limits. Real mode sends only to the verified account email. Offer sign-in as the stronger option for teams.                                                                                                                                                                                                                                            |
| Link in browser history        | A later user of the same device opens it.       | The fragment is not sent to the server and not stored in server logs. The page clears it from the address bar. Expiry and revocation apply. History on the device itself cannot be fully controlled.                                                                                                                                                        |
| Referrer leakage               | The link leaks to another site through a click. | `no-referrer` on the page and its API, no external links or third-party scripts on the page, and a fragment is never sent in a referrer.                                                                                                                                                                                                                    |
| Link scanner prefetch          | A mail scanner opens the link and "uses" it.    | A plain GET returns only the page shell. A fragment is never sent in a GET. The status comes from a script POST, and the receipt route already requires the app Origin header. The link is not single use, so a scan does not spend it. A scanner that runs scripts could read the status. That is the same exposure as any holder. Reads are rate limited. |
| Guessing                       | Someone tries tokens.                           | Use at least 256 random bits, as the receipt has. Rate limit by client and by token. Store only digests.                                                                                                                                                                                                                                                    |
| Screenshot or shoulder surf    | Others see replies on screen.                   | Out of scope. Keep replies short and free of private data.                                                                                                                                                                                                                                                                                                  |
| Wrong address typed            | The email goes to a stranger.                   | Real mode requires the account email and a verified account. Sample mode uses `@example.invalid` and sends nothing.                                                                                                                                                                                                                                         |
| Staff reply holds private data | A reply shows a secret to a link holder.        | Replies are already shown to a receipt holder today. Staff guidance must say to keep replies free of quotes, contacts and money. The owner may decide to hide replies on the link.                                                                                                                                                                          |

### Blast radius

- **Reads:** status, time and replies of one request, for the life of one link.
- **Writes:** none from the link.
- **Other requests, workspaces and money:** none.
- **A database leak:** token digests only, which do not reveal a link.
- **An email account leak:** a mailbox holder can open a live link. Sign-in does not defend against this either, because account recovery also uses email.
- **Cost:** a new email sender, a new secret key for it, and a new table or tables (see below).

### Rollback

Turn the feature flag off. The link page then answers "unavailable" and no more emails go out. Revoke all links by appending revocation rows if the owner wants a hard stop. Keep every request, receipt, reply, token digest and revocation. Do not drop tables or rewrite records. Receipts keep working as they do today.

## Interaction with closed gates

This ADR closes none of them. See `docs/implementation/deferred-controls.md`.

| Gate                                    | Effect                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01 malware scanning                    | None. The link shows no files. Scanning stays deferred and BYPASSED.                                                                                                                                                                                                                                  |
| D02 main ruleset and required CI        | None. All mandatory release checks still apply to any code that follows.                                                                                                                                                                                                                              |
| D03 secret scanning and push protection | Relevant. The email key and any token secret must stay out of the repo and logs. The gate stays open, so review this by hand.                                                                                                                                                                         |
| D04 CodeQL                              | Any later code needs actual analysis on the frozen head, as ADR-056 requires.                                                                                                                                                                                                                         |
| D05 private EU S3                       | None.                                                                                                                                                                                                                                                                                                 |
| D06 Blob orphan cleanup                 | None.                                                                                                                                                                                                                                                                                                 |
| D08 privacy, legal basis and retention  | Directly affected. A 90-day link needs a retention window longer than the recorded 30 days. Mission email to a person needs a notice and a legal basis. It is open, so the owner must accept the deferral in writing, or close it first. The privacy and intake wording must change with any release. |

## Open questions for the owner

1. **Do sample guests give an email at all?** In sample mode the address must end in `@example.invalid`, which cannot receive mail. Options: show the link on screen after submit, as the receipt is shown today, and send no email; or ask sample guests for nothing and skip the feature for them. The owner should choose. This ADR leans to the first option.
2. **Retention.** Will the owner approve a longer receipt view than the recorded 30 days, up to 90? If not, the link ends at 30 days.
3. **Email sender.** Which provider and which sender address? The existing identity mail goes through Neon Auth. This needs its own decision, its own key and its own acceptance with a real inbox.
4. **Replies on the link.** Keep operator replies on the link, or show status only?
5. **Receipt check limit.** Add a budget to the existing receipt route now?
6. **Real mode.** Real guests cannot submit and every real request belongs to an account. Is a no-sign-in link wanted there at all, given it is weaker than the signed-in check ADR-033 requires? A shorter life for real requests is an option.

## Alternatives considered

- **Device memory.** Keep the receipt in the browser, as `sessionStorage` does now. This needs no email and no new secret. It clears when the tab closes, it does not work on another device, and a shared computer exposes it. It is the current behavior and it does not meet the goal.
- **Sign-in with a code.** Email a one-time code, then open a short session. This is safer than a long bearer link, because a forwarded email does not carry lasting access. It also needs the new email sender, plus session and code handling. Real requests already use account sign-in for private reads. Both options need the email capability first.
- **Why this link is later.** The email capability does not exist, D08 is open, and the retention question is not settled. Build in this order: the owner answers the questions above, then a separate email decision, then this link.

## No migration and no code

No migration, code, flag, email setting or deployment is part of this ADR. A schema change would probably need an optional table for link digests and a revocation table. It must come as its own additive migration plan. That plan would keep all existing migrations, hashes and rows, and would be released only with the owner's approval. Existing synthetic and real records keep their provenance and are not relabeled.

## Required acceptance if approved

Keep every existing receipt and ADR-033 test. Add tests for these cases:

- digest-only storage;
- fragment never in a request URL, log or referrer;
- expiry, and the cap at retention;
- renewal that sends only to the recorded address, and the renewal total;
- revocation by the creator, by staff, by grant revocation and by principal disablement;
- one answer for wrong, expired and revoked tokens;
- rate limits per client and per token;
- prefetch with GET that changes nothing;
- the link showing none of the fields listed under "never shows";
- populated before-and-after preservation of old receipts.

Run a real browser journey with a real inbox. A fixture does not prove email delivery. Run every mandatory release gate on the exact merged head.

## Decision needed (added 24 October 2026, status unchanged)

The UX update reserves the switch `CORRIDRA_STATUS_LINK` and sends the same kind of private link through Pulse ([ADR-067](0067-notification-records-and-pulse.md)). The owner decides, before this ADR is built: whether the status link is still wanted beside Pulse; how long it should last; and whether the privacy review of Pulse also covers it.
