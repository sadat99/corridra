# Part 03: Data, identity, tenancy and trust foundations

Status: implemented, locally validated and database acceptance verified in Frankfurt on `feat/part-03-foundations`. Protected deployment and storage acceptance remain blocked. This is not a production release or a claim of 100% completion. Public production remains Part 02 at https://corridra.vercel.app. No customer import or public intake has been enabled. Automatic deployment of this branch is disabled in `apps/web/vercel.json` until the remaining storage, scanner and account gates close. Remove that branch-specific hold only after all remaining preview prerequisites are verified; it does not change production deployment behavior.

## Implemented behavior

- Five reviewed PostgreSQL migrations, Drizzle identity adapter, separate restricted runtime/auth roles, tenant RBAC/ABAC/RLS and transaction-local context.
- Invite-only password accounts with real TOTP enrollment, revocation, database-backed throttling and fresh MFA for privileged commands.
- Immutable source/claim/evidence/verification/fact records, inherited policy, independent review and canonical evidence state guards.
- Private EU S3 adapter, encrypted create-only uploads, bounded MIME/size/hash checks, real ClamAV adapter and fail-closed quarantine.
- Atomic immutable domain events, audits and outbox, separate delivery checkpoint, versioned configuration and minimal operator console.
- EU project and sterile preview lifecycle scripts, private versioned synthetic-storage template, offline seed/role provisioning, local recovery drill and CI security workflows.
- Separate ADRs for canvas topics 001 to 005, 010 and 012; permission matrix, ERD, event catalogue, threat model and recovery/access runbooks.

## Validation evidence

[Machine-readable local results](part-03-validation.json) record the runtime, test counts, restore and live public health checks on 2026-10-04. Production dependency auditing reports no known vulnerabilities after pinning the patched esbuild across tooling.

`pnpm check` passes formatting, lint, TypeScript, 7 document integrity tests, 7 infrastructure regression tests, 27 integration tests, 44 desktop/mobile public browser tests and 1 protected operator browser workflow. The integration tests run against PostgreSQL 17, including actual Better Auth TOTP enrollment/signout and actual ClamAV clean/EICAR/error behavior. The S3 test uses the real SDK against a local HTTP contract server and is not an AWS residency or permissions test. Local fresh/upgrade migrations and logical backup/restore pass; restricted-role access and denial are rechecked on the restored database.

The operator browser test covers password-only denial, enrollment, source/claim creation, tenant and CSRF denial, expired step-up followed by re-verification, persisted feature state, accessibility and signout. Operator screenshots/traces/video are disabled. A follow-up guard also rejects database logins that combine runtime and identity permissions or can create roles/databases; scanner readiness uses a real scan and handles connections closed during startup. The public browser suite passes. Browser testing also found and fixed a missing landmark on the shared availability notice without changing its copy or appearance.

## Cloud database evidence

[Cloud results](part-03-cloud-validation.json) record checks executed on 2026-10-05. The existing production candidate is `neon-corridra` (`icy-math-12467795`), in `aws-eu-central-1`, PostgreSQL 18.6, with six hours of recovery history. Only read-only connection metadata was queried on it. No production schema or data was changed.

The separate `corridra-nonprod` project (`odd-pond-26265871`) matches that region/version/history. Its sterile `synthetic` parent contains all five migrations and no accounts or sessions. PR 3 uses child `br-lucky-darkness-b1ppj8en`, with separate restricted runtime and identity logins. Actual cloud checks pass migration hash/repeat validation, role separation, signup/cross-origin/password-only denial, real TOTP enrollment, same-tenant access, cross-tenant/non-member denial, event/outbox atomicity and session revocation. All 15 tenant tables have RLS enabled. A direct runtime read without session context returns no source records, and reading identity account secrets is denied. No MFA assurance was fabricated for these checks.

A separate branch restored the recorded WAL point, reconciled the synthetic source/event/outbox counts and rechecked restricted-role access and cross-tenant denial in 4.737 seconds. This measures this small synthetic drill, not a production RTO. The temporary recovery branch was deleted after verification. The sterile parent and PR child remain available.

Vercel environment scope changes were applied and verified: 22 database/Blob variables are production-only, zero variables are currently preview-scoped, and app copies of `NEON_API_KEY` and `VERCEL_TOKEN` are removed. Codex's management bindings still work. These changes govern future deployments; existing deployment snapshots are not rewritten. Restricted branch credentials have not been imported into Vercel while release gates remain open.

## Remaining acceptance gates

| Gate                                                            | Evidence/status                                                                                                                                                                      | Closure needed                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| EU Neon projects and restricted identities                      | Verified separate Frankfurt PostgreSQL 18 projects, sterile parent, PR child and restricted login checks                                                                             | Recheck before deployment; retain production flag off                                                                     |
| Protected synthetic Vercel preview                              | Not deployed with data; PR branch deployment hold remains                                                                                                                            | Branch-only credentials, unique auth secret/origin, account protection and deployed browser checks                        |
| Production credentials excluded from future preview deployments | Verified production-only variables and management tokens removed from app settings                                                                                                   | Recheck integration scopes before deployment; existing snapshots require separate lifecycle handling                      |
| EU object store and deployed scanner                            | S3 adapter/policy and local ClamAV tests pass. Connected Blob store region/privacy unknown: specific-store API 404, list API 403. No AWS bucket credentials or private cloud scanner | Verify eligible private EU storage, scoped credentials, managed scanner/current signatures and deployed quarantine checks |
| Cloud database recovery                                         | Separate WAL-point restore and restricted-role reconciliation verified                                                                                                               | Object-version recovery remains unverified until cloud storage is configured                                              |
| Protected branch/account controls                               | GitHub protection API 403; CodeQL requires private-repository entitlement and is skipped                                                                                             | Account owner verifies required CI/review, secret scanning and push protection                                            |

Do not merge or enable the data preview until remaining gates pass. The corrected `NEON_API_KEY` destination is applied and actual API authentication works. Runtime readiness observations still report unknown; successful API/SQL calls establish only the operations recorded here. The saved environment setup instructions do not establish publication or deployment. Production migration mode is deliberately absent from the Part 03 scripts. TOTP is implemented; passkeys, invitation email, automated privileged recovery, legal-hold/DSAR execution and outbox dispatch are not claimed.

## Rollback

Keep `CORRIDRA_FOUNDATIONS_ENABLED` absent/false in production. Disable it in preview to close operator routes, revoke preview identities and retain database history. Use compatible forward migrations; do not rewrite immutable evidence/audit/event records. Remove only the matched non-production child branch when its PR is closed. The Part 02 public deployment remains the production rollback point.
