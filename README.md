# Corridra

Cross-border market access with configurable commercial corridors, evidence-backed workflows and scoped workspaces.

**Start with the [developer handoff](docs/START_HERE.md) and [current plan](docs/implementation/current-plan.md).** Original V1 Parts 1–8 are the retained foundation. The revised five-part V2 programme was implemented and merged, followed by UX-01 through UX-05 and bounded UX-06/access repairs. Original V1 Parts 9–12 are historical requirements, not the next implementation sequence. Full UX10X functional coverage and real customer readiness are not established.

Mission intake and operational records remain synthetic. Customer signup, verification and recovery are live; customer identity grants no workspace role. Production AI inference, network activation, outreach, payments and payouts remain closed. Preserve the [deferred controls](docs/implementation/deferred-controls.md), original records, MFA, RLS and exact monetary/evidence semantics.

## Access

| Person or task                            | Entry                                                                                                                                       | Authority                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| New visitor                               | [Start here](https://corridra.vercel.app/workspace), [public site](https://corridra.vercel.app)                                             | Directory and public information only                                                                      |
| Customer                                  | [Signup](https://corridra.vercel.app/signup), [sign in](https://corridra.vercel.app/signin), [account](https://corridra.vercel.app/account) | Verified identity; explicit mission invitations remain required                                            |
| Customer password recovery                | [Forgot password](https://corridra.vercel.app/forgot-password)                                                                              | Managed Neon Auth email link                                                                               |
| First invited staff setup                 | [Operator setup](https://corridra.vercel.app/operator/setup)                                                                                | Matching verified customer identity and an already approved pending invitation; own staff password and MFA |
| Existing staff and owner/admin            | [Operator sign in](https://corridra.vercel.app/operator/signin), then [workspace](https://corridra.vercel.app/operator)                     | Separate staff password, authenticator and current role                                                    |
| Staff password recovery                   | [Operator forgot password](https://corridra.vercel.app/operator/forgot-password)                                                            | Existing eligible staff; retains MFA and membership                                                        |
| Owner administration                      | Operator workspace, **People and workspace controls**                                                                                       | Owner membership management; separately permitted admin configuration/audit                                |
| Test mission brief                        | [Plan a mission](https://corridra.vercel.app/plan)                                                                                          | Invented test briefs only                                                                                  |
| Contributor, buyer, client or institution | Original assigned/private invitation                                                                                                        | Exact task/publication/capability scope and expiry/revocation                                              |

Interactive production routes use `https://corridra.vercel.app` as their canonical origin. Matching email addresses do not join customer/staff identities. Lost MFA, suspended staff and expired/new staff invitations retain reviewed recovery. Workspace administration does not grant Neon/Vercel account control.

The [identity runbook](docs/runbooks/neon-auth-accounts.md) and [PR 46 production acceptance](docs/implementation/access-recovery-production-acceptance.json) distinguish delivered emails, owner workspace entry and unobserved private reset completion. Never share or record passwords, reset links or authenticator codes.

## Documentation and verification

- [Current roadmap and old V1 Parts 9–12 disposition](docs/implementation/current-plan.md)
- [Requirement/code/test/limit matrix](docs/implementation/implementation-matrix.json)
- [Architecture map](docs/architecture/v2-current-map.md) and [ADR index](docs/adr/README.md)
- [Verification and continuation guide](docs/verification-guide.md)
- [Complete UX10X requirements and phase evidence](docs/ux10x/README.md)
- [Documentation index](docs/README.md) and [document classification catalogue](docs/documentation-map.md)

The three source uploads, V2 owner packets and full UX handoff are preserved. Historical plans and release records remain available with their dates and scope. Use the current plan for status; use source requirements and executed evidence to audit missing work. A merged phase is not exhaustive coverage.

## Development

Use Node 24.19.0 and pnpm 11.19.0. The Next.js app is `apps/web`; root commands select the workspace.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The public shell needs no application secrets. Persistent features and customer/staff authentication require isolated, documented bindings. Follow [development](docs/runbooks/development.md); never bind previews or tests to production credentials or an unverified ambient database URL.

```sh
pnpm db:local
pnpm db:prepare-local
pnpm scanner:local
pnpm exec playwright install --with-deps chromium
pnpm check
```

Docker is required for local PostgreSQL/ClamAV. `pnpm check` runs formatting, lint, types, document/infrastructure checks, database integration, build and public/protected browser suites. These suites can persist synthetic submissions: **do not run them against production**. Verify provider email delivery separately; HTTP success alone is insufficient.

## Release

Use reviewable PRs and passing checks on the intended revision. Under standing owner authorization, correctly checked merges are deployed immediately. Vercel Git auto-deployment for `main` is on (owner decision, 2026-10-20): every push to `main` deploys to production, so `main` is production. Do not deploy by hand; verify that the deployment for the merged SHA is READY, holds the production aliases and passes bounded live checks. The preview branches listed in `apps/web/vercel.json` stay off. See [deployment and rollback](docs/runbooks/deployment.md). Repository enforcement and CodeQL entitlement retain their separately documented limitations.

Builds never migrate. Preserve additive migrations, original owners/MFA, history and readiness gates. Retire only proven completed temporary branches/previews under the cleanup rules in `AGENTS.md`, preserving open dependency PRs, unfinished work, production and sterile parents. No background cleanup scheduler is installed.
