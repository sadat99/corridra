# ADR-080: Public programme pages and applications

Status: Proposed; owner decisions of 11 November 2026 recorded below. Built behind a switch that is off by default (`CORRIDRA_PROGRAMME_PAGES`). The database module is tested on PostgreSQL 16 and is NOT registered in the production installer and NOT installed anywhere. Nothing is enabled, approved or live. Enabling it is an owner action and needs the installed module and a recorded privacy review of the public page and of the application words.

Authority: owner mandate of 11 November 2026 ("A functioning public organiser recruitment and publication pathway"; "Publication requires an explicit authorised action"; "Do not expose private records through social previews"; "Do not send unsolicited messages"). V3 contract section 2, Product 3, step 4 ("Publish controlled invitations and register participants") and section 6 ("Self-service delegation creation and administration", P0). Product vision 2.1 section 13 (institutional loop) and section 20 (not a travel agency, not a spam engine).

## Context

An organiser can already create a programme, invite participants by private code, take registrations and run terms, eligibility, places, fees, coordination and reporting. Every one of those starts from an invitation the organiser sends to someone they already know. There was no way for an organiser to describe a programme in public, share one address and let companies they do not know yet ask to take part. The public "Organise" entry led only to a general request to the Corridra team.

## Decision

1. **A public page per programme, made only of reviewed words.** A current owner or admin of the workspace that owns the programme writes the public copy: title, organiser name, purpose, destination, dates, focus, who it is for, conditions to take part, an optional list of visits and meetings, an optional fee line, what is and is not included and an optional number of places. Exactly these fields can be stored (the database refuses any other key). Nothing is read live from the private programme, its participants, prices, objectives or missions.
2. **Planned is never shown as confirmed.** Each visit or meeting carries `PLANNED` or `CONFIRMED`. The editor defaults to planned and the page prints the word beside each line, with a sentence saying that confirmed is the organiser's own statement.
3. **One stable address, versions and take-down.** The first publication makes the address: a readable part from the title and ten random characters, at `/delegations/<address>`. A change is a new version at the same address. Taking the page down withdraws the latest version; publishing again reopens the same address. Every version names its closing time, at most 180 days ahead. After closing the page stays readable as closed for 30 days, then answers as unknown.
4. **The anonymous read answers one value for everything that is not a readable page**: malformed, unknown, never published, taken down, archived programme or workspace, long closed, module not installed, switch off. It writes nothing and records nothing about the visitor.
5. **Applications belong to an account.** A signed-in, email-verified person applies with a display name and one paragraph in their own words, and ticks an explicit consent. The organiser sees that name and statement and nothing else of the person: no email, no private request, contact or price. An application names the version of the page that was read; a stale page is refused so the person reads the current one.
6. **Distinct states, never collapsed.** Submitted, wait-listed, declined (always with a reason the applicant reads), invited, invitation expired, joined, registration ended, withdrawn. An application is not a place, an invitation is not a registration and a registration is not a paid or confirmed attendance; the existing terms, eligibility, places and fee records carry those later states unchanged.
7. **Joining reuses the existing registration.** "Invite" writes a row in the existing invitation table with a secret nobody holds, so it can be used only by that applicant through "Join", never as a code. "Join" needs the applicant's explicit consent and writes the same registration row and the same `customer.programme.accept` event an invitation code writes. Everything downstream of a registration is untouched.
8. **Events carry ids only.** No name, statement or public word is written to the event stream.
9. **Limits.** Twenty versions of one page an hour; 2,000 applications a programme; three applications a person for one programme; twenty applications a person an hour; the existing 1,000 invitations a programme.
10. **Sharing is started by a person.** The page and the organiser's panel offer Copy Link and links that open WhatsApp or Facebook with the address filled in. Corridra sends nothing. Social previews use only the published title and purpose. No programme page is offered to search engines (owner decision below).
11. **The visitor's choice survives sign-up.** Pressing Apply stores the public address and title in the visitor's own browser for seven days. After sign-up, verification and sign-in the account pages show one line that leads back to the application. The sign-in return rules are unchanged.

12. **Words are keyed, English first.** Every word of these screens is an English-source entry with a stable `pp.*` key in `apps/web/lib/i18n/programme-pages-words.ts`. All catalogues carry the English words until a native review is recorded, so no unreviewed translation is shown. What an organiser publishes and what an applicant writes are originals and are never translated by Corridra. Programme, Application, Invited, Joined, Planned and Confirmed are defined there and stay distinct from Mission, Request, Introduction, Verified and Reviewed.

## Blast radius

- New: six tables in `customer_private` (row security on, no grant, immutable), thirteen private helper functions and seven functions granted to the runtime role, in `packages/db/customer-programme-publication-migrations/0001_public_programme_page_and_applications.sql`. One service, one signed-in route, one public page, two signed-in panels, one owner switch.
- Existing objects: no function, policy, grant, constraint or row of an existing object is changed (the integration test compares all of them before and after installation). The module inserts rows into the existing `programme_invitation`, `programme_registration` and `programme_participant_revocation` tables under the rules the invitation code path uses, including the archive guards when the lifecycle modules are installed.
- Authority: publishing, taking down, listing applications and deciding need a current owner or admin (`customer_private.participant_scope(..., true)`). Applying, withdrawing and joining need the person's own verified session. A removed member loses all of it with their membership.
- Money: none. The fee is a line of text the organiser writes. No amount is computed, charged or recorded by this module.
- Personal data: an application holds the account reference, a display name and a statement. It is covered by the existing account closure and erasure queue in the same way as a registration label; no new export or disclosure exists.

## Owner decisions, 11 November 2026 (to this session, verbatim in brackets)

- Privacy wording of the public page and the application consent sentence: "[You approve and publish as per the best of your contextual judgement]". Decided under that delegation: the public page keeps its statement that everything on it is stated by the organiser and not checked by Corridra; the application keeps the explicit consent tick ("Send this name and statement to the organiser. They do not see my private requests, contacts or prices. Applying is not a booking.") and gains one plain line under it saying that Corridra stores the application, shows it only to the owners and admins of the organiser, that it can be withdrawn at any time and stays on record as withdrawn, with a link to the privacy notice. The privacy notice page itself is not changed by this decision; adding a paragraph on programme applications to it remains an owner text.
- Search engines: "[Not found to be indexed]", read as: programme pages are not to be indexed. Every programme page, sample or real, now carries `noindex, nofollow`. A page is reached through the address its organiser shares.
- Merge of PR 420: "[u merge]" after green CI and the Guardian review.
- Installer registration: "[check and update]". The installer run-time fix merged as `8dd2062` (PR 419), so the ordering condition is met. Registration is a separate change after this one merges.

## Not decided here (owner)

- Notifying an organiser of a new application and an applicant of an answer by email. Not built: it is outbound mail and stays behind the existing mail gates.
- A paragraph on programme applications in the privacy notice page.
- The install approval for the module and setting `CORRIDRA_PROGRAMME_PAGES`.

## Rollback

Unset `CORRIDRA_PROGRAMME_PAGES`: the page answers not found, the route answers unavailable and the panels disappear. Stored versions, applications and decisions stay as records. Registrations already made through "Join" are ordinary registrations and are not affected.
