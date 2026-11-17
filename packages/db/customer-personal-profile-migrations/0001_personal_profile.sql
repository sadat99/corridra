-- ADR-086. Optional private personal details a signed-in person keeps about themselves: job title, the country they work
-- from, interests, how they prefer to be reached and how their initials are drawn. Everything is optional and
-- self-reported: nothing here is verified, nothing is mandatory and nothing is scored.
-- Who can read it: only the person, through customer.personal_profile_view(). No staff read, no workspace read, no other
-- principal. The actor always comes from the signed-in session (customer.actor_id()), never from an argument.
-- History: every save is a new revision (append-only, expected version, one command id per decision, replayed exactly).
-- Events: one per revision and one per account security change, ids and a kind only, never a title, an interest, a name or
-- an email. The event workspace is the account chain workspace of the account lifecycle module (account_chain_tenant), so
-- the module refuses to install without it, naming the step.
-- Erasure: staff only, under an erasure request (staff_privacy_actor, erasure_in_scope, the lifecycle advisory locks), the
-- title and interests of every revision and replay record are replaced by a fixed placeholder, one record row per item. A
-- guard trigger allows exactly that change and nothing else.
-- Room for later units: a profile picture (CI-U1P) is stored in its own table keyed by principal on private object storage;
-- the validator below accepts no picture key, so picture data never enters these rows.
-- Additive only: new tables and new functions. No existing function, policy, grant, trigger or row is replaced or changed.
DO $guard$ BEGIN
 IF to_regprocedure('customer.actor_id()') IS NULL
 OR to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regclass('app.country') IS NULL
 OR to_regclass('app.domain_event') IS NULL
 OR to_regclass('customer_private.principal') IS NULL
 OR to_regclass('customer_private.configuration') IS NULL
 THEN RAISE EXCEPTION 'Personal profile prerequisites are missing'; END IF;
 IF to_regprocedure('customer_private.account_chain_tenant(uuid)') IS NULL
 OR to_regclass('customer_private.account_chain') IS NULL
 OR to_regprocedure('customer_private.account_status(uuid)') IS NULL
 OR to_regprocedure('customer_private.staff_privacy_actor()') IS NULL
 OR to_regprocedure('customer_private.erasure_in_scope(uuid)') IS NULL
 OR to_regclass('customer_private.erasure_request') IS NULL
 OR to_regclass('customer_private.erasure_status_event') IS NULL
 THEN RAISE EXCEPTION 'Install the account lifecycle modules first (field_modules_action=lifecycle_install)'; END IF;
 IF to_regclass('customer_private.personal_profile_revision') IS NOT NULL OR to_regprocedure('customer.personal_profile_view()') IS NOT NULL THEN
  RAISE EXCEPTION 'Personal profile is already present but not recorded';
 END IF;
END $guard$;

CREATE TABLE customer_private.personal_profile_revision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 details jsonb NOT NULL CHECK(jsonb_typeof(details)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(principal_id,version)
);
CREATE TABLE customer_private.personal_profile_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid PRIMARY KEY,
 revision_id uuid NOT NULL UNIQUE REFERENCES customer_private.personal_profile_revision(id),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- One row for each account security change the person made through the server routes. A kind only, no value.
CREATE TABLE customer_private.account_security_note (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('name_changed','password_changed','session_revoked','other_sessions_revoked')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,command_id)
);
-- One row for each item whose words staff removed under an erasure request. It holds no words.
CREATE TABLE customer_private.personal_profile_erasure (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source text NOT NULL CHECK(source IN ('revision','command')),
 row_key uuid NOT NULL,
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 erasure_request_id uuid NOT NULL REFERENCES customer_private.erasure_request(id),
 staff_principal_id uuid NOT NULL REFERENCES identity.principal(id),
 command_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(source,row_key)
);
CREATE INDEX personal_profile_erasure_command ON customer_private.personal_profile_erasure(command_id,erasure_request_id);

-- The one placeholder for a removed title or interest.
CREATE FUNCTION customer_private.personal_profile_placeholder() RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT 'Removed at request' $$;

