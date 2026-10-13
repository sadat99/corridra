# Controlled registry snapshots

Country identifiers and names originate from Debian `iso-codes` 4.18.0-1, ISO 3166-1 data, extracted on 12 October 2026. Source: https://salsa.debian.org/iso-codes-team/iso-codes. Copyright 2001–2008 Alastair McKinstry, 2004–2016 Christian Perrier, 2005–2025 Tobias Quathamer. Distributed under LGPL-2.1-or-later; see [license](licenses/iso-codes-LGPL-2.1.txt). The TypeScript snapshot contains identifiers only; migration 0019 contains names. Existing country names are not overwritten.

The ISO 4217 alpha-code snapshot uses the same package. Exponents were frozen from the Node 24 ICU currency metadata, with four-digit CLF and UYW explicitly retained. Non-monetary units and test/no-currency codes are excluded. These are controlled supported identifiers, not a live assertion that every currency is actively issued, transferable or commercially supported. Historical codes remain valid for historical accounting. New issuance or redenomination requires a reviewed registry update, not a route-specific migration. Existing BDT/EUR/USD/GBP/JPY exponents remain unchanged. CNY has exponent 2.

Runtime money uses only the checked-in exponent map and exact BigInt/minor-unit strings, never runtime locale defaults. PostgreSQL receives the same snapshot. Tests compare both registries to prevent drift. Country routes are configuration data and require no schema changes.

BCP 47 locale canonicalization and IANA timezone validation use Node ICU; PostgreSQL checks timezone names against its installed IANA registry. Deployments must retain Node 24 and supported PostgreSQL tzdata. Market aliases reference identities; they cannot create another country identity. EU membership is dated configuration, never inherited legal approval.
