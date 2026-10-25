# Lane 8: the supplier Reply Page and the team's review of replies

Status: built and dark, 25 October 2026. Switch `CORRIDRA_REPLY_PAGE` (off by default) for both the supplier page and the team's review; the review also needs a database module that starts closed. Decision record: [ADR-069](../adr/0069-reply-page.md), with the amendment recorded there. Owner steps: [phase2-install.md](phase2-install.md).

## What exists when the switch is on

| Part              | What it does                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The page (8a)     | One question at a time, at most one and a half phone screens a step: the answer (Interested, Need more information, Not relevant), a message, the quote form (only for Interested), a check of what was typed, then the receipt. Going back never blocks.                                                                                          |
| The quote form    | Every term the existing function accepts: specification, quantity and unit, unit and total price, lead time, valid until, trade term (the eleven allowed), shipping (included, excluded, not supplied), payment terms, tooling, set-up, packaging, minimum order, warranty, installation, training, spares. A blank is "Not stated".               |
| Money             | Amounts are typed in the currency chosen on the price step and sent as exact minor units. A currency is required for any quote. A charge of zero is only possible by choosing "No charge", never by leaving a field empty.                                                                                                                         |
| Language          | English and a Chinese draft. The team names it in the link (`#t=<token>&l=zh`). It is not stored and is not a cookie. The page sets its own `lang` and `dir`. The Chinese words are shown only once Chinese is released by the language review record (see below); until then the link opens in English.                                           |
| Receipt           | The page shows a receipt and a plain-text version the supplier can copy. No email is sent to a supplier.                                                                                                                                                                                                                                           |
| Review queue (8b) | In Delivery, under the declarations awaiting review, the team sees each reply beside the requirement the supplier was shown, term by term, with the gaps the existing comparison engine reports. They can publish, ask for missing terms, or reject with a reason.                                                                                 |
| Publish           | Records one decision and shows the quotation prepared in the same shape as the existing quotation form, with the source "supplier reply, self-declared". The team confirms it through the existing quotation form. Nothing reaches a customer until the existing publication path approves it.                                                     |
| Ask               | Records which terms are missing and shows the suffix to add to the end of that recipient's newly issued link (`&l=zh&ask=leadTime,validUntil`). The page reads the issued `#<token>` followed by that suffix, and also the `t=<token>&...` form. The link is shared by hand. The page then asks only for those terms. An ask keeps the reply open. |
| Reject            | Records a reason (a fixed list) and an optional note. The customer never sees a rejected reply.                                                                                                                                                                                                                                                    |
| Database module   | `recipient_reply_review_migrations/0001_reply_review.sql`: a closed-by-default control, an append-only review record, one staff function. It reads the reply table and writes none of the existing tables.                                                                                                                                         |

With the switch unset the page is the older Reply or request clarification form, byte for byte, and the review route answers "Reply review is unavailable" before it touches anything.

## Rules kept

- The three-answer database function and the immutable reply table are not edited. A reply is still an immutable fact; a review is a separate fact beside it.
- Review needs the `delivery.share` permission and a fresh authenticator check (five minutes), is idempotent by command id, refuses a second final decision, and records ids only in its change events.
- Every price and term stays Self-declared. Nothing on this page verifies, ranks or recommends a supplier.
- No legal, privacy or consent wording was changed. Proposed wording changes, if any, belong in the pull request.
- No supplier account, no files (gate D01 stays closed), no email to a supplier (real outreach stays closed).

## Chinese: a draft until a reviewer is recorded

`apps/web/lib/reply-words.ts` holds the Chinese words for the page's own text only. Names, quotations, currencies and the requirement text are never translated. It is listed in [language-review-record.md](language-review-record.md) with no reviewer. Until a native reviewer is recorded and `zh` is added to `CORRIDRA_LANGUAGES_REVIEWED` (or the preview setting is on), a link that names Chinese opens in English, and the review queue says so beside the language choice.

## Manual test plan for in-app browsers (not run; needs people with the apps)

Suppliers will open links inside WeChat and WhatsApp. Some in-app browsers drop the part of the address after `#`, which carries the link's secret. The page then says "Open the complete link you received" and sends nothing. Before real outreach is ever opened, a person with each app should:

1. Send a sample link (`/buyer#t=<token>&l=zh&ask=leadTime`) to themselves in WeChat (iOS and Android) and WhatsApp (iOS and Android).
2. Open it from the chat and note: does the page load the introduction, or does it show the "complete link" message?
3. If it fails, open the same link with "Open in browser" and note whether it works there.
4. Repeat with the English link and with a bare `#<token>` link (the older form).
5. Record the app, the phone, the app version and the result in this file.

If a form of link fails in a common app, the fallback is a short reviewed message telling the supplier to open the link in their phone's browser. The staff-entry fallback in the ADR is not built (see the amendment in ADR-069).

## Not built, and why

| Item                                    | Why                                                                                                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff entering a reply for a supplier   | The reply table is immutable and every row is the supplier's own statement. A row written by staff would look like one and break that. It needs its own provenance and an owner decision. |
| Automatic prefill of the quotation form | The prepared quotation is shown for the team to confirm. The existing form and publication path stay the only way a quote reaches a customer.                                             |
| A stored language per recipient         | The language travels in the link, as the ADR says.                                                                                                                                        |
| Reading the review on the customer side | Compare already shows the engine's verdict for a published offer. No new verdict is invented.                                                                                             |

## Verification

- Unit suite `ux-reply-page.test.ts` (the form maps to exactly the keys the function accepts, blank is Not stated, the language allow-lists, both catalogues cover every key, every switch-off path, the Chinese release gate) and `ux-reply-review.test.ts` (the command, where a reply stands, the gaps, the prepared quotation, every switch-off and install path): 78 tests.
- Database suite `product-experience.test.ts` (16 tests, including the Reply Page form acceptance and five review tests): additive, repeatable, append only, closed to runtime roles, needs the permission and a fresh authenticator check, refuses another tenant and a second final decision.
- Operator specs `ux-reply-page.spec.ts` and `ux-reply-review.spec.ts` (32 tests) with the real stylesheets at 320, 390, 768 and 1440 px: no sideways scroll, 44 px targets, clean accessibility scan, every state. Screenshots in `docs/design-system/evidence/lane8-reply-page/`.
