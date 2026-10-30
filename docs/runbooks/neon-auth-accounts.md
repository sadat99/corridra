# Customer and staff identity, setup and recovery

**Document status: CURRENT.** Commands apply today. See the [plan status register](../PLAN_STATUS.md).

Current guidance as reconciled on 15 October 2026. See [access and administration](v2-access-and-launch.md), [ADR 020](../adr/0020-neon-auth-accounts-and-preserved-operator-mfa.md), [ADR 030](../adr/0030-explicit-staff-invitation-and-first-password.md) and [ADR 031](../adr/0031-operator-password-recovery-and-scoped-directory.md). The two identity systems are deliberately separate; matching email is not role authority.

## Choose the right flow

| Audience                                                      | Entry                                                      | Recovery and limits                                                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Customer                                                      | `/signup`, `/verify-email`, `/signin`, `/account`          | `/forgot-password` then received `/reset-password` link; no staff role granted                                                  |
| Newly invited staff/owner                                     | Verified matching customer session, then `/operator/setup` | Only an explicitly approved pending invitation can set the first staff password; sign in separately and enroll/verify real TOTP |
| Existing staff                                                | `/operator/signin`                                         | `/operator/forgot-password` and received `/operator/reset-password` link; password recovery retains MFA and memberships         |
| Lost authenticator, suspended staff or expired/new invitation | Reviewed support/owner procedure                           | No self-service MFA bypass, account resurrection or customer-to-admin conversion                                                |
| Contributor                                                   | Assigned workspace invitation and MFA                      | Exact assignee/task/capability scope; not general membership                                                                    |
| Buyer/client/programme recipient                              | Complete original private link                             | Ask its sender for a reviewed replacement if unavailable; customer signup cannot replace the capability                         |

Customer provider proxy is `/api/auth`; staff provider is `/api/operator-auth`. Forms use native POST before hydration, bounded same-origin callbacks, generic failure/recovery messages and duplicate submission guards where implemented. Never put credentials or reset material in URLs, logs, screenshots, traces or chat.

## Managed customer identity