-- Same refusal as app.reject_rewrite for every delete and update, except the one change the staff removal makes: a record row
-- for the item exists, only the title and interests differ, the title is the placeholder (or absent) and the interests are
-- empty (or absent). On a replay record the same holds inside request.details.
CREATE FUNCTION customer_private.personal_profile_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE kind text:=TG_ARGV[0];old_row jsonb;new_row jsonb;before jsonb;after jsonb;ok boolean:=false;key uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
  old_row:=to_jsonb(OLD);new_row:=to_jsonb(NEW);
  key:=CASE kind WHEN 'revision' THEN (old_row->>'id')::uuid ELSE (old_row->>'command_id')::uuid END;
  IF EXISTS(SELECT FROM customer_private.personal_profile_erasure e WHERE e.source=kind AND e.row_key=key) THEN
   IF kind='revision' THEN
    before:=old_row->'details';after:=new_row->'details';
    ok:=(new_row-'details')=(old_row-'details');
   ELSE
    before:=old_row->'request'->'details';after:=new_row->'request'->'details';
    ok:=(new_row-'request')=(old_row-'request') AND (new_row->'request')-'details'=(old_row->'request')-'details';
   END IF;
   ok:=ok AND jsonb_typeof(after)='object' AND (after-ARRAY['title','interests'])=(before-ARRAY['title','interests'])
    AND (NOT(after ? 'title') OR jsonb_typeof(after->'title')='null' OR after->>'title'=customer_private.personal_profile_placeholder())
    AND (after ? 'title')=(before ? 'title')
    AND (NOT(after ? 'interests') OR after->'interests'='[]'::jsonb)
    AND (after ? 'interests')=(before ? 'interests');
  END IF;
  IF ok THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Immutable record; append a new record' USING ERRCODE='23514';
END $$;

CREATE TRIGGER personal_profile_revision_immutable BEFORE UPDATE OR DELETE ON customer_private.personal_profile_revision
 FOR EACH ROW EXECUTE FUNCTION customer_private.personal_profile_guard('revision');
CREATE TRIGGER personal_profile_command_immutable BEFORE UPDATE OR DELETE ON customer_private.personal_profile_command
 FOR EACH ROW EXECUTE FUNCTION customer_private.personal_profile_guard('command');
CREATE TRIGGER account_security_note_immutable BEFORE UPDATE OR DELETE ON customer_private.account_security_note
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER personal_profile_erasure_immutable BEFORE UPDATE OR DELETE ON customer_private.personal_profile_erasure
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.personal_profile_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.personal_profile_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.account_security_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.personal_profile_erasure ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.personal_profile_revision,customer_private.personal_profile_command,
 customer_private.account_security_note,customer_private.personal_profile_erasure FROM PUBLIC,corridra_runtime,corridra_auth;

-- Only these keys, each optional. title: 1 to 80 characters, trimmed, no control characters, or null. baseCountry: a code in
-- app.country, or null. interests: at most 10, each 2 to 60 trimmed characters, unique ignoring case. contactMethod: EMAIL,
-- IN_APP or NO_PREFERENCE (there is no phone). initialsPreference: NAME_INITIALS, EMAIL_INITIALS or NONE.
CREATE FUNCTION customer_private.personal_profile_valid(d jsonb) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE words text[];
BEGIN
 IF d IS NULL OR jsonb_typeof(d)<>'object' OR d-ARRAY['title','baseCountry','interests','contactMethod','initialsPreference']<>'{}'::jsonb THEN RETURN false; END IF;
 IF d ? 'title' AND jsonb_typeof(d->'title')<>'null' AND (jsonb_typeof(d->'title')<>'string' OR d->>'title'<>btrim(d->>'title')
  OR length(d->>'title') NOT BETWEEN 1 AND 80 OR d->>'title' ~ '[[:cntrl:]]') THEN RETURN false; END IF;
 IF d ? 'baseCountry' AND jsonb_typeof(d->'baseCountry')<>'null' AND (jsonb_typeof(d->'baseCountry')<>'string'
  OR NOT EXISTS(SELECT FROM app.country c WHERE c.code=d->>'baseCountry')) THEN RETURN false; END IF;
 IF d ? 'contactMethod' AND (jsonb_typeof(d->'contactMethod')<>'string' OR d->>'contactMethod' NOT IN ('EMAIL','IN_APP','NO_PREFERENCE')) THEN RETURN false; END IF;
 IF d ? 'initialsPreference' AND (jsonb_typeof(d->'initialsPreference')<>'string' OR d->>'initialsPreference' NOT IN ('NAME_INITIALS','EMAIL_INITIALS','NONE')) THEN RETURN false; END IF;
 IF d ? 'interests' THEN
  IF jsonb_typeof(d->'interests')<>'array' OR jsonb_array_length(d->'interests')>10
   OR EXISTS(SELECT FROM jsonb_array_elements(d->'interests') v WHERE jsonb_typeof(v)<>'string') THEN RETURN false; END IF;
  SELECT coalesce(array_agg(value),ARRAY[]::text[]) INTO words FROM jsonb_array_elements_text(d->'interests');
  IF EXISTS(SELECT FROM unnest(words) w WHERE w<>btrim(w) OR length(w) NOT BETWEEN 2 AND 60 OR w ~ '[[:cntrl:]]')
   OR (SELECT count(DISTINCT lower(w)) FROM unnest(words) w)<>cardinality(words) THEN RETURN false; END IF;
 END IF;
 RETURN true;
