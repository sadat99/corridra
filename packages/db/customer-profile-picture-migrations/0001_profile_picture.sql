-- ADR-088. The signed-in person's own profile picture, built on the personal details module (ADR-086).
-- What is stored here: references only. The picture itself lives on private object storage as two re-encoded square WebP
-- files (512 and 96 pixels, no metadata); the bytes the person uploaded are never stored. Each row names the storage backend
-- (provider and store or bucket id), the object id and the SHA-256 and size of each file, so a read can check what it serves.
-- Who can read it: only the person, through customer.profile_picture_view(). No staff read, no workspace read, no other
-- principal, nothing public. The actor always comes from the signed-in session (customer.actor_id()), never an argument.
-- Not history: a picture is current state. Replacing or removing it retires the object, and the server deletes the stored
-- files and then the object row (customer.profile_picture_purged). An object whose files could not be deleted stays listed
-- and is offered for deletion again by the person's next change.
-- Commands: one command id per decision, replayed exactly; the same command with another request is refused. The request is
-- a keyed one-way hash made by the server, never image bytes.
-- Events: one per change, ids, a version and an action only.
-- Erasure: staff only, under an erasure request in progress or completed (staff_privacy_actor, erasure_in_scope, the
-- lifecycle advisory locks). It retires every object, removes the head and every command of the person and records one row
-- without words; the staff route then deletes the stored files and the object rows.
-- Additive only: new tables and new functions. No existing function, policy, grant, trigger or row is replaced or changed.
DO $guard$ BEGIN
 IF to_regprocedure('customer.actor_id()') IS NULL
 OR to_regclass('customer_private.principal') IS NULL
 OR to_regprocedure('customer_private.staff_privacy_actor()') IS NULL
 OR to_regprocedure('customer_private.erasure_in_scope(uuid)') IS NULL
 OR to_regclass('customer_private.erasure_request') IS NULL
 OR to_regclass('customer_private.erasure_status_event') IS NULL
 THEN RAISE EXCEPTION 'Install the account lifecycle modules first (field_modules_action=lifecycle_install)'; END IF;
 IF to_regprocedure('customer_private.personal_profile_actor()') IS NULL
 OR to_regprocedure('customer_private.personal_profile_workspace_check(uuid)') IS NULL
 OR to_regprocedure('customer_private.personal_profile_event(uuid,uuid,text,text,jsonb)') IS NULL
 THEN RAISE EXCEPTION 'Install the personal profile module first (field_modules_action=personal_profile)'; END IF;
 IF to_regclass('customer_private.profile_picture_object') IS NOT NULL OR to_regprocedure('customer.profile_picture_view()') IS NOT NULL THEN
  RAISE EXCEPTION 'Profile picture is already present but not recorded';
 END IF;
END $guard$;

