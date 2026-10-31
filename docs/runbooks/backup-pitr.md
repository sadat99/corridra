# Backup and point-in-time restore runbook

Document status: CURRENT. Owned by WS-D of the commercial readiness program (V-51). It says how the owner checks that Neon point-in-time restore is on and how long its history is kept. The restore drill itself is deferred by owner decision on 31 Oct 2026 (RESTORE in the deferred register); nothing here claims a drill has run.

## What V-51 needs

1. Point-in-time restore is available for the production project.
2. The retention window (how far back a restore can reach) is read from Neon and written down below, with the date it was read.
3. The restore drill stays DEFERRED until the owner schedules it.

No agent calls Neon or any provider for this. The owner reads the setting in the Neon console.

## Check point-in-time restore and its retention in Neon

1. Sign in to the Neon console with the account that owns the Corridra production project.
2. Open the production project, then **Settings**.
3. Open **Storage** (older consoles call it **History retention** or **Point-in-time restore**).
4. Read the **history retention** value. This is how far back a branch can be restored, for example 1 day, 7 days or 30 days. The maximum depends on the Neon plan.
5. Open **Branches** and confirm the production branch is the default branch and is not marked as expired or archived.
6. Optional check that restore works without touching production: on the production branch choose **Restore** (or **Create branch from point in time**), pick a time inside the retention window and create a **new** branch. Do not restore over production. Delete the test branch afterwards, following the branch cleanup rules in `AGENTS.md`.

Record the result here:

| Read on   | Project             | Retention | Plan      | Read by |
| --------- | ------------------- | --------- | --------- | ------- |
| (fill in) | Corridra production | (fill in) | (fill in) | Owner   |

If retention is shorter than 7 days, raise it in the same settings page if the plan allows, or note the risk in the deferred register.

## Restore in an incident (summary, not yet rehearsed)

1. Stop writes: switch the affected feature off with its setting, or put the site in read only mode through the deployment settings.
2. In Neon, create a new branch from a point in time just before the incident. Never restore in place.
3. Check the new branch: row counts of `app.mission`, `app.service_ledger` and `app.domain_event`, and the latest audit events.
4. Point a preview deployment at the new branch and confirm sign-in, the Today page and one customer request.
5. Only then move production to the restored branch, with the owner's explicit approval.
6. Money and evidence history is append-only: compare ledger totals before and after, and keep the old branch until the comparison is signed off.

## Restore drill

DEFERRED by owner decision on 31 Oct 2026. Risk while deferred: a real restore has not been rehearsed, so recovery could take longer than expected. When the owner schedules it, run steps 2 to 4 above against a non-production copy, time each step, and record the result in this file.
