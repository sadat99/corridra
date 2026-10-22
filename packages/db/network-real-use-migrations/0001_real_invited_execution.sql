-- ADR057. Additive real invited execution; original core, synthetic guards and money history remain unchanged.

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.part4_enabled(uuid,text)'::regprocedure),'UTF8')),'hex')<>'c7a25ad8f9f540176b433d8172f879043ab34c943af15422520135880b595995' THEN RAISE EXCEPTION 'Network prerequisite function differs: app.part4_enabled(uuid,text)'; END IF; END $guard$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.network_task_access(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'39f55111898e6692c13252a8c4b3dbcf8a28a7a52ebe4466bff2b3398b384d05' THEN RAISE EXCEPTION 'Network prerequisite function differs: app.network_task_access(uuid,uuid)'; END IF; END $guard$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.guard_network()'::regprocedure),'UTF8')),'hex')<>'b1e39079ed326f121d4c0cca6ff71b29f0249633eb7115ff4aba708c22541b19' THEN RAISE EXCEPTION 'Network prerequisite function differs: app.guard_network()'; END IF; END $guard$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.network_my_tasks(uuid)'::regprocedure),'UTF8')),'hex')<>'4ed63a04d320617b1a565d0f1f289144984457a4817ce13d4bf5865e35b18e1d' THEN RAISE EXCEPTION 'Network prerequisite function differs: app.network_my_tasks(uuid)'; END IF; END $guard$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.network_contribution_valid(uuid,uuid,uuid,uuid,text)'::regprocedure),'UTF8')),'hex')<>'80d5da853b2f9684b97a9d5b735e46fa988393e5abf6bb7c440d684fcebe8e0e' THEN RAISE EXCEPTION 'Network prerequisite function differs: app.network_contribution_valid(uuid,uuid,uuid,uuid,text)'; END IF; END $guard$;

CREATE FUNCTION app.network_scope_allowed(t uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid=t
 AND current_setting('corridra.purpose',true)=app.tenant_processing_purpose(t)
 AND EXISTS(SELECT FROM app.tenant WHERE id=t AND (synthetic OR app.real_use_allowed(t))),false)
