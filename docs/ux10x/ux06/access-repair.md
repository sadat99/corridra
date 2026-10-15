# Access repair scope and acceptance

The account and operator experiences previously offered too many unrelated choices and did not make a pending owner invitation apparent. PR 45 reorganized the workspace entry and mission workflow. This packet adds invitation guidance, operator password recovery and a named existing-member selector, retaining every original service and permission.

## Where each person starts

| Person                                     | Entry and recovery                                        | Authority                                                                          |
| ------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| New customer                               | `/signup`, `/verify-email`, `/signin`, `/forgot-password` | Verified account only; no staff role                                               |
| Existing customer                          | `/account`                                                | Explicit mission invitations and test-brief receipts                               |
| Invited staff, including the initial owner | Verified customer account, then `/operator/setup`         | Only an already approved current invitation; own password and real authenticator   |
| Existing staff                             | `/operator/signin`, `/operator/forgot-password`           | Existing password, MFA and workspace membership                                    |
| Owner                                      | `/operator`, then **People and workspace controls**       | Workspace settings, permitted membership controls, audit and readiness             |
| Admin                                      | `/operator`, then **People and workspace controls**       | Permitted configuration and audit; owner-only membership changes remain restricted |
| Reviewer, operator or viewer               | `/operator`                                               | Original role-filtered tools and server authorization                              |
| Contributor                                | Original assigned workspace invitation                    | Exact identity, task, expiry and MFA                                               |
| Buyer, client or programme recipient       | Original private capability link                          | Existing exact capability scope; a public signup cannot replace it                 |

Owner includes admin capabilities. It is a workspace role, not Neon or deployment-provider administration. A matching customer email is not an activated staff membership. Lost authenticators, expired invitations, suspended staff and new invitations need the existing reviewed recovery procedure. The UI must not promise self-service role grants or provider-wide account management.

## Verification record

PR 46 merged and deployed the exact checked revision with migration 0029 separately verified on the live synthetic branch. The owner privately completed invitation/password/MFA and confirmed workspace entry. Both actual customer and staff reset emails were received. The latest private reset-link consumption/new-password sign-in was not observed; credentials and authenticator material were never captured. See [dated production acceptance](../../implementation/access-recovery-production-acceptance.json) for CI, deployment and bounded browser observations.

Lost MFA, suspended staff and expired/new invitations retain reviewed recovery. Pending invitations deliberately do not receive existing-staff reset mail. This bounded repair does not establish full UX10X action coverage, all-role live acceptance or real operational readiness.
