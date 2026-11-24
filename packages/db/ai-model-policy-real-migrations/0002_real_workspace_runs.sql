-- ADR-091. Optional module, second step of the family: AI runs, attempts, results, reviews and completions in real workspaces.
-- Installing it opens nothing. A control, app.ai_real_control, starts closed; while it is closed every difference below is
-- unreachable and real workspaces behave exactly as after ADR-089. Only the offline installer opens or pauses it, with a reason.
-- Three functions are replaced, each hash-guarded against the definition named here, and nothing else is replaced:
--  1. app.guard_ai() (as left by 0001 of this family). For ai_run, ai_attempt, ai_result, ai_review and ai_completion:
--     a. The opening check accepts a sample workspace exactly as before (its processing purpose is still synthetic_validation)
--        and a real workspace only when real use is allowed and the control is open, under its own processing purpose.
--     b. While the control is closed a real workspace may still record the two rows that end a run already started: a FAILED
--        result and a MANUAL_REVIEW completion. So a pause in the middle of a run never leaves it pending for ever. Neither
--        row carries any output, and each still needs the run or attempt the same person created.
--     c. In a real workspace a run or an attempt needs a model policy whose evaluation status is APPROVED_PROVIDER, so a
--        provider evaluated on sample data only never serves real work.
--     d. In a real workspace a run is refused when a cited statement holds seven or more digits in a row, counting through
--        spaces, dots, dashes and brackets (a phone number written without a plus sign or a keyword). Dates written
--        YYYY-MM-DD are taken out first. A year (2026) and an amount grouped with commas (1,250,000) pass.
--     The app.ai_model_policy branch and every other rule (roles, fresh authenticator check, budgets, attempt limit, circuit,
--     grounding, review) are byte-identical.
--  2. app.part4_enabled(uuid,text) (as left by network-real-use 0001). For a real workspace the key ai.enabled can now be true,
--     only while the control is open and only when the owner of that workspace wrote the latest ai.enabled setting after the
--     control was first opened. A setting written earlier never counts. network.enabled is unchanged.
--  3. app.ai_output_grounded(uuid,uuid,jsonb) (migrations/0026). The access check reads the workspace's own processing purpose
--     instead of the fixed sample purpose. Every grounding rule is byte-identical.
-- app.ai_run_authorized, app.ai_scoped_sources, app.guard_ai_mission_budget, every RLS policy and every trigger are untouched.
-- So the rules that keep contact details out of a provider call (no email address or phone number in a cited statement, no
-- subject locations, public classification, approved transfer, AI_REVIEW reuse, processing locations inside the rights review)
-- and the rule that every result is an unverified item until a person reviews it apply to real workspaces unchanged.
-- Rollback: rollback/0002_restore_sample_only_runs.sql restores the three definitions; run only as a reviewed forward run.
DO $guard$ BEGIN
 IF to_regprocedure('app.real_use_allowed(uuid)') IS NULL OR to_regprocedure('app.tenant_processing_purpose(uuid)') IS NULL
  OR to_regprocedure('app.tenant_is_synthetic(uuid)') IS NULL OR to_regprocedure('app.network_scope_allowed(uuid)') IS NULL
  OR to_regprocedure('app.ai_model_policy_location_limit()') IS NULL
  OR to_regprocedure('app.guard_ai()') IS NULL OR encode(sha256(convert_to(pg_get_functiondef('app.guard_ai()'::regprocedure),'UTF8')),'hex')<>'56f7f56c1971ecba9b42278a3889b7e12105741cb58882cd0e956100fe3b202e'
  OR to_regprocedure('app.part4_enabled(uuid,text)') IS NULL OR encode(sha256(convert_to(pg_get_functiondef('app.part4_enabled(uuid,text)'::regprocedure),'UTF8')),'hex')<>'681634f00bfd237c744fddd49a93ba5856c87da4788d5bcbfa31e5fe7f2c6610'
  OR to_regprocedure('app.ai_output_grounded(uuid,uuid,jsonb)') IS NULL OR encode(sha256(convert_to(pg_get_functiondef('app.ai_output_grounded(uuid,uuid,jsonb)'::regprocedure),'UTF8')),'hex')<>'e2939a4a1414e1f73b7b13b87d3438a5ce787a4c750c604b5e2709ae49c708ef'
 THEN RAISE EXCEPTION 'AI real workspace prerequisite differs'; END IF;
