-- ADR-089 rollback. Restores the exact app.guard_ai() definition of migrations/0026_governed_intelligence.sql (sample workspaces
-- only for every table, 1 to 20 processing locations), drops the marker and removes the module's row from
-- ai_model_policy_real_migrations.applied, so a later install applies the module again instead of skipping it. Rows already
-- recorded stay (append-only); a policy with more than 20 countries stays readable and any run stays gated. Run only through a
-- further reviewed forward run.
-- The whole rollback is one statement (one DO block), so it is all or nothing however it is run: as one query string, under
-- psql -f with or without --single-transaction, or inside a caller's transaction. It has no BEGIN or COMMIT of its own on
-- purpose: in one query string a refusal after an explicit BEGIN leaves the session in an aborted transaction, and inside a
-- caller's transaction an explicit COMMIT would end that transaction early. It first takes the migration lock the installer
-- takes (pg_advisory_xact_lock(hashtext('corridra:migrations'))), held until the enclosing transaction ends.
-- It refuses, changing nothing, unless app.guard_ai() is exactly the ADR-089 definition (the hash of pg_get_functiondef, taken
-- the same way the install pins the 0026 definition) and the module's registry row is present, so it never overwrites a later
-- replacement. The restored definition below is byte for byte the 0026 one, run through EXECUTE.
DO $guard$ DECLARE n integer; BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('corridra:migrations'));
 IF to_regprocedure('app.guard_ai()') IS NULL
  OR to_regclass('ai_model_policy_real_migrations.applied') IS NULL
  OR encode(sha256(convert_to(pg_get_functiondef('app.guard_ai()'::regprocedure),'UTF8')),'hex')<>'56f7f56c1971ecba9b42278a3889b7e12105741cb58882cd0e956100fe3b202e'
 THEN RAISE EXCEPTION 'AI model policy rollback refused: app.guard_ai is not the ADR-089 definition'; END IF;
 DELETE FROM ai_model_policy_real_migrations.applied WHERE name='0001_real_workspace_model_policy.sql';
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'AI model policy rollback refused: the module is not recorded as installed'; END IF;
 EXECUTE $restore$CREATE OR REPLACE FUNCTION app.guard_ai() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
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
END $$
$restore$;
 EXECUTE 'DROP FUNCTION IF EXISTS app.ai_model_policy_location_limit()';
END $guard$;