-- One row per stored picture. reserved: the server is writing its files; current: the picture shown; retired: replaced,
-- removed or erased, its files are to be deleted.
CREATE TABLE customer_private.profile_picture_object (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 storage_ref text NOT NULL CHECK(storage_ref ~ '^(vercel-blob|s3):[a-zA-Z0-9._-]{1,200}$'),
 state text NOT NULL CHECK(state IN ('reserved','current','retired')),
 large_sha256 text CHECK(large_sha256 ~ '^[a-f0-9]{64}$'),
 large_bytes integer CHECK(large_bytes BETWEEN 1 AND 1048576),
 small_sha256 text CHECK(small_sha256 ~ '^[a-f0-9]{64}$'),
 small_bytes integer CHECK(small_bytes BETWEEN 1 AND 1048576),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 retired_at timestamptz,
 CHECK(state='reserved' OR (large_sha256 IS NOT NULL AND large_bytes IS NOT NULL AND small_sha256 IS NOT NULL AND small_bytes IS NOT NULL)
  OR state='retired'),
 CHECK((state='retired')=(retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX profile_picture_one_current ON customer_private.profile_picture_object(principal_id) WHERE state='current';
CREATE INDEX profile_picture_object_person ON customer_private.profile_picture_object(principal_id,state);
-- The person's picture version: it grows with every change, so a stale screen is refused.
CREATE TABLE customer_private.profile_picture_head (
 principal_id uuid PRIMARY KEY REFERENCES customer_private.principal(id),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE customer_private.profile_picture_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('set','remove')),
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 object_id uuid,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX profile_picture_command_actor ON customer_private.profile_picture_command(actor_id,created_at);
-- One row for each erasure run on a person's picture. It holds no picture data.
CREATE TABLE customer_private.profile_picture_erasure (
 command_id uuid PRIMARY KEY,
 erasure_request_id uuid NOT NULL REFERENCES customer_private.erasure_request(id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 staff_principal_id uuid NOT NULL REFERENCES identity.principal(id),
 retired integer NOT NULL CHECK(retired>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER profile_picture_erasure_immutable BEFORE UPDATE OR DELETE ON customer_private.profile_picture_erasure
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.profile_picture_object ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.profile_picture_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.profile_picture_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.profile_picture_erasure ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.profile_picture_object,customer_private.profile_picture_head,
 customer_private.profile_picture_command,customer_private.profile_picture_erasure FROM PUBLIC,corridra_runtime,corridra_auth;

-- The signed-in person under the personal details refusals (disabled, closed, erasure filed: 42501), with the account and
-- picture locks taken in the same order as every other caller, and the person checked again after the locks.
CREATE FUNCTION customer_private.profile_picture_locked_actor() RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;
BEGIN
 actor:=customer_private.personal_profile_actor();
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.account.lifecycle:'||actor::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.personal_profile:'||actor::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.profile_picture:'||actor::text,0));
 IF customer_private.personal_profile_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;

-- Objects of this person whose files are to be deleted: retired ones, and reservations older than an hour (an upload that
-- never finished). A reservation younger than that may still be writing its files.
CREATE FUNCTION customer_private.profile_picture_pending(person uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'storageRef',o.storage_ref) ORDER BY o.created_at),'[]'::jsonb)
 FROM (SELECT * FROM customer_private.profile_picture_object o WHERE o.principal_id=person
  AND (o.state='retired' OR (o.state='reserved' AND o.created_at<clock_timestamp()-interval '1 hour'))
  ORDER BY o.created_at LIMIT 20) o
$$;

CREATE FUNCTION customer_private.profile_picture_shape(person uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('currentVersion',coalesce((SELECT h.version FROM customer_private.profile_picture_head h WHERE h.principal_id=person),0),
  'picture',(SELECT jsonb_build_object('id',o.id,'storageRef',o.storage_ref,'largeSha256',o.large_sha256,'largeBytes',o.large_bytes,
   'smallSha256',o.small_sha256,'smallBytes',o.small_bytes,'updatedAt',o.created_at)
   FROM customer_private.profile_picture_object o WHERE o.principal_id=person AND o.state='current'))
$$;

CREATE FUNCTION customer_private.profile_picture_bump(person uuid) RETURNS integer
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE next_version integer;
BEGIN
 INSERT INTO customer_private.profile_picture_head(principal_id,version) VALUES(person,1)
 ON CONFLICT(principal_id) DO UPDATE SET version=customer_private.profile_picture_head.version+1,updated_at=clock_timestamp()
 RETURNING version INTO next_version;
 RETURN next_version;
END $$;

CREATE FUNCTION customer_private.profile_picture_replay(actor uuid,command uuid,kind text,request text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior customer_private.profile_picture_command;
BEGIN
 SELECT * INTO prior FROM customer_private.profile_picture_command c WHERE c.command_id=command;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF prior.actor_id<>actor OR prior.kind<>kind OR prior.request_sha256<>request THEN
  RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514';
 END IF;
 RETURN customer_private.profile_picture_shape(actor)||jsonb_build_object('commandId',command,'replayed',true,
  'superseded',prior.version<>coalesce((SELECT h.version FROM customer_private.profile_picture_head h WHERE h.principal_id=actor),0),
  'pending',customer_private.profile_picture_pending(actor));
END $$;

CREATE FUNCTION customer.profile_picture_view() RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;
BEGIN
 actor:=customer_private.personal_profile_actor();
 -- Wait behind an in-flight change so a reader never sees a half-recorded picture.
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.profile_picture:'||actor::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN customer_private.profile_picture_shape(actor);
END $$;

-- Step 1 of a new picture, before any file is written: the refusals, the replay, the expected version and the workspace check.
-- It reserves an object id for the files on the named storage backend. A replay answers the first result and reserves nothing.
CREATE FUNCTION customer.profile_picture_reserve(command uuid,expected integer,request text,storage text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;replayed jsonb;head integer;object_id uuid;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR request IS NULL OR request !~ '^[a-f0-9]{64}$'
  OR storage IS NULL OR storage !~ '^(vercel-blob|s3):[a-zA-Z0-9._-]{1,200}$' THEN
  RAISE EXCEPTION 'Invalid profile picture change' USING ERRCODE='23514';
 END IF;
 actor:=customer_private.profile_picture_locked_actor();
 replayed:=customer_private.profile_picture_replay(actor,command,'set',request);
 IF replayed IS NOT NULL THEN RETURN replayed; END IF;
 SELECT coalesce((SELECT h.version FROM customer_private.profile_picture_head h WHERE h.principal_id=actor),0) INTO head;
 IF expected<>head THEN RAISE EXCEPTION 'Picture changed; reload before saving' USING ERRCODE='23514'; END IF;
 PERFORM customer_private.personal_profile_workspace_check(actor);
 -- At most three unfinished uploads at once; older ones are offered for deletion.
 IF (SELECT count(*) FROM customer_private.profile_picture_object o WHERE o.principal_id=actor AND o.state='reserved'
  AND o.created_at>=clock_timestamp()-interval '1 hour')>=3 THEN
  RAISE EXCEPTION 'Too many picture uploads at once' USING ERRCODE='54000';
 END IF;
 INSERT INTO customer_private.profile_picture_object(principal_id,storage_ref,state) VALUES(actor,storage,'reserved') RETURNING id INTO object_id;
 RETURN jsonb_build_object('commandId',command,'replayed',false,'objectId',object_id,'currentVersion',head,
  'pending',customer_private.profile_picture_pending(actor));
END $$;

-- Step 2, after both files are written: the reserved object becomes the current picture, the previous one is retired, the
-- version grows by one and one event is written. The answer lists the objects whose files the server deletes next.
CREATE FUNCTION customer.profile_picture_commit(command uuid,expected integer,request text,object uuid,
 large_sha text,large_size integer,small_sha text,small_size integer) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;replayed jsonb;head integer;target customer_private.profile_picture_object;next_version integer;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR request IS NULL OR request !~ '^[a-f0-9]{64}$'
  OR object IS NULL OR large_sha IS NULL OR large_sha !~ '^[a-f0-9]{64}$' OR small_sha IS NULL OR small_sha !~ '^[a-f0-9]{64}$'
  OR large_size IS NULL OR large_size NOT BETWEEN 1 AND 1048576 OR small_size IS NULL OR small_size NOT BETWEEN 1 AND 1048576 THEN
  RAISE EXCEPTION 'Invalid profile picture change' USING ERRCODE='23514';
 END IF;
 actor:=customer_private.profile_picture_locked_actor();
 replayed:=customer_private.profile_picture_replay(actor,command,'set',request);
 IF replayed IS NOT NULL THEN RETURN replayed; END IF;
 SELECT * INTO target FROM customer_private.profile_picture_object o WHERE o.id=object AND o.principal_id=actor AND o.state='reserved' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid profile picture change' USING ERRCODE='23514'; END IF;
 SELECT coalesce((SELECT h.version FROM customer_private.profile_picture_head h WHERE h.principal_id=actor),0) INTO head;
 IF expected<>head THEN RAISE EXCEPTION 'Picture changed; reload before saving' USING ERRCODE='23514'; END IF;
 PERFORM customer_private.personal_profile_workspace_check(actor);
 UPDATE customer_private.profile_picture_object SET state='retired',retired_at=clock_timestamp() WHERE principal_id=actor AND state='current';
 UPDATE customer_private.profile_picture_object SET state='current',large_sha256=large_sha,large_bytes=large_size,
  small_sha256=small_sha,small_bytes=small_size WHERE id=target.id;
 next_version:=customer_private.profile_picture_bump(actor);
 INSERT INTO customer_private.profile_picture_command(actor_id,command_id,kind,request_sha256,object_id,version)
 VALUES(actor,command,'set',request,target.id,next_version);
 PERFORM customer_private.personal_profile_event(actor,command,'customer.profile_picture.changed','customer_profile_picture',
  jsonb_build_object('action','set','objectId',target.id,'version',next_version));
 RETURN customer_private.profile_picture_shape(actor)||jsonb_build_object('commandId',command,'replayed',false,'superseded',false,
  'pending',customer_private.profile_picture_pending(actor));
END $$;

-- Remove the current picture. The object is retired and its files are deleted by the server next.
CREATE FUNCTION customer.profile_picture_remove(command uuid,expected integer,request text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;replayed jsonb;head integer;removed uuid;next_version integer;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR request IS NULL OR request !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Invalid profile picture change' USING ERRCODE='23514';
 END IF;
 actor:=customer_private.profile_picture_locked_actor();
 replayed:=customer_private.profile_picture_replay(actor,command,'remove',request);
 IF replayed IS NOT NULL THEN RETURN replayed; END IF;
 SELECT coalesce((SELECT h.version FROM customer_private.profile_picture_head h WHERE h.principal_id=actor),0) INTO head;
 IF expected<>head THEN RAISE EXCEPTION 'Picture changed; reload before saving' USING ERRCODE='23514'; END IF;
 PERFORM customer_private.personal_profile_workspace_check(actor);
 UPDATE customer_private.profile_picture_object SET state='retired',retired_at=clock_timestamp()
 WHERE principal_id=actor AND state='current' RETURNING id INTO removed;
 IF removed IS NULL THEN RAISE EXCEPTION 'There is no picture to remove' USING ERRCODE='23514'; END IF;
 next_version:=customer_private.profile_picture_bump(actor);
 INSERT INTO customer_private.profile_picture_command(actor_id,command_id,kind,request_sha256,object_id,version)
 VALUES(actor,command,'remove',request,removed,next_version);
 PERFORM customer_private.personal_profile_event(actor,command,'customer.profile_picture.changed','customer_profile_picture',
  jsonb_build_object('action','removed','objectId',removed,'version',next_version));
 RETURN customer_private.profile_picture_shape(actor)||jsonb_build_object('commandId',command,'replayed',false,'superseded',false,
  'pending',customer_private.profile_picture_pending(actor));
END $$;

-- After the server deleted the files of these objects: their rows go. Only this person's retired objects and reservations
-- older than an hour qualify; the current picture never does. Answers how many rows were removed. It does not refuse a
-- closed account: deleting what is left over is always allowed.
CREATE FUNCTION customer.profile_picture_purged(objects uuid[]) RETURNS integer
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();removed integer;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF objects IS NULL OR cardinality(objects)>20 THEN RAISE EXCEPTION 'Invalid profile picture change' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.profile_picture:'||actor::text,0));
 DELETE FROM customer_private.profile_picture_object o WHERE o.principal_id=actor AND o.id=ANY(objects)
  AND (o.state='retired' OR (o.state='reserved' AND o.created_at<clock_timestamp()-interval '1 hour'));
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END $$;

-- Staff only, inside the erasure queue: every object of the person named by an erasure request (in progress or completed)
-- is retired, and their picture head and commands are removed. Safe to run again: a new command finds nothing more to
-- retire, and the answer always lists the objects whose files are still to be deleted.
CREATE FUNCTION customer.profile_picture_erase(command uuid,erasure_request uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff uuid;filed customer_private.erasure_request%ROWTYPE;current_state text;retired_count integer;prior customer_private.profile_picture_erasure;
BEGIN
 staff:=customer_private.staff_privacy_actor();
 IF command IS NULL OR erasure_request IS NULL THEN RAISE EXCEPTION 'Invalid profile picture change' USING ERRCODE='22023'; END IF;
 SELECT * INTO filed FROM customer_private.erasure_request r WHERE r.id=erasure_request;
 IF NOT FOUND OR NOT customer_private.erasure_in_scope(filed.principal_id) THEN RAISE EXCEPTION 'Erasure request not found' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.account.lifecycle:'||filed.principal_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.personal_profile:'||filed.principal_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.profile_picture:'||filed.principal_id::text,0));
 SELECT * INTO prior FROM customer_private.profile_picture_erasure e WHERE e.command_id=command;
 IF FOUND AND prior.erasure_request_id<>erasure_request THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
 IF NOT FOUND THEN
  SELECT x.state INTO current_state FROM customer_private.erasure_status_event x WHERE x.request_id=erasure_request ORDER BY x.seq DESC LIMIT 1;
  IF current_state IS NULL OR current_state NOT IN ('in_progress','completed') THEN
   RAISE EXCEPTION 'Pictures can be removed only for an erasure request that is in progress or completed' USING ERRCODE='23514';
  END IF;
  UPDATE customer_private.profile_picture_object SET state='retired',retired_at=clock_timestamp()
  WHERE principal_id=filed.principal_id AND state<>'retired';
  GET DIAGNOSTICS retired_count=ROW_COUNT;
  DELETE FROM customer_private.profile_picture_command WHERE actor_id=filed.principal_id;
  DELETE FROM customer_private.profile_picture_head WHERE principal_id=filed.principal_id;
  INSERT INTO customer_private.profile_picture_erasure(command_id,erasure_request_id,principal_id,staff_principal_id,retired)
  VALUES(command,erasure_request,filed.principal_id,staff,retired_count) RETURNING * INTO prior;
 END IF;
 RETURN jsonb_build_object('reference',filed.reference,'retired',prior.retired,
  'pending',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'storageRef',o.storage_ref) ORDER BY o.created_at),'[]'::jsonb)
   FROM customer_private.profile_picture_object o WHERE o.principal_id=filed.principal_id));
END $$;

-- Staff only: after the files of these objects were deleted, their rows go. Only objects of the person named by the
-- erasure request, all of them retired by then.
CREATE FUNCTION customer.profile_picture_erase_purged(erasure_request uuid,objects uuid[]) RETURNS integer
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff uuid;filed customer_private.erasure_request%ROWTYPE;removed integer;
BEGIN
 staff:=customer_private.staff_privacy_actor();
 IF erasure_request IS NULL OR objects IS NULL OR cardinality(objects)>100 THEN RAISE EXCEPTION 'Invalid profile picture change' USING ERRCODE='22023'; END IF;
 SELECT * INTO filed FROM customer_private.erasure_request r WHERE r.id=erasure_request;
 IF NOT FOUND OR NOT customer_private.erasure_in_scope(filed.principal_id) THEN RAISE EXCEPTION 'Erasure request not found' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT FROM customer_private.profile_picture_erasure e WHERE e.erasure_request_id=erasure_request) THEN
  RAISE EXCEPTION 'Erasure request not found' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.profile_picture:'||filed.principal_id::text,0));
 DELETE FROM customer_private.profile_picture_object o WHERE o.principal_id=filed.principal_id AND o.id=ANY(objects) AND o.state='retired';
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END $$;

REVOKE ALL ON FUNCTION customer_private.profile_picture_locked_actor(),customer_private.profile_picture_pending(uuid),
 customer_private.profile_picture_shape(uuid),customer_private.profile_picture_bump(uuid),
 customer_private.profile_picture_replay(uuid,uuid,text,text) FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.profile_picture_view(),customer.profile_picture_reserve(uuid,integer,text,text),
 customer.profile_picture_commit(uuid,integer,text,uuid,text,integer,text,integer),customer.profile_picture_remove(uuid,integer,text),
 customer.profile_picture_purged(uuid[]),customer.profile_picture_erase(uuid,uuid),customer.profile_picture_erase_purged(uuid,uuid[])
 FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.profile_picture_view(),customer.profile_picture_reserve(uuid,integer,text,text),
 customer.profile_picture_commit(uuid,integer,text,uuid,text,integer,text,integer),customer.profile_picture_remove(uuid,integer,text),
 customer.profile_picture_purged(uuid[]),customer.profile_picture_erase(uuid,uuid),customer.profile_picture_erase_purged(uuid,uuid[])
 TO corridra_runtime;
