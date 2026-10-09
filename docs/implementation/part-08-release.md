# Part 08 implementation and release status

Implementation is under review on `feat/part-08-client-institutional-delivery`; production release is not yet claimed. [The requirement baseline](part-08-scope.md), [ADR-022](../adr/0022-scoped-client-and-institutional-delivery.md) and [the operator runbook](../runbooks/part-08-client-and-institutional-delivery.md) define the accepted scope, permission boundaries, import confirmation, reporting and rollback.

The delivery module implements atomic programme intake through the mission service, reviewed purpose-bound client/institutional capabilities, owned evidence requests with self-declared responses, complete approved cohort reports and audited CSV/PDF downloads. Financial totals share the Ops aggregation. Forward migrations 0014 to 0018 add scoped mission ingress, the shared aggregation, immutable delivery/import/export records and restricted helper permissions.

Final validation, CI, isolated cloud acceptance, production migration preservation and deployment evidence will be recorded after their checks finish. Part 07's explicitly deferred production commercial write check remains deferred. Signup, real customer-data admission, scanner, outreach and pilot/legal boundaries remain tracked under the existing deferred controls.