END $guard$;

-- One row per version. Closed unless the latest row says enabled; no row means closed. Only the offline schema owner writes it,
-- through the installer, with a reason. A rollback keeps the table, so IF NOT EXISTS: the record of who opened and closed it stays.
CREATE TABLE IF NOT EXISTS app.ai_real_control (
 version integer PRIMARY KEY CHECK(version>0), enabled boolean NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE app.ai_real_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_real_control FROM PUBLIC,corridra_runtime,corridra_auth;
DROP TRIGGER IF EXISTS ai_real_control_immutable ON app.ai_real_control;
CREATE TRIGGER ai_real_control_immutable BEFORE UPDATE OR DELETE ON app.ai_real_control
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
-- The one question the application and the guards ask: is AI open for real workspaces. Its presence also marks the module.
CREATE FUNCTION app.ai_real_runs_open() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT enabled FROM app.ai_real_control ORDER BY version DESC LIMIT 1),false)
$$;
REVOKE ALL ON FUNCTION app.ai_real_runs_open() FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.ai_real_runs_open() TO corridra_runtime;

CREATE OR REPLACE FUNCTION app.guard_ai() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE run app.ai_run; attempt app.ai_attempt; policy app.ai_model_policy; cfg jsonb; n integer; closing boolean:=false;
BEGIN
 IF NEW.created_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'Server-recorded AI timestamp required'; END IF;
 IF TG_TABLE_NAME='ai_model_policy' THEN
  IF NEW.created_by<>app.actor_id() OR NOT app.can_access(NEW.tenant_id,'INTERNAL',app.tenant_processing_purpose(NEW.tenant_id)) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Scoped synthetic actor required' USING ERRCODE='42501'; END IF;
 ELSE
  IF TG_TABLE_NAME='ai_completion' THEN closing:=NEW.status='MANUAL_REVIEW'; ELSIF TG_TABLE_NAME='ai_result' THEN closing:=NEW.status='FAILED'; END IF;
  IF NEW.created_by<>app.actor_id() OR NOT app.can_access(NEW.tenant_id,'INTERNAL',app.tenant_processing_purpose(NEW.tenant_id)) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND (synthetic OR (app.real_use_allowed(id) AND (app.ai_real_runs_open() OR closing)))) THEN RAISE EXCEPTION 'Scoped synthetic actor required' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_TABLE_NAME IN ('ai_run','ai_attempt') THEN
  IF NOT coalesce(app.tenant_is_synthetic(NEW.tenant_id),false) AND NOT EXISTS(SELECT FROM app.ai_model_policy WHERE tenant_id=NEW.tenant_id AND id=NEW.policy_id AND configuration->>'evaluationStatus'='APPROVED_PROVIDER') THEN RAISE EXCEPTION 'Approved provider evaluation required in a real workspace' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_TABLE_NAME='ai_run' THEN
  IF NOT coalesce(app.tenant_is_synthetic(NEW.tenant_id),false) AND EXISTS(SELECT FROM app.claim c WHERE c.tenant_id=NEW.tenant_id AND c.id::text IN (SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(NEW.input->'claimIds')='array' THEN NEW.input->'claimIds' ELSE '[]'::jsonb END)) AND regexp_replace(c.statement,'[0-9]{4}-[0-9]{2}-[0-9]{2}','','g') ~ '[0-9]([ .()-]*[0-9]){6,}') THEN RAISE EXCEPTION 'A cited statement holds a long number that may be a phone number' USING ERRCODE='42501'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':ai-budget',0));
 IF TG_TABLE_NAME='ai_model_policy' THEN
  IF NOT coalesce(app.member_role(NEW.tenant_id) IN ('owner','admin') AND app.fresh_mfa(),false) THEN RAISE EXCEPTION 'AI configuration authority required' USING ERRCODE='42501'; END IF;
  cfg:=NEW.configuration;
  IF jsonb_typeof(cfg) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_each(cfg) WHERE jsonb_typeof(value)='null') THEN RAISE EXCEPTION 'Complete non-null AI model policy required'; END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM app.ai_model_policy WHERE tenant_id=NEW.tenant_id AND key=NEW.key),0)+1 OR EXISTS(SELECT FROM app.ai_model_policy WHERE tenant_id=NEW.tenant_id AND key=NEW.key AND effective_from>=NEW.effective_from) OR cfg->>'id'<>NEW.id::text OR (cfg->>'version')::integer<>NEW.version OR cfg->>'approved'<>'true' OR cfg->>'currency'<>'USD' OR (cfg->>'effectiveUntil')::timestamptz<=NEW.effective_from OR cfg->>'model' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' OR cfg->>'model' ~ '(^|/)\.\.?(/|$)' OR NOT coalesce((cfg->>'adapter',cfg->>'secretRef') IN (('openai','CORRIDRA_OPENAI_API_KEY'),('anthropic','CORRIDRA_ANTHROPIC_API_KEY'),('google','CORRIDRA_GOOGLE_API_KEY')),false) THEN RAISE EXCEPTION 'Invalid sequential AI policy'; END IF;
  IF NOT (cfg ?& ARRAY['id','version','adapter','model','secretRef','approved','processingLocations','tasks','inputRateMinorPerMillion','outputRateMinorPerMillion','maxCostMinor','currency','effectiveUntil','fallbackPolicyIds','evaluationStatus','evaluationSourceId']) OR (SELECT count(*) FROM jsonb_object_keys(cfg))<>16 OR jsonb_typeof(cfg->'tasks')<>'array' OR jsonb_array_length(cfg->'tasks') NOT BETWEEN 1 AND 12 OR jsonb_typeof(cfg->'processingLocations')<>'array' OR jsonb_array_length(cfg->'processingLocations') NOT BETWEEN 1 AND 30 OR EXISTS(SELECT FROM jsonb_array_elements_text(cfg->'processingLocations') c WHERE NOT EXISTS(SELECT FROM app.country WHERE code=c)) OR cfg->>'inputRateMinorPerMillion' !~ '^[1-9][0-9]{0,12}$' OR cfg->>'outputRateMinorPerMillion' !~ '^[1-9][0-9]{0,12}$' OR cfg->>'maxCostMinor' !~ '^[1-9][0-9]{0,12}$' THEN RAISE EXCEPTION 'Bounded approved model configuration required'; END IF;
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

