-- ADR-089. Optional module. Real workspaces may hold a reviewed AI model policy; nothing else about AI changes.
-- Replaces exactly one function, app.guard_ai(), hash-guarded against the definition installed by
-- migrations/0026_governed_intelligence.sql (nothing later replaces it). Two differences from that definition and no others:
--  1. For app.ai_model_policy only, the opening check accepts a real-use-allowed workspace as well as a synthetic one, under
--     the workspace's own processing purpose (as the existing real_use_add policy does). The opening check for ai_run,
--     ai_attempt, ai_result, ai_review and ai_completion is byte-identical: sample workspaces only, so no run, attempt, result,
--     review or completion can exist in a real workspace. Owner or admin with a fresh authenticator check is still required
--     by the unchanged policy branch.
--  2. The processing location bound is 1 to 30 countries instead of 1 to 20. Every runtime check is a subset test, so a longer
--     list can only make a run less likely to be authorized.
-- app.part4_enabled, app.ai_run_authorized, app.ai_output_grounded, every RLS policy and every trigger are untouched, so AI
-- inference stays off in real workspaces. A marker function reports the bound so the application can tell the module is present.
-- Rollback: rollback/0001_restore_guard_ai.sql restores the 0026 definition; it is run only through a further reviewed forward run.
DO $guard$ BEGIN
 IF to_regprocedure('app.guard_ai()') IS NULL
  OR to_regprocedure('app.real_use_allowed(uuid)') IS NULL
  OR to_regprocedure('app.tenant_processing_purpose(uuid)') IS NULL
  OR encode(sha256(convert_to(pg_get_functiondef('app.guard_ai()'::regprocedure),'UTF8')),'hex')<>'6b4f74d16b5cbdc81a25b3aba81d296bac77c888be5aec3af891015762ce8e1b'
 THEN RAISE EXCEPTION 'AI model policy prerequisite function differs: app.guard_ai'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION app.guard_ai() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE run app.ai_run; attempt app.ai_attempt; policy app.ai_model_policy; cfg jsonb; n integer;
BEGIN
 IF NEW.created_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'Server-recorded AI timestamp required'; END IF;
 IF TG_TABLE_NAME='ai_model_policy' THEN
  IF NEW.created_by<>app.actor_id() OR NOT app.can_access(NEW.tenant_id,'INTERNAL',app.tenant_processing_purpose(NEW.tenant_id)) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Scoped synthetic actor required' USING ERRCODE='42501'; END IF;
 ELSIF NEW.created_by<>app.actor_id() OR NOT app.can_access(NEW.tenant_id,'INTERNAL','synthetic_validation') OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Scoped synthetic actor required' USING ERRCODE='42501'; END IF;
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

CREATE FUNCTION app.ai_model_policy_location_limit() RETURNS integer
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT 30 $$;
REVOKE ALL ON FUNCTION app.ai_model_policy_location_limit() FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.ai_model_policy_location_limit() TO corridra_runtime;