Use an isolated Frankfurt Neon Auth branch, application name Corridra, mandatory verification and exact trusted origins. Secure settings include `CORRIDRA_NEON_AUTH_ENABLED`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` (at least 32 random characters) and exact `APP_ORIGIN`; production additionally requires `CORRIDRA_NEON_AUTH_PRODUCTION_READY`. Preview uses its own branch and signing secret. Review actual provider settings; an app flag alone is insufficient.

Production customer signup/email recovery was activated and accepted in PR 26 on 9 October 2026. Custom SMTP stays configured in Neon; its saved password is not exposed to the app. Original troubleshooting/disabled-signup stages are historical, superseded by [the dated activation record](../implementation/neon-auth-production-activation.json). Do not replay those old activation steps or delete a populated managed directory. Identity email is distinct from mission outreach. Preserve the monitored account-support contact and accurate privacy notice without inventing retention/DSAR execution.

## Separate staff password recovery

Staff recovery uses the existing Better Auth token store and separate Resend HTTPS sending configuration. Set only through secure deployment settings: `CORRIDRA_OPERATOR_RECOVERY_ENABLED`, sensitive `OPERATOR_RECOVERY_EMAIL_KEY` and `OPERATOR_RECOVERY_EMAIL_FROM`. A saved Neon SMTP credential is not automatically available to this transport; never copy a management API key into runtime. Missing configuration disables recovery rather than collecting an unusable credential.

Only existing verified staff with enabled principals receive mail. Unknown, suspended, unverified and pending-invitation identities receive the same generic response without delivery. Tokens expire after 30 minutes and are one-use; callbacks must be exact same-origin destinations. Reset revokes sessions and preserves the staff principal, tenant memberships and TOTP. The next sign-in still requires the authenticator. The additive migration `0029_identity_password_audit.sql` records credential changes without storing password, hash or token in the event. Builds never apply migrations.

The verified customer invitation hint uses the existing protected setup status and no persistent storage. A pending invitation is setup, not an existing-staff password reset. The scoped member selector resolves only permitted existing workspace principals after `audit.read`; only owners with fresh MFA can change memberships, retaining last-owner protection and immutable history. It is not a provider-wide customer directory.

## Branded customer emails and sign-in with a code (Phase 0, both off by default)

Two separate switches, both unset until the owner acts. Staff recovery mail above is not touched.

| Switch                                | What it does                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `CORRIDRA_CUSTOMER_CODE_SIGNIN`       | Adds "Sign in with a code" under the password form on `/signin`. Password stays the default. Read on the server. |
| `CORRIDRA_CUSTOMER_AUTH_MAIL_ENABLED` | Turns on `POST /api/auth-mail`, the receiver for Neon Auth email events. With it unset the route answers 404.    |

Settings for the mail receiver, set by the owner in the host (never in the repository, never in chat): `CUSTOMER_AUTH_MAIL_KEY` (secret, the Resend key for the sending domain), `CUSTOMER_AUTH_MAIL_FROM` (`sadat@c.obsidianglobal.studio`, shown as "Sadat, Corridra"), `CUSTOMER_AUTH_MAIL_REPLY_TO` (`sadat@obsidianglobal.studio`), and only if the key address cannot be derived from `NEON_AUTH_BASE_URL`, `CUSTOMER_AUTH_MAIL_WEBHOOK_JWKS_URL`. If any is missing or invalid the receiver answers 503 and sends nothing.

### What Neon does (from its documentation, read 23 October 2026)

- The webhook is set per Neon project and branch. It subscribes to `send.otp` (sign-in, email-confirmation and reset codes) and `send.magic_link` (links). This application sends the sign-in, email-confirmation and reset-code messages from `send.otp`, and the password reset link from `send.magic_link` with `link_type` `forget-password`, which is what the customer reset form uses today. A sign-in or confirmation link, or an SMS code, is refused.
- **While a webhook is registered Neon sends none of its own emails for the subscribed events, and it does not fall back to them if the webhook fails.** After three attempts or 15 seconds the sign-in, sign-up confirmation or reset the person asked for fails with an error. One broken deployment therefore stops every code and reset email on that branch.
- To switch back to Neon's own emails, set `enabled` to `false` on the webhook (console, CLI or API). Do this first if anything goes wrong.
- The webhook address must be `https`, a host name (no IP address), and must not redirect: Neon does not follow redirects. Use the exact host in `APP_ORIGIN` and check it answers a POST without a redirect.
- Neon offers no test event, event log or redelivery. Test with a real sign-in on a non-production branch.
- Each request is signed (Ed25519, detached JWS) with a key published at the branch's `.well-known/jwks.json`. The receiver rejects a wrong signature, any algorithm other than EdDSA, an event older than five minutes, an unknown event type, a body over 32 KiB, a link to a host other than the identity provider or this application, and a header event id that differs from the body. A repeated event id sends once. The event id is also sent to Resend as its idempotency key.

### Order of steps (owner)

1. Set the four settings above in the host for Preview first. Set `CORRIDRA_CUSTOMER_AUTH_MAIL_ENABLED=true` there and redeploy. Check `POST /api/auth-mail` without a signature answers 401, not 404 or 503.
2. Register the webhook on the **non-production** identity branch only (`corridra-v3-auth-synthetic`): URL `https://<preview host>/api/auth-mail`, events `send.otp` and `send.magic_link`, timeout 5 seconds. Console: Auth, Configuration, Webhooks. CLI: `neon neon-auth config webhook update --enabled --url ... --enabled-events send.otp,send.magic_link --timeout 5`.
3. Test with an address you control: a sign-up confirmation code (2b), a password reset (3, a link with a "Choose a new password" button), and, with `CORRIDRA_CUSTOMER_CODE_SIGNIN=true`, a sign-in code (2a). Check the sender, the Reply-To and that no code or link appears anywhere except the inbox. Report header details only, never the code or link.
4. Only then repeat on the production identity branch with production settings. Never register the webhook on the live branch before step 3 passes.
5. Roll back by setting the webhook to `enabled: false`. Then unset `CORRIDRA_CUSTOMER_AUTH_MAIL_ENABLED`.

