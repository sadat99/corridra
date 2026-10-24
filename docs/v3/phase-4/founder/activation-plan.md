# Founder activation view: bounded plan and acceptance record

**Document status: DONE.** Planned and built as source. The capability stays PARTIAL for the whole product. It is not a to-do list. See the [plan status register](../../../PLAN_STATUS.md).

Contract sections: 4 (the founder's clarity layer), 6 (founder overview, P1) and 9 (Phase 4 founder controls). Status of the whole capability: PARTIAL.

## Changed requirement IDs

| Requirement                                                               | Status after this work                                                                                                                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V3-04-089 (what is actually activated)                                    | PARTIAL: the Business overview now reads which customer modules this deployment serves, with a plain reason for each. Whether a database module is installed is not inferred. |
| V3-09-035 (real versus synthetic status)                                  | PARTIAL: the view states the deployment (production, preview or development) and whether data is synthetic.                                                                   |
| V3-09-036 (product and service availability)                              | PARTIAL: sixteen customer modules, each on, off, waiting for a prerequisite or locked. Staff tools keep their own evidence.                                                   |
| V3-06-014 (founder overview and guided product exploration)               | PARTIAL: unchanged status, more evidence. The synthetic product explorer link and the source-backed dashboard link are kept.                                                  |
| V3-04-088, V3-04-090 to V3-04-094, V3-09-033, V3-09-034, V3-09-037 to 040 | Unchanged. Customer activity, revenue and blockers still come from the existing source-backed dashboard and activation register; no live figure is invented here.             |

## Existing versus new

Unchanged: the Global Corridor Control Center, the operations dashboard and its denominators, the service economics, the activation blockers register, staff identity, MFA, RLS and every migration. The static Business overview text keeps its asserted wording, and its out-of-date claims about organiser economics and delegation administration were corrected.

New: `packages/auth/src/founder-activation.ts` (a pure reader of configuration, no database), a staff-only `founder-activation` read on the existing `/api/workspace/[action]` route, `OperationsService.founderAccess` (owner and admin only, the same `audit.read` authority as the Control Center), and `apps/web/components/founder-activation.tsx` rendered inside the Business overview.

## What it shows and never shows

Per module: label, the exact flag name, and one state. ON; OFF (flag unset); WAITING_PREREQUISITE (own flag set, a module it depends on is off); LOCKED_PRODUCTION (customer modules never run on a production deployment); LOCKED_NOT_SYNTHETIC. A flag counts as set only when it is exactly `true`, matching each module's own enabled function, which this view calls rather than reimplements.

It never reads or returns a secret, connection string or credential, never counts customers, revenue or activity, and never turns a missing figure into zero. If the read fails it says nothing is assumed to be on.

## Tests

PostgreSQL and unit (7): all-off default, production lock with flags set, non-synthetic lock, prerequisite chain (templates wait on workspaces, programmes, participants, economics and coordination; the exact six modules that turn on), exact `true` only, no secret in the output, owner allowed and operator denied. Component protocol specs (9) with the real component: states and reasons, failure assumes nothing, malformed or extended responses rejected, workspace change reloads, no secret or live figure in the text, keyboard focus and axe at 320, 390, 768 and 1440. The existing founder browser journey keeps its assertions.

## Remaining gaps

Database installation state is not shown, because it needs the offline schema-owner procedure. Live customer and revenue figures stay in the existing dashboard. A guided walkthrough with demonstration data, a blocker owner register and founder-controlled toggles are not built. Nothing here switches a flag.

## Deployment and rollback

Source only, no schema. Rollback is redeploying the previous application. On a production deployment every customer module reads as locked by design, which is the correct and expected result.
