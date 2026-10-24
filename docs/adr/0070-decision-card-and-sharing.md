# ADR-070: Decision card and sharing with a co-owner or bank

Status: proposed, design only, nothing built. Switch `CORRIDRA_SHARE_CARD` stays "planned". The interviews in [phase2-interviews.md](../product/phase2-interviews.md) decide whether it is worth building.

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
