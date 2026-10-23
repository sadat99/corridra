# Rehearsal Mission proposal (Phase 0, item 7)

Date: 2026-10-23. Status: proposal for the owner. Docs only. This file adds no code and no migration.

Owner goal: click through the whole mission journey without touching a real customer.

Words: this page says "sample" for invented test data. The code calls it `synthetic`, so code names keep that word. The repo also uses "rehearsal" for something else: a disposable database install check (for example `docs/v3/cleanup/2026-10-22-pr126-network-rehearsal.json`). A Rehearsal Mission is a sample mission that people walk by hand.

## 1. Short answer

| Question                                      | Answer                                                                                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can it be built with no schema change?        | Yes for the staff, buyer and client views, on the live site or in a sample environment. Yes for the customer views only in a sample environment. No for the customer views on the live site.        |
| What is the smallest change?                  | None in code. Use the sample workspace that already exists, a short owner-run checklist, and a naming rule. Three small screen-only fixes are optional.                                             |
| When would a database change be needed?       | Only if the owner wants the customer views on the live site. That is one new optional installer module with one function and one allow-list table. It alters no existing table, policy or function. |
| Does it keep gates D01 to D06 and D08 closed? | Yes. It changes no gate, sends nothing, takes no payment and needs no real data.                                                                                                                    |
| Recommendation                                | Run the staff, buyer and client walk on the live sample workspace now. Run the customer walk in a sample environment. Decide on the database change later, after a test proves it is needed.        |

## 2. What exists today

Every row below was read in the repo.

| Item                                            | What it does                                                                                                                                                            | Path                                                                                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sample flag on every workspace                  | `app.tenant.synthetic` marks a workspace as sample. A sample workspace gets purpose `synthetic_validation`. A real one gets `commercial_qualification`.                 | `packages/db/customer-real-use-migrations/0002_real_request_authority.sql` lines 2 to 4                                                                      |
| Sample and real live in one database            | Customer sessions see sample workspaces. Staff see a workspace only if their membership lists its purpose.                                                              | same file lines 431 to 442; `packages/db/customer-real-use-migrations/0005_real_staff_scope.sql` (`app.my_tenants`)                                          |
| Sample intake keeps its own destination         | The old notice still routes to `app.intake_destination`. The real notice routes to a separate real tenant.                                                              | `0002_real_request_authority.sql` lines 665 to 673                                                                                                           |
| The live sample workspace exists by design      | Real admission can only be switched on if the sample intake owner and staff already exist. The staff invitation code names "the exact live synthetic intake workspace". | `packages/auth/src/customer-real-use-configuration.ts` lines 39 to 55; `packages/auth/src/operator-invitation.ts` line 144                                   |
| Sample contacts are forced to `example.invalid` | The database rejects any other address in a sample workspace, and any sample company domain outside `example.invalid`.                                                  | `packages/db/customer-real-use-migrations/0007_real_private_contacts.sql` lines 4 and 7                                                                      |
| Introductions can only go to sample targets     | The send check needs a sample workspace, a sample company, a contact at `example.invalid` and channel `SYNTHETIC` or `MANUAL`. Channel `EMAIL` is refused.              | `packages/db/migrations/0009_controlled_communications.sql` lines 96 to 98, 115, 123, 285                                                                    |
| The only wired outreach adapter sends nothing   | `SyntheticChannel` writes a receipt row. `EmailChannel` fails unless sender readiness is set, and the app never wires it.                                               | `packages/communications/src/adapters.ts`; `apps/web/lib/foundations.ts` lines 118 and 493                                                                   |
| Staff can create a sample mission               | A programme import turns each row into a mission through `app.import_mission_brief`. In a sample workspace the email must end in `example.invalid`.                     | `packages/delivery/src/index.ts` line 265; `packages/db/customer-real-use-migrations/0006_real_programme_import.sql`                                         |
| A sample import file exists                     | `intakeTemplate()` returns one invented row.                                                                                                                            | `packages/delivery/src/import.ts` lines 429 to 431                                                                                                           |
| Offline seed tools                              | Seed a sample workspace and owner; set the sample intake destination; used by the local browser server.                                                                 | `packages/auth/src/bootstrap.ts` line 7; `packages/missions/src/bootstrap.ts`; `scripts/operator-browser-server.ts` lines 32 to 37                           |
| Sample labels on screen                         | Staff badge "Synthetic workspace" versus "Operational workspace". Customer picker says "Example workspace." Buyer page says "Invented demonstration. No real outreach." | `apps/web/app/operator/workspace.tsx` lines 163 and 331; `apps/web/components/workspace-chooser.tsx` line 73; `apps/web/app/buyer/introduction.tsx` line 165 |
| Static samples                                  | The home page example and "See a sample mission" are fixed text. They are not stored records and have no screens behind them.                                           | `apps/web/components/home-example-record.tsx` line 21; `apps/web/app/workspace/page.tsx`                                                                     |
| Name clash to avoid                             | `SAMPLE` in the record kinds means a product sample sent to a buyer. It is not sample data.                                                                             | `packages/domain/src/opportunities.ts` line 37                                                                                                               |

