-- ADR-078 amendment: removing problem report words is bounded in time and answers a replay first. Additive: this file
-- replaces one function (customer.problem_report_remove_words, same signature, language, security and search path) and
-- creates no table, policy, trigger or grant. CREATE OR REPLACE keeps the grants 0001 made. 0001 is never edited.
-- 1. A removal reaches only the reports filed at or before the moment the erasure request was completed. While the
--    request is still in progress the limit is the time of the transaction, so the words written after that moment keep
--    their words. A report filed after completion needs a new erasure request.
-- 2. A retry is answered before anything else. When erasure rows already exist for this command and this erasure
--    request, the original count is returned whatever was filed since. The same command used for a different erasure
--    request is refused with the conflict message used by every other command.
-- The guard below has three states and runs before anything is replaced.
--  ABSENT: 0001 is not applied (the function does not exist and the registry has no row for 0001). The file raises a
--  notice, changes nothing and creates nothing, so it can never install the function without its tables.
--  MATCHING: the live function is what 0001 created and the registry (when it exists) holds the SHA-256 of the 0001
--  file text. The function is replaced. The migrator inserts the 0001 registry row right after 0001 runs and before
--  this file, in the same transaction, so a normal install reaches this state.
--  CHANGED: the live function differs in any compared property, or the registry holds another hash for 0001. The file
--  refuses with an error and replaces nothing.
-- The live function is compared by its stored body (pg_proc.prosrc, identical on every PostgreSQL major version;
-- pg_get_functiondef is not) by SHA-256, computed from the function 0001 creates, plus the security setting, the search
-- path setting and the argument types. COST, ownership and the like may differ.
DO $guard$ DECLARE registered boolean; recorded text; BEGIN
 registered:=to_regclass('customer_problem_report_migrations.applied') IS NOT NULL;
 IF registered THEN
  EXECUTE 'SELECT sha256 FROM customer_problem_report_migrations.applied WHERE name=$1' INTO recorded USING '0001_problem_reports.sql';
 END IF;
 IF to_regprocedure('customer.problem_report_remove_words(uuid,uuid)') IS NULL AND recorded IS NULL THEN
  RAISE NOTICE 'Problem report word removal bounds skipped: 0001_problem_reports.sql is not applied';
  RETURN;
 END IF;
 IF NOT EXISTS(SELECT FROM pg_proc WHERE oid=to_regprocedure('customer.problem_report_remove_words(uuid,uuid)')
  AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog'] AND proargtypes::text='2950 2950'
  AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='582ab8289185d2bbeefb5bbba84ecb14a536274db2fd9c8e90b30dfa8a2267df') THEN
  RAISE EXCEPTION 'Problem report prerequisite function differs: customer.problem_report_remove_words';
 END IF;
 IF registered AND recorded IS DISTINCT FROM '52d32043f9b8138b78e11114d3683fd5ff385d4a498d35689e1f0fa5dedb88cc' THEN
  RAISE EXCEPTION 'Problem report prerequisite file differs: 0001_problem_reports.sql';
 END IF;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.problem_report_remove_words(command uuid,erasure_request uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff uuid;filed customer_private.erasure_request%ROWTYPE;current_state text;stamped timestamptz;cutoff timestamptz;report uuid;removed integer;
BEGIN
 staff:=customer_private.staff_privacy_actor();
 IF command IS NULL OR erasure_request IS NULL THEN RAISE EXCEPTION 'Invalid problem report change' USING ERRCODE='22023'; END IF;
 SELECT * INTO filed FROM customer_private.erasure_request r WHERE r.id=erasure_request;
 IF NOT FOUND OR NOT customer_private.erasure_in_scope(filed.principal_id) THEN RAISE EXCEPTION 'Erasure request not found' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.account.lifecycle:'||filed.principal_id::text,0));
 IF EXISTS(SELECT FROM customer_private.problem_report_erasure e WHERE e.command_id=command AND e.erasure_request_id<>erasure_request) THEN
  RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514';
 END IF;
 SELECT count(*)::integer INTO removed FROM customer_private.problem_report_erasure e WHERE e.command_id=command AND e.erasure_request_id=erasure_request;
 IF removed>0 THEN RETURN jsonb_build_object('reference',filed.reference,'removed',removed); END IF;
 SELECT x.state,x.created_at INTO current_state,stamped FROM customer_private.erasure_status_event x WHERE x.request_id=erasure_request ORDER BY x.seq DESC LIMIT 1;
 IF current_state IS NULL OR current_state NOT IN ('in_progress','completed') THEN
  RAISE EXCEPTION 'Words can be removed only for an erasure request that is in progress or completed' USING ERRCODE='23514';
 END IF;
 cutoff:=CASE WHEN current_state='completed' THEN stamped ELSE transaction_timestamp() END;
 FOR report IN SELECT r.id FROM customer_private.problem_report r
  WHERE r.reporter_kind='customer' AND r.customer_principal_id=filed.principal_id AND r.filed_at<=cutoff
  AND NOT EXISTS(SELECT FROM customer_private.problem_report_erasure e WHERE e.report_id=r.id) ORDER BY r.number LOOP
  INSERT INTO customer_private.problem_report_erasure(report_id,reporter_kind,erasure_request_id,staff_principal_id,command_id)
  VALUES(report,'customer',erasure_request,staff,command);
  DELETE FROM customer_private.problem_report_words w WHERE w.report_id=report;
  removed:=removed+1;
 END LOOP;
 RETURN jsonb_build_object('reference',filed.reference,'removed',removed);
END $$
$fn$;
END $guard$;
