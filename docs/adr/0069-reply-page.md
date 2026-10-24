# ADR-069: Reply Page for suppliers and buyers

Status: accepted by owner delegation, 24 October 2026. Default off. Switch `CORRIDRA_REPLY_PAGE`. The whole `/buyer` path stays sample only: it works for contacts ending in `@example.invalid` over the SYNTHETIC or MANUAL channel until the real-outreach gate closes.

## Context

A supplier opens a private link on `/buyer`, answers Interested, Need more information or Not relevant, and may add a declared quotation with seven term fields. Reading the code for this ADR showed the plan's premises were partly wrong:

- The reply is **not versioned**. `app.recipient_detail_response` holds one immutable row per link. It has no revision, status or review column.
- There is **no review action** today. "Counterparty declarations awaiting review" is a read-only list. A reply reaches a customer only when the Corridra team re-enters its terms as a mission quotation, approves a publication and shares it.
- The comparison engine does **not** flag warranty, installation, training or spares. It flags twelve terms: specification, quantity, unit, unit price, lead time, valid until, trade term, shipping, payment terms, tooling, set-up and packaging. With seven fields a reply can never be "Comparable on supplied terms".
- The database function already accepts **eighteen** term keys, and the web schema `offerTerms` already allows them. Only the form is narrow.
- A reply has **no language**. The page is fixed English, and the shell forces `lang="en"`.

## Decision

- **The page** keeps its link model, its three answers, its opt-out and its sample-only rule. It shows one question at a time, at most one and a half phone screens a step: the answer; for Interested, "Your quote"; a check of what was typed; the receipt.
- **The quote form** asks for what the engine needs: valid until, trade term (the eleven allowed terms), shipping (included, excluded or not supplied), tooling, set-up and packaging (an amount, or an explicit zero), plus minimum order, and warranty, installation, training and spares as declared text. Nothing is required except what the existing function requires; a blank stays "Not stated", never zero. All answers stay Self-declared. No account. No files until gate D01 closes. If a supplier cannot use the page, staff enter the same form for them.
- **Language** is set by the team per recipient and carried in the link as `#t=<token>&l=en` or `&l=zh`. It is not stored and not a cookie. A limited Chinese catalogue covers the page's own words only; names, quotations, currencies and the requirement text are never translated. The page sets its own `lang` and `dir`.
- **Receipt.** The page shows the receipt and a plain-text version the supplier can keep. No email is sent to a supplier: contacts are sample addresses and real outreach is closed.
- **Review queue (staff).** An additive module, `recipient_reply_review_migrations`, adds an append-only review record per reply (publish, ask for missing terms, or reject with a reason code and a note) written by a staff function that needs `delivery.share` and a fresh authenticator check. The queue shows the requirement beside the reply term by term, with the gaps the existing engine reports. **Publish** records the decision and prepares the mission quotation from the reply with the reply as a self-declared source; the Corridra team confirms it through the existing quotation form, and nothing reaches a customer until the existing publication path approves it. **Ask** makes a pre-filled link naming the missing terms, shared by hand. **Reject** records a reason; the customer never sees the reply.
- **Customer side.** Compare shows the engine's verdict for the published offer. No new verdict is invented.

## Abuse cases

Link leakage (the token is in the fragment, expires within 7 days, is revocable); scraping and look-alike pages (no indexing, no referrer, exact origin check, rate limits already in place); tampering with the language parameter (a fixed allow-list of two); a reply claiming verification (always Self-declared); a very long or hostile quote text (length caps in the function); replay (idempotent by response id); an operator publishing without review (the review record is required before the prefilled quotation can be confirmed); WeChat and WhatsApp in-app browsers dropping the fragment (a written manual test plan; the staff-entry fallback exists).

## Not included

Real outreach, email to suppliers, file upload, supplier accounts, and any change to the three-answer database function or to the immutable reply table.

## Rollback

Unset `CORRIDRA_REPLY_PAGE` (the old form returns), or pause the review module. Replies and review records are kept.

## Required acceptance

Unit tests: the form maps to exactly the keys the function accepts; blank means Not stated; the language allow-list; the Chinese catalogue has every key the English one has. Database tests: the review module is repeatable, append only, closed to runtime and auth roles, needs the permission and a fresh authenticator check, and refuses another tenant. A narrow-viewport test for the page and the queue, and the written manual test plan for the in-app browsers.