## 3. Question 1: can it be built with no schema change?

Yes, with one limit. There are three routes.

| Route                                   | Where it runs                                                                                       | Roles it can walk                                                                            | Schema change | Can a real customer be reached?                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------- |
| A. Sample environment                   | A preview on a Neon child of the sterile parent, or a local database. `DATA_ENVIRONMENT=synthetic`. | All: customer, staff, buyer, client, institution.                                            | None          | No. It is a different database. `docs/adr/0012-synthetic-preview-lifecycle.md`; `scripts/neon-preview.ts` |
| B. Live site, existing sample workspace | The production site, in the sample workspace that already exists.                                   | Staff (owner, admin, operator, reviewer, viewer), buyer link, client link, institution link. | None          | Same database as real workspaces. Kept apart by workspace rows, purposes and row-level security.          |
| C. Live site, customer views            | The production site.                                                                                | Customer owner, admin, member.                                                               | Yes, small    | Same as B.                                                                                                |

Why the customer views fail on the live site today:

- `/api/intake` returns 409 when real use is on (`apps/web/app/api/intake/route.ts` line 15).
- A new customer workspace takes its sample or real mark from `customer_private.synthetic_context()`. With no workspace chosen yet, a real session gets "real" (`0002_real_request_authority.sql` lines 10 to 12, and `customer.provision_workspace` in the same file). So any workspace made on the live site is real.
- The live site sets real mode for the whole process (`packages/auth/src/customer-production.ts`, `realUseEnabled`). The sample environment is the only place where the old `/plan` form and the "Synthetic " name rule apply.

Route A is also the strongest proof of isolation, because the data lives in another database. ADR-012 warns that the `DATA_ENVIRONMENT` flag is "a guard, not independent proof of isolation". The separate Neon child is the proof.

### The journey and who can walk it

Permissions come from `packages/domain/src/index.ts` lines 65 to 87. Mission states come from `packages/domain/src/missions.ts` (`missionStatus`). Navigation comes from `apps/web/lib/workspace-navigation.ts`.

| Step                        | Screen                                                      | Who                                                                        | Route that works                                                                                                     |
| --------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1. Request arrives          | `/plan` form, then `/account`                               | Customer                                                                   | A only                                                                                                               |
| 1b. Request arrives (staff) | `/operator`, Delivery, programme import                     | Owner, admin, operator                                                     | A and B                                                                                                              |
| 2. Triage and qualify       | `/operator`, Missions                                       | Owner, admin, operator (reviewer and viewer read)                          | A and B                                                                                                              |
| 3. Research companies       | `/operator`, Research                                       | Owner, admin, operator; resolve: owner, admin, reviewer                    | A and B                                                                                                              |
| 4. Introduction             | `/operator`, Meetings; policy approval owner and admin only | Owner, admin, operator                                                     | A and B (owner must switch on `communications.introductions` and `communications.dispatch`; both are off by default) |
| 5. Buyer answers            | `/buyer` capability link, no account                        | Buyer                                                                      | A and B                                                                                                              |
| 6. Meetings and follow-up   | `/operator`, Meetings                                       | Owner, admin, operator                                                     | A and B                                                                                                              |
| 7. Commercial pipeline      | `/operator`, Commercial (records only, no money moves)      | Owner, admin, operator; accounting: owner, admin                           | A and B                                                                                                              |
| 8. Share an approved view   | `/operator`, Delivery, then `/client` or `/institutions`    | Owner or admin with fresh MFA shares; client or institution opens the link | A and B                                                                                                              |
| 9. Customer sees the result | `/account`, reviewed delivery (ADR-040)                     | Customer                                                                   | A only                                                                                                               |
| 10. Close                   | `/operator`, Missions                                       | Owner, admin, operator                                                     | A and B                                                                                                              |

