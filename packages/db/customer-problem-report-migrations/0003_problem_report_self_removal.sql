-- ADR-078 decision 6 amendment (owner answer "A", 10 November 2026): a customer can remove the words of their own problem
-- reports themselves. This is a customer authority keyed on customer.actor_id() alone: there is no person id, no staff actor
-- and no erasure request. The erasure tables and staff_privacy_actor are not used by the new function, so the privacy and
-- self-service authorities stay independent (ADR-032, V3 contract). It never asks the account lifecycle control, so it works
-- while that control is closed, paused or was never opened, and for a person with no workspace or only a revoked membership.
-- Additive: one table, one trigger function and one new function, plus replacements of five functions (same name, parameter
-- names, defaults, language, security, volatility and search path for each; CREATE OR REPLACE keeps the grants 0001 made).
-- 0001 and 0002 are never edited. No event, audit or outbox row is written: the append-only self-removal row is the record
-- (which report, which person, which command, when). It holds no words.
-- 1. customer_private.problem_report_self_removal: one row per customer report whose words the reporter removed. The row
--    must name the person who filed the report and is immutable. A team report cannot have one (the reporter kind is
--    customer and the key to the report carries it).
-- 2. customer.problem_report_remove_own_words(command): removes the words of every report the signed-in person filed that
--    still has words, oldest first, and writes one self-removal row for each (the delete trigger needs it). A replay of the
--    same command answers with the first count and writes nothing. A call that finds nothing to remove writes nothing, so
--    the same command runs again later. It holds the same per-person lock as filing, so a filing and a removal are seen in
--    turn and a report filed after the removal keeps its words.
-- 3. customer_private.problem_report_words_guard: a delete is allowed when an erasure row or a self-removal row exists for
--    that report; every update and every other delete still fails.
-- 4. customer.problem_report_list, customer.problem_report_get and customer.problem_report_queue: only the words removed
--    expression changes (a report is shown as removed after either kind of removal).
-- 5. customer.problem_report_remove_words (staff, under the erasure authority): the 0002 body plus the per-person report lock
--    taken right after the lifecycle lock, and a report with a self-removal row is skipped, so it is not counted twice and a
--    staff removal and a self-removal are seen in turn. Staff removal also no longer misses a report whose filing commits
--    after the scan: filing holds the same lock until it commits.
-- The guard below has three states and runs before anything is created or replaced.
--  ABSENT: 0001 is not applied (none of the five functions, the new function and the new table exist, and the registry has
--  no row for 0001 or 0002). The file raises a notice, changes nothing and creates nothing.
--  MATCHING: the five live functions are what 0001 and 0002 left, the new function and table do not exist, and the registry
--  (when it exists) holds the SHA-256 of the 0001 and 0002 file texts. Everything below runs. The migrator inserts the
--  registry row of each file right after it runs and before the next one, in the same transaction, so a normal install
--  reaches this state.
--  CHANGED: any of the five differs in any compared property (this includes a database that has 0001 alone, where the word
--  removal is still the 0001 form), the new function or table already exists, or the registry holds another hash for 0001 or
--  0002. The file refuses with an error and changes nothing: all five are checked before anything is created.
-- Each live function is compared by its stored body (pg_proc.prosrc, identical on every PostgreSQL major version;
-- pg_get_functiondef is not) by SHA-256, plus the security setting, the volatility, the search path setting and the argument
-- types, taken from a database that has 0001 and 0002 applied. COST, ownership and the like may differ.
-- Every statement below runs through its own EXECUTE inside the one block, so ABSENT creates nothing and a refusal leaves
-- nothing behind.
DO $guard$ DECLARE registered boolean; first_recorded text; second_recorded text; f record; BEGIN
 registered:=to_regclass('customer_problem_report_migrations.applied') IS NOT NULL;
 IF registered THEN
  EXECUTE 'SELECT sha256 FROM customer_problem_report_migrations.applied WHERE name=$1' INTO first_recorded USING '0001_problem_reports.sql';
  EXECUTE 'SELECT sha256 FROM customer_problem_report_migrations.applied WHERE name=$1' INTO second_recorded USING '0002_word_removal_bounds.sql';
 END IF;
 IF to_regprocedure('customer.problem_report_remove_words(uuid,uuid)') IS NULL AND to_regprocedure('customer_private.problem_report_words_guard()') IS NULL
  AND to_regprocedure('customer.problem_report_list(bigint,integer)') IS NULL AND to_regprocedure('customer.problem_report_get(text)') IS NULL
  AND to_regprocedure('customer.problem_report_queue(bigint,integer,text)') IS NULL AND to_regprocedure('customer.problem_report_remove_own_words(uuid)') IS NULL
  AND to_regclass('customer_private.problem_report_self_removal') IS NULL AND first_recorded IS NULL AND second_recorded IS NULL THEN
  RAISE NOTICE 'Problem report self-removal skipped: 0001_problem_reports.sql is not applied';
  RETURN;
 END IF;
 FOR f IN SELECT * FROM (VALUES
  ('customer.problem_report_remove_words(uuid,uuid)','f27a8f09f4c98c526b11a2f49929829bfc67802f1f172a8738d4c72dad3c4777',true,'v','2950 2950'),
  ('customer_private.problem_report_words_guard()','c684a2835e16949c509e8dd03316088ce9a42a5fedeeb9335edb446e7a32cc06',true,'v',''),
  ('customer.problem_report_list(bigint,integer)','e11fcea3a92ed45bd0497d6f7b10ec7363391ef51322907aa1029bb16ddf5aea',true,'v','20 23'),
  ('customer.problem_report_get(text)','f6bc8bb6376f39d0824fbc55f4c29529481456cc808eb284f62a3a46909a7bb0',true,'v','25'),
  ('customer.problem_report_queue(bigint,integer,text)','0df0814aa8f4cd9264cae20e2724a35b01d8938e6ef0be3620bf5c71d339007b',true,'v','20 23 25')
 ) v(signature,body_hash,secdef,volatility,argument_types) LOOP
  IF NOT EXISTS(SELECT FROM pg_proc WHERE oid=to_regprocedure(f.signature) AND prosecdef=f.secdef AND provolatile=f.volatility::"char"
   AND proconfig=ARRAY['search_path=pg_catalog'] AND proargtypes::text=f.argument_types
   AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')=f.body_hash) THEN
   RAISE EXCEPTION 'Problem report prerequisite function differs: %',split_part(f.signature,'(',1);
  END IF;
 END LOOP;
 IF registered AND first_recorded IS DISTINCT FROM '52d32043f9b8138b78e11114d3683fd5ff385d4a498d35689e1f0fa5dedb88cc' THEN
  RAISE EXCEPTION 'Problem report prerequisite file differs: 0001_problem_reports.sql';
 END IF;
 IF registered AND second_recorded IS DISTINCT FROM '74603ba692aca8b9108ffb72ce10ef8742a93a0ecebf1aaefb262e5efa2e8707' THEN
  RAISE EXCEPTION 'Problem report prerequisite file differs: 0002_word_removal_bounds.sql';
 END IF;
 IF to_regprocedure('customer.problem_report_remove_own_words(uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'Problem report self-removal already exists: customer.problem_report_remove_own_words';
 END IF;
 IF to_regclass('customer_private.problem_report_self_removal') IS NOT NULL THEN
  RAISE EXCEPTION 'Problem report self-removal already exists: customer_private.problem_report_self_removal';
 END IF;
 EXECUTE $table$
CREATE TABLE customer_private.problem_report_self_removal (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 report_id uuid NOT NULL UNIQUE,
 reporter_kind text NOT NULL CHECK(reporter_kind='customer'),
 customer_principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(report_id,reporter_kind) REFERENCES customer_private.problem_report(id,reporter_kind)
)
$table$;
 EXECUTE $index$
CREATE INDEX problem_report_self_removal_command ON customer_private.problem_report_self_removal(customer_principal_id,command_id)
$index$;
 EXECUTE $check$
CREATE FUNCTION customer_private.problem_report_self_removal_check() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT FROM customer_private.problem_report r WHERE r.id=NEW.report_id AND r.reporter_kind='customer'
  AND r.customer_principal_id<>NEW.customer_principal_id) THEN
  RAISE EXCEPTION 'A self-removal record must name the person who filed the report' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$
$check$;
 EXECUTE $checktrigger$
CREATE TRIGGER problem_report_self_removal_check BEFORE INSERT ON customer_private.problem_report_self_removal FOR EACH ROW EXECUTE FUNCTION customer_private.problem_report_self_removal_check()
$checktrigger$;
 EXECUTE $immutable$
CREATE TRIGGER problem_report_self_removal_immutable BEFORE UPDATE OR DELETE ON customer_private.problem_report_self_removal FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()
$immutable$;
 EXECUTE $security$
ALTER TABLE customer_private.problem_report_self_removal ENABLE ROW LEVEL SECURITY
$security$;
 EXECUTE $closed$
REVOKE ALL ON customer_private.problem_report_self_removal FROM PUBLIC,corridra_runtime,corridra_auth
$closed$;
 EXECUTE $closedcheck$
REVOKE ALL ON FUNCTION customer_private.problem_report_self_removal_check() FROM PUBLIC,corridra_runtime,corridra_auth
$closedcheck$;
 EXECUTE $guardfn$
CREATE OR REPLACE FUNCTION customer_private.problem_report_words_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND (EXISTS(SELECT FROM customer_private.problem_report_erasure e WHERE e.report_id=OLD.report_id)
  OR EXISTS(SELECT FROM customer_private.problem_report_self_removal s WHERE s.report_id=OLD.report_id)) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Immutable record; append a new record' USING ERRCODE='23514';
END $$
$guardfn$;
 EXECUTE $listfn$
CREATE OR REPLACE FUNCTION customer.problem_report_list(before_number bigint DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;
BEGIN
 actor:=customer_private.account_actor();
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid problem report request' USING ERRCODE='22023'; END IF;
 RETURN coalesce((SELECT jsonb_agg(page.item ORDER BY page.number DESC) FROM (
  SELECT r.number,jsonb_build_object('reference',r.reference,'number',r.number,'category',r.category,'filedAt',r.filed_at,
   'status',s.state,'updatedAt',s.created_at,
   'wordsRemoved',(EXISTS(SELECT FROM customer_private.problem_report_erasure e WHERE e.report_id=r.id) OR EXISTS(SELECT FROM customer_private.problem_report_self_removal q WHERE q.report_id=r.id))) AS item
  FROM customer_private.problem_report r
  JOIN LATERAL (SELECT x.state,x.created_at FROM customer_private.problem_report_status_event x WHERE x.report_id=r.id ORDER BY x.seq DESC LIMIT 1) s ON true
  WHERE r.customer_principal_id=actor AND (before_number IS NULL OR r.number<before_number)
  ORDER BY r.number DESC LIMIT page_size) page),'[]'::jsonb);
END $$
$listfn$;
 EXECUTE $getfn$
CREATE OR REPLACE FUNCTION customer.problem_report_get(ref text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;result jsonb;
BEGIN
 actor:=customer_private.account_actor();
 SELECT jsonb_build_object('reference',r.reference,'category',r.category,'filedAt',r.filed_at,'status',s.state,'updatedAt',s.created_at,
  'words',CASE WHEN EXISTS(SELECT FROM customer_private.problem_report_erasure e WHERE e.report_id=r.id) OR EXISTS(SELECT FROM customer_private.problem_report_self_removal q WHERE q.report_id=r.id) THEN jsonb_build_object('removed',true)
   ELSE jsonb_build_object('pageKind',w.page_kind,'page',w.page_text,'detail',w.detail) END,
  'history',(SELECT jsonb_agg(jsonb_build_object('state',x.state,'note',x.note,'createdAt',x.created_at) ORDER BY x.seq)
   FROM customer_private.problem_report_status_event x WHERE x.report_id=r.id)) INTO result
 FROM customer_private.problem_report r
 JOIN LATERAL (SELECT x.state,x.created_at FROM customer_private.problem_report_status_event x WHERE x.report_id=r.id ORDER BY x.seq DESC LIMIT 1) s ON true
 LEFT JOIN customer_private.problem_report_words w ON w.report_id=r.id
 WHERE r.reference=ref AND r.customer_principal_id=actor;
 IF result IS NULL THEN RAISE EXCEPTION 'Problem report not found' USING ERRCODE='23514'; END IF;
 RETURN result;
END $$
$getfn$;
 EXECUTE $queuefn$
CREATE OR REPLACE FUNCTION customer.problem_report_queue(after_number bigint DEFAULT NULL,page_size integer DEFAULT 25,state_filter text DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM customer_private.staff_problem_actor();
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 OR (state_filter IS NOT NULL AND state_filter NOT IN ('received','in_review','resolved','closed')) THEN
  RAISE EXCEPTION 'Invalid queue request' USING ERRCODE='22023';
 END IF;
 WITH scoped AS (
  SELECT r.id,r.number,r.reference,r.reporter_kind,r.category,r.filed_at,customer_private.problem_report_side(r.id) AS side,s.state,s.created_at AS updated_at
  FROM customer_private.problem_report r
  JOIN LATERAL (SELECT x.state,x.created_at FROM customer_private.problem_report_status_event x WHERE x.report_id=r.id ORDER BY x.seq DESC LIMIT 1) s ON true
  WHERE customer_private.problem_report_in_scope(r.id)),
 shown AS (SELECT * FROM scoped WHERE state_filter IS NULL OR state=state_filter),
 page AS (SELECT * FROM shown WHERE after_number IS NULL OR number>after_number ORDER BY number LIMIT page_size)
 SELECT jsonb_build_object(
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'number',p.number,'reference',p.reference,'reporterKind',p.reporter_kind,
    'filedAt',p.filed_at,'category',p.category,'side',p.side,'status',p.state,'updatedAt',p.updated_at,
    'wordsRemoved',(EXISTS(SELECT FROM customer_private.problem_report_erasure e WHERE e.report_id=p.id) OR EXISTS(SELECT FROM customer_private.problem_report_self_removal q WHERE q.report_id=p.id)),
    'pageKind',w.page_kind,'page',w.page_text,'detail',w.detail,
    'history',(SELECT jsonb_agg(jsonb_build_object('state',x.state,'note',x.note,'createdAt',x.created_at) ORDER BY x.seq)
      FROM customer_private.problem_report_status_event x WHERE x.report_id=p.id)) ORDER BY p.number)
   FROM page p LEFT JOIN customer_private.problem_report_words w ON w.report_id=p.id),'[]'::jsonb),
  'total',(SELECT count(*) FROM shown),
  'counts',jsonb_build_object('received',(SELECT count(*) FROM scoped WHERE state='received'),'in_review',(SELECT count(*) FROM scoped WHERE state='in_review'),
   'resolved',(SELECT count(*) FROM scoped WHERE state='resolved'),'closed',(SELECT count(*) FROM scoped WHERE state='closed')),
  'oldestReceivedAt',(SELECT min(filed_at) FROM scoped WHERE state='received')) INTO result;
 RETURN result;
