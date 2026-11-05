# CRUD standard: create, read, update and remove, the same way everywhere

Document status: CURRENT.

Owner request, 5 November 2026, verbatim: "also implement CRUD across the platform 100% correctly ,like our standard and MAANG". This spec turns that into one lifecycle standard for every object a person creates or acts on, an audit of what exists today (`docs/revamp/crud/matrix.json`) and gap PRs per track. Every revamp rule still holds: keep every action, link destination, element `id` and `name`, payload and test hook; English only; nothing in production changes without the owner.

## 1. Lifecycle classes

Every object has exactly one class. The class decides what "update" and "delete" mean.

| Class              | Examples                                                                                                    | Update means                                                                 | Remove means                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Mutable            | Workspace name, profile, company profile, saved filter, notification preference                             | Edit in place                                                                | Archive (restorable) by default; hard delete only where privacy law or the owner requires it |
| Draft, then frozen | Mission draft, service request before sending, programme terms before publishing                            | Edit while a draft; after sending or publishing, follow Record               | Discard a draft (with Undo); a sent item is withdrawn, never deleted                         |
| Membership         | Workspace member, invitation, share link, programme participant                                             | Change role or scope                                                         | Revoke or cancel, which takes effect at once and denies old deep links                       |
| Record             | Signed quote, decision, evidence, event, invoice, payment, audit entry, specification confirmation, outcome | Never edited. A correction is a new record that supersedes it, with a reason | Void or withdraw with a reason; the original stays readable to those allowed                 |

An immutable record that can be edited or hard deleted is a stop-ship defect (contract: exact money and history).

## 2. Rules for every operation

| Id   | Operation | Rule                                                                                                                                                                                                                                                      |
| ---- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | Create    | One primary action in Title Case ("New Request", "Add Member"). Forms follow the layout budget (one to three fields per step, review step). Server validation is the authority; inline errors move focus to the first problem.                            |
| C-02 | Create    | Idempotent: each submit carries a command id, so a retry or double click never creates two. The new item appears in its list at once, with a quiet confirmation (toast or status line) and focus on it.                                                   |
| R-01 | Read list | Paginated or "Load more" after a fixed count; sort and filter in the address (`?tab=`, `?filter=`) so deep links and Back work. Loading uses skeleton rows; empty, error, offline and denied states are distinct and honest.                              |
| R-02 | Read item | Every item has its own address. A person without access sees "You do not have access", never another tenant's data or an empty page that hides a denial.                                                                                                  |
| U-01 | Update    | Edit opens in place or in a dialog with the current values; Save is disabled until something changed; Cancel and Escape discard with no prompt if nothing changed and a prompt if something did.                                                          |
| U-02 | Update    | Concurrency: the save carries the version the person saw (version number or `updated_at`); if someone else saved first, the person sees both and chooses. No silent last-write-wins on shared objects.                                                    |
| D-01 | Remove    | Archive, discard, revoke or withdraw is reversible where the class allows: an Undo for at least 10 seconds, and a restore path from an "Archived" filter. Words name the action exactly ("Archive Workspace", "Withdraw Request"), never a bare "Delete". |
| D-02 | Remove    | An irreversible action (hard delete, revoke access, void a record) asks once in a dialog that names the object and its consequence, with the destructive button not focused by default. Voids and withdrawals require a reason.                           |
| A-01 | All       | Every create, update and remove writes an audit or event row: who, when, what changed and why where a reason is required. The object's history shows it to those allowed.                                                                                 |
| A-02 | All       | The server checks the role and tenant on every operation; the UI hiding a button is never the control. Denials return 403 with plain words; rate limits return 429 with the shared limit words and keep the command ready to resend.                      |
| A-03 | All       | Keyboard and screen reader: every action is a real button or link with a 44 px target, dialogs trap focus and return it, status changes are announced.                                                                                                    |

## 3. Required tests (named by id)

| Id     | Case                                                                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRUD-1 | Matrix coverage: every object in `matrix.json` has each operation its class allows, reachable in the UI for each permitted role and denied for each other role (server 403). |
| CRUD-2 | Idempotent create: the same command id twice yields one item.                                                                                                                |
| CRUD-3 | Concurrent update: a stale version is refused and the person sees the newer value.                                                                                           |
| CRUD-4 | Remove and restore: archive, Undo and restore return the same item; revoke denies an old deep link at once.                                                                  |
| CRUD-5 | Records: no edit or delete path exists for any Record-class object (route scan plus UI scan); a void or supersede keeps the original readable with its reason.               |
| CRUD-6 | Audit: every operation in CRUD-1 writes its audit or event row.                                                                                                              |

## 4. Order and ownership

1. S1: this standard and the audit matrix (`docs/revamp/crud/matrix.json`, `summary.md`), no code.
2. Gap PRs by file ownership: S2 customer objects, S3 organiser, programme and public intake objects, S4 team, contributor, recipient and owner objects. Highest severity first; Record-class defects stop other work.
3. Any gap that needs a schema change (an archive column, a version column) goes in its own PR with the migration and waits for the owner's merge. No production migration, switch, provider, payment, outreach or AI change is implied.

No screen or report claims the platform is "100% complete": the matrix shows, per object and operation, implemented, tested, merged and deployed separately, as the contract requires.