Each staff role needs its own verified account and authenticator. The owner invites staff from the sample workspace (`packages/auth/src/operator-invitation.ts` lines 36 to 39). The owner role alone covers steps 1b to 8, so a first walk needs one account plus one link-only viewer.

## 4. Question 2: the smallest change (routes A and B)

### 4.1 Change

No code and no schema. The change is a written checklist plus a naming rule.

Owner checklist for route B:

1. In the workspace picker, open the existing sample workspace (badge "Synthetic workspace").
2. In the workspace controls (`apps/web/app/operator/workspace-controls.tsx`), switch on the features for introductions and dispatch.
3. In Delivery, create a programme and import the one-row file from `intakeTemplate()`. Change the names so each starts with "Synthetic Rehearsal".
4. Walk steps 2 to 8 and 10 in section 3.
5. Open the `/buyer` and `/client` links in a private window.
6. Note the date and the result in the ledger.

For route A, use a PR preview as `docs/adr/0012-synthetic-preview-lifecycle.md` describes, or the local browser server (`scripts/operator-browser-server.ts`, KI-15 in `docs/v3/KNOWN_ISSUES.md`). Steps 1 and 9 work there.

### 4.2 Optional screen-only fixes (no schema)

| Fix                                                                                                                   | Why                                                                                                                                                                                    | Path                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Show the client and institution notice only for sample workspaces                                                     | The text "Invented test mission data. Real customer mission admission is not enabled." is fixed. Real admission is now enabled, so it can be wrong on a real report.                   | `apps/web/app/delivery-view.tsx` line 269                               |
| Add a loud "Rehearsal" banner on every staff screen when the workspace is a sample and the deployment is in real mode | In real mode the app no longer forces the "Synthetic " prefix on free text (`packages/domain/src/customer-input-mode.ts`, `customerLabelAllowed`). Only the badge marks the workspace. | `apps/web/app/operator/workspace.tsx`                                   |
| Same banner on `/buyer`, `/client` and `/institutions`                                                                | Link holders have no workspace badge.                                                                                                                                                  | `apps/web/app/buyer/introduction.tsx`, `apps/web/app/delivery-view.tsx` |

### 4.3 How a Rehearsal Mission is labelled

| Layer                      | Mark                                                                                                                           | Enforced by                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Workspace                  | Name starts "Synthetic Rehearsal". Existing badge and picker text.                                                             | Convention plus existing badge                            |
| Mission and companies      | Every name starts "Synthetic Rehearsal". Contacts end in `example.invalid`. Company domains end in `example.invalid`.          | Database for addresses and domains. Convention for names. |
| Staff screens              | Existing badge. Optional banner (4.2).                                                                                         | Screen                                                    |
| Buyer, client, institution | Existing buyer line. Optional banner (4.2).                                                                                    | Screen                                                    |
| Reports and exports        | Report carries `purpose` (`packages/delivery/src/report.ts` line 193). It reads `synthetic_validation` for a sample workspace. | Existing report code                                      |

Gap: on the live site nothing forces the name prefix. Operators must follow the rule.

### 4.4 How it stays out of every count, report and delivery

Rule: the sample workspace is its own tenant. Every query reads one tenant.

- The mission queue filters `m.tenant_id=$1` (`packages/missions/src/index.ts`, `queue`).
- The operations dashboard, rates, totals and money views are built from `base` rows filtered by `m.tenant_id=$1` and join only `tenant_id` pairs (`packages/missions/src/operations.ts` lines 590 to 670).
- Commercial totals take one tenant argument (`packages/db/migrations/0015_shared_commercial_totals.sql`).
- Reports, links and deliveries are made from one tenant's rows. Staff sharing needs a sample tenant and an owner or admin with MFA (`packages/db/migrations/0016_scoped_delivery.sql` line 70).
- A staff member whose membership lists only `commercial_qualification` cannot list the sample workspace (`0005_real_staff_scope.sql`). A real customer cannot be a member of it.
- Introductions cannot leave a sample workspace (section 2).