END $$
$queuefn$;
 EXECUTE $removefn$
CREATE OR REPLACE FUNCTION customer.problem_report_remove_words(command uuid,erasure_request uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff uuid;filed customer_private.erasure_request%ROWTYPE;current_state text;stamped timestamptz;cutoff timestamptz;report uuid;removed integer;
BEGIN
 staff:=customer_private.staff_privacy_actor();
 IF command IS NULL OR erasure_request IS NULL THEN RAISE EXCEPTION 'Invalid problem report change' USING ERRCODE='22023'; END IF;
 SELECT * INTO filed FROM customer_private.erasure_request r WHERE r.id=erasure_request;
 IF NOT FOUND OR NOT customer_private.erasure_in_scope(filed.principal_id) THEN RAISE EXCEPTION 'Erasure request not found' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.account.lifecycle:'||filed.principal_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.problem_report:'||filed.principal_id::text,0));
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
  AND NOT EXISTS(SELECT FROM customer_private.problem_report_erasure e WHERE e.report_id=r.id)
  AND NOT EXISTS(SELECT FROM customer_private.problem_report_self_removal s WHERE s.report_id=r.id) ORDER BY r.number LOOP
  INSERT INTO customer_private.problem_report_erasure(report_id,reporter_kind,erasure_request_id,staff_principal_id,command_id)
  VALUES(report,'customer',erasure_request,staff,command);
  DELETE FROM customer_private.problem_report_words w WHERE w.report_id=report;
  removed:=removed+1;
 END LOOP;
 RETURN jsonb_build_object('reference',filed.reference,'removed',removed);
