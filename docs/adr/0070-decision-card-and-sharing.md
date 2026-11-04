# ADR-070: Decision card and sharing with a co-owner or bank

Status: proposed; the decision card is accepted for building, not yet built, under [ADR-076](0076-trip-books-and-decision-sharing.md) item 4, default off. See the addendum at the end.

## Context

A customer decision often needs a second person: a co-owner or a bank. A customer can already read the reviewed decision disclosures of a delivered mission (SELECT, DECLINE or NEED_INFORMATION, with rationale, next action and due date). They cannot hand that to someone else without forwarding screenshots.

## Decision

If built, a **decision card** is a read-only, expiring view of one reviewed decision disclosure, reached by a private link on the existing delivery-link model (an unguessable token in the fragment, a hard expiry of at most 30 days, revocable, audited).

- Sharing is explicit, per card, never per workspace, and off by default. Team sharing stays off.
- The card shows the company, the decision, the rationale, the next action and the date, with the trust label on each fact. It shows no price, quotation, contact, file or other decisions.
- Only a workspace owner or admin may create or revoke a card. Every open is counted, and a revoked or expired link answers like an unknown one.
- No account is needed to read it. Nothing on it can be acted on.

## Not built until

The interviews show that co-owners or banks are involved often enough to justify it, a privacy review covers what a card may disclose, and the owner sets the default expiry.

## Rollback

Not applicable until built. When built: unset the switch, revoke all links.

## Addendum, 3 November 2026

ADR-076 narrows this proposal. The expiry is at most seven days (not thirty), the card stores a digest of the previewed fields rather than a copy of them, the creator must be a current owner or admin of the workspace, and cards exist for sample (synthetic) workspaces only. The "Not built until" interviews condition is waived for building behind the default-off switch, on the owner's direction. It is not waived for enabling. Turning `CORRIDRA_SHARE_CARD` on remains an owner action and needs the recorded privacy review and the installed database module. ADR-076 item 4 governs where the two differ.