I checked the count queries I could find. I did not audit every query in the repo. Proposed proof: one integration test that adds a full sample journey and asserts that the real intake tenant's totals do not change.

Cleanup: history is append-only, so sample rows stay. Records use `app.reject_rewrite` triggers (for example `packages/db/migrations/0014_scoped_mission_import.sql` line 10). Stopping means revoking the extra memberships and switching the features off.

## 5. Question 3: if a database change is needed (route C only)

Routes A and B need none. Route C needs one small change so a customer account can own a sample workspace on the live site.

### 5.1 Smallest additive change

New optional installer module, built the same way as `customer-real-use-migrations`:

| Part                                                                                                 | Content                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One allow-list table, for example `customer_private.rehearsal_principal`                             | Owner adds the account ids allowed to make a sample workspace. Row-level security on. No grant to `corridra_runtime` or `corridra_auth`. Rows cannot be rewritten.                                                                                                |
| One control table, append-only versions                                                              | Same shape as `customer_private.real_use_admission_control`. Latest row says enabled or paused.                                                                                                                                                                   |
| One `SECURITY DEFINER` function, for example `customer.provision_rehearsal_workspace(command, name)` | Copy of `customer.provision_workspace`, with the tenant inserted as `synthetic=true`, the name forced to start "Synthetic Rehearsal ", a cap per account, and the allow-list and control checks. `search_path` fixed. Execute granted to `corridra_runtime` only. |
| Installer glue (new files)                                                                           | A migrate file in `packages/db/src/`, an entry in the `registries` and `installers` lists in `scripts/install-customer-modules.ts`, and a workflow input.                                                                                                         |

Rejected: a flag on each mission row. Migration 0002 had to change purpose checks on 19 tables for real use (`0002_real_request_authority.sql` lines 17 to 71). A per-mission flag would touch the same set and every function that guards them.

### 5.2 Blast radius

- Adds: two tables and one function. Alters: nothing existing. No policy, trigger, grant or signature changes.
- Follows the existing guard pattern: a hash check of any function it depends on (`DO $guard$` blocks in the real-use files).
- Risk that grows the change: I did not trace every customer function for a real login inside a sample workspace. The pieces that point to it working are `customer.workspaces()` (shows sample workspaces to real sessions) and `MissionService.prepareCustomerIntake` (takes a per-workspace sample flag, `packages/missions/src/index.ts` lines 110 to 125). No test I found runs that case end to end. If a test shows a customer function refuses it, stop and re-plan. Do not widen the module on the fly.

### 5.3 Row-level security

- Existing policies apply unchanged because the new workspace is an ordinary tenant with `synthetic=true`.
- New tables follow the pattern in `customer-real-use-migrations/0001_verified_guest_handoff.sql`: row-level security on, all rights revoked from the runtime and auth roles, rewrite trigger on.
- Staff scope is untouched, so real-only staff still cannot see the sample workspace.

### 5.4 How it would be applied

- Use the owner-run workflow `.github/workflows/install-customer-modules.yml`. It runs only on `main`, in the protected `customer-modules-install` environment (one reviewer, per ADR-056), as login `corridra_migrator` on the approved Frankfurt host. The default is a read-only report. Install needs `apply=yes`.
- Installers are idempotent and refuse a changed or missing applied file (`scripts/install-customer-modules.ts`).
- Rehearse first on a disposable Neon branch with an immutable-registry replay and an authority check, as for PR118 and PR126 (`docs/v3/cleanup/2026-10-21-pr118-real-use-rehearsal.json`, `docs/v3/cleanup/2026-10-22-pr126-network-rehearsal.json`).
- The app side needs its own flag, off by default, like every other customer module.
- Do not write the migration until the owner picks route C.

### 5.5 Exclusion from counts, reports and delivery

Same as 4.4. The new workspace is a sample tenant, so counts, reports and deliveries stay tenant-scoped. Customers who own one still see their real workspaces separately.

