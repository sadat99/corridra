-- ADR-093 Phase 2a rollback. Restores the exact app.guard_operations_control() definition of
-- customer-real-use-migrations/0003_real_customer_modules.sql (publication and release need a second person again), drops the
-- marker app.route_pack_one_person_publication() and removes the module's row from route_pack_migrations.applied, so a later
-- install applies the module again instead of skipping it. Records written meanwhile stay (append-only) and each still shows
-- who did what. Run only through a further reviewed forward run.
-- The whole rollback is one statement (one DO block), so it is all or nothing however it is run: as one query string, under
-- psql -f with or without --single-transaction, or inside a caller's transaction. It has no BEGIN or COMMIT of its own on
-- purpose: in one query string a refusal after an explicit BEGIN leaves the session in an aborted transaction, and inside a
-- caller's transaction an explicit COMMIT would end that transaction early. It first takes the migration lock the installer
-- takes (pg_advisory_xact_lock(hashtext('corridra:migrations'))), held until the enclosing transaction ends.
-- It refuses, changing nothing, unless app.guard_operations_control() is exactly the ADR-093 definition (the hash of
-- pg_get_functiondef, taken the same way the install pins the 0003 definition) and the module's registry row is present, so it
-- never overwrites a later replacement. The restored definition below is byte for byte the 0003 one, run through EXECUTE.
DO $guard$ DECLARE n integer; BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('corridra:migrations'));
 IF to_regprocedure('app.guard_operations_control()') IS NULL
  OR to_regclass('route_pack_migrations.applied') IS NULL
  OR encode(sha256(convert_to(pg_get_functiondef('app.guard_operations_control()'::regprocedure),'UTF8')),'hex')<>'4d61d39fc11128eb607997d815f033495fe349b0db47717ceb3bd925953f216b'
 THEN RAISE EXCEPTION 'Route pack rollback refused: app.guard_operations_control is not the ADR-093 definition'; END IF;
 DELETE FROM route_pack_migrations.applied WHERE name='0001_one_person_route_publication.sql';
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Route pack rollback refused: the module is not recorded as installed'; END IF;
 EXECUTE 'DROP FUNCTION app.route_pack_one_person_publication()';
 EXECUTE $restore$CREATE OR REPLACE FUNCTION app.guard_operations_control()
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
      IF r.id IS NULL OR NOT(r.id=ANY(NEW.readiness_ids)) OR r.pack_id<>NEW.pack_id OR r.status='BLOCKED' OR r.valid_until<=now() OR r.created_by=NEW.created_by OR NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=r.source_id AND app.can_access(tenant_id,classification,purpose) AND retention_until>now()) THEN RAISE EXCEPTION 'Independent approval of current evidenced readiness required'; END IF;
     END LOOP;
    END IF;
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='configuration_decision' THEN
  SELECT * INTO q FROM app.configuration_proposal WHERE tenant_id=NEW.tenant_id AND id=NEW.proposal_id;
  IF q.id IS NULL OR q.created_by=NEW.created_by THEN RAISE EXCEPTION 'Independent configuration reviewer required'; END IF;
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
$restore$;
END $guard$;
