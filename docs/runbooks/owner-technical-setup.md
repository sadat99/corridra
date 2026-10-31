# Owner technical setup

Document status: CURRENT. Owned by WS-D of the commercial readiness program. Install and configuration instructions that used to sit on the owner page and the readiness page live here (UX-03, CQ-39), so those pages show status first. Nothing in this file changes a setting by itself, and none of these steps clears a deferred control.

## Optional installed records

Some records have no application switch. They exist only after the owner installs their database module.

| Record                    | Install choice                                                                       | Note                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Quote arrangement records | `field_modules_action=commercial_arrangements` (or `both`)                           | Follows service-request access. Principal sales, billing and payments stay separate. |
| Commercial readiness      | Included in the default module list of the install workflow (inbox and source links) | Adds the in-app inbox and optional mission and company links on sources and claims.  |

Steps:

1. Open the repository on GitHub, then **Actions**, then **Install customer modules**.
2. Choose **Run workflow** on `main`.
3. First run it with `apply=no`. Read the plan in the run log: it lists each migration it would install.
4. If the plan is what you expect, run it again with `apply=yes`.
5. Open the owner page and check that the related settings still show the state you expect.

## Feature switches for this release

Each switch is off in production until you set it to `true` in the Vercel project settings, then redeploy:

- `CORRIDRA_TEAM_INVITES`: team invitations on the Workspace controls page.
- `CORRIDRA_ROUTE_PACK_FORM`: the guided "Add route pack" form in Corridors and policies.
- `CORRIDRA_NOTIFICATIONS_V2`, `CORRIDRA_UX_SHELLS_V2`, `CORRIDRA_UX_MISSIONS_V2`: owned by other parts of the release.

## Repository settings for the deferred controls (D02 to D04)

Use a GitHub account with repository administration access. A 403 from an integration does not prove that a paid feature is missing; check the actual plan and settings before buying anything.

1. **Repository rules** (Settings, Rules): protect `main` with pull requests, the CI `validate` check, review when a second trusted maintainer is available, and no force pushes or deletion. Confirm the rule applies to this private repository.
2. **Security settings** (Settings, Code security): check secret scanning, push protection and code scanning. Gitleaks and the local Semgrep rules already run in CI.
3. **CodeQL**: set `CODEQL_ENABLED` only after the plan and configuration are confirmed, then require a real successful analysis. A skipped job is not a pass.
4. **Dependency pull requests**: merge tested compatible updates, check production, then delete only merged branches. Keep `main` and unfinished work; the repository keeps fewer than nine branches.

Record what you changed and the date in the deferred controls register (`docs/implementation/deferred-controls.md`). Until then the owner, readiness and control center pages show each of these as "Deferred by owner decision".

## QA data scripts

Two scripts tidy the records created during the 31 Oct 2026 QA review. Both default to a dry run that only lists records, need the database connection string as an explicit `--connection` argument, and never delete ledger, audit or evidence rows.

- `pnpm exec tsx scripts/qa/label-synthetic.ts --connection "<connection string>"` lists made-up organisations and routes (for example the leftover AL to AU route). `--apply --confirm-production` appends "(madeup)" to organisation names only.
- `pnpm exec tsx scripts/qa/cleanup-qa-records.ts --connection "<connection string>"` lists the QA mission, report, private link, claim, evidence and programme records. `--apply --confirm-production --actor <your team member reference>` revokes only the QA report and its private link.

Run the dry run first and read its output before any apply.
