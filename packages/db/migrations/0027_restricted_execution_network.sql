-- Private reviewed capability profiles; contributor identities never gain tenant membership.
CREATE TABLE app.network_profile (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES app.tenant(id), principal_id uuid NOT NULL REFERENCES identity.principal(id), version integer NOT NULL CHECK(version>0),
 configuration jsonb NOT NULL, eligibility_source_id uuid NOT NULL, expires_at timestamptz NOT NULL, created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,principal_id,version), FOREIGN KEY(tenant_id,eligibility_source_id) REFERENCES app.source_record(tenant_id,id)
);
CREATE TABLE app.network_task (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, mission_id uuid NOT NULL, route_assignment_id uuid NOT NULL, configuration jsonb NOT NULL,
 reviewer_id uuid NOT NULL REFERENCES identity.principal(id), reward_rule_id uuid, deadline timestamptz NOT NULL, expires_at timestamptz NOT NULL CHECK(expires_at>deadline),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id), FOREIGN KEY(tenant_id,route_assignment_id) REFERENCES app.mission_route_assignment(tenant_id,id), FOREIGN KEY(tenant_id,reward_rule_id) REFERENCES app.reward_rule_version(tenant_id,id)
);
CREATE TABLE app.network_event (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, task_id uuid NOT NULL, version integer NOT NULL CHECK(version>0), action text NOT NULL CHECK(action IN ('ASSIGN','ACCEPT','SUBMIT','REQUEST_CORRECTION','REVIEW','COMPLETE','REJECT','DISPUTE','RESOLVE','CANCEL')),
 details jsonb NOT NULL, input_hash text NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500), created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,task_id,version), FOREIGN KEY(tenant_id,task_id) REFERENCES app.network_task(tenant_id,id)
);
CREATE FUNCTION app.network_profile_current(t uuid,pid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(EXISTS(SELECT FROM app.network_profile p JOIN identity.principal i ON i.id=p.principal_id JOIN app.source_record s ON s.tenant_id=p.tenant_id AND s.id=p.eligibility_source_id
 WHERE p.tenant_id=t AND p.id=pid AND p.version=(SELECT max(version) FROM app.network_profile WHERE tenant_id=t AND principal_id=p.principal_id) AND p.configuration->>'status'='ACTIVE' AND p.configuration->>'available'='true' AND p.expires_at>now() AND i.kind='person' AND i.disabled_at IS NULL AND s.retention_until>now() AND s.observed_at<=now()),false)
$$;
CREATE FUNCTION app.network_task_access(t uuid,tid uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE task app.network_task; p app.network_profile; assignment app.network_event; enabled boolean;
BEGIN
 IF NULLIF(current_setting('corridra.tenant_id',true),'')::uuid IS DISTINCT FROM t OR current_setting('corridra.purpose',true)<>'synthetic_validation' OR app.actor_id() IS NULL THEN RETURN false; END IF;
 SELECT * INTO task FROM app.network_task WHERE tenant_id=t AND id=tid AND expires_at>now();
 SELECT coalesce(value->>'enabled'='true',false) INTO enabled FROM app.config_version WHERE tenant_id=t AND key='network.enabled' AND effective_from<=now() ORDER BY version DESC LIMIT 1;
 IF task.id IS NULL OR NOT coalesce(enabled,false) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=t AND synthetic) THEN RETURN false; END IF;
 SELECT * INTO assignment FROM app.network_event WHERE tenant_id=t AND task_id=tid AND action='ASSIGN' ORDER BY version DESC LIMIT 1;
 SELECT * INTO p FROM app.network_profile WHERE tenant_id=t AND id=(assignment.details->>'profileId')::uuid;
 RETURN coalesce(p.principal_id=app.actor_id() AND app.network_profile_current(t,p.id) AND length(assignment.details->>'relationshipDisclosure')>=3,false);
END $$;
CREATE FUNCTION app.network_match(t uuid,tid uuid,pid uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE task app.network_task; p app.network_profile; assignment app.mission_route_assignment; pack app.corridor_pack_version;
BEGIN
 SELECT * INTO task FROM app.network_task WHERE tenant_id=t AND id=tid;
 SELECT * INTO p FROM app.network_profile WHERE tenant_id=t AND id=pid;
 SELECT * INTO assignment FROM app.mission_route_assignment WHERE tenant_id=t AND id=task.route_assignment_id;
 SELECT * INTO pack FROM app.corridor_pack_version WHERE tenant_id=t AND id=assignment.pack_id;
 RETURN coalesce(app.network_profile_current(t,pid) AND task.expires_at>now() AND p.expires_at>=task.expires_at AND p.principal_id<>task.reviewer_id AND
 p.configuration->'markets' ? (task.configuration->>'market') AND p.configuration->'workCountries' ? (task.configuration->>'workCountry') AND p.configuration->'languages' ? (task.configuration->>'language') AND p.configuration->'sectors' ? (task.configuration->>'sector') AND (p.configuration->'capabilities') @> (task.configuration->'capabilities') AND (p.configuration->'capabilities') @> (pack.configuration->'requiredCapabilities') AND
 assignment.version=(SELECT max(version) FROM app.mission_route_assignment WHERE tenant_id=t AND mission_id=task.mission_id) AND pack.version=(SELECT max(version) FROM app.corridor_pack_version WHERE tenant_id=t AND route_id=pack.route_id AND effective_from<=now()) AND pack.status IN ('TESTING','LIMITED','ACTIVE') AND EXISTS(SELECT FROM app.mission WHERE tenant_id=t AND id=task.mission_id AND status NOT IN ('CANCELLED','CLOSED')),false);
END $$;
CREATE FUNCTION app.guard_network() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k text; required text[]; task app.network_task; prev app.network_event; assignment app.network_event; p app.network_profile; a app.mission_route_assignment; pack app.corridor_pack_version; route app.corridor_route; rule app.reward_rule_version; staff boolean; actor uuid:=app.actor_id(); review app.network_event; current_action text;
BEGIN
 IF NEW.created_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'Server-recorded task timestamp required'; END IF;
 IF actor IS NULL OR NEW.created_by<>actor OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Network actor required' USING ERRCODE='42501'; END IF;
 staff:=coalesce(app.can_access(NEW.tenant_id,'INTERNAL','synthetic_validation') AND app.member_role(NEW.tenant_id) IN ('owner','admin','operator','reviewer'),false);
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
  IF a.id IS NULL OR a.status<>'ASSIGNED' OR pack.status NOT IN ('TESTING','LIMITED','ACTIVE') OR a.version<>(SELECT max(version) FROM app.mission_route_assignment WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id) OR pack.version<>(SELECT max(version) FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND route_id=pack.route_id AND effective_from<=now()) OR NEW.deadline<=now() OR NEW.expires_at>now()+interval '90 days' OR NEW.reviewer_id=NEW.created_by OR NOT EXISTS(SELECT FROM app.membership membership JOIN identity.principal principal ON principal.id=membership.user_id WHERE membership.tenant_id=NEW.tenant_id AND membership.user_id=NEW.reviewer_id AND membership.role IN ('owner','admin','operator','reviewer') AND membership.revoked_at IS NULL AND principal.kind='person' AND principal.disabled_at IS NULL AND principal.operating_country=ANY(membership.allowed_countries) AND 'synthetic_validation'=ANY(membership.allowed_purposes) AND 'INTERNAL'=ANY(membership.allowed_classifications)) THEN RAISE EXCEPTION 'Current route, bounded deadline and independent reviewer required'; END IF;
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
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['network_profile','network_task','network_event'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY read ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator'',''reviewer''))',t);
  EXECUTE format('CREATE POLICY add ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND created_by=app.actor_id())',t);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO corridra_runtime',t);
  EXECUTE format('CREATE TRIGGER guard BEFORE INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_network()',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',t);
  EXECUTE format('CREATE TRIGGER event AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_change()',t);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION app.guard_network(),app.network_profile_current(uuid,uuid),app.network_match(uuid,uuid,uuid),app.network_task_access(uuid,uuid) FROM PUBLIC;

-- A restricted identity can see only tasks actually assigned to it, never a member workspace.
CREATE FUNCTION app.network_my_tasks(t uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF app.actor_id() IS NULL OR current_setting('corridra.purpose',true)<>'synthetic_validation' THEN RAISE EXCEPTION 'Sign in with MFA' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',task.id,'disclosure',task.configuration,'deadline',task.deadline,'expiresAt',task.expires_at,'status',coalesce(last.action,'CREATED'),'version',coalesce(last.version,0),'reviewer',task.reviewer_id,
 'reward',CASE WHEN rule.id IS NULL THEN NULL ELSE jsonb_build_object('ruleId',rule.id,'currency',rule.currency,'amountMinor',rule.amount_minor::text,'conditional',true,'paymentGuaranteed',false) END,
 'history',(SELECT jsonb_agg(jsonb_build_object('version',e.version,'action',e.action,'reason',e.reason,'details',e.details,'createdAt',e.created_at) ORDER BY e.version) FROM app.network_event e WHERE e.tenant_id=t AND e.task_id=task.id),
 'obligations',(SELECT jsonb_agg(jsonb_build_object('id',l.id,'amountMinor',l.amount_minor::text,'currency',l.currency,'reverseOf',l.reverse_of,'paymentGuaranteed',false)) FROM app.contribution c JOIN app.service_ledger l ON l.tenant_id=c.tenant_id AND l.contribution_id=c.id WHERE c.tenant_id=t AND c.task_key='network:'||task.id::text AND c.contributor_id=app.actor_id())))
 FROM app.network_task task LEFT JOIN app.reward_rule_version rule ON rule.tenant_id=task.tenant_id AND rule.id=task.reward_rule_id
 LEFT JOIN LATERAL (SELECT * FROM app.network_event WHERE tenant_id=t AND task_id=task.id ORDER BY version DESC LIMIT 1) last ON true
 WHERE task.tenant_id=t AND app.network_task_access(t,task.id)), '[]'::jsonb);
