# Owner technical setup

Document status: CURRENT. Owned by WS-D of the commercial readiness program. Install and configuration instructions that used to sit on the owner page and the readiness page live here (UX-03, CQ-39), so those pages show status first. Nothing in this file changes a setting by itself, and none of these steps clears a deferred control.

## Optional installed records

Some records have no application switch. They exist only after the owner installs their database module.

| Record                    | Install choice                                                                                           | Note                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quote arrangement records | `field_modules_action=commercial_arrangements` (or `both`)                                               | Follows service-request access. Principal sales, billing and payments stay separate.                                                                                                                                                                                                                                                                                                                                                           |
| Problem reports           | `field_modules_action=problem_reports`                                                                   | No application switch. Installing the database module is the activation; it installs the workspace and account lifecycle modules first and leaves their controls as they are (closed on a database that never opened them). The Help menus keep Report a Problem as Coming soon until the application release that uses it.                                                                                                                    |
| Contact and note changes  | `field_modules_action=contact_changes_install`, then `contact_changes_enable` or `contact_changes_pause` | CRUD G11 Withdraw, Correct and Hide for private contacts and notes (ADR-017 amendment). Install leaves the one control closed and changes nothing anyone can see; enable opens withdraw, correct and hide together; pause stops new commands and keeps every record and state. Like the G4/G5 lifecycle choices, `contact_changes_enable` on a database where the module is absent installs it and opens it in one run. No application switch. |
| Personal details          | `field_modules_action=personal_profile`                                                                  | ADR-086 private personal details and the account security record. Needs the account lifecycle modules first (`lifecycle_install`) and refuses otherwise. Installing exposes nothing until the account page reads it.                                                                                                                                                                                                                           |
| Profile picture           | `field_modules_action=profile_picture`                                                                   | ADR-088 private profile picture references. Needs the personal profile module first (`personal_profile`) and refuses otherwise. Installing exposes nothing: the picture stays hidden until the reviewed `profilePicture` code switch is on.                                                                                                                                                                                                    |
| Commercial readiness      | Included in the default module list of the install workflow (inbox and source links)                     | Adds the in-app inbox and optional mission and company links on sources and claims.                                                                                                                                                                                                                                                                                                                                                            |

Steps:

1. Open the repository on GitHub, then **Actions**, then **Install customer modules**.
2. Choose **Run workflow** on `main`.
3. First run it with `apply=no`. Read the plan in the run log: it lists each migration it would install.
4. If the plan is what you expect, run it again with `apply=yes`.
5. Open the owner page and check that the related settings still show the state you expect.

## Real intake owner change

Owner decision of 23 November 2026: "Corridra founder" becomes the owner of new real requests, then "Synthetic operator" and "Synthetic reviewer" lose their roles in the real workspace "Corridra request operations" only. The install choice is `field_modules_action=real_intake_owner_apply`. The Guardian runs it after the merge, first on a temporary database branch.

What it does and does not do:

- It installs one small database module (`customer-real-intake-owner-migrations`), which needs the real-use modules first. Installing the module alone changes no owner.
- It adds one row to the owner record (`customer_private.real_intake_owner_version`). The newest row decides who owns a new real request. The one configuration row of real use is never written.
- It ends the two sample memberships in the real workspace by marking them removed, the same way the staff team screen does. Each removal writes an audit record in the name of the pinned service identity, because offline work has no signed-in person.
- It deletes nothing. No user, identity, customer account, workspace, request or membership row is removed. Sample workspaces, the sample intake and the owner recorded on existing requests stay as they are.
- It refuses, and writes nothing, unless each of the three names matches exactly one person in the real workspace, the new owner is an active owner or admin there with the real processing purpose and an allowed operating country, and the real workspace keeps an active owner.
- It moves no work. While a member still to be removed owns an open mission, meeting, case, opportunity or current route readiness record in the real workspace, the apply refuses with "Reassign these on the staff screens first". A signed-in staff member reassigns them on the staff screens, which keeps the normal audit record, and then the step is run again. Closed or finished work keeps its recorded owner. Open follow-ups, delivery requests and route releases are counted for information only, because their owner cannot be changed by an update.
- Once an owner is recorded, a new real request is refused with "Real intake unavailable" while that recorded owner is not an active owner or admin of the real workspace. Keep that person's role, or record another owner first. Before any owner is recorded there is no such check, so installing the module alone cannot stop real intake.
- The offline network open and pause step (`network_use_action`) uses the same owner: the recorded one when there is one, else the configuration owner. It keeps working after the earlier owner has left the real workspace.

Steps:

1. Run **Install customer modules** on `main` with `field_modules_action=real_intake_owner_apply` and `apply=no`. This is the dry run. It writes nothing and lists exactly what would change, with the three names it searched for and 8-character ids only. It also says whether the module can be installed, whether the configuration owner and the new owner each pass the intake check (membership) and the network check (membership plus operating country), and how much open work the members to remove still own.
2. Check the list: one workspace, one owner change, four check lines, the open work counts and two members. A line that starts with "apply would refuse" names what to fix first.
3. Run it again with `apply=yes`. The log shows the same lines and ends with `applied`.
4. A later run with the same choice ends with `unchanged`.

Way back: nothing needs to be deleted. Add the two members again on the staff team screen. To return new real requests to the earlier owner, add a later row to the owner record that names that person; this needs a reviewed installer step, which this change does not include.

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
