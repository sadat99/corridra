# Saved request recovery, phases 2 and 3: proposal

**Document status: PARTLY BUILT.** Phase 1 is built (PR168). Phases 2 and 3 are WAITING OWNER. See the [plan status register](../PLAN_STATUS.md).

Status: phase 1 is built (a notice that says the request is saved, not sent, kept for 24 hours and finished on the same device and browser, plus an address that is filled in on the verify page). Phases 2 and 3 are not built and need the owner's approval. Written on 24 October 2026.

## The problem

People often forget to verify their email after they send a request. Today the saved request lives for 24 hours and can be claimed only from the browser that saved it. A person who verifies on another phone, or after a day, finds nothing.

## Phase 2: finish from another device, keep it for three days

| Change                         | What it does                                                                                                                                            | Needs                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Three days instead of 24 hours | The saved request waits three days. After that it is deleted, as it is today after one.                                                                 | A database change (owner run install), a privacy notice update and a notice version.                 |
| Claim from any device          | After the person verifies the address, signing in on any device offers "Send your saved request". Only the verified owner of that address can claim it. | Same database change. A match on the verified email hash, which the claim function already requires. |
| Rate limits                    | Staging and claiming are limited per address and per network, so the form cannot be used to fill the table or probe addresses.                          | Application change and tests.                                                                        |
| Clear wording                  | The notices drop "same device and browser" and say "sign in with this email, on any device, within 3 days".                                             | Copy, tested for no promise beyond three days.                                                       |

What stays the same: the request is stored only as the person typed it, a claim still needs a verified address that matches, nothing is sent to Corridra's team until the claim, receipt codes and sample requests are untouched, and no real operation is turned on.

Privacy effect to approve: unverified people's request text is kept up to three days instead of one. The privacy notice must say so, with a new version date, before the switch is turned on.

## Phase 3: one reminder email

If the address is still unverified some hours after the request was saved, send one email: "Your request is saved. Verify your email to send it." No details of the request, no claim link, one mute link, sent at most once per saved request.

Risks to approve with it:

- Anyone can type another person's address. One short email to that address is the abuse risk. Mitigations: one email per request, a per-address and per-network limit, a plain "if this was not you, ignore it" line, and an immediate stop if the address mutes.
- It uses the mission email system and its sender, mute link and database gate.
- It stays off until the owner turns on a separate switch.

## Decisions needed

1. Approve phase 2 as above, including three days and the privacy notice change.
2. Approve phase 3 with its limits, or leave it out.
3. Name the hour after which the reminder is sent (suggested: 12 hours).

## Order of work

Phase 2 database change and tests, then the application change behind its own switch, then the owner installs the module, updates the privacy notice, and turns the switch on. Phase 3 follows only after phase 2 is live and checked.
