-- Revised V2 Part 4. Additive public-text assistance; all consequential commands stay human.
CREATE TABLE app.ai_model_policy (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES app.tenant(id), key text NOT NULL CHECK(length(key) BETWEEN 3 AND 80), version integer NOT NULL CHECK(version>0),
 configuration jsonb NOT NULL, terms_source_id uuid NOT NULL, daily_budget_minor bigint NOT NULL CHECK(daily_budget_minor BETWEEN 1 AND 100000), effective_from timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,key,version), FOREIGN KEY(tenant_id,terms_source_id) REFERENCES app.source_record(tenant_id,id)
);
CREATE TABLE app.ai_run (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, mission_id uuid NOT NULL, policy_id uuid NOT NULL, task text NOT NULL,
 input jsonb NOT NULL, input_hash text NOT NULL, created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id), FOREIGN KEY(tenant_id,policy_id) REFERENCES app.ai_model_policy(tenant_id,id)
);
CREATE TABLE app.ai_attempt (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, run_id uuid NOT NULL, policy_id uuid NOT NULL, reserved_minor bigint NOT NULL CHECK(reserved_minor>0),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,run_id) REFERENCES app.ai_run(tenant_id,id), FOREIGN KEY(tenant_id,policy_id) REFERENCES app.ai_model_policy(tenant_id,id)
);
CREATE TABLE app.ai_result (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, attempt_id uuid NOT NULL, status text NOT NULL CHECK(status IN ('SUCCEEDED','FAILED')), output jsonb, metadata jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,attempt_id), FOREIGN KEY(tenant_id,attempt_id) REFERENCES app.ai_attempt(tenant_id,id),
 CHECK((status='SUCCEEDED' AND output->>'authority'='UNVERIFIED_DRAFT') OR (status='FAILED' AND output IS NULL))
);
CREATE TABLE app.ai_completion (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,run_id uuid NOT NULL,status text NOT NULL CHECK(status IN ('DRAFT_READY','MANUAL_REVIEW')),reason_code text NOT NULL CHECK(reason_code IN ('VALIDATED_DRAFT','PROVIDER_OR_BUDGET_UNAVAILABLE')),
 created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),UNIQUE(tenant_id,run_id),FOREIGN KEY(tenant_id,run_id) REFERENCES app.ai_run(tenant_id,id)
);
CREATE TABLE app.ai_review (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, result_id uuid NOT NULL, decision text NOT NULL CHECK(decision IN ('ACCEPT','EDIT','REJECT')), edited_output jsonb, reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,result_id), FOREIGN KEY(tenant_id,result_id) REFERENCES app.ai_result(tenant_id,id),
 CHECK((decision='EDIT' AND edited_output->>'authority'='UNVERIFIED_DRAFT') OR (decision<>'EDIT' AND edited_output IS NULL))
);
CREATE FUNCTION app.part4_enabled(t uuid,k text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(app.can_access(t,'INTERNAL','synthetic_validation') AND EXISTS(SELECT FROM app.tenant WHERE id=t AND synthetic) AND
 (SELECT value->>'enabled'='true' FROM app.config_version WHERE tenant_id=t AND key=k AND effective_from<=now() ORDER BY version DESC LIMIT 1),false)
$$;
-- This helper is not a source lookup oracle: it requires scoped member access and returns only authorization.
CREATE FUNCTION app.ai_run_authorized(t uuid,m uuid,pid uuid,actor uuid,inp jsonb,task_name text,root_pid uuid DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.ai_model_policy; cid text; s app.source_record; c app.claim; d app.data_rights_policy; assigned app.mission_route_assignment; pack app.corridor_pack_version;
BEGIN
 root_pid:=coalesce(root_pid,pid);
 IF pid<>root_pid AND NOT EXISTS(SELECT FROM app.ai_model_policy primary_policy WHERE tenant_id=t AND id=root_pid AND configuration->'fallbackPolicyIds' ? pid::text AND effective_from<=now() AND (configuration->>'effectiveUntil')::timestamptz>now() AND version=(SELECT max(version) FROM app.ai_model_policy latest WHERE latest.tenant_id=t AND latest.key=primary_policy.key AND latest.effective_from<=now())) THEN RETURN false; END IF;
 IF actor<>app.actor_id() OR NOT app.part4_enabled(t,'ai.enabled') OR NOT coalesce(app.member_role(t) IN ('owner','admin','operator','reviewer') AND app.fresh_mfa(),false) THEN RETURN false; END IF;
 SELECT * INTO p FROM app.ai_model_policy WHERE tenant_id=t AND id=pid AND effective_from<=now() AND (configuration->>'effectiveUntil')::timestamptz>now();
 IF p.id IS NULL OR NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=t AND id::text=p.configuration->>'evaluationSourceId' AND retention_until>now() AND observed_at<=now() AND app.can_access(tenant_id,classification,purpose)) OR NOT (p.configuration->'tasks' ? task_name) OR NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=t AND id=p.terms_source_id AND retention_until>now() AND observed_at<=now() AND app.can_access(tenant_id,classification,purpose)) THEN RETURN false; END IF;
 IF p.version<>(SELECT max(version) FROM app.ai_model_policy WHERE tenant_id=t AND key=p.key AND effective_from<=now()) THEN RETURN false; END IF;
 SELECT * INTO assigned FROM app.mission_route_assignment WHERE tenant_id=t AND mission_id=m ORDER BY version DESC LIMIT 1;
 SELECT * INTO pack FROM app.corridor_pack_version WHERE tenant_id=t AND id=assigned.pack_id;
 IF assigned.status<>'ASSIGNED' OR pack.id IS NULL OR pack.status NOT IN ('TESTING','LIMITED','ACTIVE') OR pack.configuration->>'aiPolicyRef' IS DISTINCT FROM root_pid::text OR pack.version<>(SELECT max(version) FROM app.corridor_pack_version WHERE tenant_id=t AND route_id=pack.route_id AND effective_from<=now()) OR NOT EXISTS(SELECT FROM app.mission WHERE tenant_id=t AND id=m AND status NOT IN ('CANCELLED','CLOSED')) THEN RETURN false; END IF;
 IF jsonb_typeof(inp) IS DISTINCT FROM 'object' OR NOT (inp ?& ARRAY['task','schemaVersion','claimIds']) OR (SELECT count(*) FROM jsonb_object_keys(inp))<>(CASE WHEN task_name='translation' THEN 4 ELSE 3 END) OR jsonb_typeof(inp->'schemaVersion') IS DISTINCT FROM 'number' OR (task_name='translation' AND (jsonb_typeof(inp->'targetLanguage') IS DISTINCT FROM 'string' OR inp->>'targetLanguage' !~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$')) THEN RETURN false; END IF;
 IF inp->>'task'<>task_name OR inp->>'schemaVersion'<>'1' OR jsonb_typeof(inp->'claimIds')<>'array' OR jsonb_array_length(inp->'claimIds') NOT BETWEEN 1 AND 10 OR (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(inp->'claimIds') x)<>jsonb_array_length(inp->'claimIds') THEN RETURN false; END IF;
 FOR cid IN SELECT jsonb_array_elements_text(inp->'claimIds') LOOP
  SELECT * INTO c FROM app.claim WHERE tenant_id=t AND id=cid::uuid AND classification='PUBLIC' AND app.can_access(tenant_id,classification,purpose);
  SELECT * INTO s FROM app.source_record WHERE tenant_id=t AND id=c.source_id AND classification='PUBLIC' AND ai_policy<>'DENY' AND retention_until>now() AND observed_at<=now() AND app.can_access(tenant_id,classification,purpose);
  SELECT * INTO d FROM app.data_rights_policy WHERE tenant_id=t AND source_id=s.id AND effective_from<=now() ORDER BY version DESC LIMIT 1;
  IF c.id IS NULL OR s.id IS NULL OR d.id IS NULL OR d.data_role='UNREVIEWED' OR d.ai_permission='DENY' OR d.transfer_status<>'APPROVED' OR d.data_classification<>'PUBLIC' OR NOT ('AI_REVIEW'=ANY(d.permitted_reuse)) OR d.retention_until<=now() OR d.data_purpose<>c.purpose OR cardinality(d.subject_locations)>0 OR c.statement ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}' OR c.statement ~* '(\+[0-9][0-9 ()-]{7,}[0-9]|(phone|tel|mobile|whatsapp)[[:space:]]*[:=]?[[:space:]]*[0-9][0-9 ()-]{6,}[0-9])' OR NOT (ARRAY(SELECT jsonb_array_elements_text(p.configuration->'processingLocations')) <@ d.processing_locations) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION app.guard_ai() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE run app.ai_run; attempt app.ai_attempt; policy app.ai_model_policy; cfg jsonb; n integer;
BEGIN
 IF NEW.created_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'Server-recorded AI timestamp required'; END IF;
 IF NEW.created_by<>app.actor_id() OR NOT app.can_access(NEW.tenant_id,'INTERNAL','synthetic_validation') OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Scoped synthetic actor required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':ai-budget',0));
 IF TG_TABLE_NAME='ai_model_policy' THEN
  IF NOT coalesce(app.member_role(NEW.tenant_id) IN ('owner','admin') AND app.fresh_mfa(),false) THEN RAISE EXCEPTION 'AI configuration authority required' USING ERRCODE='42501'; END IF;
  cfg:=NEW.configuration;
  IF jsonb_typeof(cfg) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_each(cfg) WHERE jsonb_typeof(value)='null') THEN RAISE EXCEPTION 'Complete non-null AI model policy required'; END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM app.ai_model_policy WHERE tenant_id=NEW.tenant_id AND key=NEW.key),0)+1 OR EXISTS(SELECT FROM app.ai_model_policy WHERE tenant_id=NEW.tenant_id AND key=NEW.key AND effective_from>=NEW.effective_from) OR cfg->>'id'<>NEW.id::text OR (cfg->>'version')::integer<>NEW.version OR cfg->>'approved'<>'true' OR cfg->>'currency'<>'USD' OR (cfg->>'effectiveUntil')::timestamptz<=NEW.effective_from OR cfg->>'model' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' OR cfg->>'model' ~ '(^|/)\.\.?(/|$)' OR NOT coalesce((cfg->>'adapter',cfg->>'secretRef') IN (('openai','CORRIDRA_OPENAI_API_KEY'),('anthropic','CORRIDRA_ANTHROPIC_API_KEY'),('google','CORRIDRA_GOOGLE_API_KEY')),false) THEN RAISE EXCEPTION 'Invalid sequential AI policy'; END IF;
  IF NOT (cfg ?& ARRAY['id','version','adapter','model','secretRef','approved','processingLocations','tasks','inputRateMinorPerMillion','outputRateMinorPerMillion','maxCostMinor','currency','effectiveUntil','fallbackPolicyIds','evaluationStatus','evaluationSourceId']) OR (SELECT count(*) FROM jsonb_object_keys(cfg))<>16 OR jsonb_typeof(cfg->'tasks')<>'array' OR jsonb_array_length(cfg->'tasks') NOT BETWEEN 1 AND 12 OR jsonb_typeof(cfg->'processingLocations')<>'array' OR jsonb_array_length(cfg->'processingLocations') NOT BETWEEN 1 AND 20 OR EXISTS(SELECT FROM jsonb_array_elements_text(cfg->'processingLocations') c WHERE NOT EXISTS(SELECT FROM app.country WHERE code=c)) OR cfg->>'inputRateMinorPerMillion' !~ '^[1-9][0-9]{0,12}$' OR cfg->>'outputRateMinorPerMillion' !~ '^[1-9][0-9]{0,12}$' OR cfg->>'maxCostMinor' !~ '^[1-9][0-9]{0,12}$' THEN RAISE EXCEPTION 'Bounded approved model configuration required'; END IF;
  IF jsonb_typeof(cfg->'fallbackPolicyIds') IS DISTINCT FROM 'array' OR jsonb_array_length(cfg->'fallbackPolicyIds')>1 OR EXISTS(SELECT FROM jsonb_array_elements_text(cfg->'fallbackPolicyIds') fallback_id WHERE fallback_id=NEW.id::text OR NOT EXISTS(SELECT FROM app.ai_model_policy WHERE tenant_id=NEW.tenant_id AND id::text=fallback_id AND effective_from<=now() AND (configuration->>'effectiveUntil')::timestamptz>now())) THEN RAISE EXCEPTION 'Explicit approved same-tenant fallback required'; END IF;
  IF cfg->>'evaluationStatus' NOT IN ('SYNTHETIC_ONLY','APPROVED_PROVIDER') OR NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id::text=cfg->>'evaluationSourceId' AND retention_until>now() AND observed_at<=now() AND app.can_access(tenant_id,classification,purpose)) THEN RAISE EXCEPTION 'Current reviewed model evaluation source required'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(cfg->'tasks') t WHERE t NOT IN ('commercial_intent','requirement_structuring','counterparty_research','entity_duplicate_suggestions','buyer_supplier_fit','machinery_specification','quotation_comparison','meeting_preparation','translation','evidence_gaps','post_meeting_followup','opportunity_outcome_summary')) THEN RAISE EXCEPTION 'Registered task required'; END IF;
  IF NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.terms_source_id AND retention_until>now() AND observed_at<=now() AND app.can_access(tenant_id,classification,purpose)) THEN RAISE EXCEPTION 'Current provider terms source required'; END IF;
 ELSIF TG_TABLE_NAME='ai_run' THEN
  IF NOT app.ai_run_authorized(NEW.tenant_id,NEW.mission_id,NEW.policy_id,NEW.created_by,NEW.input,NEW.task) THEN RAISE EXCEPTION 'AI retrieval or route denied' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='ai_attempt' THEN
  SELECT * INTO run FROM app.ai_run WHERE tenant_id=NEW.tenant_id AND id=NEW.run_id AND created_by=NEW.created_by;
  SELECT * INTO policy FROM app.ai_model_policy WHERE tenant_id=NEW.tenant_id AND id=NEW.policy_id;
  IF run.id IS NULL OR NOT app.ai_run_authorized(run.tenant_id,run.mission_id,NEW.policy_id,NEW.created_by,run.input,run.task,run.policy_id) THEN RAISE EXCEPTION 'AI policy changed' USING ERRCODE='42501'; END IF;
  SELECT count(*) INTO n FROM app.ai_attempt WHERE tenant_id=NEW.tenant_id AND run_id=run.id;
  IF n>=2 OR NEW.reserved_minor+coalesce((SELECT sum(reserved_minor) FROM app.ai_attempt WHERE tenant_id=NEW.tenant_id AND run_id=run.id),0)>(SELECT (configuration->>'maxCostMinor')::bigint FROM app.ai_model_policy WHERE tenant_id=NEW.tenant_id AND id=run.policy_id) OR NEW.reserved_minor>(policy.configuration->>'maxCostMinor')::bigint OR NEW.reserved_minor+coalesce((SELECT sum(reserved_minor) FROM app.ai_attempt WHERE tenant_id=NEW.tenant_id AND created_at>=date_trunc('day',now())),0)>policy.daily_budget_minor OR EXISTS(SELECT FROM app.ai_result r JOIN app.ai_attempt a ON a.tenant_id=r.tenant_id AND a.id=r.attempt_id WHERE a.tenant_id=NEW.tenant_id AND a.run_id=run.id AND r.status='SUCCEEDED') THEN RAISE EXCEPTION 'AI budget or attempt limit reached' USING ERRCODE='54000'; END IF;
  IF (SELECT count(*) FROM (SELECT r.status FROM app.ai_attempt a LEFT JOIN app.ai_result r ON r.tenant_id=a.tenant_id AND r.attempt_id=a.id WHERE a.tenant_id=NEW.tenant_id AND a.policy_id=NEW.policy_id AND a.created_at>now()-interval '60 seconds' ORDER BY a.created_at DESC LIMIT 3) recent WHERE status IS NULL OR status='FAILED')>=3 THEN RAISE EXCEPTION 'Provider circuit open' USING ERRCODE='54000'; END IF;
 ELSIF TG_TABLE_NAME='ai_result' THEN
  SELECT * INTO attempt FROM app.ai_attempt WHERE tenant_id=NEW.tenant_id AND id=NEW.attempt_id AND created_by=NEW.created_by;
  SELECT * INTO run FROM app.ai_run WHERE tenant_id=NEW.tenant_id AND id=attempt.run_id;
  IF attempt.id IS NULL OR (NEW.status='SUCCEEDED' AND NOT app.ai_output_grounded(NEW.tenant_id,run.id,NEW.output)) OR (NEW.status='SUCCEEDED' AND NOT app.ai_run_authorized(run.tenant_id,run.mission_id,attempt.policy_id,NEW.created_by,run.input,run.task,run.policy_id)) THEN RAISE EXCEPTION 'AI result authority changed' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='ai_completion' THEN
  SELECT * INTO run FROM app.ai_run WHERE tenant_id=NEW.tenant_id AND id=NEW.run_id AND created_by=NEW.created_by;
  IF run.id IS NULL OR (NEW.status='DRAFT_READY' AND NOT EXISTS(SELECT FROM app.ai_result result JOIN app.ai_attempt a ON a.tenant_id=result.tenant_id AND a.id=result.attempt_id WHERE a.tenant_id=NEW.tenant_id AND a.run_id=NEW.run_id AND result.status='SUCCEEDED')) OR (NEW.status='DRAFT_READY' AND NEW.reason_code<>'VALIDATED_DRAFT') OR (NEW.status='MANUAL_REVIEW' AND NEW.reason_code<>'PROVIDER_OR_BUDGET_UNAVAILABLE') THEN RAISE EXCEPTION 'Owned run and exact completion status required'; END IF;
 ELSE
  SELECT a.* INTO attempt FROM app.ai_attempt a JOIN app.ai_result result ON result.tenant_id=a.tenant_id AND result.attempt_id=a.id WHERE result.tenant_id=NEW.tenant_id AND result.id=NEW.result_id;
  SELECT * INTO run FROM app.ai_run WHERE tenant_id=NEW.tenant_id AND id=attempt.run_id;
  IF run.id IS NULL OR NOT app.ai_run_authorized(run.tenant_id,run.mission_id,attempt.policy_id,NEW.created_by,run.input,run.task,run.policy_id) THEN RAISE EXCEPTION 'Current source and policy required for review' USING ERRCODE='42501'; END IF;
  IF NEW.decision='EDIT' AND NOT app.ai_output_grounded(NEW.tenant_id,run.id,NEW.edited_output) THEN RAISE EXCEPTION 'Grounded reviewed edit required'; END IF;
  IF NOT coalesce(app.member_role(NEW.tenant_id) IN ('owner','admin','operator','reviewer') AND app.fresh_mfa(),false) OR NOT EXISTS(SELECT FROM app.ai_result WHERE tenant_id=NEW.tenant_id AND id=NEW.result_id AND status='SUCCEEDED') THEN RAISE EXCEPTION 'AI review authority required' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ai_model_policy','ai_run','ai_attempt','ai_result','ai_review','ai_completion'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY read ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator'',''reviewer''))',t);
  EXECUTE format('CREATE POLICY add ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND created_by=app.actor_id())',t);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO corridra_runtime',t);
  EXECUTE format('CREATE TRIGGER guard BEFORE INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_ai()',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',t);
  EXECUTE format('CREATE TRIGGER event AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_change()',t);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION app.guard_ai(),app.ai_run_authorized(uuid,uuid,uuid,uuid,jsonb,text,uuid),app.part4_enabled(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_run_authorized(uuid,uuid,uuid,uuid,jsonb,text,uuid),app.part4_enabled(uuid,text) TO corridra_runtime;

-- Retain every original pack guard; only permit an explicit reviewed AI policy reference.
CREATE OR REPLACE FUNCTION app.guard_corridor_configuration() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c app.corridor_definition; p app.corridor_pack_version; k text; v jsonb;
BEGIN
 IF NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL','synthetic_validation') AND app.member_role(NEW.tenant_id) IN ('owner','admin') AND app.fresh_mfa() AND NEW.created_by=app.actor_id(),false) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Synthetic configuration authority with fresh MFA required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':corridor',0));
 IF TG_TABLE_NAME='corridor_route' THEN
  SELECT * INTO c FROM app.corridor_definition WHERE tenant_id=NEW.tenant_id AND id=NEW.corridor_id;
  IF c.id IS NULL OR ARRAY[least(NEW.origin_market,NEW.destination_market),greatest(NEW.origin_market,NEW.destination_market)]<>ARRAY[c.market_a,c.market_b] THEN RAISE EXCEPTION 'Route endpoints must belong to corridor'; END IF;
 ELSIF TG_TABLE_NAME='corridor_pack_version' THEN
  IF NEW.version<>coalesce((SELECT max(version) FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id),0)+1 THEN RAISE EXCEPTION 'Sequential pack version required'; END IF;
  IF EXISTS(SELECT FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id AND effective_from>=NEW.effective_from) THEN RAISE EXCEPTION 'Pack effective date must increase'; END IF;
  IF NOT (NEW.configuration ?& ARRAY['missionTypes','requiredCapabilities','languages','currencies','timeZones','localities','clusters','requirements','assessments','sourceCategories','channels','jurisdictionPolicyRefs','evidenceTypes','reviewRequired','operatorCapabilities','coverage','aiPolicyRef','pricingRef']) OR (SELECT count(*) FROM jsonb_object_keys(NEW.configuration))<>18 OR NEW.configuration->'reviewRequired'<>'true'::jsonb THEN RAISE EXCEPTION 'Invalid or elevated pack configuration'; END IF;
  FOR k,v IN SELECT * FROM jsonb_each(NEW.configuration) LOOP
   IF k NOT IN ('reviewRequired','aiPolicyRef','pricingRef') THEN
    IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>50 THEN RAISE EXCEPTION 'Bounded configuration arrays required'; END IF;
    IF EXISTS(SELECT FROM jsonb_array_elements(v) x WHERE jsonb_typeof(x)<>'string') THEN RAISE EXCEPTION 'Configuration strings required'; END IF;
   END IF;
  END LOOP;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'currencies') x WHERE NOT EXISTS(SELECT FROM app.currency WHERE code=x)) OR EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'channels') x WHERE x NOT IN ('SYNTHETIC','MANUAL')) THEN RAISE EXCEPTION 'Unsupported currency or channel'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'timeZones') x WHERE NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=x)) OR EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'languages') x WHERE x !~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$') THEN RAISE EXCEPTION 'Valid timezone and locale required'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'requirements') x WHERE NOT EXISTS(SELECT FROM app.requirement_definition WHERE tenant_id=NEW.tenant_id AND id::text=x)) OR EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'assessments') x WHERE NOT EXISTS(SELECT FROM app.assessment_definition WHERE tenant_id=NEW.tenant_id AND id::text=x)) THEN RAISE EXCEPTION 'Exact same-tenant definition versions required'; END IF;
  IF NEW.configuration->'aiPolicyRef'<>'null'::jsonb AND NOT EXISTS(SELECT FROM app.ai_model_policy WHERE tenant_id=NEW.tenant_id AND id::text=NEW.configuration->>'aiPolicyRef' AND effective_from<=now() AND (configuration->>'effectiveUntil')::timestamptz>now() AND version=(SELECT max(version) FROM app.ai_model_policy next_policy WHERE next_policy.tenant_id=NEW.tenant_id AND next_policy.key=app.ai_model_policy.key AND next_policy.effective_from<=now())) THEN RAISE EXCEPTION 'Current same-tenant reviewed AI policy required'; END IF;
  IF NEW.configuration->'pricingRef'<>'null'::jsonb THEN RAISE EXCEPTION 'Pricing activation belongs to a later reviewed service'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'jurisdictionPolicyRefs') x WHERE NOT EXISTS(SELECT FROM app.communication_policy WHERE tenant_id=NEW.tenant_id AND id::text=x AND effective_from<=now() AND valid_until>now())) THEN RAISE EXCEPTION 'Current same-tenant communication policy required'; END IF;
 ELSIF TG_TABLE_NAME='mission_route_assignment' THEN
  IF NEW.version<>coalesce((SELECT max(version) FROM app.mission_route_assignment WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id),0)+1 THEN RAISE EXCEPTION 'Sequential assignment version required'; END IF;
  IF NEW.status='ASSIGNED' THEN
   SELECT * INTO p FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND id=NEW.pack_id;
   IF p.id IS NULL OR p.status NOT IN ('TESTING','LIMITED','ACTIVE') OR p.effective_from>now() OR p.version<>(SELECT max(version) FROM app.corridor_pack_version WHERE tenant_id=p.tenant_id AND route_id=p.route_id AND effective_from<=now()) OR NOT EXISTS(SELECT FROM app.mission_type_definition WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_type_id AND p.configuration->'missionTypes' ? key) THEN RAISE EXCEPTION 'Current available pack and mission type required'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION app.ai_scoped_sources(t uuid,rid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run app.ai_run; result jsonb;
BEGIN
 SELECT * INTO run FROM app.ai_run WHERE tenant_id=t AND id=rid;
 IF run.id IS NULL OR NOT app.ai_run_authorized(t,run.mission_id,run.policy_id,app.actor_id(),run.input,run.task) THEN RAISE EXCEPTION 'AI source access denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_agg(jsonb_build_object('tenantId',c.tenant_id,'sourceId',s.id,'claimId',c.id,'quote',c.statement,'rights',jsonb_build_object(
 'sourceId',s.id,'licence',d.licence,'permittedReuse',d.permitted_reuse,'role',d.data_role,'purpose',d.data_purpose,'classification',d.data_classification,'jurisdictions',d.jurisdictions,'subjectLocations',d.subject_locations,'processingLocations',d.processing_locations,'retentionUntil',to_char(d.retention_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'legalHold',d.legal_hold,'aiPermission',d.ai_permission,'transferStatus',d.transfer_status,'transferMechanism',d.transfer_mechanism))) INTO result
 FROM app.claim c JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id
 JOIN LATERAL (SELECT * FROM app.data_rights_policy WHERE tenant_id=t AND source_id=s.id AND effective_from<=now() ORDER BY version DESC LIMIT 1) d ON true
 WHERE c.tenant_id=t AND c.id::text IN (SELECT jsonb_array_elements_text(run.input->'claimIds'));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.ai_scoped_sources(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_scoped_sources(uuid,uuid) TO corridra_runtime;

CREATE FUNCTION app.ai_output_grounded(t uuid,rid uuid,o jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run app.ai_run; item jsonb;
BEGIN
 IF NOT app.can_access(t,'INTERNAL','synthetic_validation') OR o->>'authority' IS DISTINCT FROM 'UNVERIFIED_DRAFT' OR jsonb_typeof(o->'facts') IS DISTINCT FROM 'array' OR jsonb_typeof(o->'unknowns') IS DISTINCT FROM 'array' OR jsonb_typeof(o->'data') IS DISTINCT FROM 'object' OR length(o::text)>32000 THEN RETURN false; END IF;
 SELECT * INTO run FROM app.ai_run WHERE tenant_id=t AND id=rid;
 IF run.id IS NULL THEN RETURN false; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(o->'facts') fact WHERE NOT (fact ?& ARRAY['sourceId','claimId','quote'])) THEN RETURN false; END IF;
 FOR item IN SELECT jsonb_path_query(o,'$.** ? (exists(@.claimId) || exists(@.quote) || exists(@.sourceId))') LOOP
  IF NOT EXISTS(SELECT FROM app.claim WHERE tenant_id=t AND source_id::text=item->>'sourceId' AND run.input->'claimIds' ? id::text) THEN RETURN false; END IF;
  IF NOT (item ? 'claimId' OR item ? 'quote') THEN CONTINUE; END IF;
  IF jsonb_typeof(item->'quote') IS DISTINCT FROM 'string' OR length(item->>'quote') NOT BETWEEN 1 AND 2000 OR NOT EXISTS(SELECT FROM app.claim c JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id WHERE c.tenant_id=t AND c.id::text=item->>'claimId' AND s.id::text=item->>'sourceId' AND run.input->'claimIds' ? c.id::text AND position(item->>'quote' in c.statement)>0 AND c.classification='PUBLIC' AND s.classification='PUBLIC' AND s.retention_until>now()) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.ai_output_grounded(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_output_grounded(uuid,uuid,jsonb) TO corridra_runtime;