### Must be answered before `CORRIDRA_CUSTOMER_CODE_SIGNIN` is turned on

Neon's page on email codes does not say whether signing in with a code **creates an account for an address that has none**. Test it on the non-production branch with an address you control, then delete the test account:

1. Ask for a sign-in code for an address that has no account. Does a code arrive? Does the screen say anything different from an address that has one? (It must not.)
2. Enter the code. Are you signed in? Was an account created, and is its email marked verified?
3. If an account was created, does it pass the same email-verified admission as a password sign-up (ADR-049 and ADR-056)? Note that this route skips the sign-up page, so it also skips the privacy notice shown there and sets no password or name.
4. If an account must not be created, say so. The option then stays for existing accounts only and the owner decides before the switch is turned on.

Status on 23 October 2026: **not tested.** The cloud container that built this could not reach the identity host, so the answer is unknown. Leave the switch off until it is recorded here with the date and the observed behaviour.

## Actual acceptance and how to diagnose

[PR 46 acceptance](../implementation/access-recovery-production-acceptance.json) records exact revision/CI/READY deployment, audit migration and read-only production observations. The owner privately completed staff password/MFA and confirmed workspace entry. Both actual customer and staff reset emails were confirmed received. The latest private reset-link consumption and resulting new-password sign-in were not observed; do not claim otherwise. PR 26 separately records its original managed-customer token-consumption acceptance.

For a reported failure, identify the audience and URL first. Check eligible active identity/invitation state through authorized tools, app/provider configuration and exact callback origin. Distinguish API request acceptance, provider delivery status, inbox receipt, private token consumption and session behavior. Use at most an explicitly scoped request; do not repeatedly send mail or enumerate accounts. A 200 response is intentionally not proof the identity exists or mail arrived.

Email deliverability depends on the actual verified sender/key/domain and provider state. Do not restart DNS verification or create a new sender unnecessarily. Inspect bounded sanitized errors; never return provider bodies or credentials to users. Ask the recipient only for outcome/error text, not codes, reset links, passwords or authenticator keys.

## Rollback and gates

Disable the affected existing auth/recovery flag and redeploy if necessary, preserving users, sessions/history as applicable, memberships, MFA and migration/audit records. Do not delete schemas or user accounts as rollback. Signing-key rotation requires a recovery plan.

These identity flows do not close D08, admit real mission data, fix production scanning/storage, authorize outreach, activate AI/network execution or enable payments/payouts. See [deferred controls](../implementation/deferred-controls.md) and [route readiness](../implementation/v2-part-05-readiness.md).

## V3 synthetic customer workspace authority

The isolated provider uses email OTP. Signup sends a six-digit code; a verification link is not required. The owner confirmed code delivery on 17 October 2026 and reported the form hiding its code field. The presentation repair exposes the input on arrival and keeps a separate code request/recovery action; deployment/verification status is in ledger chunk23. Email and code remain provider-verified; never read provider OTP stores or mark an account verified administratively to substitute for a received-code walkthrough. An invalid or expired code must remain on verification with a recoverable error. Keep passwords and codes out of shared evidence.

The independently gated customer module is described in [ADR032](../adr/0032-customer-workspace-authority.md). Its [bounded acceptance](../v3/phase-3/customer-authority/report.json) and [release receipt](../v3/phase-3/customer-authority/release.json) distinguish source implementation, tests, deployment, isolated schema installation and actual customer acceptance.

`migrateCustomerAuthority` explicitly runs the unchanged core migration runner and the separately hashed customer module. Core-only deployments continue to use the original runner. Never edit the original29 SQL files, filter an old fixture or conceal the new registry. Before application, verify the exact nonproduction project, child branch, endpoint, database and schema-owner role; inspect current records and hashes. Use a direct verified-TLS connection. The existing sterile parent, live synthetic environment and production remain outside this procedure. Builds never apply schema.

The first packet creates an explicitly synthetic tenant and immutable initial owner grant. It returns `organisationId:null`, not an invented canonical company. Customer authority is separate from staff identity and app memberships. An offline schema-owner may explicitly admit a verified controlled synthetic provider subject with a recorded reason and an active service executor. Never infer this from matching email or client input. Admission is not account verification; never read OTP stores, auto-verify an address or copy production identity/signing material to obtain a passing walkthrough.

