-- ADR-091 rollback. Restores the three functions the second step replaced to the exact definitions it found (app.guard_ai as
-- left by ADR-089, app.part4_enabled as left by the real Network module, app.ai_output_grounded of migration 0026), drops
-- app.ai_real_runs_open() and removes the step's row from ai_model_policy_real_migrations.applied, so a later install applies
-- it again. The control table and every run, attempt, result and review already recorded stay (append-only, still readable).
-- It refuses, changing nothing, unless all three functions are exactly the ADR-091 definitions, the registry row is present
-- and the control is closed (pause first), so a reinstall always starts closed and a later replacement is never overwritten.
-- The whole rollback is one statement (one DO block) with no BEGIN or COMMIT of its own, and it takes the migration lock the
-- installer takes. The ADR-089 rollback (0001_restore_guard_ai.sql) refuses until this one has run. Run only through a
-- further reviewed forward run.
DO $guard$ DECLARE n integer; BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('corridra:migrations'));
 IF to_regclass('ai_model_policy_real_migrations.applied') IS NULL OR to_regprocedure('app.ai_real_runs_open()') IS NULL
  OR to_regprocedure('app.guard_ai()') IS NULL OR encode(sha256(convert_to(pg_get_functiondef('app.guard_ai()'::regprocedure),'UTF8')),'hex')<>'4c0ae1fa80ee849474372766797841dae6acea6b7e57a9adb1620e3aa42e195d'
  OR to_regprocedure('app.part4_enabled(uuid,text)') IS NULL OR encode(sha256(convert_to(pg_get_functiondef('app.part4_enabled(uuid,text)'::regprocedure),'UTF8')),'hex')<>'4ae6f61dd686b93fe4d518aad7192edf1702a8bedf7be82c7a91817e9032e3af'
  OR to_regprocedure('app.ai_output_grounded(uuid,uuid,jsonb)') IS NULL OR encode(sha256(convert_to(pg_get_functiondef('app.ai_output_grounded(uuid,uuid,jsonb)'::regprocedure),'UTF8')),'hex')<>'af18f09733df3bdaf41c0ddbb4663556c1e1411a8869ba57ed84e5f409664b1e'
 THEN RAISE EXCEPTION 'AI real workspace rollback refused: a function is not the ADR-091 definition'; END IF;
 IF app.ai_real_runs_open() THEN RAISE EXCEPTION 'AI real workspace rollback refused: pause AI for real workspaces first'; END IF;
 DELETE FROM ai_model_policy_real_migrations.applied WHERE name='0002_real_workspace_runs.sql';
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'AI real workspace rollback refused: the module is not recorded as installed'; END IF;
 EXECUTE $restore$CREATE OR REPLACE FUNCTION app.guard_ai() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
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
END $$;$restore$;
 EXECUTE $restore$CREATE OR REPLACE FUNCTION app.part4_enabled(t uuid,k text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(app.can_access(t,'INTERNAL',app.tenant_processing_purpose(t))
 AND app.network_scope_allowed(t)
 AND (app.tenant_is_synthetic(t) OR k='network.enabled')
 AND (SELECT value->>'enabled'='true' FROM app.config_version WHERE tenant_id=t AND key=k AND effective_from<=now() ORDER BY version DESC LIMIT 1),false)
$$;$restore$;
 EXECUTE $restore$CREATE OR REPLACE FUNCTION app.ai_output_grounded(t uuid,rid uuid,o jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
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
END $$;$restore$;
 DROP FUNCTION app.ai_real_runs_open();
END $guard$;