### 5.6 Rollback

- Append a "paused" row to the control table. The function then refuses new sample workspaces.
- Unset the app flag.
- Keep tables, rows and history. They are never dropped (the rule in ADR-049 and ADR-056).

## 6. Safety

| Gate or risk                  | Position under this proposal                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D01 malware scanning          | Stays closed. Production keeps `EVIDENCE_SCAN_MODE=bypass` (ADR-049). Rule: no file uploads in a rehearsal, or invented files only.                                                                                                        |
| D02, D03, D04 GitHub controls | Stay closed. Nothing here touches them.                                                                                                                                                                                                    |
| D05 EU S3, D06 Blob cleanup   | Stay closed. No new storage. Rehearsal uploads are not needed.                                                                                                                                                                             |
| D08 privacy, legal, retention | Stays closed. Only invented people and companies. Real personal data is never entered. Sample history cannot be deleted, so it must be invented.                                                                                           |
| Outreach                      | Nothing is sent. `SyntheticChannel` writes a receipt. The database refuses channel `EMAIL`. `EmailChannel` is not wired (`apps/web/lib/foundations.ts` line 493).                                                                          |
| Payment                       | None. Commercial records are records, not payments (ADR-049). Billing is missing (`docs/V3_LEDGER.md`).                                                                                                                                    |
| Customer data                 | None. Contacts are `example.invalid`. The database enforces this in a sample workspace.                                                                                                                                                    |
| AI                            | Production inference is not enabled (ADR-049). Skip the AI steps in a rehearsal.                                                                                                                                                           |
| Shared deployment (route B)   | The ledger says real request admission is enabled on the live site. A real intake tenant therefore shares the database with the sample workspace. Use a staff login scoped to the sample purpose only, so it cannot open a real workspace. |

## 7. Recommendation and owner decisions

Recommendation:

1. Adopt route B for the staff, buyer and client walk. It needs no code and no schema change.
2. Adopt route A for the customer walk and for any demo where the owner wants proof that no real database is reachable.
3. Do the three screen-only fixes in 4.2 as one small UI change. The first one fixes copy that may now be wrong.
4. Hold route C. Ask for it only if the owner needs the customer views on the live site.
5. Add the integration test in 4.4 so exclusion is proved, not assumed.

Decisions needed from the owner:

| #   | Decision                                                                                                   | Default if no answer                  |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | Is a staff, buyer and client walk on the live site enough, with the customer walk in a sample environment? | Yes                                   |
| 2   | Approve the three screen-only fixes in 4.2?                                                                | Yes, one small PR                     |
| 3   | Do you want customer views on the live site (route C)?                                                     | No                                    |
| 4   | If route C: approve a rehearsal of the installer on a disposable branch first?                             | Yes                                   |
| 5   | Who may hold the sample-only staff login, and who invites it?                                              | Owner invites; owner decides the list |
| 6   | Is the name "Rehearsal Mission" final, given that "rehearsal" already means a database install check?      | Keep, and define it in the UI help    |
| 7   | May the first walk use file uploads? (D01 stays closed.)                                                   | No uploads                            |

## 8. What I could not confirm

- Whether the owner's Phase 0 plan meant more than the goal quoted at the top. The goal and the three questions (no schema change, smallest change, what a database change would need) come from that plan's item 7.
- That the live sample workspace still exists, that its owner and staff still hold the sample purpose, and that the delivery and introduction features are switched on there. The code implies it (section 2), but I did not read the live database or Vercel settings.
- That a real login can run the whole customer flow inside a sample workspace (5.2). No test found.
- What `synthetic: config.DATA_ENVIRONMENT === 'synthetic'` does for customer services on the live site, where it is false (`apps/web/lib/foundations.ts` line 201 and its repeats). I did not trace its effect.
- Whether any report or count outside `packages/missions/src/operations.ts`, `packages/missions/src/index.ts` and `packages/db/migrations/0015_shared_commercial_totals.sql` reads across tenants. I did not search all of them.
- Whether the preview route A is available today: it needs a sterile parent branch, a free Neon branch slot and a PR number. The ledger says the sterile template is kept, but I did not check it.
