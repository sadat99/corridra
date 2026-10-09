# Corridra

Cross-border market access, starting with Bangladesh and Spain/EU.

Parts 01 through 08 are implemented and deployed. Corridra includes the public website, mission intake and review, counterparty research, controlled introductions and meetings, commercial follow-through, and client/institutional delivery. Neon Auth customer signup, email verification, sign-in, sign-out and password recovery are live. Parts 09 through 12 remain planned.

Mission intake and operational data remain restricted to invented test records. Customer accounts do not grant workspace membership. Real customer imports, outreach email, production evidence storage/scanning and the paid-customer pilot retain the gates in the [deferred controls register](docs/implementation/deferred-controls.md). Part 07's production commercial write check remains deferred by the owner; full commercial and delivery journeys passed in isolated test environments.

## Access

| Journey                           | Entry point                                                                                   | Access                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Public website                    | [c.obsidianglobal.studio](https://c.obsidianglobal.studio)                                    | Public                                             |
| Customer signup                   | [Create an account](https://corridra.vercel.app/signup)                                       | Email verification required                        |
| Customer sign-in and profile      | [Sign in](https://corridra.vercel.app/signin), [account](https://corridra.vercel.app/account) | Verified customer session                          |
| Password recovery                 | [Reset access](https://corridra.vercel.app/forgot-password)                                   | Received email link                                |
| Operator/admin workspace          | [Operator sign-in](https://corridra.vercel.app/operator/signin)                               | Existing invitation, tenant role and password/TOTP |
| Test mission intake               | [Plan a mission](https://corridra.vercel.app/plan)                                            | No account required; test briefs only              |
| Buyer, client and programme views | Links issued from the workspace                                                               | Scoped capabilities with expiry/revocation         |

Interactive production pages use `https://corridra.vercel.app` as their canonical origin. Other aliases redirect there while preserving receipt and recovery query parameters. Customer identities and operator identities are separate: matching email addresses never grant operator access. The owner's existing admin access and MFA remain intact.

Neon Auth stores accounts in Frankfurt and sends identity mail through Resend SMTP in Ireland. Received verification and recovery emails, reset-token reuse denial and live browser session behavior passed acceptance. [The account runbook](docs/runbooks/neon-auth-accounts.md) and [production acceptance record](docs/implementation/neon-auth-production-activation.json) contain the release evidence. Support uses the monitored `sadat@obsidianglobal.studio` inbox; `sadat@c.obsidianglobal.studio` is the sending address. Mission replies and outreach do not send email.

## Documents

- [Documentation index](docs/README.md)
- [Positioning & Messaging Constitution v1.0](docs/brand/positioning-messaging-constitution-v1.0.md)
- [Public Experience v1.0](docs/product/public-experience-v1.0.md)
- [Implementation Canvas v1.0](docs/architecture/implementation-canvas-v1.0.md)
- [12-part implementation plan and current status](docs/implementation/plan-v1.0.md)
- [Part 06 access and meetings](docs/implementation/part-06-release.md)
- [Part 07 commercial follow-through](docs/implementation/part-07-release.md)
- [Part 08 client and institutional delivery](docs/implementation/part-08-release.md)

Original uploads remain byte-for-byte intact in `docs/source/`. The constitution working copy includes the requested writing rule under section 21. Release records distinguish historical results from current activation status.

## Development

Use Node 24.19.0 and pnpm 11.19.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The Next.js app lives in `apps/web`; root scripts select the correct workspace. The public shell runs without application secrets. Persistent intake, operator features and managed customer accounts require their documented secure configuration. Use isolated development databases and separate signing material; never bind previews to production credentials. Follow the [development runbook](docs/runbooks/development.md), [foundation runbook](docs/runbooks/part-03-foundations.md) and [account runbook](docs/runbooks/neon-auth-accounts.md).

## Validation

```sh
pnpm db:local
pnpm db:prepare-local
pnpm scanner:local
pnpm exec playwright install --with-deps chromium
pnpm check
```

Docker is required for local PostgreSQL and scanner checks. `pnpm check` runs formatting, lint, typechecking, document/infrastructure checks, real database integration tests, the production build and public/protected browser suites. Tests cover tenant isolation, MFA, provenance, atomic events, quarantine, financial history, capability revocation, imports and exports. Browser checks include responsive layout, accessibility and actual operator journeys. Mission test submissions are persisted; their claims remain self-declared.

Managed Neon Auth also needs isolated provider acceptance and received-email checks. Request success alone does not prove delivery. Keep credentials, authentication cookies, received codes and reset links out of source, logs and uploaded test artifacts.

## Release and cleanup

Release through short-lived PRs with passing checks on the reviewed revision. GitHub Actions validates PRs and `main`; Vercel Git integration deploys `main`. Repository protection, CodeQL entitlement and other account controls retain their separately documented status. Deploy with Vercel Root Directory `apps/web`, Node 24.x, workspace files outside the root included and the existing Frankfurt runtime configuration. The [deployment runbook](docs/runbooks/deployment.md) covers verification and rollback.

Confirm the production deployment is READY at the intended commit and test the live behavior before recording acceptance. Preserve additive migrations, original owners, personal admin sessions and immutable history. Disable affected feature flags for rollback rather than deleting production records.

Under the owner's standing cleanup instruction, remove completed short-lived Git branches, unused temporary Neon branches and their exact retired preview settings after acceptance and sanitized evidence are preserved. Inspect project/branch IDs, parents, children, PR status and bindings first. Keep production/default databases, sterile parents, open-PR environments and unfinished work. Revoke temporary protection-bypass credentials and remove test identities created for the release. Cleanup runs at task completion; no background deletion scheduler is installed.
