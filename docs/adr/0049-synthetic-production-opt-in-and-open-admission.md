# ADR-049: Synthetic production opt-in and open admission

Status: accepted by the owner on 19 October 2026, as a deliberate, recorded deferral of controls. This is not a closure of D01 to D06 or D08. The product stays PARTIAL.

## Context

Every customer module was hard-disabled on a production deployment, and every account needed a hand-entered admission in an offline allowlist. The owner wants to run the real platform on the live site, with random test data and documents, for their own team and invited users, with all modules on and no per-account step. The owner explicitly accepted deferring malware scanning, privacy and legal readiness and security hardening until after the pilot.

## Decision

- **Production opt-in, default locked.** A production deployment runs customer modules only when `VERCEL_ENV=production`, `DATA_ENVIRONMENT=synthetic` and `CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK` is exactly `synthetic-only`. Any other value, including unset, keeps the old behaviour. Every module also keeps its own flag, so the unlock alone enables nothing. Implementation: `packages/auth/src/customer-production.ts`, used by the two root gate functions and by the `production` option of every customer service in `apps/web/lib/foundations.ts`.
- **Open admission, default off.** When `CORRIDRA_CUSTOMER_OPEN_ADMISSION` is exactly `synthetic-only` (and data is synthetic and the deployment is not locked), the first use by a fresh, email-verified account calls `customer_private.admit_verified_subject`, installed by the optional module `customer-admission-migrations`. It writes the same immutable principal row the offline procedure writes, so every existing check, row-level rule and per-account disable switch still applies. A disabled principal is never re-enabled. The function accepts only a live attestation for the pinned issuer from the auth role, is not callable by the runtime role, and refuses beyond 2000 principals so a burst of signups cannot grow the database without bound.
- **Synthetic-only data stays.** Every free-text field still has to begin with `Synthetic `, and every row is marked synthetic. "Random data and documents" means invented test content, not real people or real companies. Money remains records, not payments.
- **Visibility.** The founder activation view reports whether the production unlock and open admission are on.

## Deferred controls (owner-accepted, must close before any real customer data)

| Control                                                           | State                                                                                                                                                                                                             | Required before                                                 |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| D01 malware scanning of uploads                                   | Deferred. Production keeps `EVIDENCE_SCAN_MODE=bypass`, so uploaded files are not scanned.                                                                                                                        | Any real customer or counterparty document                      |
| D08 privacy, legal basis, retention, data-subject handling, terms | Deferred. No approved controller notice, retention schedule or terms for customer data.                                                                                                                           | Any real personal or commercial data, or any outside pilot user |
| Security hardening                                                | Deferred: rate limiting and abuse controls on signup and workspace creation beyond the 2000-principal ceiling, an independent security review, secret and push protection (D03), code scanning entitlement (D04). | A public launch or real data                                    |
| Payments, outreach, production AI inference                       | Unchanged: not built or not enabled.                                                                                                                                                                              | Their own gates                                                 |

Risks the owner accepted: anyone who can sign up with a verified email can create synthetic workspaces; uploaded documents are not scanned; there is no approved privacy or legal basis for personal data, so real personal data must not be entered. Test with invented names, companies and files only.

## Rollback

Unset `CORRIDRA_CUSTOMER_OPEN_ADMISSION` to stop new admissions, and `CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK` to lock production again; both take effect on the next deployment, and flags can be unset the same way. Admitted principals can be disabled offline. The additive schema, rows and history are retained and never dropped.

## Required acceptance

Unit tests for the exact unlock and admission values, including non-synthetic and production cases. Database tests for the admission function: fresh account, repeat call, unverified email refusal, disabled principal stays disabled, foreign issuer and stale or unknown attestation refused, runtime role denied, the ceiling, and a repeatable idempotent install with an exact recorded hash. The full original suites on the exact merged head, then production verification after the owner-approved install and flags.