`CORRIDRA_CUSTOMER_WORKSPACES_ENABLED` defaults off, requires synthetic data and is hard-disabled in Vercel production. API controls must stay gated until the actual isolated customer session, provider verification, reload and revocation walkthrough is accepted. Database fixtures and anonymous provider responses do not establish that acceptance. Customer creation UI is not part of the first backend release. Company linking, invitations, customer missions and independent delegation/participant/economics remain separate implementation work.

For controlled identity acceptance, use the dedicated isolated preview described in the ledger and its branch-scoped settings. Keep its signing key and database logins separate, use the exact provider-listed origin and retain mandatory email verification. A controlled tester completes signup and receives/consumes the OTP privately, then checks sign-in, account reload, sign-out and stale-cookie/revocation denial. Never ask for passwords, OTPs or reset links in chat. Record observed outcomes and the exact tested revision; keep unobserved stages marked NOT VERIFIED. Do not send test mail without a designated controlled recipient.

Roll back exposure by disabling the customer flag and deploying the retained compatible application. Retain additive schema, grants, canonical records and append-only history. Remove a preview's settings, alias, deployment and Git branch only after its acceptance work is finished and no current environment depends on it. None of this opens D01-D06/D08 or authorizes commercial data, outreach, inference or payments.

### Private customer requests (optional module3)

ADR033 and the bounded request report govern this separate capability. `CORRIDRA_CUSTOMER_REQUESTS_ENABLED` defaults off, requires synthetic data and is hard-disabled in production. Workspace admission is insufficient: a schema-owner must separately admit the controlled synthetic principal through the offline procedure. Source-only release does not install a cloud migration,configure an intake destination or admit a provider account. Verify all old hashes/records and exact isolated environment before any optional installation.

New submissions require active workspace membership; prior creator-owned progress stays private after departure under fresh proof, continuing request admission, independent resource revocation and original source retention. No workspace owner/organiser gets implicit access. The new API exposes receipt progress only,never full commercial/source scope or a receipt bearer secret. Existing publication routes remain independently authorized. Disabling flags/redeploying old compatible source rolls exposure back; keep additive schema and all original records/history. Private metadata holds identifiers/digests/provenance only; real retention/legal gates remain closed.

### Owner opt-in: synthetic customer modules on production ([ADR049](../adr/0049-synthetic-production-opt-in-and-open-admission.md))

The statements above that customer flags are hard-disabled in Vercel production describe the default. The owner can opt in with two exact Production settings: `CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK=synthetic-only` and, to admit every email-verified account automatically, `CORRIDRA_CUSTOMER_OPEN_ADMISSION=synthetic-only`. `DATA_ENVIRONMENT` must stay `synthetic`. Each module still needs its own `CORRIDRA_CUSTOMER_*_ENABLED=true` flag and its database installation, which the manual `Install customer modules` workflow performs (read-only report first, then `apply=yes`, each approved by the owner in the `customer-modules-install` environment). Order: install, then set the flags, then deploy the exact commit. Rollback is unsetting the two settings and redeploying. Scanning, legal and security controls are deferred by owner decision and must be closed before any real customer data. The sign-in issuer must also be set and pinned: set `CORRIDRA_CUSTOMER_ISSUER` to the exact Neon Auth base URL and run the install workflow with `apply=yes`, `customer_issuer` (the same URL) and `customer_executor_id` (an active service principal). The pin is written once and cannot be changed. The issuer is the Neon Auth base URL of the Neon branch the app database runs on (production: project corridra-nonprod, branch corridra-live-synthetic, `https://ep-tiny-forest-b199wxno.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth`). Read it from that branch's Neon Auth configuration and confirm a sign-up lands in that branch's `neon_auth.user`; never take it from another Neon project. Sign-up for an address that already has a verified account reports success and sends no code by design.

### Team roles and leaving (optional module, ADR051)

