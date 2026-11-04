# Wave 8: journey acceptance and release memo

Document status: CURRENT.

Contract section 4 (J1 to J4 and the additional journeys) and section 6, Wave 8. The tracks prove the journeys on synthetic, sanitised fixtures in CI. Authenticated production validation is done by an authorised human tester and is owner-run. Restricted switches stay off. Real obligations (payments, outreach, providers, AI) are not claimed.

## Journeys (one Playwright operator spec per journey, steps named by id)

| Id  | Owner | Journey (contract section 4) and what the spec must assert                                                                                                                                                                                                                                                                                                                                                       |
| --- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J1  | S2    | Source, Bangladesh to China. A technical requirement with an uncertain field is clarified. Supplier quotes keep their original currency, MOQ, lead time and delivery terms. A technical mismatch shows "Not comparable" with its reason. Missing evidence is named. A trip context is optional. The buyer decides. The outcome is recorded apart from follow-through. Costs and markup never reach the customer. |
| J2  | S2    | Sell, Bangladesh to Spain. An offer with target buyer and meeting criteria leads to a shortlist and introductions. Proposed, confirmed and held meetings stay distinct, and RFQ, sample and agreement steps are separate. An event is context, not a requirement. The participant's contacts and quotes stay private.                                                                                            |
| J3  | S3    | Organise a delegation. Objectives, terms, eligibility and fees, then invitations and consent, then schedule, conflicts and attendance. Scheduled, held and qualified counts stay separate. Results show no participant quote or private finance.                                                                                                                                                                 |
| J4  | S4    | Multi-context and access. One person in two organisations sells in one and sources in the other. Drafts resume in each. Records are visible only where authorised. A revoked member's old deep link is denied. An organiser cannot read a participant's costs. Signed-out, expired and denied states are honest.                                                                                                 |
| J5  | S3    | Supplier response invitation, through the scoped link only, with no broad role grant.                                                                                                                                                                                                                                                                                                                            |
| J6  | S4    | Staff execution and contributor review, permitted tasks only.                                                                                                                                                                                                                                                                                                                                                    |
| J7  | S2    | Billed service quote acceptance with no payment claimed. An unread report and its notification. An expired or withdrawn share link. A failed network with retry, and a 429.                                                                                                                                                                                                                                      |

## Release memo (S1)

`docs/revamp/RELEASE-MEMO.md`, one page. It covers:

- new user capabilities, retained features, and removed items with their manifest entries;
- the 60 gap and 507 requirement statuses as recorded, with none inferred;
- the journeys tested, with spec names;
- the SHA, CI and deployment receipts;
- blocked owner decisions and owner review items, including art review.

The memo does not say commercially live until real obligations are proven.