END $$;

-- The signed-in person, refused when disabled, closed (undo window or final) or with an erasure request that was not declined.
CREATE FUNCTION customer_private.personal_profile_actor() RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM customer_private.principal WHERE id=actor AND disabled_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF (SELECT s.status FROM customer_private.account_status(actor) s)<>'active' THEN
  RAISE EXCEPTION 'Your account is closed' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT FROM customer_private.erasure_request r
  WHERE r.principal_id=actor AND (SELECT x.state FROM customer_private.erasure_status_event x WHERE x.request_id=r.id ORDER BY x.seq DESC LIMIT 1)<>'declined') THEN
  RAISE EXCEPTION 'An erasure request is filed for this account' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;

-- The workspace that carries this person's events. A person with no workspace gets a plain refusal.
CREATE FUNCTION customer_private.personal_profile_tenant(person uuid) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 RETURN customer_private.account_chain_tenant(person);
EXCEPTION WHEN check_violation THEN
 RAISE EXCEPTION 'Personal details need a workspace on this account. Create or join a workspace first.' USING ERRCODE='23514';
END $$;

CREATE FUNCTION customer_private.personal_profile_event(person uuid,command uuid,kind text,aggregate text,payload jsonb) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid;eid uuid:=gen_random_uuid();tenant uuid;next_version integer;
BEGIN
 IF person IS NULL OR customer.actor_id() IS DISTINCT FROM person THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 tenant:=customer_private.personal_profile_tenant(person);
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO next_version FROM app.domain_event e
 WHERE e.tenant_id=tenant AND e.aggregate_type=aggregate AND e.aggregate_id=person::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,tenant,kind,1,aggregate,person::text,next_version,executor,clock_timestamp(),command,command,
  payload||jsonb_build_object('initiator_kind','customer','initiator_id',person,'principal_id',person));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),tenant,eid,executor,kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),tenant,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,tenant);
END $$;

CREATE FUNCTION customer_private.personal_profile_shape(r customer_private.personal_profile_revision) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN r.id IS NULL THEN NULL ELSE r.details||jsonb_build_object('version',r.version,'updatedAt',r.created_at) END
$$;

CREATE FUNCTION customer.personal_profile_view() RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;head customer_private.personal_profile_revision;
BEGIN
 actor:=customer_private.personal_profile_actor();
 -- Wait behind an in-flight save so a reader never sees a half-recorded revision.
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.personal_profile:'||actor::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO head FROM customer_private.personal_profile_revision WHERE principal_id=actor ORDER BY version DESC LIMIT 1;
 RETURN jsonb_build_object('currentVersion',coalesce(head.version,0),'profile',customer_private.personal_profile_shape(head),
  'provenance','SELF_REPORTED','verified',false);
END $$;

CREATE FUNCTION customer.personal_profile_command(command uuid,expected integer,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.personal_profile_command;revision customer_private.personal_profile_revision;head integer;payload jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR NOT customer_private.personal_profile_valid(input) THEN
  RAISE EXCEPTION 'Invalid personal details' USING ERRCODE='23514';
 END IF;
 actor:=customer_private.personal_profile_actor();
 payload:=jsonb_build_object('expectedVersion',expected,'details',input);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.account.lifecycle:'||actor::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.personal_profile:'||actor::text,0));
 -- Recheck after the locks: a close or an erasure filing may have committed while this waited.
 IF customer_private.personal_profile_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(version),0) INTO head FROM customer_private.personal_profile_revision WHERE principal_id=actor;
 SELECT * INTO prior FROM customer_private.personal_profile_command WHERE command_id=command;
 IF FOUND THEN
  IF prior.actor_id<>actor OR prior.request IS DISTINCT FROM payload THEN
   RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514';
  END IF;
  SELECT * INTO revision FROM customer_private.personal_profile_revision WHERE id=prior.revision_id;
  RETURN jsonb_build_object('commandId',command,'currentVersion',head,'superseded',revision.version<>head,
   'profile',customer_private.personal_profile_shape(revision));
 END IF;
 IF expected<>head THEN RAISE EXCEPTION 'Profile changed; reload before saving' USING ERRCODE='23514'; END IF;
 -- The workspace check comes before any row is written, so a person with no workspace changes nothing.
 PERFORM customer_private.personal_profile_tenant(actor);
 INSERT INTO customer_private.personal_profile_revision(principal_id,version,details) VALUES(actor,head+1,input) RETURNING * INTO revision;
 INSERT INTO customer_private.personal_profile_command(actor_id,command_id,revision_id,request) VALUES(actor,command,revision.id,payload);
 PERFORM customer_private.personal_profile_event(actor,command,'customer.personal_profile.revised','customer_personal_profile',
  jsonb_build_object('revisionId',revision.id,'version',revision.version));
 RETURN jsonb_build_object('commandId',command,'currentVersion',revision.version,'superseded',false,
  'profile',customer_private.personal_profile_shape(revision));