$$;
REVOKE ALL ON FUNCTION app.network_scope_allowed(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE OR REPLACE FUNCTION app.part4_enabled(t uuid,k text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(app.can_access(t,'INTERNAL',app.tenant_processing_purpose(t))
 AND app.network_scope_allowed(t)
 AND (app.tenant_is_synthetic(t) OR k='network.enabled')
 AND (SELECT value->>'enabled'='true' FROM app.config_version WHERE tenant_id=t AND key=k AND effective_from<=now() ORDER BY version DESC LIMIT 1),false)
$$;

CREATE OR REPLACE FUNCTION app.network_task_access(t uuid,tid uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE task app.network_task; p app.network_profile; assignment app.network_event; enabled boolean;
BEGIN
 IF NULLIF(current_setting('corridra.tenant_id',true),'')::uuid IS DISTINCT FROM t OR current_setting('corridra.purpose',true) IS DISTINCT FROM app.tenant_processing_purpose(t) OR app.actor_id() IS NULL THEN RETURN false; END IF;
 SELECT * INTO task FROM app.network_task WHERE tenant_id=t AND id=tid AND expires_at>now();
 SELECT coalesce(value->>'enabled'='true',false) INTO enabled FROM app.config_version WHERE tenant_id=t AND key='network.enabled' AND effective_from<=now() ORDER BY version DESC LIMIT 1;
 IF task.id IS NULL OR NOT coalesce(enabled,false) OR NOT app.network_scope_allowed(t) THEN RETURN false; END IF;
 SELECT * INTO assignment FROM app.network_event WHERE tenant_id=t AND task_id=tid AND action='ASSIGN' ORDER BY version DESC LIMIT 1;
 SELECT * INTO p FROM app.network_profile WHERE tenant_id=t AND id=(assignment.details->>'profileId')::uuid;
 RETURN coalesce(p.principal_id=app.actor_id() AND app.network_profile_current(t,p.id) AND length(assignment.details->>'relationshipDisclosure')>=3,false);
END $$;

CREATE OR REPLACE FUNCTION app.guard_network() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k text; required text[]; task app.network_task; prev app.network_event; assignment app.network_event; p app.network_profile; a app.mission_route_assignment; pack app.corridor_pack_version; route app.corridor_route; rule app.reward_rule_version; staff boolean; actor uuid:=app.actor_id(); review app.network_event; current_action text;
BEGIN
 IF NEW.created_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'Server-recorded task timestamp required'; END IF;
 IF actor IS NULL OR NEW.created_by<>actor OR NOT app.network_scope_allowed(NEW.tenant_id) THEN RAISE EXCEPTION 'Network actor required' USING ERRCODE='42501'; END IF;
 staff:=coalesce(app.can_access(NEW.tenant_id,'INTERNAL',app.tenant_processing_purpose(NEW.tenant_id)) AND app.member_role(NEW.tenant_id) IN ('owner','admin','operator','reviewer'),false);
 IF TG_TABLE_NAME='network_profile' THEN
  IF NOT coalesce(staff AND app.member_role(NEW.tenant_id) IN ('owner','admin') AND app.fresh_mfa(),false) THEN RAISE EXCEPTION 'Reviewed profile authority required' USING ERRCODE='42501'; END IF;
  required:=ARRAY['id','principalId','version','alias','categories','capabilities','markets','languages','sectors','workCountries','available','status','eligibilitySourceId','expiresAt','reason'];
  IF jsonb_typeof(NEW.configuration) IS DISTINCT FROM 'object' OR NOT (NEW.configuration ?& required) OR (SELECT count(*) FROM jsonb_object_keys(NEW.configuration))<>15 OR EXISTS(SELECT FROM jsonb_each(NEW.configuration) WHERE jsonb_typeof(value)='null') OR NEW.configuration->>'id' IS DISTINCT FROM NEW.id::text OR (NEW.configuration->>'version')::integer IS DISTINCT FROM NEW.version OR (NEW.configuration->>'expiresAt')::timestamptz IS DISTINCT FROM NEW.expires_at OR NEW.configuration->>'eligibilitySourceId' IS DISTINCT FROM NEW.eligibility_source_id::text OR length(NEW.configuration->>'alias') NOT BETWEEN 3 AND 500 OR jsonb_typeof(NEW.configuration->'available')<>'boolean' THEN RAISE EXCEPTION 'Complete reviewed profile required'; END IF;
  FOREACH k IN ARRAY ARRAY['id','principalId','alias','status','eligibilitySourceId','expiresAt','reason'] LOOP IF jsonb_typeof(NEW.configuration->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Typed profile metadata required'; END IF; END LOOP;
  IF jsonb_typeof(NEW.configuration->'version') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Numeric profile version required'; END IF;
  FOREACH k IN ARRAY ARRAY['categories','capabilities','markets','languages','sectors','workCountries'] LOOP
   IF jsonb_typeof(NEW.configuration->k) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.configuration->k) NOT BETWEEN 1 AND 30 OR EXISTS(SELECT FROM jsonb_array_elements(NEW.configuration->k) x WHERE jsonb_typeof(x)<>'string' OR length(x#>>'{}') NOT BETWEEN 2 AND 80) THEN RAISE EXCEPTION 'Bounded profile capabilities required'; END IF;
  END LOOP;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'categories') x WHERE x NOT IN ('local_operator','sourcing_expert','connector','interpreter','technical_adviser','factory_coordinator','field_researcher','verification_professional','institution_operator','private_connector')) THEN RAISE EXCEPTION 'Reviewed profile categories required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':profile:'||NEW.principal_id::text,0));
  IF NEW.version<>coalesce((SELECT max(version) FROM app.network_profile WHERE tenant_id=NEW.tenant_id AND principal_id=NEW.principal_id),0)+1 OR NEW.configuration->>'principalId'<>NEW.principal_id::text OR NEW.configuration->>'status' NOT IN ('ACTIVE','SUSPENDED','RETIRED') OR NEW.expires_at<=now() OR NOT EXISTS(SELECT FROM identity.principal WHERE id=NEW.principal_id AND kind='person' AND disabled_at IS NULL) OR NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.eligibility_source_id AND retention_until>=NEW.expires_at AND observed_at<=now() AND app.can_access(tenant_id,classification,purpose)) THEN RAISE EXCEPTION 'Reviewed existing identity, current source and sequential profile required'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements_text((NEW.configuration->'markets')||(NEW.configuration->'workCountries')) c WHERE NOT EXISTS(SELECT FROM app.country WHERE code=c)) THEN RAISE EXCEPTION 'Registered work and market countries required'; END IF;
 ELSIF TG_TABLE_NAME='network_task' THEN
  IF NOT coalesce(staff AND app.member_role(NEW.tenant_id) IN ('owner','admin','operator') AND app.part4_enabled(NEW.tenant_id,'network.enabled'),false) THEN RAISE EXCEPTION 'Task operator required' USING ERRCODE='42501'; END IF;
  required:=ARRAY['id','missionId','routeAssignmentId','kind','market','workCountry','location','language','sector','capabilities','instructions','deadline','expiresAt','evidenceRequired','effort','dataHandling','cancellationTerms','disputeTerms','reviewerId','rewardRuleId','reason'];
  IF jsonb_typeof(NEW.configuration) IS DISTINCT FROM 'object' OR NOT (NEW.configuration ?& required) OR (SELECT count(*) FROM jsonb_object_keys(NEW.configuration))<>21 OR EXISTS(SELECT FROM jsonb_each(NEW.configuration) WHERE key<>'rewardRuleId' AND jsonb_typeof(value)='null') OR NEW.configuration->>'id' IS DISTINCT FROM NEW.id::text OR NEW.configuration->>'missionId' IS DISTINCT FROM NEW.mission_id::text OR NEW.configuration->>'routeAssignmentId' IS DISTINCT FROM NEW.route_assignment_id::text OR NEW.configuration->>'reviewerId' IS DISTINCT FROM NEW.reviewer_id::text OR NEW.configuration->>'rewardRuleId' IS DISTINCT FROM NEW.reward_rule_id::text OR (NEW.configuration->>'deadline')::timestamptz IS DISTINCT FROM NEW.deadline OR (NEW.configuration->>'expiresAt')::timestamptz IS DISTINCT FROM NEW.expires_at OR NEW.configuration->>'kind' NOT IN ('supplier_research','introductions','factory_coordination','price_checks','interpreting','translation','samples','followup','site_support','category_intelligence','delegation_assistance') THEN RAISE EXCEPTION 'Complete scoped task disclosure required'; END IF;
  FOREACH k IN ARRAY ARRAY['location','evidenceRequired','effort','dataHandling','cancellationTerms','disputeTerms'] LOOP IF jsonb_typeof(NEW.configuration->k) IS DISTINCT FROM 'string' OR length(NEW.configuration->>k) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Bounded task terms required'; END IF; END LOOP;
  FOREACH k IN ARRAY ARRAY['instructions','language','sector','reason'] LOOP IF jsonb_typeof(NEW.configuration->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Typed task metadata required'; END IF; END LOOP;
  IF EXISTS(SELECT FROM jsonb_array_elements(NEW.configuration->'capabilities') x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' !~ '^[a-z][a-z0-9_.-]{0,79}$') OR NEW.configuration->>'language' !~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$' OR NEW.configuration->>'sector' !~ '^[a-z][a-z0-9_.-]{0,79}$' THEN RAISE EXCEPTION 'Reviewed capability and locale keys required'; END IF;
  IF length(NEW.configuration->>'instructions') NOT BETWEEN 10 AND 2000 OR jsonb_typeof(NEW.configuration->'capabilities') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.configuration->'capabilities') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Bounded task instructions required'; END IF;
  SELECT * INTO a FROM app.mission_route_assignment WHERE tenant_id=NEW.tenant_id AND id=NEW.route_assignment_id AND mission_id=NEW.mission_id;
  SELECT * INTO pack FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND id=a.pack_id;
  SELECT * INTO route FROM app.corridor_route WHERE tenant_id=NEW.tenant_id AND id=pack.route_id;
  IF a.id IS NULL OR a.status<>'ASSIGNED' OR pack.status NOT IN ('TESTING','LIMITED','ACTIVE') OR a.version<>(SELECT max(version) FROM app.mission_route_assignment WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id) OR pack.version<>(SELECT max(version) FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND route_id=pack.route_id AND effective_from<=now()) OR NEW.deadline<=now() OR NEW.expires_at>now()+interval '90 days' OR NEW.reviewer_id=NEW.created_by OR NOT EXISTS(SELECT FROM app.membership membership JOIN identity.principal principal ON principal.id=membership.user_id WHERE membership.tenant_id=NEW.tenant_id AND membership.user_id=NEW.reviewer_id AND membership.role IN ('owner','admin','operator','reviewer') AND membership.revoked_at IS NULL AND principal.kind='person' AND principal.disabled_at IS NULL AND principal.operating_country=ANY(membership.allowed_countries) AND app.tenant_processing_purpose(NEW.tenant_id)=ANY(membership.allowed_purposes) AND 'INTERNAL'=ANY(membership.allowed_classifications)) THEN RAISE EXCEPTION 'Current route, bounded deadline and independent reviewer required'; END IF;
  IF NOT EXISTS(SELECT FROM app.country WHERE code=NEW.configuration->>'workCountry') OR NOT EXISTS(SELECT FROM app.country WHERE code=NEW.configuration->>'market') OR NOT (NEW.configuration->>'market' IN (route.origin_market,route.destination_market) OR EXISTS(SELECT FROM app.market_member WHERE market_key IN (route.origin_market,route.destination_market) AND country_code=NEW.configuration->>'market' AND effective_from<=current_date AND (effective_until IS NULL OR effective_until>current_date))) OR NOT ((NEW.configuration->'capabilities') @> (pack.configuration->'requiredCapabilities')) OR NOT (NEW.configuration->'capabilities' ? (NEW.configuration->>'kind')) OR (jsonb_array_length(pack.configuration->'languages')>0 AND NOT (pack.configuration->'languages' ? (NEW.configuration->>'language'))) THEN RAISE EXCEPTION 'Explicit route market and capability scope required'; END IF;
  IF NEW.reward_rule_id IS NOT NULL THEN
   SELECT * INTO rule FROM app.reward_rule_version WHERE tenant_id=NEW.tenant_id AND id=NEW.reward_rule_id;
   IF rule.id IS NULL OR rule.effective_from>now() OR rule.effective_until<NEW.expires_at THEN RAISE EXCEPTION 'Reward rule must cover the disclosed work period'; END IF;
  END IF;
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':network:'||NEW.task_id::text,0));
  SELECT * INTO task FROM app.network_task WHERE tenant_id=NEW.tenant_id AND id=NEW.task_id;
  SELECT * INTO prev FROM app.network_event WHERE tenant_id=NEW.tenant_id AND task_id=NEW.task_id ORDER BY version DESC LIMIT 1;
  SELECT * INTO assignment FROM app.network_event WHERE tenant_id=NEW.tenant_id AND task_id=NEW.task_id AND action='ASSIGN' ORDER BY version DESC LIMIT 1;
  SELECT * INTO p FROM app.network_profile WHERE tenant_id=NEW.tenant_id AND id=(assignment.details->>'profileId')::uuid;
  IF task.id IS NULL OR NEW.version<>coalesce(prev.version,0)+1 THEN RAISE EXCEPTION 'Sequential task event required'; END IF;
  current_action:=coalesce(prev.action,'CREATED');
  IF jsonb_typeof(NEW.details) IS DISTINCT FROM 'object' OR NEW.details->>'kind' IS DISTINCT FROM (CASE NEW.action WHEN 'ASSIGN' THEN 'assignment' WHEN 'SUBMIT' THEN 'submission' WHEN 'REVIEW' THEN 'review' ELSE 'decision' END) OR (NEW.action='ASSIGN' AND NOT coalesce(NEW.details ?& ARRAY['profileId','relationshipDisclosure'] AND jsonb_typeof(NEW.details->'profileId')='string' AND jsonb_typeof(NEW.details->'relationshipDisclosure')='string',false)) OR (NEW.action='SUBMIT' AND jsonb_typeof(NEW.details->'body') IS DISTINCT FROM 'string') OR (NEW.action='REVIEW' AND (NOT (NEW.details ?& ARRAY['sourceId','claimId','evidenceQuality','timeliness','rationale','verificationId']) OR EXISTS(SELECT FROM jsonb_each(NEW.details) WHERE key<>'verificationId' AND jsonb_typeof(value)='null'))) THEN RAISE EXCEPTION 'Typed bounded event details required'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.details))<>(CASE NEW.action WHEN 'ASSIGN' THEN 3 WHEN 'SUBMIT' THEN 2 WHEN 'REVIEW' THEN 7 WHEN 'RESOLVE' THEN 2 ELSE 1 END) THEN RAISE EXCEPTION 'Exact task disclosure fields required'; END IF;
  IF NEW.action IN ('ACCEPT','SUBMIT','DISPUTE') THEN
   IF NOT app.fresh_mfa() OR NOT app.network_task_access(NEW.tenant_id,NEW.task_id) THEN RAISE EXCEPTION 'Restricted assignee access required' USING ERRCODE='42501'; END IF;
  ELSIF NOT staff OR NOT app.part4_enabled(NEW.tenant_id,'network.enabled') THEN RAISE EXCEPTION 'Network operator required' USING ERRCODE='42501'; END IF;
  IF NEW.action='ASSIGN' THEN
   IF current_action<>'CREATED' OR NOT coalesce(app.member_role(NEW.tenant_id) IN ('owner','admin') AND app.fresh_mfa(),false) OR NOT app.network_match(NEW.tenant_id,NEW.task_id,(NEW.details->>'profileId')::uuid) OR length(NEW.details->>'relationshipDisclosure') NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Reviewed eligible assignment required'; END IF;
  ELSIF NEW.action='ACCEPT' THEN
   IF current_action<>'ASSIGN' OR now()>task.deadline OR NOT app.network_match(NEW.tenant_id,NEW.task_id,p.id) THEN RAISE EXCEPTION 'Current eligible assignment required'; END IF;
  ELSIF NEW.action='SUBMIT' THEN
   IF current_action NOT IN ('ACCEPT','REQUEST_CORRECTION') OR NOT app.network_match(NEW.tenant_id,NEW.task_id,p.id) OR length(NEW.details->>'body') NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'Accepted task and bounded evidence statement required'; END IF;
  ELSIF NEW.action IN ('REVIEW','REQUEST_CORRECTION','COMPLETE','REJECT') THEN
   IF actor<>task.reviewer_id OR actor=p.principal_id OR NOT app.fresh_mfa() OR NOT app.network_profile_current(NEW.tenant_id,p.id) THEN RAISE EXCEPTION 'Independent active evidence reviewer required' USING ERRCODE='42501'; END IF;
   IF NEW.action='REVIEW' THEN
    IF current_action='RESOLVE' AND prev.details->>'resolution'='REOPEN' THEN SELECT * INTO prev FROM app.network_event WHERE tenant_id=NEW.tenant_id AND task_id=NEW.task_id AND action='SUBMIT' ORDER BY version DESC LIMIT 1; END IF;
    IF (current_action<>'SUBMIT' AND NOT (current_action='RESOLVE' AND prev.details->>'resolution'='REOPEN')) OR NOT EXISTS(SELECT FROM app.claim c JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id WHERE c.tenant_id=NEW.tenant_id AND c.id=(NEW.details->>'claimId')::uuid AND s.id=(NEW.details->>'sourceId')::uuid AND s.retention_until>now() AND s.retention_until<=task.expires_at AND s.observed_at=date_trunc('milliseconds',prev.created_at) AND s.kind='self_declaration' AND s.created_by=NEW.created_by AND c.statement=prev.details->>'body' AND s.locator='Restricted network task '||task.id::text||'; submission '||prev.id::text||'; declarant '||prev.created_by::text AND app.can_access(s.tenant_id,s.classification,s.purpose)) OR (NEW.details->>'timeliness')::integer NOT BETWEEN 0 AND 4 OR (NEW.details->>'evidenceQuality')::integer NOT BETWEEN 0 AND 4 OR length(NEW.details->>'rationale') NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Submitted evidence and reasoned dimensions required'; END IF;
    IF NEW.details->>'verificationId' IS NOT NULL AND NOT EXISTS(SELECT FROM app.evidence_object e JOIN app.evidence_state es ON es.tenant_id=e.tenant_id AND es.id=e.id WHERE e.tenant_id=NEW.tenant_id AND e.id=(NEW.details->>'verificationId')::uuid AND e.claim_id=(NEW.details->>'claimId')::uuid AND e.retention_until>now() AND es.status='VERIFIED' AND EXISTS(SELECT FROM app.verification WHERE tenant_id=e.tenant_id AND evidence_id=e.id AND decision='VERIFIED' AND valid_until>now())) THEN RAISE EXCEPTION 'Actual current verified evidence required'; END IF;
   ELSIF NEW.action='COMPLETE' AND current_action<>'REVIEW' OR NEW.action IN ('REQUEST_CORRECTION','REJECT') AND current_action NOT IN ('SUBMIT','REVIEW') AND NOT (current_action='RESOLVE' AND prev.details->>'resolution'='REOPEN') THEN RAISE EXCEPTION 'Evidence review transition required'; END IF;
  ELSIF NEW.action='DISPUTE' THEN
   IF current_action NOT IN ('SUBMIT','REVIEW','COMPLETE','REJECT') THEN RAISE EXCEPTION 'Submitted or decided work required'; END IF;
  ELSIF NEW.action='RESOLVE' THEN
   IF NEW.details->>'resolution' NOT IN ('UPHOLD','REJECT','REOPEN') OR NEW.details->>'resolution' IS NULL OR (NEW.details->>'resolution'='UPHOLD' AND NOT EXISTS(SELECT FROM app.network_event WHERE tenant_id=NEW.tenant_id AND task_id=NEW.task_id AND action='COMPLETE')) THEN RAISE EXCEPTION 'Explicit evidence-backed dispute disposition required'; END IF;
   IF current_action<>'DISPUTE' OR actor<>task.reviewer_id OR NOT app.fresh_mfa() OR actor=p.principal_id THEN RAISE EXCEPTION 'Independent dispute reviewer required'; END IF;
  ELSIF NEW.action='CANCEL' THEN
   IF current_action IN ('COMPLETE','REJECT','CANCEL','RESOLVE') OR NOT coalesce(app.member_role(NEW.tenant_id) IN ('owner','admin') AND app.fresh_mfa(),false) THEN RAISE EXCEPTION 'Reviewed cancellation of open work required'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.network_my_tasks(t uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF app.actor_id() IS NULL OR current_setting('corridra.purpose',true) IS DISTINCT FROM app.tenant_processing_purpose(t) THEN RAISE EXCEPTION 'Sign in with MFA' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',task.id,'disclosure',task.configuration,'deadline',task.deadline,'expiresAt',task.expires_at,'status',coalesce(last.action,'CREATED'),'version',coalesce(last.version,0),'reviewer',task.reviewer_id,
 'reward',CASE WHEN rule.id IS NULL THEN NULL ELSE jsonb_build_object('ruleId',rule.id,'currency',rule.currency,'amountMinor',rule.amount_minor::text,'conditional',true,'paymentGuaranteed',false) END,
 'history',(SELECT jsonb_agg(jsonb_build_object('version',e.version,'action',e.action,'reason',e.reason,'details',e.details,'createdAt',e.created_at) ORDER BY e.version) FROM app.network_event e WHERE e.tenant_id=t AND e.task_id=task.id),
 'obligations',(SELECT jsonb_agg(jsonb_build_object('id',l.id,'amountMinor',l.amount_minor::text,'currency',l.currency,'reverseOf',l.reverse_of,'paymentGuaranteed',false)) FROM app.contribution c JOIN app.service_ledger l ON l.tenant_id=c.tenant_id AND l.contribution_id=c.id WHERE c.tenant_id=t AND c.task_key='network:'||task.id::text AND c.contributor_id=app.actor_id())))
 FROM app.network_task task LEFT JOIN app.reward_rule_version rule ON rule.tenant_id=task.tenant_id AND rule.id=task.reward_rule_id
 LEFT JOIN LATERAL (SELECT * FROM app.network_event WHERE tenant_id=t AND task_id=task.id ORDER BY version DESC LIMIT 1) last ON true
 WHERE task.tenant_id=t AND app.network_task_access(t,task.id)), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION app.network_contribution_valid(t uuid,m uuid,contributor uuid,source uuid,task_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(app.can_access(t,'INTERNAL',app.tenant_processing_purpose(t)) AND EXISTS(
 SELECT FROM app.network_task task JOIN app.network_event assigned ON assigned.tenant_id=t AND assigned.task_id=task.id AND assigned.action='ASSIGN'
 JOIN app.network_profile p ON p.tenant_id=t AND p.id=(assigned.details->>'profileId')::uuid
 JOIN LATERAL (SELECT * FROM app.network_event WHERE tenant_id=t AND task_id=task.id ORDER BY version DESC LIMIT 1) last ON true
 JOIN LATERAL (SELECT * FROM app.network_event WHERE tenant_id=t AND task_id=task.id AND action='REVIEW' ORDER BY version DESC LIMIT 1) review ON true
 WHERE task.tenant_id=t AND task.id::text=substring(task_key from 9) AND task.mission_id=m AND p.principal_id=contributor AND app.network_profile_current(t,p.id) AND (last.action='COMPLETE' OR (last.action='RESOLVE' AND last.details->>'resolution'='UPHOLD' AND EXISTS(SELECT FROM app.network_event WHERE tenant_id=t AND task_id=task.id AND action='COMPLETE'))) AND (review.details->>'sourceId')::uuid=source AND review.created_by<>contributor AND task.expires_at>now()),false)
$$;
