-- ADR-093 Phase 2a. Optional module: one person may propose and publish a route pack, record its readiness and release it.
-- Replaces exactly one function, app.guard_operations_control(), hash-guarded against the definition installed by
-- customer-real-use-migrations/0003_real_customer_modules.sql (nothing later replaces it). Four differences from that
-- definition and no others:
--  1. The release loop no longer compares r.created_by=NEW.created_by, so the person who recorded a readiness observation
--     may release the route.
--  2. The configuration_decision branch no longer compares q.created_by=NEW.created_by, so the proposer may decide.
--  3. The release loop message becomes 'Current evidenced readiness required for every dimension'; it still covers a missing,
--     unlisted, other-pack, BLOCKED or expired observation and a missing, unreadable or expired source.
--  4. The decision message becomes 'Configuration proposal required'; it still covers a proposal missing from the tenant.
-- Everything else stays byte for byte: owner or admin with a fresh authenticator check, the current pinned base, the exact
-- published configuration equal to the proposal (p.created_by<>NEW.created_by in the PUBLISH branch is kept: the publisher
-- must have written the pack), sequential versions, retained evidence and the 13 dimensions. Roles are untouched.
-- A marker function app.route_pack_one_person_publication() tells the application that the module is present; until it
-- exists the service keeps its own proposer comparison and its text. It opens no gate and adds no switch.
-- Rollback: rollback/0001_restore_independent_review.sql restores the 0003 definition and drops the marker; it is run only
-- through a further reviewed forward run.
DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.guard_operations_control()'::regprocedure),'UTF8')),'hex')<>'df18b4d178c4fc824869c924da7110ea802e7594681659dbabebe24950edbd97' THEN RAISE EXCEPTION 'Route pack prerequisite function differs: app.guard_operations_control'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION app.guard_operations_control()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE p app.corridor_pack_version; s app.source_record; q app.configuration_proposal; d app.service_document; e app.mission_effort; k text; r app.route_readiness;
BEGIN
 IF NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL',app.tenant_processing_purpose(NEW.tenant_id)) AND app.member_role(NEW.tenant_id) IN ('owner','admin') AND app.fresh_mfa() AND NEW.created_by=app.actor_id(),false) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Scoped synthetic administration with fresh MFA required' USING ERRCODE='42501'; END IF;
 IF NEW.created_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'Server-owned observation time required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':operations',0));
 IF TG_TABLE_NAME IN ('route_readiness','route_release','configuration_proposal') THEN
  IF TG_TABLE_NAME='configuration_proposal' THEN
   IF NEW.base_pack_id IS DISTINCT FROM (SELECT id FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id AND effective_from<=now() ORDER BY version DESC LIMIT 1) THEN RAISE EXCEPTION 'Current configuration base required'; END IF;
   IF NEW.proposed_pack->>'routeId' IS DISTINCT FROM NEW.route_id::text THEN RAISE EXCEPTION 'Proposal route mismatch'; END IF;
  ELSE
   SELECT * INTO p FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND id=NEW.pack_id AND route_id=NEW.route_id AND effective_from<=now();
   IF p.id IS NULL OR p.version<>(SELECT max(version) FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id AND effective_from<=now()) OR NOT (p.configuration->'missionTypes' ? NEW.mission_type) THEN RAISE EXCEPTION 'Current exact pack and enabled mission type required'; END IF;
   IF NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Active operational owner required'; END IF;
   IF TG_TABLE_NAME='route_readiness' THEN
    IF NEW.version<>coalesce((SELECT max(version) FROM app.route_readiness WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id AND mission_type=NEW.mission_type AND dimension=NEW.dimension),0)+1 OR NEW.valid_until<=now() THEN RAISE EXCEPTION 'Sequential unexpired readiness observation required'; END IF;
    IF NEW.status<>'BLOCKED' THEN
     IF NEW.dimension<>'dependencies' AND NEW.status='NOT_APPLICABLE' THEN RAISE EXCEPTION 'Mandatory readiness dimension cannot be inapplicable'; END IF;
     SELECT * INTO s FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.source_id AND app.can_access(tenant_id,classification,purpose) AND observed_at<=now() AND retention_until>=NEW.valid_until;
     IF s.id IS NULL THEN RAISE EXCEPTION 'Current retained readiness evidence required'; END IF;
    END IF;
   ELSE
    IF NEW.version<>coalesce((SELECT max(version) FROM app.route_release WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id AND mission_type=NEW.mission_type),0)+1 THEN RAISE EXCEPTION 'Sequential route release required'; END IF;
    IF NEW.state='SYNTHETIC_APPROVED' THEN
     IF p.status NOT IN ('TESTING','LIMITED','ACTIVE') OR cardinality(NEW.readiness_ids)<>13 OR cardinality(NEW.readiness_ids)<>(SELECT count(DISTINCT x) FROM unnest(NEW.readiness_ids) x) THEN RAISE EXCEPTION 'All readiness dimensions and available pack required'; END IF;
     FOREACH k IN ARRAY ARRAY['offer','owner','qualification','research','communications','coverage','evidence','privacy','dependencies','support','quality','rollback','pilot'] LOOP
      SELECT * INTO r FROM app.route_readiness WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id AND mission_type=NEW.mission_type AND dimension=k ORDER BY version DESC LIMIT 1;
      IF r.id IS NULL OR NOT(r.id=ANY(NEW.readiness_ids)) OR r.pack_id<>NEW.pack_id OR r.status='BLOCKED' OR r.valid_until<=now() OR NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=r.source_id AND app.can_access(tenant_id,classification,purpose) AND retention_until>now()) THEN RAISE EXCEPTION 'Current evidenced readiness required for every dimension'; END IF;
     END LOOP;
    END IF;
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='configuration_decision' THEN
  SELECT * INTO q FROM app.configuration_proposal WHERE tenant_id=NEW.tenant_id AND id=NEW.proposal_id;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Configuration proposal required'; END IF;
  IF NEW.decision='PUBLISH' THEN
   SELECT * INTO p FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND id=NEW.published_pack_id;
   IF p.id IS NULL OR p.created_by<>NEW.created_by OR p.route_id<>q.route_id OR p.configuration IS DISTINCT FROM q.proposed_pack->'configuration' OR p.status IS DISTINCT FROM q.proposed_pack->>'status' OR p.version<>(q.proposed_pack->>'version')::integer OR p.id::text IS DISTINCT FROM q.proposed_pack->>'id' THEN RAISE EXCEPTION 'Exact reviewed configuration publication required'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME IN ('service_document','mission_effort','mission_operations_context','ai_mission_budget') THEN
  IF NOT EXISTS(SELECT FROM app.mission WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id) THEN RAISE EXCEPTION 'Current accessible mission required'; END IF;
  SELECT * INTO s FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.source_id AND app.can_access(tenant_id,classification,purpose) AND retention_until>now() AND observed_at<=now();
  IF s.id IS NULL THEN RAISE EXCEPTION 'Current accessible source required'; END IF;
  IF TG_TABLE_NAME='service_document' THEN
   IF NEW.reverse_of IS NOT NULL THEN
    SELECT * INTO d FROM app.service_document WHERE tenant_id=NEW.tenant_id AND id=NEW.reverse_of AND reverse_of IS NULL;
    IF d.id IS NULL OR (NEW.kind,NEW.parent_id,NEW.mission_id,NEW.currency,NEW.amount_minor) IS DISTINCT FROM (d.kind,d.parent_id,d.mission_id,d.currency,-d.amount_minor) OR NEW.occurred_at<d.occurred_at THEN RAISE EXCEPTION 'Exact service compensation required'; END IF;
    IF d.kind='INVOICE' AND EXISTS(SELECT FROM app.service_document WHERE tenant_id=NEW.tenant_id AND parent_id=d.id GROUP BY parent_id HAVING sum(amount_minor)>0) THEN RAISE EXCEPTION 'Compensate receipts before their invoice'; END IF;
   ELSIF NEW.kind='RECEIPT' THEN
    SELECT * INTO d FROM app.service_document WHERE tenant_id=NEW.tenant_id AND id=NEW.parent_id AND kind='INVOICE' AND reverse_of IS NULL;
    IF d.id IS NULL OR d.mission_id<>NEW.mission_id OR d.currency<>NEW.currency OR NEW.occurred_at<d.occurred_at OR EXISTS(SELECT FROM app.service_document WHERE tenant_id=NEW.tenant_id AND reverse_of=d.id) OR NEW.amount_minor+coalesce((SELECT sum(amount_minor) FROM app.service_document WHERE tenant_id=NEW.tenant_id AND parent_id=d.id),0)>d.amount_minor THEN RAISE EXCEPTION 'Uncompensated original invoice and bounded same-currency receipt required'; END IF;
   END IF;
  ELSIF TG_TABLE_NAME='mission_effort' THEN
   IF NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.operator_id) THEN RAISE EXCEPTION 'Active effort operator required'; END IF;
   IF NEW.reverse_of IS NOT NULL THEN
    SELECT * INTO e FROM app.mission_effort WHERE tenant_id=NEW.tenant_id AND id=NEW.reverse_of AND reverse_of IS NULL;
    IF e.id IS NULL OR (NEW.mission_id,NEW.operator_id,NEW.minutes) IS DISTINCT FROM (e.mission_id,e.operator_id,e.minutes) THEN RAISE EXCEPTION 'Exact effort compensation required'; END IF;
   END IF;
  ELSIF TG_TABLE_NAME='ai_mission_budget' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':ai-budget',0));
   IF NEW.version<>coalesce((SELECT max(version) FROM app.ai_mission_budget WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id),0)+1 OR NEW.valid_until<=now() OR NEW.valid_until>s.retention_until THEN RAISE EXCEPTION 'Sequential retained mission budget required'; END IF;
  ELSE
   IF NEW.version<>coalesce((SELECT max(version) FROM app.mission_operations_context WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id),0)+1 THEN RAISE EXCEPTION 'Sequential mission context required'; END IF;
   IF NEW.intake_decision='REJECTED' AND NOT EXISTS(SELECT FROM app.mission WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id AND status='CANCELLED') THEN RAISE EXCEPTION 'Rejected intake must have a cancelled canonical mission'; END IF;
   IF NEW.first_useful_result_at IS NOT NULL AND NEW.first_useful_result_at<(SELECT created_at FROM app.mission WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id) THEN RAISE EXCEPTION 'Useful result cannot precede intake'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='operations_case' THEN
  IF NEW.version<>coalesce((SELECT max(version) FROM app.operations_case WHERE tenant_id=NEW.tenant_id AND key=NEW.key),0)+1 OR NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Sequential case and active owner required'; END IF;
  IF NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.source_id AND app.can_access(tenant_id,classification,purpose) AND retention_until>now()) THEN RAISE EXCEPTION 'Current closure evidence required'; END IF;
  IF NEW.subject_id IS NOT NULL AND ((NEW.kind='COMMUNICATION' AND NOT EXISTS(SELECT FROM app.communication WHERE tenant_id=NEW.tenant_id AND id=NEW.subject_id)) OR (NEW.kind IN ('TASK','FRAUD') AND NOT EXISTS(SELECT FROM app.network_task WHERE tenant_id=NEW.tenant_id AND id=NEW.subject_id)) OR (NEW.kind='REPORT' AND NOT EXISTS(SELECT FROM app.delivery_publication WHERE tenant_id=NEW.tenant_id AND id=NEW.subject_id)) OR (NEW.kind='PROVIDER' AND NOT EXISTS(SELECT FROM app.ai_run WHERE tenant_id=NEW.tenant_id AND id=NEW.subject_id)) OR (NEW.kind IN ('PRIVACY','SECURITY','INCIDENT') AND NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.subject_id))) THEN RAISE EXCEPTION 'Current same-tenant case subject required'; END IF;
  IF EXISTS(SELECT FROM app.operations_case WHERE tenant_id=NEW.tenant_id AND key=NEW.key AND (kind<>NEW.kind OR subject_id IS DISTINCT FROM NEW.subject_id)) THEN RAISE EXCEPTION 'Case subject history is immutable'; END IF;
 END IF;
 RETURN NEW;
END $function$
;

CREATE FUNCTION app.route_pack_one_person_publication() RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION app.route_pack_one_person_publication() FROM PUBLIC;