Install with the `Install customer modules` workflow (it now includes `customer-member-role-migrations`), then set `CORRIDRA_CUSTOMER_MEMBER_ROLES_ENABLED=true` and deploy. The owner can then make an invited member an admin or a regular member from the team screen, and any non-owner can leave from the workspace list. Admins can edit the company profile and plan delegations; only the owner manages the team. To withdraw an admin right before switching the flag off, demote the member first, because the role readers keep honouring recorded roles.

### Company links (optional module, ADR052)

Install with the `Install customer modules` workflow (it now includes `customer-organisation-link-migrations`, after profiles and team roles), then set `CORRIDRA_CUSTOMER_ORGANISATION_LINKS_ENABLED=true` and deploy. Owners and admins then request a company link from the company profile page; staff with the owner, admin or reviewer role in the intake workspace decide from Companies and research in the operator console, with a fresh authenticator check. A link never writes to the company list: to add a new company, approve it for creation, create the record in the existing research screens, then link it. Roll back by unsetting the flag; recorded requests and links are kept.

### Pricing, series and exports (optional module, ADR054)

Install with the `Install customer modules` workflow (it now includes `customer-programme-pricing-migrations`, after programme templates), then set `CORRIDRA_CUSTOMER_PROGRAMME_PRICING_ENABLED=true` next to the economics, coordination and templates flags and deploy. Owners and admins then see a Pricing, Series and Exports section on the planner page. Nothing is collected or sent; fees are the organiser's own records in the existing ledger. To stop, unset the flag; recorded schedules, editions and fees stay.

### Paid-service requests (optional module, ADR055)

Install with the `Install customer modules` workflow (it now includes `customer-service-request-migrations`, after member roles, programmes and companies), then set `CORRIDRA_CUSTOMER_SERVICE_REQUESTS_ENABLED=true` and deploy. Staff also need `CORRIDRA_DELIVERY_ENABLED=true`. Owners and admins then see "Request help" in programmes, private requests and the company portfolio, and staff see the queue, quote form and catalogue in the operator delivery section. Accepting a quote records an order intent only: nothing is charged and billing is not enabled. Rollback is unsetting the flag; requests, quotes and order intents are kept.

### Sample plans and subscriptions (optional module, ADR060)

Install with the `Install customer modules` workflow (it now includes `customer-billing-migrations`, after member roles; it does not need the paid-service module), then set `CORRIDRA_CUSTOMER_BILLING_ENABLED=true` and deploy. Staff also need `CORRIDRA_DELIVERY_ENABLED=true`. Owners and admins then see "Plan and billing" under More and on each workspace card, and staff see "Customer sample plans" in the delivery section. Only sample workspaces are served: a real workspace is refused by every function and by a table guard. Nothing is charged and no invoice, tax number or payment exists. Plan limits are recorded and applied nowhere. The three plans that ship are invented examples ("sample plan" in the title), not prices. To stop, unset the switch; tables and history are kept. Real-session acceptance of the screens and the first staff activation are not yet observed.

### Sample invoices and payment records (optional module, ADR061)

Install with the `Install customer modules` workflow (it now includes `customer-invoicing-migrations`, after the billing module, which it needs), then set `CORRIDRA_CUSTOMER_INVOICING_ENABLED=true` next to `CORRIDRA_CUSTOMER_BILLING_ENABLED=true` and deploy. Staff also need `CORRIDRA_DELIVERY_ENABLED=true`. Owners and admins then see an Invoices section on the plan and billing page, and staff see "Customer sample invoices" in the delivery section: periods that need an invoice, issue, record a payment, issue a credit note. Only sample workspaces are served and every note starts with Synthetic. Invoices are labelled sample records, not tax invoices, and are numbered SAMPLE-INV and SAMPLE-CN. Nothing is collected, refunded or converted, and no tax is calculated. A payment record is the team's statement, not a bank confirmation. To stop, unset the switch; tables and history are kept. Real-session acceptance and the first staff issue are not yet observed.

### Owner install checklist for the billing stack (24 October 2026)