END $$;
CREATE FUNCTION app.network_contributor_command(t uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tid uuid:=(payload->>'taskId')::uuid; cid uuid:=(payload->>'commandId')::uuid; actor uuid:=app.actor_id(); h text:=encode(sha256(convert_to(payload::text,'UTF8')),'hex'); prior app.network_event;
BEGIN
 IF NOT app.network_task_access(t,tid) OR payload->>'action' NOT IN ('ACCEPT','SUBMIT','DISPUTE') OR NOT (payload ?& ARRAY['taskId','commandId','version','action','reason','details']) OR (SELECT count(*) FROM jsonb_object_keys(payload))<>6 THEN RAISE EXCEPTION 'Restricted task command denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':network:'||tid::text,0));
 SELECT * INTO prior FROM app.network_event WHERE tenant_id=t AND id=cid;
 IF prior.id IS NOT NULL THEN
  IF prior.created_by<>actor OR prior.input_hash<>h THEN RAISE EXCEPTION 'Command key reused'; END IF;
  RETURN jsonb_build_object('id',cid,'version',prior.version,'duplicate',true);
 END IF;
 INSERT INTO app.network_event(id,tenant_id,task_id,version,action,details,input_hash,reason,created_by) VALUES(cid,t,tid,(payload->>'version')::integer+1,payload->>'action',payload->'details',h,payload->>'reason',actor);
 RETURN jsonb_build_object('id',cid,'version',(payload->>'version')::integer+1,'duplicate',false);
END $$;
CREATE FUNCTION app.network_contribution_valid(t uuid,m uuid,contributor uuid,source uuid,task_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(app.can_access(t,'INTERNAL','synthetic_validation') AND EXISTS(
 SELECT FROM app.network_task task JOIN app.network_event assigned ON assigned.tenant_id=t AND assigned.task_id=task.id AND assigned.action='ASSIGN'
 JOIN app.network_profile p ON p.tenant_id=t AND p.id=(assigned.details->>'profileId')::uuid
 JOIN LATERAL (SELECT * FROM app.network_event WHERE tenant_id=t AND task_id=task.id ORDER BY version DESC LIMIT 1) last ON true
 JOIN LATERAL (SELECT * FROM app.network_event WHERE tenant_id=t AND task_id=task.id AND action='REVIEW' ORDER BY version DESC LIMIT 1) review ON true
 WHERE task.tenant_id=t AND task.id::text=substring(task_key from 9) AND task.mission_id=m AND p.principal_id=contributor AND app.network_profile_current(t,p.id) AND (last.action='COMPLETE' OR (last.action='RESOLVE' AND last.details->>'resolution'='UPHOLD' AND EXISTS(SELECT FROM app.network_event WHERE tenant_id=t AND task_id=task.id AND action='COMPLETE'))) AND (review.details->>'sourceId')::uuid=source AND review.created_by<>contributor AND task.expires_at>now()),false)
$$;
CREATE FUNCTION app.network_assess(t uuid,tid uuid,reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE task app.network_task; assignment app.network_event; review app.network_event; profile app.network_profile; old app.contribution; cid uuid:=gen_random_uuid();
BEGIN
 IF NOT app.part4_enabled(t,'network.enabled') OR NOT coalesce(app.member_role(t) IN ('owner','admin','operator'),false) OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Contribution assessment operator required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':network:'||tid::text,0));
 SELECT * INTO task FROM app.network_task WHERE tenant_id=t AND id=tid;
 SELECT * INTO assignment FROM app.network_event WHERE tenant_id=t AND task_id=tid AND action='ASSIGN' ORDER BY version DESC LIMIT 1;
 SELECT * INTO profile FROM app.network_profile WHERE tenant_id=t AND id=(assignment.details->>'profileId')::uuid;
 SELECT * INTO review FROM app.network_event WHERE tenant_id=t AND task_id=tid AND action='REVIEW' ORDER BY version DESC LIMIT 1;
 IF NOT app.network_contribution_valid(t,task.mission_id,profile.principal_id,(review.details->>'sourceId')::uuid,'network:'||tid::text) THEN RAISE EXCEPTION 'Completed independently reviewed contribution required'; END IF;
 SELECT * INTO old FROM app.contribution WHERE tenant_id=t AND task_key='network:'||tid::text AND mission_id=task.mission_id AND contributor_id=profile.principal_id;
 IF old.id IS NOT NULL THEN RETURN old.id; END IF;
 INSERT INTO app.contribution(id,tenant_id,mission_id,contributor_id,source_id,task_key,relationship_disclosure,reason,created_by) VALUES(cid,t,task.mission_id,profile.principal_id,(review.details->>'sourceId')::uuid,'network:'||tid::text,assignment.details->>'relationshipDisclosure',reason,app.actor_id());
 RETURN cid;
END $$;
-- Network reward credits must use the rule disclosed before acceptance and remain undisputed.
-- The existing independent accounting, reconciliation and exact negative reversal guards still run.
CREATE FUNCTION app.guard_network_reward() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE contribution app.contribution; task app.network_task;
BEGIN
 IF NEW.kind='CONTRIBUTOR_REWARD' AND NEW.reverse_of IS NULL THEN
  SELECT * INTO contribution FROM app.contribution WHERE tenant_id=NEW.tenant_id AND id=NEW.contribution_id;
  IF contribution.task_key LIKE 'network:%' THEN
   SELECT * INTO task FROM app.network_task WHERE tenant_id=NEW.tenant_id AND id::text=substring(contribution.task_key from 9);
   IF task.id IS NULL OR task.reward_rule_id IS DISTINCT FROM NEW.rule_id OR NOT app.network_contribution_valid(NEW.tenant_id,contribution.mission_id,contribution.contributor_id,contribution.source_id,contribution.task_key) THEN RAISE EXCEPTION 'Disclosed rule and undisputed task required'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER network_contract BEFORE INSERT ON app.service_ledger FOR EACH ROW EXECUTE FUNCTION app.guard_network_reward();
REVOKE ALL ON FUNCTION app.network_my_tasks(uuid),app.network_contributor_command(uuid,jsonb),app.network_contribution_valid(uuid,uuid,uuid,uuid,text),app.network_assess(uuid,uuid,text),app.guard_network_reward() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.network_my_tasks(uuid),app.network_contributor_command(uuid,jsonb),app.network_assess(uuid,uuid,text) TO corridra_runtime;

-- Narrow extension: completed reviewed task contributors may be non-members. No old monetary guard is removed.
CREATE OR REPLACE FUNCTION app.guard_service_foundation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE original app.service_ledger; rule app.reward_rule_version; task app.contribution; src app.source_record;
BEGIN
 IF NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL','synthetic_validation') AND NEW.created_by=app.actor_id(),false) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Synthetic tenant actor required' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='contribution' THEN
  IF NOT coalesce(app.member_role(NEW.tenant_id) IN ('owner','admin','operator'),false) THEN RAISE EXCEPTION 'Contribution operator required' USING ERRCODE='42501'; END IF;
 ELSE
  IF NOT coalesce(app.member_role(NEW.tenant_id) IN ('owner','admin') AND app.fresh_mfa(),false) THEN RAISE EXCEPTION 'Accounting/configuration authority and fresh MFA required' USING ERRCODE='42501'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':service-economics',0));
 IF TG_TABLE_NAME<>'reward_rule_version' THEN
  SELECT * INTO src FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.source_id AND app.can_access(tenant_id,classification,purpose) AND retention_until>now() AND observed_at<=now();
  IF src.id IS NULL THEN RAISE EXCEPTION 'Current accessible source required'; END IF;
 END IF;
 IF TG_TABLE_NAME='data_rights_policy' THEN
  IF NEW.version<>coalesce((SELECT max(version) FROM app.data_rights_policy WHERE tenant_id=NEW.tenant_id AND source_id=NEW.source_id),0)+1 OR EXISTS(SELECT FROM app.data_rights_policy WHERE tenant_id=NEW.tenant_id AND source_id=NEW.source_id AND effective_from>=NEW.effective_from) THEN RAISE EXCEPTION 'Sequential effective policy version required'; END IF;
  IF NEW.retention_until>src.retention_until OR NEW.retention_until<=now() OR NEW.data_classification<>src.classification OR NEW.data_purpose<>src.purpose OR cardinality(NEW.jurisdictions)=0 OR cardinality(NEW.processing_locations)=0 OR EXISTS(SELECT FROM unnest(NEW.jurisdictions||NEW.subject_locations||NEW.processing_locations) c WHERE NOT EXISTS(SELECT FROM app.country WHERE code=c)) THEN RAISE EXCEPTION 'Policy cannot expand source rights'; END IF;
  IF NEW.ai_permission<>'DENY' AND src.ai_policy='DENY' THEN RAISE EXCEPTION 'Source AI denial cannot be overridden'; END IF;
 ELSIF TG_TABLE_NAME='reward_rule_version' THEN
  IF NEW.version<>coalesce((SELECT max(version) FROM app.reward_rule_version WHERE tenant_id=NEW.tenant_id AND key=NEW.key),0)+1 OR EXISTS(SELECT FROM app.reward_rule_version WHERE tenant_id=NEW.tenant_id AND key=NEW.key AND tstzrange(effective_from,effective_until,'[)') && tstzrange(NEW.effective_from,NEW.effective_until,'[)')) THEN RAISE EXCEPTION 'Nonoverlapping sequential reward rule required'; END IF;
 ELSIF TG_TABLE_NAME='contribution' THEN
  IF NOT EXISTS(SELECT FROM app.mission WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id) OR (NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.contributor_id) AND NOT app.network_contribution_valid(NEW.tenant_id,NEW.mission_id,NEW.contributor_id,NEW.source_id,NEW.task_key)) THEN RAISE EXCEPTION 'Scoped mission and active contributor required'; END IF;
 ELSIF TG_TABLE_NAME='service_ledger' THEN
  IF NOT EXISTS(SELECT FROM app.mission WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id) THEN RAISE EXCEPTION 'Accessible mission required'; END IF;
  IF NEW.reverse_of IS NOT NULL THEN
   SELECT * INTO original FROM app.service_ledger WHERE tenant_id=NEW.tenant_id AND id=NEW.reverse_of;
   IF original.id IS NULL OR original.reverse_of IS NOT NULL OR (NEW.mission_id,NEW.kind,NEW.currency,NEW.contribution_id,NEW.rule_id,NEW.amount_minor) IS DISTINCT FROM (original.mission_id,original.kind,original.currency,original.contribution_id,original.rule_id,-original.amount_minor) OR NEW.occurred_at<original.occurred_at OR EXISTS(SELECT FROM app.reward_reconciliation WHERE tenant_id=NEW.tenant_id AND ledger_id=original.id AND status='MANUALLY_RECONCILED') THEN RAISE EXCEPTION 'Exact unreconciled compensation required'; END IF;
  ELSIF NEW.kind='CONTRIBUTOR_REWARD' THEN
   SELECT * INTO rule FROM app.reward_rule_version WHERE tenant_id=NEW.tenant_id AND id=NEW.rule_id;
   SELECT * INTO task FROM app.contribution WHERE tenant_id=NEW.tenant_id AND id=NEW.contribution_id;
   IF rule.id IS NULL OR task.id IS NULL OR task.mission_id<>NEW.mission_id OR NEW.created_by IN (task.created_by,task.contributor_id) OR NEW.amount_minor<>rule.amount_minor OR NEW.currency<>rule.currency OR task.created_at<rule.effective_from OR task.created_at>=rule.effective_until THEN RAISE EXCEPTION 'Independent review and exact effective reward required'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='reward_reconciliation' THEN
  SELECT * INTO original FROM app.service_ledger WHERE tenant_id=NEW.tenant_id AND id=NEW.ledger_id AND kind='CONTRIBUTOR_REWARD' AND reverse_of IS NULL;
  SELECT * INTO task FROM app.contribution WHERE tenant_id=NEW.tenant_id AND id=original.contribution_id;
  IF original.id IS NULL OR NEW.created_by IN (original.created_by,task.contributor_id,task.created_by) OR NEW.version<>coalesce((SELECT max(version) FROM app.reward_reconciliation WHERE tenant_id=NEW.tenant_id AND ledger_id=NEW.ledger_id),0)+1 OR EXISTS(SELECT FROM app.reward_reconciliation WHERE tenant_id=NEW.tenant_id AND ledger_id=NEW.ledger_id AND status IN ('MANUALLY_RECONCILED','CANCELLED')) OR EXISTS(SELECT FROM app.service_ledger WHERE tenant_id=NEW.tenant_id AND reverse_of=original.id) THEN RAISE EXCEPTION 'Independent reconciler and open reward required'; END IF;
 END IF;
 RETURN NEW;