END $$
$removefn$;
 EXECUTE $own$
CREATE FUNCTION customer.problem_report_remove_own_words(command uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;report uuid;removed integer;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL THEN RAISE EXCEPTION 'Invalid problem report change' USING ERRCODE='22023'; END IF;
 actor:=customer_private.account_actor();
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.problem_report:'||actor::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT count(*)::integer INTO removed FROM customer_private.problem_report_self_removal s WHERE s.customer_principal_id=actor AND s.command_id=command;
 IF removed>0 THEN RETURN jsonb_build_object('removed',removed,'changed',false); END IF;
 FOR report IN SELECT r.id FROM customer_private.problem_report r
  WHERE r.reporter_kind='customer' AND r.customer_principal_id=actor
  AND EXISTS(SELECT FROM customer_private.problem_report_words w WHERE w.report_id=r.id) ORDER BY r.number LOOP
  INSERT INTO customer_private.problem_report_self_removal(report_id,reporter_kind,customer_principal_id,command_id)
  VALUES(report,'customer',actor,command);
  DELETE FROM customer_private.problem_report_words w WHERE w.report_id=report;
  removed:=removed+1;
 END LOOP;
 RETURN jsonb_build_object('removed',removed,'changed',removed>0);
END $$
$own$;
 EXECUTE $revoke$
REVOKE ALL ON FUNCTION customer.problem_report_remove_own_words(uuid) FROM PUBLIC,corridra_auth
$revoke$;
 EXECUTE $grant$
GRANT EXECUTE ON FUNCTION customer.problem_report_remove_own_words(uuid) TO corridra_runtime
$grant$;
END $guard$;