Where each thing is done: **GitHub** > repository > Actions > "Install customer modules" > Run workflow, branch `main`, `apply` = `yes`. **Vercel** > the Corridra project > Settings > Environment Variables > Production, add or edit the value, then Deployments > the newest Production deployment > Redeploy. A setting changes nothing until that redeploy. Never paste a secret into the workflow reason or into chat. Do the rows in order; stop at any row you do not want yet. Every billing row also needs `CORRIDRA_CUSTOMER_WORKSPACES_ENABLED` and `CORRIDRA_CUSTOMER_BILLING_ENABLED` to be `true` in Production (both were `true` when checked on 24 Oct 2026), and each module needs the one before it. Run the workflow once with `apply` = `no` first: it only reports what is installed.

| Step | Where               | Input or setting                                                                                                        | Result                                                                                                          |
| ---- | ------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1    | GitHub workflow     | `real_use_action` = `install`                                                                                           | Adds every pending real-use migration (0009 and 0010 if not yet installed). It does not open or close anything. |
| 2    | GitHub workflow     | `real_billing_action` = `install`, then Vercel `CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED=true`, redeploy, then `enable`   | Real plans open (section below). No money.                                                                      |
| 3    | GitHub workflow     | `real_invoicing_action` = `install`                                                                                     | Invoices module with made-up supplier fields marked "(madeup)".                                                 |
| 4    | GitHub workflow     | `real_invoicing_action` = `set_supplier` with your real company JSON                                                    | Replaces the made-up values. Do this before enabling.                                                           |
| 5    | Vercel, then GitHub | `CORRIDRA_CUSTOMER_REAL_INVOICING_ENABLED=true`, redeploy, then `real_invoicing_action` = `enable`                      | Customers can read real invoices. Still no payment provider.                                                    |
| 6    | Optional            | `simulated_payments_action` = `install`, Vercel `CORRIDRA_CUSTOMER_SIMULATED_PAYMENTS_ENABLED=true`, redeploy, `enable` | A made-up pay and refund flow. Everything says (madeup).                                                        |

The real report switches are Vercel settings only and are described in the next section. Check "what is installed" any time by running the workflow with `apply` = `no`.

### Field modules (owner only, corrected 30 October 2026)

After the workflow repair is merged, check that its next push run has no workflow-validation failure. The script refuses `field_modules_action` with `apply=no`, so the read-only report is a run on `main` with `apply=no` and every action `unchanged`; read it. Then run with `apply=yes` and the chosen `field_modules_action` (`specification_confirmation`, `commercial_arrangements` or `both`), keep every unrelated action `unchanged`, and approve the protected run. That run prints its own report before and after the install. Done on 30 October 2026: run 44 (`apply=yes`, `field_modules_action=both`) installed both modules. Installation alone does not open specification confirmation, principal sales, billing or payments. The owner decides when to set `CORRIDRA_CUSTOMER_SPECIFICATION_CONFIRMATION_ENABLED=true`; its saved-report and customer access prerequisites still apply. Commercial arrangements have no independent environment switch: installed metadata follows existing service-request authority. Deploy the corresponding privacy notice before applying this install-only extension, because installation can expose its terms under existing service-request gates.

The workflow has exactly 25 inputs and no remaining headroom. A later optional module requires restructuring. Combining the repeated reasons into one shared reason is a proposal for the owner, not an implemented change.

### Real report access switches (optional, ADR063, real-use migration 0010)

Two independent owner switches for shared reports of real workspaces. Both are read on each request, so the owner changes a Vercel Production setting and redeploys; the install job is not needed after step 1 above.

- `CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED=true` lets anyone holding an unexpired, unrevoked link read that real report and answer its requests without signing in. Off unless set to exactly `true`.
- `CORRIDRA_REAL_REPORT_SIGNED_IN_ENABLED=false` turns off a verified real customer's saved reports, report history, company history, decisions and assigned reports. On unless set to exactly `false`.

Sample workspaces are never affected. Remove a setting to return to its default. No data is touched either way.

### Real plans and subscriptions (optional module, ADR062)

This is billing stage 1 for real workspaces. It records which plan a real workspace holds and for which period. Nothing is invoiced, charged or collected, and the invoicing module is not touched. Order of steps, each one on purpose:

1. Run the `Install customer modules` workflow on `main` with `apply` = `yes` and `real_billing_action` = `install`. This adds the module and changes nothing for anyone: the control starts closed.
2. In Production set `CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED=true` (it needs `CORRIDRA_CUSTOMER_BILLING_ENABLED=true` and the real-use settings already on) and deploy.
3. Run the workflow again with `real_billing_action` = `enable` and a reason of at least ten characters. This opens the database side. To stop, run it with `pause` (records are kept) or unset the setting.
4. As the owner or an admin of the operator workspace (fresh authenticator check) open the delivery section, then "Customer plans", and write the real plans: name, price in whole minor units, currency, interval, tax treatment, what is included and left out, and every limit. The real catalogue starts empty, and a real plan title must not say "sample".
5. A real workspace owner or admin then sees the plan on "Plan and billing", reads it whole, and can ask for it. Staff activate the request for an explicit period.

Say to customers only what is true: the subscription is a record until real invoices are on (below).

### Real invoices (optional module, ADR064)

Billing stage 2. A real owner or admin can read their invoices and credit notes; the team prepares each one and a second person approves it. Nothing is collected: there is no payment provider and no money moves. Order of steps, each one on purpose:

1. Real plans must already be installed and open (section above).
2. Run `Install customer modules` on `main` with `apply` = `yes` and `real_invoicing_action` = `install`. This adds the module, leaves the control closed and writes the supplier details Corridra Pte Ltd, 101 Robinson Road, Singapore 180239 with every missing legal detail made up and marked "(madeup)".
3. Replace the made-up values before any document is sent to anyone. Run the workflow with `real_invoicing_action` = `set_supplier`, a reason, and the supplier JSON in `real_invoicing_supplier_json` (legalName, address, country, uen, gstRegistered, gstRegistrationNo, taxLabel, gstRateBps, paymentTermsDays, paymentInstructions, financeLabel, approverEmail, madeupFields). Every key is required except `approverEmail` and `madeupFields`; `uen` and `gstRegistrationNo` may be `null` (but `gstRegistered: true` needs a number). `madeupFields` may list only `uen`, `gst_registration_no`, `gst_registered`, `payment_instructions` and `finance_label`; leave a field out once its value is real. Text must be plain: no `@` and no `://`, so write bank instructions without an email address or link. `country` is two capital letters (for example `SG`) and `gstRateBps` is in basis points (900 is 9 percent). `approverEmail` must be the staff account of your finance person; then only that account can approve.
4. In Production set `CORRIDRA_CUSTOMER_REAL_INVOICING_ENABLED=true` and deploy.
5. Run the workflow with `real_invoicing_action` = `enable` and a reason. To stop, run `pause` (records are kept) or unset the setting.
6. A second owner or admin of the real operator workspace is needed to approve. If only one person exists, run `allow_single_approver` with a reason; each document it covers is marked self approved. `require_second_approver` restores the default.

Every document issued while a supplier field is made up says "Contains made-up organisation data (madeup) ... Not a valid tax invoice". Check the GST rule, your registration status and the numbering (`INV-YYYY-NNNNNN`, `CN-YYYY-NNNNNN`, gap free per Singapore calendar year) with your finance adviser.

### Simulated payment flow (optional module, ADR065)

Billing stage 3. A stand-in provider named "Corridra Pay (madeup)" so owners can try paying an invoice and the team can try a refund. It moves no money, uses no card or bank, and never changes an invoice. Every reference and screen says (madeup). Order of steps:

1. Real invoices must already be installed, set up and open (section above).
2. Run `Install customer modules` on `main` with `apply` = `yes` and `simulated_payments_action` = `install`. This adds the module and leaves its control closed.
3. In Production set `CORRIDRA_CUSTOMER_SIMULATED_PAYMENTS_ENABLED=true` and deploy.
4. Run the workflow with `simulated_payments_action` = `enable` and a reason. To stop, run `pause` (records are kept) or unset the setting. `set_refund_window` with `simulated_payments_refund_days` changes the made-up refund window (default 14 days; later outcomes use the new value).

Approving a simulated payment does not mark an invoice paid. Record real payments on the invoice as before. Replace the made-up refund policy and the provider before any real money is taken.