END $$;

CREATE FUNCTION customer.personal_profile_history(before_version integer DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;items jsonb;next_before integer;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 OR (before_version IS NOT NULL AND before_version<1) THEN
  RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514';
 END IF;
 actor:=customer_private.personal_profile_actor();
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.personal_profile:'||actor::text,0));
 WITH page AS(SELECT r.* FROM customer_private.personal_profile_revision r WHERE r.principal_id=actor
  AND (before_version IS NULL OR r.version<before_version) ORDER BY r.version DESC LIMIT page_size+1),
 visible AS(SELECT * FROM page ORDER BY version DESC LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('version',v.version,'createdAt',v.created_at,'provenance','SELF_REPORTED') ORDER BY v.version DESC) FROM visible v),'[]'::jsonb),
  CASE WHEN (SELECT count(*) FROM page)>page_size THEN (SELECT min(version) FROM visible) ELSE NULL END INTO items,next_before;
 RETURN jsonb_build_object('revisions',items,'nextBefore',next_before);
END $$;

-- Whether this person already recorded this command: the name route answers a lost response without calling the provider
-- again. It applies the same account refusals as a save.
CREATE FUNCTION customer.account_security_noted(command uuid) RETURNS boolean
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;
BEGIN
 IF command IS NULL THEN RAISE EXCEPTION 'Invalid account security change' USING ERRCODE='23514'; END IF;
 actor:=customer_private.personal_profile_actor();
 RETURN EXISTS(SELECT FROM customer_private.account_security_note n WHERE n.actor_id=actor AND n.command_id=command);
END $$;

