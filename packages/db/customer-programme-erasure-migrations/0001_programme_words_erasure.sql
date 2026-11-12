-- Privacy accepted the launch of public programme applications without automated redaction (ADR-080, ADR-078 decision 6). This module
-- adds it: when staff action an erasure request, the words the person wrote in a programme application and the registration labels
-- under their name are replaced with a fixed placeholder. Ids, times, decisions, invitations, registrations, places, fees, money,
-- audit and event rows are never deleted or changed; only the words are.
-- Where the words live (all append-only today, so each table gets a guarded exception, nothing else is loosened):
--   programme_application            display_label, statement       (the person's own application words)
--   programme_invitation             label                          (copied from the application when an organiser invites an applicant)
--   programme_registration           display_label                  (the label given on joining)
--   programme_registration_label_revision display_label             (every later correction of that label, by the person or an organiser)
--   programme_participant_command    request/result displayLabel    (the replay record of joining)
--   programme_registration_label_command request/result displayLabel (the replay record of a label correction)
-- Organiser words (decision notes, programme names, invitation labels typed by an organiser for a code invitation) are not the
-- applicant's words and are left alone.
-- Pattern reused from customer.problem_report_remove_words: staff only under the erasure authority (staff_privacy_actor and
-- erasure_in_scope), the person comes from the erasure request and never from input, the same two advisory locks, command replay,
-- only while the request is in progress or completed, a cutoff (the completion time, or now while in progress), one no-words record
-- row for each item changed, and a guard trigger that allows exactly that change and nothing else.
-- Changes to existing objects: the append-only trigger (named immutable, or <table>_immutable on the two label tables) on the six tables above is replaced by customer_private.programme_words_guard,
-- which rejects every delete and every update exactly as before (same message and code) unless the update is the one this module
-- makes: an erasure record row for that item exists, only the word columns differ and each holds the placeholder. No function of an
-- older module is replaced, so there is no function fingerprint to compare. Additive: one table, two functions and one customer function.
-- The guard below refuses the whole file, before anything is created, unless every prerequisite is present and each of the six tables
-- still has the single append-only trigger this file replaces (proof that the module is the one it was written for).
DO $guard$
DECLARE spec record;
BEGIN
 FOR spec IN SELECT * FROM (VALUES
  ('customer_private.programme_application','immutable'),('customer_private.programme_invitation','immutable'),
  ('customer_private.programme_registration','immutable'),
  ('customer_private.programme_registration_label_revision','programme_registration_label_revision_immutable'),
  ('customer_private.programme_participant_command','immutable'),
  ('customer_private.programme_registration_label_command','programme_registration_label_command_immutable')) v(tbl,trg)
 LOOP
  IF to_regclass(spec.tbl) IS NULL THEN
   RAISE EXCEPTION 'Programme words erasure prerequisite is missing: %',spec.tbl;
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid=to_regclass(spec.tbl) AND NOT t.tgisinternal AND t.tgname=spec.trg
      AND t.tgfoid=to_regprocedure('app.reject_rewrite()'))<>1 THEN
   RAISE EXCEPTION 'Programme words erasure prerequisite differs: % has no append-only trigger named %',spec.tbl,spec.trg;
  END IF;
 END LOOP;
 IF to_regprocedure('customer_private.staff_privacy_actor()') IS NULL OR to_regprocedure('customer_private.erasure_in_scope(uuid)') IS NULL
  OR to_regclass('customer_private.erasure_request') IS NULL OR to_regclass('customer_private.erasure_status_event') IS NULL
  OR to_regclass('customer_private.programme_application_decision') IS NULL THEN
  RAISE EXCEPTION 'Programme words erasure needs the account lifecycle and programme publication modules first';
 END IF;
 IF to_regclass('customer_private.programme_words_erasure') IS NOT NULL OR to_regprocedure('customer.programme_words_remove(uuid,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'Programme words erasure is already present but not recorded';
 END IF;
END $guard$;

-- One row for each item whose words were removed. It holds no words. The key is the item's own id, or registration id and version for
-- a label revision, or actor and command for a replay record.
CREATE TABLE customer_private.programme_words_erasure (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source text NOT NULL CHECK(source IN ('application','invitation','registration','label_revision','participant_command','label_command')),
 row_key text NOT NULL CHECK(length(row_key) BETWEEN 36 AND 80),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 erasure_request_id uuid NOT NULL REFERENCES customer_private.erasure_request(id),
 staff_principal_id uuid NOT NULL REFERENCES identity.principal(id),
 command_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(source,row_key)
);
CREATE INDEX programme_words_erasure_command ON customer_private.programme_words_erasure(command_id,erasure_request_id);
ALTER TABLE customer_private.programme_words_erasure ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.programme_words_erasure FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON customer_private.programme_words_erasure FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- The only two label placeholders and the one statement placeholder. A sample (synthetic) context requires the 'Synthetic ' mark.
CREATE FUNCTION customer_private.programme_words_label(sample boolean) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT CASE WHEN sample THEN 'Synthetic removed words' ELSE 'Removed at request' END $$;
CREATE FUNCTION customer_private.programme_words_statement() RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT 'Words removed at the request of this person' $$;

-- Replaces the append-only trigger on the six tables. Same refusal as app.reject_rewrite for everything except the one change.
CREATE FUNCTION customer_private.programme_words_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE kind text:=TG_ARGV[0];key text;words text[];old_row jsonb;new_row jsonb;ok boolean:=false;
BEGIN
 IF TG_OP='UPDATE' THEN
  old_row:=to_jsonb(OLD);new_row:=to_jsonb(NEW);
  key:=CASE kind WHEN 'label_revision' THEN old_row->>'registration_id'||':'||(old_row->>'version')
   WHEN 'participant_command' THEN old_row->>'actor_id'||':'||(old_row->>'command_id')
   WHEN 'label_command' THEN old_row->>'actor_id'||':'||(old_row->>'command_id') ELSE old_row->>'id' END;
  IF EXISTS(SELECT FROM customer_private.programme_words_erasure e WHERE e.source=kind AND e.row_key=key) THEN
   IF kind IN ('participant_command','label_command') THEN
    ok:=(new_row-ARRAY['request','result'])=(old_row-ARRAY['request','result'])
     AND (new_row->'request')-'displayLabel'=(old_row->'request')-'displayLabel'
     AND (new_row->'result')-'displayLabel'=(old_row->'result')-'displayLabel'
     AND coalesce(new_row->'request'->>'displayLabel',customer_private.programme_words_label(true))
      IN (customer_private.programme_words_label(true),customer_private.programme_words_label(false))
     AND coalesce(new_row->'result'->>'displayLabel',customer_private.programme_words_label(true))
      IN (customer_private.programme_words_label(true),customer_private.programme_words_label(false));
   ELSE
    words:=CASE kind WHEN 'application' THEN ARRAY['display_label','statement'] WHEN 'invitation' THEN ARRAY['label'] ELSE ARRAY['display_label'] END;
    ok:=(new_row-words)=(old_row-words)
     AND coalesce(new_row->>'display_label',new_row->>'label') IN (customer_private.programme_words_label(true),customer_private.programme_words_label(false))
     AND (kind<>'application' OR new_row->>'statement'=customer_private.programme_words_statement());
   END IF;
  END IF;
  IF ok THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Immutable record; append a new record' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION customer_private.programme_words_guard(),customer_private.programme_words_label(boolean),customer_private.programme_words_statement() FROM PUBLIC;

DO $swap$ DECLARE spec record;
BEGIN
 FOR spec IN SELECT * FROM (VALUES
  ('programme_application','application','immutable'),('programme_invitation','invitation','immutable'),
  ('programme_registration','registration','immutable'),
  ('programme_registration_label_revision','label_revision','programme_registration_label_revision_immutable'),
  ('programme_participant_command','participant_command','immutable'),
  ('programme_registration_label_command','label_command','programme_registration_label_command_immutable')) v(tbl,kind,trg)
 LOOP
  EXECUTE format('DROP TRIGGER %I ON customer_private.%I',spec.trg,spec.tbl);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON customer_private.%I FOR EACH ROW EXECUTE FUNCTION customer_private.programme_words_guard(%L)',spec.trg,spec.tbl,spec.kind);
 END LOOP;
END $swap$;

-- Staff only. Replaces the words of one person, named by their erasure request. Safe to run again with a new command: items already
-- done are skipped. A replay of the same command answers with the first counts and changes nothing.
CREATE FUNCTION customer.programme_words_remove(command uuid,erasure_request uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff uuid;filed customer_private.erasure_request%ROWTYPE;current_state text;stamped timestamptz;cutoff timestamptz;
 sample boolean;mark text;note text;counts jsonb;
BEGIN
 staff:=customer_private.staff_privacy_actor();
 IF command IS NULL OR erasure_request IS NULL THEN RAISE EXCEPTION 'Invalid programme words change' USING ERRCODE='22023'; END IF;
 SELECT * INTO filed FROM customer_private.erasure_request r WHERE r.id=erasure_request;
 IF NOT FOUND OR NOT customer_private.erasure_in_scope(filed.principal_id) THEN RAISE EXCEPTION 'Erasure request not found' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.account.lifecycle:'||filed.principal_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_words:'||filed.principal_id::text,0));
 IF EXISTS(SELECT FROM customer_private.programme_words_erasure e WHERE e.command_id=command AND e.erasure_request_id<>erasure_request) THEN
  RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT FROM customer_private.programme_words_erasure e WHERE e.command_id=command AND e.erasure_request_id=erasure_request) THEN
  RETURN (SELECT jsonb_build_object('reference',filed.reference,'removed',count(*),
   'applications',count(*) FILTER (WHERE e.source='application'),'invitationLabels',count(*) FILTER (WHERE e.source='invitation'),
   'registrations',count(*) FILTER (WHERE e.source='registration'),'labelRevisions',count(*) FILTER (WHERE e.source='label_revision'),
   'commandRecords',count(*) FILTER (WHERE e.source IN ('participant_command','label_command')))
   FROM customer_private.programme_words_erasure e WHERE e.command_id=command AND e.erasure_request_id=erasure_request);
 END IF;
 SELECT x.state,x.created_at INTO current_state,stamped FROM customer_private.erasure_status_event x WHERE x.request_id=erasure_request ORDER BY x.seq DESC LIMIT 1;
 IF current_state IS NULL OR current_state NOT IN ('in_progress','completed') THEN
  RAISE EXCEPTION 'Words can be removed only for an erasure request that is in progress or completed' USING ERRCODE='23514';
 END IF;
 cutoff:=CASE WHEN current_state='completed' THEN stamped ELSE transaction_timestamp() END;
 -- The label placeholder must satisfy the label CHECK of the context the staff member works in (the sample mark, or none).
 sample:=true;
 IF to_regprocedure('customer_private.synthetic_context()') IS NOT NULL THEN EXECUTE 'SELECT customer_private.synthetic_context()' INTO sample; END IF;
 mark:=customer_private.programme_words_label(coalesce(sample,true));
 note:=customer_private.programme_words_statement();

 -- Record first, then change. The guard allows a change only for an item that already has its record row.
 INSERT INTO customer_private.programme_words_erasure(source,row_key,principal_id,erasure_request_id,staff_principal_id,command_id)
 SELECT 'application',a.id::text,filed.principal_id,erasure_request,staff,command FROM customer_private.programme_application a
 WHERE a.principal_id=filed.principal_id AND a.created_at<=cutoff
 AND NOT EXISTS(SELECT FROM customer_private.programme_words_erasure e WHERE e.source='application' AND e.row_key=a.id::text);
 INSERT INTO customer_private.programme_words_erasure(source,row_key,principal_id,erasure_request_id,staff_principal_id,command_id)
 SELECT 'invitation',i.id::text,filed.principal_id,erasure_request,staff,command FROM customer_private.programme_invitation i
 WHERE i.created_at<=cutoff AND i.id IN (SELECT d.invitation_id FROM customer_private.programme_application_decision d
  JOIN customer_private.programme_application a ON a.id=d.application_id WHERE a.principal_id=filed.principal_id AND d.invitation_id IS NOT NULL)
 AND NOT EXISTS(SELECT FROM customer_private.programme_words_erasure e WHERE e.source='invitation' AND e.row_key=i.id::text);
 INSERT INTO customer_private.programme_words_erasure(source,row_key,principal_id,erasure_request_id,staff_principal_id,command_id)
 SELECT 'registration',r.id::text,filed.principal_id,erasure_request,staff,command FROM customer_private.programme_registration r
 WHERE r.principal_id=filed.principal_id AND r.consented_at<=cutoff
 AND NOT EXISTS(SELECT FROM customer_private.programme_words_erasure e WHERE e.source='registration' AND e.row_key=r.id::text);
 INSERT INTO customer_private.programme_words_erasure(source,row_key,principal_id,erasure_request_id,staff_principal_id,command_id)
 SELECT 'label_revision',v.registration_id::text||':'||v.version,filed.principal_id,erasure_request,staff,command
 FROM customer_private.programme_registration_label_revision v
 WHERE v.created_at<=cutoff AND v.registration_id IN (SELECT r.id FROM customer_private.programme_registration r WHERE r.principal_id=filed.principal_id)
 AND NOT EXISTS(SELECT FROM customer_private.programme_words_erasure e WHERE e.source='label_revision' AND e.row_key=v.registration_id::text||':'||v.version);
 INSERT INTO customer_private.programme_words_erasure(source,row_key,principal_id,erasure_request_id,staff_principal_id,command_id)
 SELECT 'participant_command',c.actor_id::text||':'||c.command_id,filed.principal_id,erasure_request,staff,command
 FROM customer_private.programme_participant_command c
 WHERE c.actor_id=filed.principal_id AND c.created_at<=cutoff AND (c.request ? 'displayLabel' OR c.result ? 'displayLabel')
 AND NOT EXISTS(SELECT FROM customer_private.programme_words_erasure e WHERE e.source='participant_command' AND e.row_key=c.actor_id::text||':'||c.command_id);
 INSERT INTO customer_private.programme_words_erasure(source,row_key,principal_id,erasure_request_id,staff_principal_id,command_id)
 SELECT 'label_command',c.actor_id::text||':'||c.command_id,filed.principal_id,erasure_request,staff,command
 FROM customer_private.programme_registration_label_command c
 WHERE c.actor_id=filed.principal_id AND c.created_at<=cutoff AND (c.request ? 'displayLabel' OR c.result ? 'displayLabel')
 AND NOT EXISTS(SELECT FROM customer_private.programme_words_erasure e WHERE e.source='label_command' AND e.row_key=c.actor_id::text||':'||c.command_id);

 UPDATE customer_private.programme_application a SET display_label=mark,statement=note
 WHERE EXISTS(SELECT FROM customer_private.programme_words_erasure e WHERE e.source='application' AND e.row_key=a.id::text AND e.command_id=command);
 UPDATE customer_private.programme_invitation i SET label=mark
 WHERE EXISTS(SELECT FROM customer_private.programme_words_erasure e WHERE e.source='invitation' AND e.row_key=i.id::text AND e.command_id=command);
 UPDATE customer_private.programme_registration r SET display_label=mark
 WHERE EXISTS(SELECT FROM customer_private.programme_words_erasure e WHERE e.source='registration' AND e.row_key=r.id::text AND e.command_id=command);
 UPDATE customer_private.programme_registration_label_revision v SET display_label=mark
 WHERE EXISTS(SELECT FROM customer_private.programme_words_erasure e WHERE e.source='label_revision' AND e.row_key=v.registration_id::text||':'||v.version AND e.command_id=command);
 UPDATE customer_private.programme_participant_command c SET
  request=CASE WHEN c.request ? 'displayLabel' THEN jsonb_set(c.request,'{displayLabel}',to_jsonb(mark)) ELSE c.request END,
  result=CASE WHEN c.result ? 'displayLabel' THEN jsonb_set(c.result,'{displayLabel}',to_jsonb(mark)) ELSE c.result END
 WHERE EXISTS(SELECT FROM customer_private.programme_words_erasure e WHERE e.source='participant_command' AND e.row_key=c.actor_id::text||':'||c.command_id AND e.command_id=command);
 UPDATE customer_private.programme_registration_label_command c SET
  request=CASE WHEN c.request ? 'displayLabel' THEN jsonb_set(c.request,'{displayLabel}',to_jsonb(mark)) ELSE c.request END,
  result=CASE WHEN c.result ? 'displayLabel' THEN jsonb_set(c.result,'{displayLabel}',to_jsonb(mark)) ELSE c.result END
 WHERE EXISTS(SELECT FROM customer_private.programme_words_erasure e WHERE e.source='label_command' AND e.row_key=c.actor_id::text||':'||c.command_id AND e.command_id=command);

 SELECT jsonb_build_object('reference',filed.reference,'removed',count(*),
  'applications',count(*) FILTER (WHERE e.source='application'),'invitationLabels',count(*) FILTER (WHERE e.source='invitation'),
  'registrations',count(*) FILTER (WHERE e.source='registration'),'labelRevisions',count(*) FILTER (WHERE e.source='label_revision'),
  'commandRecords',count(*) FILTER (WHERE e.source IN ('participant_command','label_command'))) INTO counts
 FROM customer_private.programme_words_erasure e WHERE e.command_id=command AND e.erasure_request_id=erasure_request;
 RETURN counts;
END $$;
REVOKE ALL ON FUNCTION customer.programme_words_remove(uuid,uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.programme_words_remove(uuid,uuid) TO corridra_runtime;
