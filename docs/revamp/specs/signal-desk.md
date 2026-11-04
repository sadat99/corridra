# Signal Desk map: the 18 staff sections

Document status: CURRENT.

Track S4, Wave 5. Where each of the 18 staff workspace sections sits in the locked Corridra team navigation. The section ids, the address words in `apps/web/lib/operator-urls.ts`, the roles in `apps/web/lib/workspace-navigation.ts`, every mounted panel, MFA, tenant switching, audit and readiness gates stay exactly as they are. Only grouping and order change.

## Navigation names

Locked team navigation (UI direction, Guided experience standard): **Today, Missions, Companies, Delivery, Outcomes**, and **All tools and settings**, which keeps every section reachable. The session plan's "Work" and "More" are an open owner decision (see the [specs index](README.md)); build the locked names.

## Map

| Group                  | Section id                | Address word     | Current label                   | Roles today (unchanged)                  |
| ---------------------- | ------------------------- | ---------------- | ------------------------------- | ---------------------------------------- |
| Today                  | (landing, no section id)  | `/operator`      | Today queue                     | as today                                 |
| Missions               | `workspace-missions`      | `missions`       | Missions and requirements       | owner, admin, operator, reviewer, viewer |
| Missions               | `workspace-meetings`      | `meetings`       | Introductions and meetings      | owner, admin, operator, reviewer, viewer |
| Missions               | `workspace-commercial`    | `commercial`     | Commercial progress             | owner, admin, operator, reviewer, viewer |
| Companies              | `workspace-research`      | `research`       | Companies and research          | owner, admin, operator, reviewer, viewer |
| Companies              | `workspace-sources`       | `sources`        | Sources and claims              | owner, admin, operator, reviewer, viewer |
| Companies              | `workspace-evidence`      | `evidence`       | Evidence review                 | owner, admin, operator, reviewer, viewer |
| Delivery               | `workspace-delivery`      | `delivery`       | Client and institution delivery | owner, admin, operator, reviewer, viewer |
| Delivery               | `workspace-network`       | `network`        | Execution network               | owner, admin, operator, reviewer         |
| Delivery               | `workspace-ai`            | `assistance`     | AI assistance                   | owner, admin, operator, reviewer         |
| Outcomes               | `ops-dashboard`           | `dashboard`      | Mission dashboard and economics | owner, admin, operator                   |
| All tools and settings | `workspace-operations`    | `operations`     | Global operations               | owner, admin, operator                   |
| All tools and settings | `ops-health`              | `health`         | Recovery and health             | owner, admin, operator                   |
| All tools and settings | `ops-gates`               | `readiness`      | Production readiness            | owner, admin, operator                   |
| All tools and settings | `ops-center`              | `control-center` | Corridor Control Center         | owner, admin                             |
| All tools and settings | `workspace-settings`      | `settings`       | Corridors and policies          | owner, admin                             |
| All tools and settings | `workspace-audit`         | `audit`          | Access and audit                | owner, admin                             |
| All tools and settings | `workspace-authenticator` | `authenticator`  | Authenticator                   | owner, admin, operator, reviewer, viewer |
| All tools and settings | `workspace-controls`      | `controls`       | Workspace controls              | owner                                    |

18 section rows, each id placed exactly once, plus the Today landing, which is not a section.

## Rules

1. A section shows only to its roles, as today. A group with no visible section for the person is not shown. While the role is unknown (`role === null`), no role-limited section or owner link is shown.
2. Labels may become plain verbs (UI direction glossary, "Corridra team" words), but the section `id`, address word, `#workspace-...` hash and mounted panel do not change.
3. The founder page (`/operator/owner`) and view-as stay where they are.

## Required tests (S4, named by id)

| Id   | Case                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------- |
| S-01 | The map places each of the 18 ids in `workspaceSections` exactly once; a new section fails the test until it is placed. |
| S-02 | For each of owner, admin, operator, reviewer and viewer, the set of reachable sections is identical before and after.   |
| S-03 | With `role === null`, no role-limited section and no owner link is rendered.                                            |
| S-04 | Every `/operator/<word>` address and every `#workspace-...` hash still opens its section.                               |
| S-05 | At 390 and 1440: no sideways scroll, 44 px targets up to 768, axe clean, at most five top-level groups plus All tools.  |