CREATE OR REPLACE FUNCTION app.part4_enabled(t uuid,k text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(app.can_access(t,'INTERNAL',app.tenant_processing_purpose(t))
 AND app.network_scope_allowed(t)
 AND (app.tenant_is_synthetic(t) OR k='network.enabled' OR (k='ai.enabled' AND app.ai_real_runs_open() AND coalesce((SELECT created_at FROM app.config_version WHERE tenant_id=t AND key=k AND effective_from<=now() ORDER BY version DESC LIMIT 1)>(SELECT min(created_at) FROM app.ai_real_control WHERE enabled),false)))
 AND (SELECT value->>'enabled'='true' FROM app.config_version WHERE tenant_id=t AND key=k AND effective_from<=now() ORDER BY version DESC LIMIT 1),false)
$$;

CREATE OR REPLACE FUNCTION app.ai_output_grounded(t uuid,rid uuid,o jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run app.ai_run; item jsonb;
BEGIN
 IF NOT app.can_access(t,'INTERNAL',app.tenant_processing_purpose(t)) OR o->>'authority' IS DISTINCT FROM 'UNVERIFIED_DRAFT' OR jsonb_typeof(o->'facts') IS DISTINCT FROM 'array' OR jsonb_typeof(o->'unknowns') IS DISTINCT FROM 'array' OR jsonb_typeof(o->'data') IS DISTINCT FROM 'object' OR length(o::text)>32000 THEN RETURN false; END IF;
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
