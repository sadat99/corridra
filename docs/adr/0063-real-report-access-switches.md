# ADR-063: Owner switches for shared reports of real workspaces

Status: bounded implementation. Two independent owner switches, one defaults off and one defaults on, so behaviour on deploy is exactly what it was before. No data is copied or relabelled. Closed gates D01 to D06 and D08 are untouched.

## Context

A staff member publishes a commercial report and shares it by a link. The link is an expiring capability: only its hash is stored, it can be revoked, and it carries one publication. For a sample workspace anyone holding the link can read the report. For a real workspace, [real-use 0009](../../packages/db/customer-real-use-migrations/0009_real_report_links.sql) let a verified real customer session save and open such a link, and the anonymous path still refused it. The owner asked on 24 October 2026 to keep both ways of reading a real report available, each behind its own switch, so either can be turned on or off without a code change.

## Decision

| Switch                                              | Meaning                                                                                                                           | Default        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED` = `true` | Anyone holding an unexpired, unrevoked link can read that real report and answer its requests without signing in. Needs real use. | Off, as before |
| `CORRIDRA_REAL_REPORT_SIGNED_IN_ENABLED` = `false`  | Turns off a verified real customer's saved reports, report history, company history, decisions and assigned reports.              | On, as before  |

Both are read when each request is handled, so the owner changes a setting and redeploys; nothing needs the install job. Sample workspaces are never affected by either.

How each is enforced:

- **Application.** The four customer report services (saved reports, companies, decisions, assigned missions) answer 503 "Shared reports are switched off for now" to a real session while signed-in access is off. The delivery service opens a transaction for the anonymous view and respond calls and sets one transaction-local setting only while the public switch is on.
- **Database.** Real-use migration `0010_real_report_switches.sql` replaces the single helper `app.delivery_purpose(tenant)` that 0009 added. A real customer session gets the real purpose only while `corridra.real_report_signed_in` is not `off`, which every customer session sets from the switch. An anonymous call gets it only when `corridra.real_report_public` is `on`. Both apply only to a non-sample tenant that real use allows. A tenant-scoped (staff) call is unchanged. Everything else about the re-check is unchanged: the person who made the link must still hold an owner or admin role, a verified authenticator and the real purpose in that tenant, and the link must be unexpired, unrevoked and for the right audience.
- **Owner page.** Both switches are listed with a plain label. The signed-in one is shown On unless set to exactly `false`.

## What the public link does not do

- It does not export. CSV and PDF export links stay refused for real data. They need an institution link and are a separate decision.
- It does not make the report searchable or listable. A visitor needs the link itself.
- It does not change who can create a link. Only staff with delivery authority in the real operator workspace can.

## Risks the owner accepts when turning the public link on

- Anyone who obtains the link can read that report until it expires or is revoked. Treat a link like a password: share it only with the intended person and prefer short expiry dates.
- Real company details appear in the report. Staff decide what a publication contains; nothing here widens that.
- The setting that marks a call as public is set by the application, in the same way the application already sets the tenant for staff calls. It cannot be set from the browser.

## Not included

A session-based preview that checks an invitation without saving it, a per-link switch, a per-workspace switch, export of real reports, and an in-product toggle (switches are settings changed by the owner).

## Rollback

Set the public switch to anything but `true`, or remove it. Set the signed-in switch to `false` to stop signed-in access, or remove it to restore the default. No data is touched either way. Migration 0010 is additive and its helper is harmless with both switches at their defaults.

## Required acceptance

`real-report-access-switches.test.ts`: defaults behave as before; the public link reads, answers and is refused when bad, revoked, switched off or when real use is off; signed-in off stops all four services with the same 503 and the database itself refuses a real session's share; the switches are independent; the helper gives the real purpose only to a non-sample tenant and only through a switch; the migration is recorded. The owner-page test lists both switches and shows the default-on one correctly. The sample report, company, decision and delivery suites pass unchanged.
