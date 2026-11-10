-- ADR-078 amendment: removing problem report words is bounded in time and answers a replay first, and the plain text rule
-- refuses more control and direction characters. Additive: this file replaces two functions (same signature, language,
-- security, volatility and search path for each) and creates no table, policy, trigger or grant. CREATE OR REPLACE keeps
-- the grants 0001 made, so the plain text helper stays closed to the runtime and auth roles. 0001 is never edited.
-- 1. customer.problem_report_remove_words. A removal reaches only the reports filed at or before the moment the erasure
--    request was completed. While the request is still in progress the limit is the time of the transaction, so the
--    words written after that moment keep their words. A report filed after completion needs a new erasure request.
--    A retry is answered before anything else. When erasure rows already exist for this command and this erasure
--    request, the original count is returned whatever was filed since. The same command used for a different erasure
--    request is refused with the conflict message used by every other command.
-- 2. customer_private.problem_report_plain. In addition to U+0001 to U+001F, U+007F, "://", "@" and "www.", the C1
--    controls U+0080 to U+009F, the line and paragraph separators U+2028 and U+2029, the bidirectional embedding and
--    override characters U+202A to U+202E and the isolate characters U+2066 to U+2069 are refused. The CHECK constraints
--    of problem_report_words and problem_report_status_event, problem_report_path_ok and problem_report_parse use this
--    function, so the database refuses them everywhere. PostgreSQL does not check existing rows again when a function used
--    by a CHECK constraint is replaced (replacing a function rewrites no table and validates no constraint), and the rows
--    cannot be updated (append-only triggers), so rows stored under the older rule stay exactly as they are: they are
--    still read, listed and removed under an erasure request, and none of them becomes invalid. A CHECK constraint is
--    evaluated again only when a row is written, and stored rows are never written again. Only new writes are held to
--    the wider rule.
-- The guard below has three states and runs before anything is replaced.
--  ABSENT: 0001 is not applied (neither function exists and the registry has no row for 0001). The file raises a
--  notice, changes nothing and creates nothing, so it can never install a function without its tables.
--  MATCHING: both live functions are what 0001 created and the registry (when it exists) holds the SHA-256 of the 0001
--  file text. Both functions are replaced. The migrator inserts the 0001 registry row right after 0001 runs and before
--  this file, in the same transaction, so a normal install reaches this state.
--  CHANGED: either live function differs in any compared property, or the registry holds another hash for 0001. The
--  file refuses with an error and replaces neither function: both are checked before the first one is replaced.
-- Each live function is compared by its stored body (pg_proc.prosrc, identical on every PostgreSQL major version;
-- pg_get_functiondef is not) by SHA-256, computed from the function 0001 creates, plus the security setting, the
-- volatility, the search path setting and the argument types. COST, ownership and the like may differ.
DO $guard$ DECLARE registered boolean; recorded text; f record; BEGIN
 registered:=to_regclass('customer_problem_report_migrations.applied') IS NOT NULL;
 IF registered THEN
  EXECUTE 'SELECT sha256 FROM customer_problem_report_migrations.applied WHERE name=$1' INTO recorded USING '0001_problem_reports.sql';
 END IF;
 IF to_regprocedure('customer.problem_report_remove_words(uuid,uuid)') IS NULL
  AND to_regprocedure('customer_private.problem_report_plain(text,integer,integer)') IS NULL AND recorded IS NULL THEN
  RAISE NOTICE 'Problem report word removal bounds skipped: 0001_problem_reports.sql is not applied';
  RETURN;
 END IF;
 FOR f IN SELECT * FROM (VALUES
  ('customer.problem_report_remove_words(uuid,uuid)','582ab8289185d2bbeefb5bbba84ecb14a536274db2fd9c8e90b30dfa8a2267df',true,'v','2950 2950'),
  ('customer_private.problem_report_plain(text,integer,integer)','67f5be7abee4ff564d1bd83cac2bc30bc5b090da8f068bb5699bc196f9f4961d',false,'i','25 23 23')
 ) v(signature,body_hash,secdef,volatility,argument_types) LOOP
  IF NOT EXISTS(SELECT FROM pg_proc WHERE oid=to_regprocedure(f.signature) AND prosecdef=f.secdef AND provolatile=f.volatility::"char"
   AND proconfig=ARRAY['search_path=pg_catalog'] AND proargtypes::text=f.argument_types
   AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')=f.body_hash) THEN
   RAISE EXCEPTION 'Problem report prerequisite function differs: %',split_part(f.signature,'(',1);
  END IF;
 END LOOP;
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
 EXECUTE $plain$
CREATE OR REPLACE FUNCTION customer_private.problem_report_plain(value text,min_length integer,max_length integer) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(length(value) BETWEEN min_length AND max_length AND value !~ '[\u0001-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]' AND value !~ '(://|@|www\.)',false)
$$
$plain$;
END $guard$;