END $$;

GRANT EXECUTE ON FUNCTION app.network_contribution_valid(uuid,uuid,uuid,uuid,text) TO corridra_runtime;

CREATE FUNCTION app.guard_network_contribution() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.task_key LIKE 'network:%' AND NEW.relationship_disclosure IS DISTINCT FROM (SELECT details->>'relationshipDisclosure' FROM app.network_event WHERE tenant_id=NEW.tenant_id AND task_id::text=substring(NEW.task_key from 9) AND action='ASSIGN' ORDER BY version DESC LIMIT 1) THEN RAISE EXCEPTION 'Original reviewed relationship disclosure required'; END IF;
 IF NEW.task_key LIKE 'network:%' AND (NEW.created_by=NEW.contributor_id OR NOT app.network_contribution_valid(NEW.tenant_id,NEW.mission_id,NEW.contributor_id,NEW.source_id,NEW.task_key)) THEN RAISE EXCEPTION 'Independent assessment of completed scoped work required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER network_contract BEFORE INSERT ON app.contribution FOR EACH ROW EXECUTE FUNCTION app.guard_network_contribution();
REVOKE ALL ON FUNCTION app.guard_network_contribution() FROM PUBLIC;

-- Reviewed dimensions by capability/task category, never an opaque universal ranking or revenue claim.
CREATE VIEW app.network_performance WITH(security_invoker=true) AS
SELECT p.tenant_id,p.principal_id,task.configuration->>'kind' AS task_kind,task.configuration->>'market' AS market,
 count(*)::int AS completed_reviewed_tasks,
 avg((review.details->>'evidenceQuality')::integer)::numeric(4,2) AS evidence_quality,
 avg((review.details->>'timeliness')::integer)::numeric(4,2) AS timeliness,
 count(*) FILTER(WHERE EXISTS(SELECT FROM app.evidence_object e JOIN app.evidence_state es ON es.tenant_id=e.tenant_id AND es.id=e.id JOIN app.verification v ON v.tenant_id=e.tenant_id AND v.evidence_id=e.id WHERE e.tenant_id=task.tenant_id AND e.id::text=review.details->>'verificationId' AND e.claim_id::text=review.details->>'claimId' AND es.status='VERIFIED' AND e.retention_until>now() AND v.decision='VERIFIED' AND v.valid_until>now()))::int AS tasks_with_current_verified_evidence,
 jsonb_agg(jsonb_build_object('taskId',task.id,'rationale',review.details->>'rationale','reviewerId',review.created_by,'sourceId',review.details->>'sourceId','verificationId',review.details->>'verificationId')) AS rationale
