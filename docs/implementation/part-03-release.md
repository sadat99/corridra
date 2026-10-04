# Part 03: Data, identity, tenancy and trust foundations

Status: implemented and locally validated on `feat/part-03-foundations`. Cloud acceptance is blocked. This is not a production release or a claim of 100% completion. Public production remains Part 02 at https://corridra.vercel.app. No customer import or public intake has been enabled. Automatic deployment of this branch is disabled in `apps/web/vercel.json` while preview credentials share production scopes. Remove that branch-specific hold only after isolation is verified; it does not change production deployment behavior.

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

`pnpm check` passes formatting, lint, TypeScript, 7 document integrity tests, 25 integration tests, 44 desktop/mobile public browser tests and 1 protected operator browser workflow. The integration tests run against PostgreSQL 17, including actual Better Auth TOTP enrollment/signout and actual ClamAV clean/EICAR/error behavior. The S3 test uses the real SDK against a local HTTP contract server and is not an AWS residency or permissions test. Local fresh/upgrade migrations and logical backup/restore pass; restricted-role access and denial are rechecked on the restored database.

The operator browser test covers password-only denial, enrollment, source/claim creation, tenant and CSRF denial, expired step-up followed by re-verification, persisted feature state, accessibility and signout. Operator screenshots/traces/video are disabled. The public browser suite passes. Browser testing also found and fixed a missing landmark on the shared availability notice without changing its copy or appearance.

## Remaining acceptance gates

| Gate                                                    | Evidence/status                                                                                                                          | Closure needed                                                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| EU Neon production and separate non-production projects | Existing supplied URL identifies US East; it has not been connected to or changed. `NEON_API_KEY` is absent.                             | Secure Neon API access, approved EU resource IDs and live region/role checks                                         |
| Protected synthetic Vercel preview                      | Not deployed with data. The current Vercel API token cannot inspect integration-owned resources: HTTP 403.                               | Create isolated child, branch-only restricted credentials, real operator identity and protected preview checks       |
| No production credentials in preview                    | Vercel metadata shows Neon integration variables and `VERCEL_TOKEN` scoped to preview and production. Values were not disclosed or used. | Separate database scopes and remove deployment token from app runtime with account-level access                      |
| EU object store and deployed scanner                    | Adapter, policy template and local tests exist. AWS credentials/bucket and private cloud scanner are absent.                             | Provision/verify private EU storage, managed scanner connectivity, current signatures and deployed quarantine checks |
| Cloud recovery                                          | Local logical restore passes. Neon history/PITR and S3 version recovery are not verified.                                                | Separate non-production cloud restore and measured recovery evidence                                                 |
| Protected branch/account controls                       | GitHub protection API returned HTTP 403. CODEOWNERS, dependency updates and CodeQL are configured in code only.                          | Account owner verifies required CI/review, secret scanning and push protection                                       |

Do not merge or promote the data preview until these gates pass. The tested environment setup draft is saved and requires publishing. Its existing `NEON_API_KEY` destination must be edited in environment settings to include `console.neon.tech`; the draft API rejected changing an existing secret target. The environment setup draft is not equivalent to a saved secret binding or an applied runtime/network policy. Production migration mode is deliberately absent from the Part 03 scripts. TOTP is implemented; passkeys, invitation email, automated privileged recovery, legal-hold/DSAR execution and outbox dispatch are not claimed.

## Rollback

Keep `CORRIDRA_FOUNDATIONS_ENABLED` absent/false in production. Disable it in preview to close operator routes, revoke preview identities and retain database history. Use compatible forward migrations; do not rewrite immutable evidence/audit/event records. Remove only the matched non-production child branch when its PR is closed. The Part 02 public deployment remains the production rollback point.
