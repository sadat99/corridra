# ADR-071: The Road, a request in six steps

Status: accepted by owner delegation, 24 October 2026. Default off. Switch `CORRIDRA_UX_ROAD`. Presentation only: it reads the mission status a customer may already read and adds no data, no table and no permission.

## Context

A customer reads a request as `progress.status`, one of eleven values, plus the team's replies, only while the 30 day retention window lasts. Three pages show one piece of work under three ids. People understand "where is it, what is next" better than a status word.

## Decision

The Road has six steps: Define, Find, Compare, Visit, Decide, Follow through. The marker follows the status; Compare and Decide follow records.

| Mission status                         | Road                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------- |
| DRAFT, QUALIFICATION                   | Define is now                                                               |
| ACTIVE, TARGETING, OUTREACH            | Find is now                                                                 |
| MEETINGS                               | Visit is now                                                                |
| FOLLOW_UP, COMMERCIAL_PIPELINE, CLOSED | Follow through is now, with a plain line taken from the status              |
| ON_HOLD                                | No marker. A side note, because the paused-from step is not readable.       |
| CANCELLED                              | No marker. A side note.                                                     |
| Any other value                        | No marker. A plain status line, so a status added later never draws a step. |

- **Compare and Decide are records, not statuses.** Compare is done when a delivered report exists for the same piece of work, Decide when a reviewed decision disclosure exists. Otherwise each says "Not tracked yet". Customers cannot record a decision; they read reviewed ones.
- **Four shapes**, each with its word: done, now, later, not tracked yet.
- **The marker never steps back.** The legal moves in `packages/missions/src/index.ts` only go forward (including ACTIVE or TARGETING straight to COMMERCIAL_PIPELINE, which moves Find to Follow through). A property test over that graph proves it, and a second test fails when the status list gains a value the mapping does not know.
- **No holder badge on the Road in phase 1.** Replies come only from the team, so "You" and "Them" cannot be derived from them. A holder appears on Your Move cards and service request rows, where the state says who waits.
- **After the retention window** the page says so plainly and offers a way back (the Room keeps the old request page one tap away).

## Not included

Predicting dates, scoring, percent complete, or any step the status does not support.

## Rollback

Unset `CORRIDRA_UX_ROAD`. Nothing else changes.

## Required acceptance

The mapping and property tests in `tests/integration/ux-teaching-layer.test.ts`, the Road in the specimen at 320, 390, 768 and 1440 px, and the Room's tests for `available: false` and for another customer's request.