FROM app.network_task task
JOIN app.network_event assigned ON assigned.tenant_id=task.tenant_id AND assigned.task_id=task.id AND assigned.action='ASSIGN'
JOIN app.network_profile p ON p.tenant_id=task.tenant_id AND p.id=(assigned.details->>'profileId')::uuid
JOIN LATERAL (SELECT * FROM app.network_event WHERE tenant_id=task.tenant_id AND task_id=task.id AND action='REVIEW' ORDER BY version DESC LIMIT 1) review ON true
JOIN LATERAL (SELECT * FROM app.network_event WHERE tenant_id=task.tenant_id AND task_id=task.id ORDER BY version DESC LIMIT 1) last ON true
JOIN app.source_record source ON source.tenant_id=task.tenant_id AND source.id=(review.details->>'sourceId')::uuid AND source.retention_until>now() AND app.can_access(source.tenant_id,source.classification,source.purpose)
WHERE last.action='COMPLETE' OR (last.action='RESOLVE' AND last.details->>'resolution'='UPHOLD' AND EXISTS(SELECT FROM app.network_event WHERE tenant_id=task.tenant_id AND task_id=task.id AND action='COMPLETE'))
GROUP BY p.tenant_id,p.principal_id,task.configuration->>'kind',task.configuration->>'market';
GRANT SELECT ON app.network_performance TO corridra_runtime;
