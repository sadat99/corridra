# Lane 12: fair pages and the Countdown

**Document status: DONE.** Built and merged behind its switch, off by default; nothing installed or enabled by merging. See the [plan status register](../PLAN_STATUS.md).

Status: built and dark, 25 October 2026. Switch `CORRIDRA_UX_FAIRS`, off by default. `CORRIDRA_UX_BOOKS` stays planned: the books are not built (reasons below). With the switch unset, `/fairs` and every `/fairs/<name>` address answer the plain "not found" page.

## What exists

| Part            | What it does                                                                                                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/fairs`        | A reading page: the fairs the Corridra team has checked, each with its city, its next checked date, the days to it and "Dates last checked" (the latest day any of its dates was read on the fair's own site). Empty, it says "No fairs are listed yet."              |
| `/fairs/<name>` | One fair: Opens, Closes and Registration closes, each with the date, the days to it, a link to the page where the fair states it, who in the team read it and on which day. A date the fair has not announced says "Not announced yet".                               |
| Countdown       | Whole calendar days to a real date: "Tomorrow", "In 12 days", "Today". A date that has passed is said plainly ("This date passed yesterday") and a next date is named only when a real one exists. It draws nothing for a missing or unreal date and needs no script. |
| The list        | `apps/web/content/fairs.ts`. It is empty on purpose. The pages and the rules live in `apps/web/lib/fairs.ts`.                                                                                                                                                         |

## How a fair is added (a team step, not an install)

A person in the Corridra team opens the fair's own site, reads the dates, and adds an entry to `apps/web/content/fairs.ts` through a pull request. Each entry holds the fair's slug, name, city, country code and website, and for each date: the kind, the date as the fair states it (or `null` if not announced), the address of the page that states it, who read it and the day. The entry is shown only if it follows every rule in `lib/fairs.ts`:

- a lower-case slug of 3 to 60 characters, a name, a city, a two-letter upper-case country code, an https website without a password;
- at least one date; each kind at most once; a real calendar day (2026-02-30 is refused); an https source; a named person; a checking day that is a real day and not in the future;
- a fair that closes before it opens is refused.

An entry that breaks a rule is not shown and a test fails. No date is worked out from a previous year or guessed.

## Decisions left for the owner

| Decision                                      | Default chosen                                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whether fair pages may be found by search     | Not indexed (`robots: noindex`). A public page that states a third party's dates is the owner's call.                                                 |
| Who may add a fair and how often to re-check  | Anyone in the team through a pull request; the "Dates last checked" line shows how old each check is. No automatic re-check exists.                   |
| A live admin screen instead of a content file | Not built. It would be a new database module and a staff screen; the content file needs no migration and keeps every check in the repository history. |

## Not built, and why

| Item                              | Why                                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trip Book and Supplier Book (PDF) | They are to contain the commercial itinerary only (A11), and the customer screens hold no itinerary or visit data yet (the Trip view is still planned). A book with nothing to print would be invented. Bangla and Chinese type in a PDF also needs a shaping check with real fonts, which should be done with the data. |
| A Countdown on a request's Road   | The request Road has no date of its own. A Countdown appears only where a real date exists; the Move cards already carry a real due date in words. Wiring a date onto the Road needs a record that holds one.                                                                                                            |
| Fair data                         | There is none to ship. Every date needs a person to read it on the fair's own site.                                                                                                                                                                                                                                      |

## Rollback

Unset the switch. Nothing is stored or migrated.

## Verification

- Unit suite `ux-fairs.test.ts` (29 tests): every rule an entry must follow with a refusing case for each, "Dates last checked", the next date, the countdown across a leap day and a year end, no countdown for an unreal date, the plain words for a passed date, the switch is read before the list (including in the page title), the countdown has no script, tokens only.
- Operator spec `ux-fairs.spec.ts` (9 tests): the real views and stylesheet with invented fairs: the empty list, the next date and its days, a fair with nothing still to come, each date with its source, checker and day, "Not announced yet", a passed date said plainly, and 320, 390, 768 and 1440 px with no sideways scroll and a clean accessibility scan. Screenshots in `docs/design-system/evidence/lane12-fairs/`.
- The UX gate baseline lists `/fairs` as unavailable at every width while the switch is off.
