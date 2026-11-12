-- Extends the programme erasure module (0001) to the free text a participant typed into a payment declaration (real-use 0016):
--   programme_payment_declaration  payer_reference, note   (the person's own words)
--   programme_payment_command      request.payload.payerReference and request.payload.note (the replay record of declaring)
-- Amounts, currencies, dates, decisions (organiser words included), ledger entries, events and audit rows are never changed.
-- Same pattern as 0001: staff only under the erasure authority (staff_privacy_actor and erasure_in_scope), the person comes from the
-- erasure request, the same two advisory locks, command replay, only while the request is in progress or completed, a cutoff
-- (completion time, or now while in progress), one no-words record row for each item changed (written first), and a guard trigger
-- that refuses every delete and every update except the one change: a record row exists, only the word fields differ and each
-- holds the same placeholder 0001 uses (it satisfies the CHECK constraints of payer_reference and note in both contexts).
-- A field that is NULL stays NULL. Changes to existing objects: the append-only trigger of the same name on the two tables above is
-- replaced by customer_private.programme_payment_words_guard (same refusal message and code). No function of an older module is
-- replaced, so there is no function fingerprint to compare. Additive: one table, two functions and one customer function.
-- When the payment declaration module (real-use 0016) is absent, this file only raises a notice and creates nothing.
DO $module$
DECLARE spec record;
BEGIN
 IF to_regclass('customer_private.programme_payment_declaration') IS NULL OR to_regclass('customer_private.programme_payment_command') IS NULL THEN
  RAISE NOTICE 'Programme payment words erasure skipped: the participant payment declaration module (real-use 0016) is not installed';
  RETURN;
 END IF;
 FOR spec IN SELECT * FROM (VALUES
  ('customer_private.programme_payment_declaration','programme_payment_declaration_immutable'),
  ('customer_private.programme_payment_command','programme_payment_command_immutable')) v(tbl,trg)
 LOOP
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid=to_regclass(spec.tbl) AND NOT t.tgisinternal AND t.tgname=spec.trg
      AND t.tgfoid=to_regprocedure('app.reject_rewrite()'))<>1 THEN
   RAISE EXCEPTION 'Programme payment words erasure prerequisite differs: % has no append-only trigger named %',spec.tbl,spec.trg;
  END IF;
 END LOOP;
 IF to_regclass('customer_private.programme_words_erasure') IS NULL OR to_regprocedure('customer_private.programme_words_label(boolean)') IS NULL
  OR to_regprocedure('customer_private.staff_privacy_actor()') IS NULL OR to_regprocedure('customer_private.erasure_in_scope(uuid)') IS NULL
  OR to_regclass('customer_private.erasure_request') IS NULL OR to_regclass('customer_private.erasure_status_event') IS NULL THEN
  RAISE EXCEPTION 'Programme payment words erasure needs the programme words erasure module first';
 END IF;
 IF to_regclass('customer_private.programme_payment_words_erasure') IS NOT NULL OR to_regprocedure('customer.programme_payment_words_remove(uuid,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'Programme payment words erasure is already present but not recorded';
 END IF;

 EXECUTE $ddl$
-- One row for each item whose words were removed. It holds no words. The key is the declaration id, or actor and command for a replay record.
CREATE TABLE customer_private.programme_payment_words_erasure (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source text NOT NULL CHECK(source IN ('declaration','declaration_command')),
 row_key text NOT NULL CHECK(length(row_key) BETWEEN 36 AND 80),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 erasure_request_id uuid NOT NULL REFERENCES customer_private.erasure_request(id),
 staff_principal_id uuid NOT NULL REFERENCES identity.principal(id),
 command_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(source,row_key)
);
CREATE INDEX programme_payment_words_erasure_command ON customer_private.programme_payment_words_erasure(command_id,erasure_request_id);
ALTER TABLE customer_private.programme_payment_words_erasure ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.programme_payment_words_erasure FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON customer_private.programme_payment_words_erasure FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

CREATE FUNCTION customer_private.programme_payment_words_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE kind text:=TG_ARGV[0];key text;old_row jsonb;new_row jsonb;ok boolean:=false;k text;
BEGIN
 IF TG_OP='UPDATE' THEN
  old_row:=to_jsonb(OLD);new_row:=to_jsonb(NEW);
  key:=CASE kind WHEN 'declaration' THEN old_row->>'id' ELSE old_row->>'actor_id'||':'||(old_row->>'command_id') END;
  IF EXISTS(SELECT FROM customer_private.programme_payment_words_erasure e WHERE e.source=CASE kind WHEN 'declaration' THEN 'declaration' ELSE 'declaration_command' END AND e.row_key=key) THEN
   IF kind='declaration' THEN
    ok:=(new_row-ARRAY['payer_reference','note'])=(old_row-ARRAY['payer_reference','note'])
     AND jsonb_typeof(new_row->'payer_reference')=jsonb_typeof(old_row->'payer_reference')
     AND jsonb_typeof(new_row->'note')=jsonb_typeof(old_row->'note')
     AND coalesce(new_row->>'payer_reference',customer_private.programme_words_label(true)) IN (customer_private.programme_words_label(true),customer_private.programme_words_label(false))
     AND coalesce(new_row->>'note',customer_private.programme_words_label(true)) IN (customer_private.programme_words_label(true),customer_private.programme_words_label(false));
   ELSE
    ok:=(new_row-'request')=(old_row-'request')
     AND old_row->>'action'='DECLARE'
     AND (new_row->'request')-'payload'=(old_row->'request')-'payload'
     AND (new_row->'request'->'payload')-ARRAY['payerReference','note']=(old_row->'request'->'payload')-ARRAY['payerReference','note'];
    IF ok THEN
     FOREACH k IN ARRAY ARRAY['payerReference','note'] LOOP
      IF jsonb_typeof(new_row->'request'->'payload'->k) IS DISTINCT FROM jsonb_typeof(old_row->'request'->'payload'->k)
       OR coalesce(new_row->'request'->'payload'->>k,customer_private.programme_words_label(true))
        NOT IN (customer_private.programme_words_label(true),customer_private.programme_words_label(false)) THEN
       ok:=false;
      END IF;
     END LOOP;
    END IF;
   END IF;
  END IF;
  IF ok THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Immutable record; append a new record' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION customer_private.programme_payment_words_guard() FROM PUBLIC;

DROP TRIGGER programme_payment_declaration_immutable ON customer_private.programme_payment_declaration;
CREATE TRIGGER programme_payment_declaration_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_payment_declaration FOR EACH ROW EXECUTE FUNCTION customer_private.programme_payment_words_guard('declaration');
DROP TRIGGER programme_payment_command_immutable ON customer_private.programme_payment_command;
CREATE TRIGGER programme_payment_command_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_payment_command FOR EACH ROW EXECUTE FUNCTION customer_private.programme_payment_words_guard('declaration_command');

-- Staff only. Replaces the payer reference and note of one person's payment declarations, named by their erasure request. Safe to run
-- again with a new command: items already done are skipped. A replay of the same command answers with the first counts.
CREATE FUNCTION customer.programme_payment_words_remove(command uuid,erasure_request uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff uuid;filed customer_private.erasure_request%ROWTYPE;current_state text;stamped timestamptz;cutoff timestamptz;
 sample boolean;mark text;counts jsonb;
BEGIN
 staff:=customer_private.staff_privacy_actor();
 IF command IS NULL OR erasure_request IS NULL THEN RAISE EXCEPTION 'Invalid programme words change' USING ERRCODE='22023'; END IF;
 SELECT * INTO filed FROM customer_private.erasure_request r WHERE r.id=erasure_request;
 IF NOT FOUND OR NOT customer_private.erasure_in_scope(filed.principal_id) THEN RAISE EXCEPTION 'Erasure request not found' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.account.lifecycle:'||filed.principal_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_words:'||filed.principal_id::text,0));
 IF EXISTS(SELECT FROM customer_private.programme_payment_words_erasure e WHERE e.command_id=command AND e.erasure_request_id<>erasure_request) THEN
  RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT FROM customer_private.programme_payment_words_erasure e WHERE e.command_id=command AND e.erasure_request_id=erasure_request) THEN
  RETURN (SELECT jsonb_build_object('reference',filed.reference,'removed',count(*),
   'declarations',count(*) FILTER (WHERE e.source='declaration'),'commandRecords',count(*) FILTER (WHERE e.source='declaration_command'))
   FROM customer_private.programme_payment_words_erasure e WHERE e.command_id=command AND e.erasure_request_id=erasure_request);
 END IF;
 SELECT x.state,x.created_at INTO current_state,stamped FROM customer_private.erasure_status_event x WHERE x.request_id=erasure_request ORDER BY x.seq DESC LIMIT 1;
 IF current_state IS NULL OR current_state NOT IN ('in_progress','completed') THEN
  RAISE EXCEPTION 'Words can be removed only for an erasure request that is in progress or completed' USING ERRCODE='23514';
 END IF;
 cutoff:=CASE WHEN current_state='completed' THEN stamped ELSE transaction_timestamp() END;
 sample:=true;
 IF to_regprocedure('customer_private.synthetic_context()') IS NOT NULL THEN EXECUTE 'SELECT customer_private.synthetic_context()' INTO sample; END IF;
 mark:=customer_private.programme_words_label(coalesce(sample,true));

 -- Record first, then change. The guard allows a change only for an item that already has its record row.
 INSERT INTO customer_private.programme_payment_words_erasure(source,row_key,principal_id,erasure_request_id,staff_principal_id,command_id)
 SELECT 'declaration',d.id::text,filed.principal_id,erasure_request,staff,command FROM customer_private.programme_payment_declaration d
 WHERE d.declared_by=filed.principal_id AND d.declared_at<=cutoff AND (d.payer_reference IS NOT NULL OR d.note IS NOT NULL)
 AND NOT EXISTS(SELECT FROM customer_private.programme_payment_words_erasure e WHERE e.source='declaration' AND e.row_key=d.id::text);
 INSERT INTO customer_private.programme_payment_words_erasure(source,row_key,principal_id,erasure_request_id,staff_principal_id,command_id)
 SELECT 'declaration_command',c.actor_id::text||':'||c.command_id,filed.principal_id,erasure_request,staff,command
 FROM customer_private.programme_payment_command c
 WHERE c.actor_id=filed.principal_id AND c.action='DECLARE' AND c.created_at<=cutoff
 AND (jsonb_typeof(c.request->'payload'->'payerReference')='string' OR jsonb_typeof(c.request->'payload'->'note')='string')
 AND NOT EXISTS(SELECT FROM customer_private.programme_payment_words_erasure e WHERE e.source='declaration_command' AND e.row_key=c.actor_id::text||':'||c.command_id);

 UPDATE customer_private.programme_payment_declaration d SET
  payer_reference=CASE WHEN d.payer_reference IS NULL THEN NULL ELSE mark END,
  note=CASE WHEN d.note IS NULL THEN NULL ELSE mark END
 WHERE EXISTS(SELECT FROM customer_private.programme_payment_words_erasure e WHERE e.source='declaration' AND e.row_key=d.id::text AND e.command_id=command);
 UPDATE customer_private.programme_payment_command c SET request=
  CASE WHEN jsonb_typeof(c.request->'payload'->'note')='string' THEN jsonb_set(
   CASE WHEN jsonb_typeof(c.request->'payload'->'payerReference')='string' THEN jsonb_set(c.request,'{payload,payerReference}',to_jsonb(mark)) ELSE c.request END,
   '{payload,note}',to_jsonb(mark))
  ELSE jsonb_set(c.request,'{payload,payerReference}',to_jsonb(mark)) END
 WHERE EXISTS(SELECT FROM customer_private.programme_payment_words_erasure e WHERE e.source='declaration_command' AND e.row_key=c.actor_id::text||':'||c.command_id AND e.command_id=command);

 SELECT jsonb_build_object('reference',filed.reference,'removed',count(*),
  'declarations',count(*) FILTER (WHERE e.source='declaration'),'commandRecords',count(*) FILTER (WHERE e.source='declaration_command')) INTO counts
 FROM customer_private.programme_payment_words_erasure e WHERE e.command_id=command AND e.erasure_request_id=erasure_request;
 RETURN counts;
END $$;
REVOKE ALL ON FUNCTION customer.programme_payment_words_remove(uuid,uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.programme_payment_words_remove(uuid,uuid) TO corridra_runtime;
 $ddl$;
END $module$;
