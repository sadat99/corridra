# ADR-024: Evidence-backed commercial origins

Status: implemented for V2 Part 01; extends ADR-021's origin restriction.

Keep held meetings as a valid origin. Permit a typed source/claim-backed sourcing requirement, RFQ, supplier response or accepted introduction to originate an opportunity. Database guards require the exact tenant, mission, target and relationship permissions. Introduction origins additionally require observed buyer acceptance. An opportunity has exactly one origin; no fictional meeting is created.

Reuse the existing commercial state machine, record parentage, immutable money and accounting confirmation services. Permit qualified alternate-origin missions to enter the commercial pipeline without meeting states. Preserve qualification history and whole-mission closure checks.

Keep historical events unchanged. New alternate-origin snapshots use schema version 2 and carry originId with null meetingId. Replay accepts versions 1 and 2. Existing customer totals remain independent of origin type. Old create clients remain compatible. See [architecture](../architecture/multi-corridor-v2.md).