-- Records a change the sign-in provider already made. A repeat of the same command and kind answers the first record; the
-- same command with another kind is refused. It does not refuse a closed account: the change has already happened.
CREATE FUNCTION customer.account_security_note(command uuid,kind text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();prior customer_private.account_security_note;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR kind IS NULL OR kind NOT IN ('name_changed','password_changed','session_revoked','other_sessions_revoked') THEN
  RAISE EXCEPTION 'Invalid account security change' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.account_security:'||actor::text||':'||command::text,0));
 SELECT * INTO prior FROM customer_private.account_security_note n WHERE n.actor_id=actor AND n.command_id=command;
 IF FOUND THEN
  IF prior.kind<>kind THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('commandId',command,'kind',kind,'replayed',true);
 END IF;
 INSERT INTO customer_private.account_security_note(actor_id,command_id,kind) VALUES(actor,command,kind);
 PERFORM customer_private.personal_profile_event(actor,command,'customer.account_security.changed','customer_account_security',
  jsonb_build_object('kind',kind));
 RETURN jsonb_build_object('commandId',command,'kind',kind,'replayed',false);
END $$;

-- Staff only. Replaces the title and interests of one person, named by their erasure request, with the placeholder. Safe to
-- run again with a new command: items already done are skipped. A replay of the same command answers with the first counts.
CREATE FUNCTION customer.personal_profile_remove_words(command uuid,erasure_request uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff uuid;filed customer_private.erasure_request%ROWTYPE;current_state text;stamped timestamptz;cutoff timestamptz;mark text;
BEGIN
 staff:=customer_private.staff_privacy_actor();
 IF command IS NULL OR erasure_request IS NULL THEN RAISE EXCEPTION 'Invalid personal details change' USING ERRCODE='22023'; END IF;
 SELECT * INTO filed FROM customer_private.erasure_request r WHERE r.id=erasure_request;
 IF NOT FOUND OR NOT customer_private.erasure_in_scope(filed.principal_id) THEN RAISE EXCEPTION 'Erasure request not found' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.account.lifecycle:'||filed.principal_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.personal_profile:'||filed.principal_id::text,0));
 IF EXISTS(SELECT FROM customer_private.personal_profile_erasure e WHERE e.command_id=command AND e.erasure_request_id<>erasure_request) THEN
  RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT FROM customer_private.personal_profile_erasure e WHERE e.command_id=command) THEN
  RETURN (SELECT jsonb_build_object('reference',filed.reference,'removed',count(*),
   'revisions',count(*) FILTER (WHERE e.source='revision'),'commandRecords',count(*) FILTER (WHERE e.source='command'))
   FROM customer_private.personal_profile_erasure e WHERE e.command_id=command);
 END IF;
 SELECT x.state,x.created_at INTO current_state,stamped FROM customer_private.erasure_status_event x WHERE x.request_id=erasure_request ORDER BY x.seq DESC LIMIT 1;
 IF current_state IS NULL OR current_state NOT IN ('in_progress','completed') THEN
  RAISE EXCEPTION 'Words can be removed only for an erasure request that is in progress or completed' USING ERRCODE='23514';
 END IF;
 cutoff:=CASE WHEN current_state='completed' THEN stamped ELSE transaction_timestamp() END;
 mark:=customer_private.personal_profile_placeholder();
 -- Record first, then change. The guard allows a change only for an item that already has its record row.
 INSERT INTO customer_private.personal_profile_erasure(source,row_key,principal_id,erasure_request_id,staff_principal_id,command_id)
 SELECT 'revision',r.id,filed.principal_id,erasure_request,staff,command FROM customer_private.personal_profile_revision r
 WHERE r.principal_id=filed.principal_id AND r.created_at<=cutoff AND (r.details ? 'title' OR r.details ? 'interests')
 AND NOT EXISTS(SELECT FROM customer_private.personal_profile_erasure e WHERE e.source='revision' AND e.row_key=r.id);
 INSERT INTO customer_private.personal_profile_erasure(source,row_key,principal_id,erasure_request_id,staff_principal_id,command_id)
 SELECT 'command',c.command_id,filed.principal_id,erasure_request,staff,command FROM customer_private.personal_profile_command c
 WHERE c.actor_id=filed.principal_id AND c.created_at<=cutoff AND (c.request->'details' ? 'title' OR c.request->'details' ? 'interests')
 AND NOT EXISTS(SELECT FROM customer_private.personal_profile_erasure e WHERE e.source='command' AND e.row_key=c.command_id);
 UPDATE customer_private.personal_profile_revision r SET details=r.details
  ||CASE WHEN r.details ? 'title' THEN jsonb_build_object('title',CASE WHEN jsonb_typeof(r.details->'title')='null' THEN NULL ELSE mark END) ELSE '{}'::jsonb END
  ||CASE WHEN r.details ? 'interests' THEN jsonb_build_object('interests','[]'::jsonb) ELSE '{}'::jsonb END
 WHERE EXISTS(SELECT FROM customer_private.personal_profile_erasure e WHERE e.source='revision' AND e.row_key=r.id AND e.command_id=command);
 UPDATE customer_private.personal_profile_command c SET request=jsonb_set(c.request,'{details}',(c.request->'details')
  ||CASE WHEN c.request->'details' ? 'title' THEN jsonb_build_object('title',CASE WHEN jsonb_typeof(c.request->'details'->'title')='null' THEN NULL ELSE mark END) ELSE '{}'::jsonb END
  ||CASE WHEN c.request->'details' ? 'interests' THEN jsonb_build_object('interests','[]'::jsonb) ELSE '{}'::jsonb END)
 WHERE EXISTS(SELECT FROM customer_private.personal_profile_erasure e WHERE e.source='command' AND e.row_key=c.command_id AND e.command_id=command);
 RETURN (SELECT jsonb_build_object('reference',filed.reference,'removed',count(*),
  'revisions',count(*) FILTER (WHERE e.source='revision'),'commandRecords',count(*) FILTER (WHERE e.source='command'))
  FROM customer_private.personal_profile_erasure e WHERE e.command_id=command);
END $$;

REVOKE ALL ON FUNCTION customer_private.personal_profile_placeholder(),customer_private.personal_profile_guard(),
 customer_private.personal_profile_valid(jsonb),customer_private.personal_profile_actor(),customer_private.personal_profile_tenant(uuid),
 customer_private.personal_profile_event(uuid,uuid,text,text,jsonb),customer_private.personal_profile_shape(customer_private.personal_profile_revision)
 FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.personal_profile_view(),customer.personal_profile_command(uuid,integer,jsonb),
 customer.personal_profile_history(integer,integer),customer.account_security_noted(uuid),customer.account_security_note(uuid,text),
 customer.personal_profile_remove_words(uuid,uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.personal_profile_view(),customer.personal_profile_command(uuid,integer,jsonb),
 customer.personal_profile_history(integer,integer),customer.account_security_noted(uuid),customer.account_security_note(uuid,text),
 customer.personal_profile_remove_words(uuid,uuid) TO corridra_runtime;
