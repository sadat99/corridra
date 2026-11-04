# Wave 6: accessibility, states, busy actions and performance

Document status: CURRENT.

Contract section 6, Wave 6, limited to the items that need no owner gate. Gap closure stays evidence-only: a track never changes a status in `docs/qa/current-plan-gaps/findings.json`; it records proof in its own verification JSON and the Conductor decides. Language items (GAP-008, 013, 014, 021, 027, 028), owner-dependent gaps (033, 036, 040, 043 to 048) and deferred controls (051 to 060) are not built here. Inspect first, then fix only what a failing test proves.

## Ownership

| Track | Surfaces                                                                   |
| ----- | -------------------------------------------------------------------------- |
| S2    | Customer Home, Work, saved mission and request room, drafts, account pages |
| S3    | Public pages, `/plan`, organiser room and programme pages                  |
| S4    | Team workspace (Signal Desk), contributor board, owner page                |

## Required tests (named by id, per track, on its own surfaces)

| Id   | Case                                                                                                                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-01 | Keyboard: every action is reachable by Tab in reading order, focus is always visible, there is no trap, a view change moves focus to its heading, and a failed check moves focus to the error summary.                                                                                                                            |
| Q-02 | Reflow: at 320 CSS px (the 200 percent zoom equivalent of 640) and at 1280 with 200 percent zoom, no content or action is lost and there is no sideways scroll.                                                                                                                                                                   |
| Q-03 | Contrast and semantics: axe clean (wcag2a, wcag2aa) at 390 and 1440 on every listed screen, using existing tokens only. No new colour.                                                                                                                                                                                            |
| Q-04 | Right to left: where a screen already renders translated content, `dir="rtl"` mirrors the layout without overlap or clipped controls. No new translated string.                                                                                                                                                                   |
| Q-05 | States (contract section 5): each listed screen shows honest words for first use, empty, loading, partial data, unavailable (503), denied (403), stale or concurrent update (409), offline (the request rejects) with a retry, 429 with a later-retry line, and gated or switched off. Never a blank area and never a false zero. |
| Q-06 | Busy actions (GAP-050): every signed-in action that sends a request is disabled or `aria-busy` while in flight, a double click sends one request, and the result is announced. Sweep first and list every action checked in the verification JSON.                                                                                |
| Q-07 | GAP-049 (S3 only): screenshots of the organiser room, all five groups, at 390 and 1440, saved under `docs/design-system/evidence/revamp-wave6/` for named human art review. No self-approval. Fix only a proven token or layout defect against AC/1.                                                                              |
| Q-08 | Performance: on a production build, record per listed route the JavaScript bytes sent, the time to the main heading and the largest contentful paint from `PerformanceObserver`, at 390 with CPU throttling 4x. Record the numbers only, invent no score. Fix a bottleneck only with before and after numbers in the same PR.     |

## Rules

1. Keep every action, link, id, name, payload and test hook.
2. One PR per track for Q-01 to Q-06, then a separate PR for Q-08 if it changes code. `Sensitive: yes` only if the change touches auth, session, tenant scope, money, consent, tokens or cookies.
3. Each finding a test proves gets its own failing test first. If a test finds nothing, the PR is test-only and says so.
