# Team header: old item to new place (navigation v1, order 2c)

Document status: CURRENT.

Binding condition 1 of [navigation system v1](../navigation-v1.md): nothing is lost. This table lists every item the team header (and the team sidebar's Account group) had before part 3 and where it is now. No route was deleted and no role gained or lost a place. The first change was PR 359 (`252d81af`).

The proof is `tests/integration/signal-desk.test.ts` (NAV-05, NAV-06), `tests/integration/team-navigation-map.test.ts` (NAV-01 to NAV-03), `tests/integration/team-menu-links.test.ts`, `tests/operator/team-nav-v1.spec.ts` and `tests/e2e/verification/ws-e/team-shell.spec.ts`.

| Old item                                                     | Route or hook                                    | New place                                                                                       | Roles                   |
| ------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------- |
| Inbox bell and plain list                                    | `/api/notifications?tenant=`                     | Inbox bell, grouped Notifications panel (same read; marks one item read, no bulk call)          | as before               |
| Account menu: language radios                                | `LanguageMenu`                                   | Language menu (from 640 px), inside the Account menu below 640 px; hidden with one language     | as before               |
| Account menu: Corridra Website                               | `/`                                              | Help menu, About Corridra                                                                       | all                     |
| Corner Help button (header)                                  | `CornerDock variant="header"`                    | Help and accessibility menu (Get Help, Make It Easier to Read, About Corridra)                  | all                     |
| Help: Start a request                                        | `/plan`                                          | Help menu, About Corridra, Start a Request                                                      | all                     |
| Listen to this page (corner)                                 | `useListen`                                      | Help menu, Listen to This Page (hidden where the browser has no voice, as before)               | all                     |
| Sidebar Account group: Authenticator                         | `/operator/authenticator`                        | Account menu, Authenticator                                                                     | every role              |
| Sidebar Account group: Health                                | `/operator/health`                               | Account menu, Health (roles that may open it and are not shown Admin); Admin > Health otherwise | operator; owner, admin  |
| Sidebar Account group: Readiness                             | `/operator/readiness`                            | Account menu, Readiness (same rule); Admin > Readiness otherwise                                | operator; owner, admin  |
| Search button in the sidebar                                 | `corridra:open-palette`, Ctrl K                  | Search button in the top bar, and Ctrl K                                                        | all                     |
| Workspace toolbar: Sign Out (page)                           | `identityClient.signOut`                         | Unchanged, and now also Account menu > Sign Out (`POST /api/operator-auth/sign-out`)            | all                     |
| Header status, brand, menu button                            | unchanged                                        | unchanged                                                                                       | all                     |

Account menu rows that carry a `#`, or that sit on a page other than the workspace, are plain anchors (the workspace reads its section from `hashchange`, which a router link to the same page does not fire). The staff inbox cannot count or mark every item read, so its panel offers neither (PR 364).

Open follow-up: cross-tab sign-out needs the sign-in SDK in the shared header, which the header bundle guard forbids.
