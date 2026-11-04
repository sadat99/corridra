# Organiser room, Wave 6 (GAP-049, Q-07)

Ten screenshots of the organiser room: the five groups (Overview, Participants and eligibility, Programme and
meetings, Terms and fees, Results) at 390 and 1440 CSS px, at 2x.

- Made-up data only. The room is the real component with the real stylesheet, mounted in the test fixture.
- Panels whose service is not mocked there show their calm "unavailable" words. This is the room's own state, not an error.
- The fixture does not load the app fonts, so the type shows in the browser's fallback face. Judge layout, spacing and
  colour here, and type on the live page.
- Regenerate with `WAVE6_EVIDENCE=1 pnpm exec playwright test --config playwright.operator.config.ts tests/operator/revamp-programme-room.spec.ts -g "Q-07 evidence"`.

For named human art review. Nothing here is self-approved; the gap status stays with the Conductor and the owner.
