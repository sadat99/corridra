# ADR-025: Separate service economics, reward obligations and policy authority

Status: implemented for V2 Part 01; operational UI and providers deferred.

Customer contract/cash values are not Corridra revenue. A separate append-only service ledger records earned fees, accepted costs and reward obligations, grouped by currency. Sources and mission attribution are mandatory. Currency conversion is separately derived with rational rate provenance and never overwrites original amounts.

Effective-dated reward rules deterministically price observed contributions. One contribution can earn one original reward credit. Independent human review, exact compensation and a separate reconciliation actor prevent self-approval and duplicate credit. No outgoing payment service is installed. Reconciled obligations require later separately reviewed recovery design rather than silent reversal.

Versioned source rights cannot expand source retention or override AI denial. Jurisdictions and processing locations are explicit. Unreviewed transfer status denies AI; EU hosting alone proves nothing about legal basis. Trusted server policy admits only scoped public-source read/draft assistance. Model/provider output cannot become verification, permission, money, legal conclusions or customer commitments. Credentials stay in provider/environment storage. See [architecture](../architecture/multi-corridor-v2.md).
