# Access repair scope and acceptance

The account and operator experiences previously offered too many unrelated choices and did not make a pending owner invitation apparent. PR 45 reorganized the workspace entry and mission workflow. This packet adds invitation guidance, operator password recovery and a named existing-member selector, retaining every original service and permission.

## Where each person starts

| Person                                     | Entry and recovery                                        | Authority                                                                          |
| ------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| New customer                               | `/signup`, `/verify-email`, `/signin`, `/forgot-password` | Verified account only; no staff role                                               |
| Existing customer                          | `/account`                                                | Explicit mission invitations and test-brief receipts                               |
| Invited staff, including the initial owner | Verified customer account, then `/operator/setup`         | Only an already approved current invitation; own password and real authenticator   |
| Existing staff                             | `/operator/signin`, `/operator/forgot-password`           | Existing password, MFA and workspace membership                                    |
| Owner                                      | `/operator`, then **Manage this workspace**               | Workspace settings, permitted membership controls, audit and readiness             |
| Admin                                      | `/operator`, then **Manage this workspace**               | Permitted configuration and audit; owner-only membership changes remain restricted |
| Reviewer, operator or viewer               | `/operator`                                               | Original role-filtered tools and server authorization                              |
| Contributor                                | Original assigned workspace invitation                    | Exact identity, task, expiry and MFA                                               |
| Buyer, client or programme recipient       | Original private capability link                          | Existing exact capability scope; a public signup cannot replace it                 |

Owner includes admin capabilities. It is a workspace role, not Neon or deployment-provider administration. A matching customer email is not an activated staff membership. Lost authenticators, expired invitations, suspended staff and new invitations need the existing reviewed recovery procedure. The UI must not promise self-service role grants or provider-wide account management.

## Verification record

Before this change, the saved Neon SMTP test returned success and the recipient confirmed receipt. One actual production customer reset request returned HTTP 200 with the expected generic message; inbox receipt and private reset completion are independently tracked. The live owner invitation was found pending, with no completed staff MFA/session history; no password or authenticator was set on the owner's behalf.

The new operator recovery is not accepted as live until its exact revision is tested, the separate audit migration and deployment settings are verified, the deployment is ready, and delivery is observed for an eligible existing identity. Pending invitations deliberately do not receive operator reset mail. Production password and MFA completion belong to the recipient and must not be captured in screenshots, traces or chat.

Tests and release results are recorded with the PR. This bounded repair does not establish full UX10X coverage, unrestricted customer operations or completion of every usability issue.
