-- ADR-080. The public programme page and applications to it.
-- An organiser (a current owner or admin of the workspace that owns the programme) writes the public words of one
-- programme, previews them and publishes them at a stable address. Anyone can read the page without an account. A
-- signed-in person can apply; the organiser invites, wait-lists or declines; an invited applicant joins, which makes the
-- same registration an invitation code makes. Everything after that (terms, eligibility, places, fees, objectives)
-- is the existing programme machinery, unchanged.
-- What is public is ONLY the reviewed copy stored here. Nothing is read live from the private programme, its
-- participants, prices or missions. The page shows no person, contact, count of applicants or private record.
-- Nothing existing is replaced: six new tables and new functions, no policy and no change to a grant, a constraint
-- or a function of an older object. Rows are added to the existing invitation, registration and revocation tables by
-- the same rules the invitation code path uses.
DO $guard$ BEGIN
 IF to_regprocedure('customer_private.participant_scope(uuid,uuid,uuid,boolean)') IS NULL
 OR to_regprocedure('customer_private.participant_invitation_active(uuid)') IS NULL
 OR to_regprocedure('customer_private.workspace_access_event(uuid,uuid,uuid,text,jsonb)') IS NULL
 OR to_regprocedure('customer.actor_id()') IS NULL
 OR to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regclass('customer_private.programme_creation') IS NULL
 OR to_regclass('customer_private.programme_invitation') IS NULL
 OR to_regclass('customer_private.programme_registration') IS NULL
 OR to_regclass('customer_private.programme_participant_revocation') IS NULL THEN
  RAISE EXCEPTION 'Programme publication prerequisite is missing';
 END IF;
END $guard$;
-- The module inserts rows into three older tables. Their shape (every column with its type, NOT NULL and whether it has
-- a default, and every CHECK constraint) must be one this file was proven against; any other shape refuses the install
-- before anything is created. Lists are sorted in byte order (COLLATE "C"), so the result does not depend on the
-- database's collation. Proven shapes: the participant module alone (sample), the base modules without real use,
-- and the full install with real use. Function bodies are deliberately not fingerprinted: the real-use module
-- legitimately replaces participant_scope and lock_workspace_access.
DO $guard$
DECLARE r record;shape text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('customer_private.programme_invitation'::regclass,ARRAY['7a7024daeb51e39aa85d31b8acc27b97919027e74650906fb11b00d5557bd7a7',
   'f0c30bcd23c365a526ddfcec5eda4526e53b67eabfc75d340a119ed0a14a46e1','d3f0949c5584ec5e193182c9137e6d73a240d17346832cc9c8285b18981b4437']),
  ('customer_private.programme_registration'::regclass,ARRAY['ae94351a50b942e71074659bb3330bf33286ba6011a407385d0a3d6b61b0ab6f',
   '2b86e1837ff0522b466195211b6496d51156a9e960a001704fa26cfc5d0481e5']),
  ('customer_private.programme_participant_revocation'::regclass,ARRAY['a2c31eb71d1e40f4f947856c6a750c2ea2ea3c9ee06f2f4d821c2c3b78c8ff32'])
 ) v(tbl,known) LOOP
  SELECT (SELECT string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||a.atthasdef::text,',' ORDER BY a.attname::text COLLATE "C")
    FROM pg_attribute a WHERE a.attrelid=r.tbl AND a.attnum>0 AND NOT a.attisdropped)
   ||'|'||coalesce((SELECT string_agg(pg_get_constraintdef(c.oid),';' ORDER BY pg_get_constraintdef(c.oid) COLLATE "C")
    FROM pg_constraint c WHERE c.conrelid=r.tbl AND c.contype='c'),'') INTO shape;
  IF shape IS NULL OR NOT (encode(sha256(convert_to(shape,'UTF8')),'hex')=ANY(r.known)) THEN
   RAISE EXCEPTION 'Programme publication prerequisite differs: %',r.tbl;
  END IF;
 END LOOP;
END $guard$;

-- Limits live here and nowhere else in the database. Hours, not days: a day interval follows the session time zone.
CREATE FUNCTION customer_private.programme_publication_max_open() RETURNS interval
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT interval '4320 hours' $$;
CREATE FUNCTION customer_private.programme_publication_after_close() RETURNS interval
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT interval '720 hours' $$;
CREATE FUNCTION customer_private.programme_publication_hourly_limit() RETURNS integer
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT 20 $$;
CREATE FUNCTION customer_private.programme_application_cap() RETURNS integer
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT 2000 $$;
CREATE FUNCTION customer_private.programme_application_person_cap() RETURNS integer
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT 3 $$;
CREATE FUNCTION customer_private.programme_application_hourly_limit() RETURNS integer
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT 20 $$;
-- Times leave the database as UTC ISO text, so a screen never depends on a session time zone.
CREATE FUNCTION customer_private.programme_publication_iso(t timestamptz) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT to_char(t AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;
-- One line of public text: a string within the bounds, trimmed, with no control character.
CREATE FUNCTION customer_private.programme_publication_text(v jsonb,lo integer,hi integer) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_typeof(v)='string' AND length(v#>>'{}') BETWEEN lo AND hi AND (v#>>'{}')=btrim(v#>>'{}') AND (v#>>'{}') !~ '[[:cntrl:]]',false)
$$;
-- The whole public copy. Exactly these fields and nothing else can ever be published. A planned visit or meeting is
-- PLANNED unless the organiser states it is CONFIRMED; the page shows that word beside it. In a sample (synthetic)
-- workspace the title and the organiser name carry the 'Synthetic ' mark, as every sample label does.
CREATE FUNCTION customer_private.programme_publication_copy_valid(copy jsonb,sample boolean) RETURNS boolean
 LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item jsonb;
BEGIN
 IF copy IS NULL OR jsonb_typeof(copy)<>'object' OR octet_length(copy::text)>16384
 OR NOT copy ?& ARRAY['title','organiser','summary','destination','dates','focus','audience','eligibility','activities','included','excluded']
 OR copy-ARRAY['title','organiser','summary','destination','dates','focus','audience','eligibility','activities','included','excluded','fee','capacity']<>'{}'::jsonb THEN
  RETURN false;
 END IF;
 IF NOT customer_private.programme_publication_text(copy->'title',CASE WHEN sample THEN 11 ELSE 3 END,160)
 OR NOT customer_private.programme_publication_text(copy->'organiser',CASE WHEN sample THEN 11 ELSE 2 END,160)
 OR NOT customer_private.programme_publication_text(copy->'summary',10,1200)
 OR NOT customer_private.programme_publication_text(copy->'destination',2,160)
 OR NOT customer_private.programme_publication_text(copy->'dates',2,160)
 OR NOT customer_private.programme_publication_text(copy->'focus',2,300)
 OR NOT customer_private.programme_publication_text(copy->'audience',10,600)
 OR NOT customer_private.programme_publication_text(copy->'eligibility',10,600)
 OR (copy ? 'fee' AND NOT customer_private.programme_publication_text(copy->'fee',2,300))
 OR (copy ? 'capacity' AND (jsonb_typeof(copy->'capacity')<>'number' OR (copy->>'capacity') !~ '^[0-9]{1,4}$' OR (copy->>'capacity')::integer NOT BETWEEN 1 AND 1000))
 OR jsonb_typeof(copy->'activities')<>'array' OR jsonb_array_length(copy->'activities')>12
 OR jsonb_typeof(copy->'included')<>'array' OR jsonb_array_length(copy->'included')>8
 OR jsonb_typeof(copy->'excluded')<>'array' OR jsonb_array_length(copy->'excluded')>8 THEN
  RETURN false;
 END IF;
 IF sample AND ((copy->>'title') NOT LIKE 'Synthetic %' OR (copy->>'organiser') NOT LIKE 'Synthetic %') THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(copy->'activities') LOOP
  IF jsonb_typeof(item)<>'object' OR item-ARRAY['label','status']<>'{}'::jsonb OR NOT item ?& ARRAY['label','status']
  OR NOT customer_private.programme_publication_text(item->'label',3,160)
  OR item->>'status' IS NULL OR item->>'status' NOT IN ('PLANNED','CONFIRMED') THEN RETURN false; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(copy->'included') UNION ALL SELECT value FROM jsonb_array_elements(copy->'excluded') LOOP
  IF NOT customer_private.programme_publication_text(item,2,160) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

-- The stable public address of one programme. Made once, at the first publication, and never changed or reused:
-- a readable part and ten random characters, so an address cannot be guessed from a programme name.
CREATE TABLE customer_private.programme_public_address (
 programme_id uuid PRIMARY KEY REFERENCES customer_private.programme_creation(programme_id),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 slug text NOT NULL UNIQUE CHECK(length(slug) BETWEEN 12 AND 80 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*-[a-z0-9]{10}$'),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
-- One published version of the public copy. A change is a new version; the page always shows the latest one.
CREATE TABLE customer_private.programme_publication (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 programme_id uuid NOT NULL REFERENCES customer_private.programme_public_address(programme_id),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 version integer NOT NULL CHECK(version>=1),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL,
 copy jsonb NOT NULL CHECK(jsonb_typeof(copy)='object' AND octet_length(copy::text)<=16384),
 closes_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(programme_id,version),UNIQUE(principal_id,command_id),
 CHECK(closes_at>created_at AND closes_at<=created_at+interval '4320 hours')
);
-- Taking the page down. It withdraws the version named; publishing again makes a new version at the same address.
CREATE TABLE customer_private.programme_publication_withdrawal (
 publication_id uuid PRIMARY KEY REFERENCES customer_private.programme_publication(id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(principal_id,command_id)
);
-- An application: who applied (their account), the name they want shown to the organiser and what they want from the
-- programme, in their own words. Self-declared; nothing here is verified. It names the version of the page they read.
CREATE TABLE customer_private.programme_application (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 publication_id uuid NOT NULL REFERENCES customer_private.programme_publication(id),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 programme_id uuid NOT NULL REFERENCES customer_private.programme_public_address(programme_id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL,
 display_label text NOT NULL CHECK(length(display_label) BETWEEN 2 AND 120 AND display_label=btrim(display_label) AND display_label !~ '[[:cntrl:]]'),
 statement text NOT NULL CHECK(length(statement) BETWEEN 10 AND 1000 AND statement=btrim(statement) AND statement !~ '[[:cntrl:]]'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(principal_id,command_id)
);
CREATE INDEX programme_application_page ON customer_private.programme_application(workspace_id,programme_id,id);
CREATE INDEX programme_application_own ON customer_private.programme_application(principal_id,id);
-- The organiser's decisions on one application, in order. INVITED carries the invitation it issued. A decline always
-- carries the words the applicant will read.
CREATE TABLE customer_private.programme_application_decision (
 application_id uuid NOT NULL REFERENCES customer_private.programme_application(id),
 version integer NOT NULL CHECK(version>=1),
 decision text NOT NULL CHECK(decision IN ('INVITED','WAITLISTED','DECLINED')),
 note text CHECK(note IS NULL OR (length(note) BETWEEN 10 AND 500 AND note=btrim(note) AND note !~ '[[:cntrl:]]')),
 invitation_id uuid UNIQUE REFERENCES customer_private.programme_invitation(id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(application_id,version),UNIQUE(principal_id,command_id),
 CHECK((decision='INVITED')=(invitation_id IS NOT NULL)),CHECK(decision<>'DECLINED' OR note IS NOT NULL)
);
-- The applicant taking their own application back.
CREATE TABLE customer_private.programme_application_withdrawal (
 application_id uuid PRIMARY KEY REFERENCES customer_private.programme_application(id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(principal_id,command_id)
);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['programme_public_address','programme_publication','programme_publication_withdrawal','programme_application','programme_application_decision','programme_application_withdrawal'] LOOP
  EXECUTE format('ALTER TABLE customer_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON customer_private.%I FROM PUBLIC,corridra_runtime,corridra_auth',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON customer_private.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',t);
 END LOOP;
END $$;

-- Whether the programme or its workspace is archived. The lifecycle modules own those facts; where one is not
-- installed nothing of that kind has been archived, so it answers false. The statements are fixed text.
CREATE FUNCTION customer_private.programme_publication_paused(target uuid,programme uuid) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE paused boolean:=false;
BEGIN
 IF to_regprocedure('customer_private.workspace_archived(uuid)') IS NOT NULL THEN
  EXECUTE 'SELECT customer_private.workspace_archived($1)' INTO paused USING target;
  IF coalesce(paused,false) THEN RETURN true; END IF;
 END IF;
 IF to_regclass('customer_private.programme_current') IS NOT NULL THEN
  EXECUTE 'SELECT EXISTS(SELECT FROM customer_private.programme_current c WHERE c.id=$1 AND c.tenant_id=$2 AND c.archived)' INTO paused USING programme,target;
 END IF;
 RETURN coalesce(paused,false);
END $$;
CREATE FUNCTION customer_private.programme_publication_latest(programme uuid) RETURNS customer_private.programme_publication
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p FROM customer_private.programme_publication p WHERE p.programme_id=programme ORDER BY p.version DESC LIMIT 1
$$;
-- NONE: never published. WITHDRAWN: taken down. PAUSED: the programme or workspace is archived. OPEN: taking
-- applications. CLOSED: still readable, no longer taking applications. ENDED: closed long enough that the page is gone.
CREATE FUNCTION customer_private.programme_publication_state(p customer_private.programme_publication) RETURNS text
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p.id IS NULL THEN RETURN 'NONE'; END IF;
 IF EXISTS(SELECT FROM customer_private.programme_publication_withdrawal w WHERE w.publication_id=p.id) THEN RETURN 'WITHDRAWN'; END IF;
 IF customer_private.programme_publication_paused(p.workspace_id,p.programme_id) THEN RETURN 'PAUSED'; END IF;
 IF p.closes_at+customer_private.programme_publication_after_close()<=clock_timestamp() THEN RETURN 'ENDED'; END IF;
 IF p.closes_at<=clock_timestamp() THEN RETURN 'CLOSED'; END IF;
 RETURN 'OPEN';
END $$;

-- One application as the applicant and the organiser both see it. The status is live:
--   SUBMITTED            waiting for the organiser
--   WAITLISTED, DECLINED the organiser's latest decision
--   INVITED              invited, the invitation can still be used
--   INVITATION_EXPIRED   invited, the invitation lapsed or was revoked before it was used
--   JOINED               registered in the programme (the registration id is given)
--   REGISTRATION_ENDED   joined and later withdrew or was removed
--   WITHDRAWN            the applicant took the application back
CREATE FUNCTION customer_private.programme_application_summary(a customer_private.programme_application) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d customer_private.programme_application_decision;r customer_private.programme_registration;i customer_private.programme_invitation;live text;
BEGIN
 SELECT * INTO d FROM customer_private.programme_application_decision WHERE application_id=a.id ORDER BY version DESC LIMIT 1;
 IF d.invitation_id IS NOT NULL THEN
  SELECT * INTO r FROM customer_private.programme_registration WHERE invitation_id=d.invitation_id;
  SELECT * INTO i FROM customer_private.programme_invitation WHERE id=d.invitation_id;
 END IF;
 live:=CASE
  WHEN r.id IS NOT NULL AND EXISTS(SELECT FROM customer_private.programme_participant_revocation v WHERE v.registration_id=r.id) THEN 'REGISTRATION_ENDED'
  WHEN r.id IS NOT NULL THEN 'JOINED'
  WHEN EXISTS(SELECT FROM customer_private.programme_application_withdrawal w WHERE w.application_id=a.id) THEN 'WITHDRAWN'
  WHEN d.application_id IS NULL THEN 'SUBMITTED'
  WHEN d.decision='INVITED' AND customer_private.participant_invitation_active(d.invitation_id) THEN 'INVITED'
  WHEN d.decision='INVITED' THEN 'INVITATION_EXPIRED'
  ELSE d.decision END;
 RETURN jsonb_strip_nulls(jsonb_build_object('id',a.id,'programmeId',a.programme_id,'status',live,'displayLabel',a.display_label,'statement',a.statement,
  'appliedAt',customer_private.programme_publication_iso(a.created_at),'decisionVersion',coalesce(d.version,0),'note',d.note,
  'decidedAt',customer_private.programme_publication_iso(d.created_at),
  'invitationExpiresAt',CASE WHEN live='INVITED' THEN customer_private.programme_publication_iso(i.expires_at) END,
  'registrationId',CASE WHEN live='JOINED' THEN r.id END));
END $$;

-- The organiser's view of the page: the latest version as stored, its state and how many applications wait.
CREATE FUNCTION customer.programme_publication_view(target uuid,programme uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);p customer_private.programme_publication;result jsonb;
BEGIN
 p:=customer_private.programme_publication_latest(programme);
 result:=jsonb_build_object('programmeId',programme,'workspaceId',target,'version',coalesce(p.version,0),
  'state',customer_private.programme_publication_state(p),
  'address',(SELECT slug FROM customer_private.programme_public_address WHERE programme_id=programme AND workspace_id=target),
  'copy',p.copy,'closesAt',customer_private.programme_publication_iso(p.closes_at),'publishedAt',customer_private.programme_publication_iso(p.created_at),
  'applications',(SELECT count(*) FROM customer_private.programme_application a WHERE a.workspace_id=target AND a.programme_id=programme),
  'awaiting',(SELECT count(*) FROM customer_private.programme_application a WHERE a.workspace_id=target AND a.programme_id=programme
   AND customer_private.programme_application_summary(a)->>'status'='SUBMITTED'),
  'maxOpenHours',4320,'sample',(SELECT synthetic FROM app.tenant WHERE id=target));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_strip_nulls(result);
END $$;

-- Publishes a version. Distinct refusals, so the screen can tell them apart (all 409 except the last, never access loss):
--   23514 PROGRAMME_PUBLICATION_CHANGED        another version was published meanwhile, or a reused command differs
--   23514 PROGRAMME_PUBLICATION_ADDRESS_TAKEN  the proposed address is in use (the caller proposes another)
--   23514 PROGRAMME_PUBLICATION_PAUSED         the programme or its workspace is archived
--   54000 PROGRAMME_PUBLICATION_RATE_LIMITED   twenty versions of this page in the last hour
-- address_proposal is used only for the first version; later versions keep the address the programme already has.
CREATE FUNCTION customer.publish_programme(command uuid,target uuid,programme uuid,expected integer,address_proposal text,copy jsonb,closes timestamptz) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.participant_scope(command,target,programme,true);prior customer_private.programme_publication;
 latest customer_private.programme_publication;made customer_private.programme_publication;address text;created timestamptz:=clock_timestamp();
BEGIN
 IF expected IS NULL OR expected<0 OR closes IS NULL
 OR NOT customer_private.programme_publication_copy_valid(copy,(SELECT synthetic FROM app.tenant WHERE id=target)) THEN
  RAISE EXCEPTION 'Invalid programme page' USING ERRCODE='23514';
 END IF;
 SELECT * INTO prior FROM customer_private.programme_publication WHERE principal_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.programme_id<>programme OR prior.copy<>copy OR prior.closes_at<>closes OR prior.version<>expected+1 THEN
   RAISE EXCEPTION 'PROGRAMME_PUBLICATION_CHANGED' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('programmeId',programme,'version',prior.version,'state',customer_private.programme_publication_state(prior),
   'address',(SELECT slug FROM customer_private.programme_public_address WHERE programme_id=programme),'closesAt',customer_private.programme_publication_iso(prior.closes_at));
 END IF;
 IF closes<=created+interval '1 hour' OR closes>created+customer_private.programme_publication_max_open() THEN
  RAISE EXCEPTION 'Invalid programme page' USING ERRCODE='23514';
 END IF;
 IF customer_private.programme_publication_paused(target,programme) THEN RAISE EXCEPTION 'PROGRAMME_PUBLICATION_PAUSED' USING ERRCODE='23514'; END IF;
 latest:=customer_private.programme_publication_latest(programme);
 IF coalesce(latest.version,0)<>expected THEN RAISE EXCEPTION 'PROGRAMME_PUBLICATION_CHANGED' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM customer_private.programme_publication p WHERE p.programme_id=programme AND p.created_at>created-interval '1 hour')>=customer_private.programme_publication_hourly_limit() THEN
  RAISE EXCEPTION 'PROGRAMME_PUBLICATION_RATE_LIMITED' USING ERRCODE='54000';
 END IF;
 SELECT slug INTO address FROM customer_private.programme_public_address WHERE programme_id=programme AND workspace_id=target;
 IF address IS NULL THEN
  IF address_proposal IS NULL OR length(address_proposal) NOT BETWEEN 12 AND 80 OR address_proposal !~ '^[a-z0-9]+(-[a-z0-9]+)*-[a-z0-9]{10}$' THEN
   RAISE EXCEPTION 'Invalid programme page' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT FROM customer_private.programme_public_address WHERE slug=address_proposal) THEN
   RAISE EXCEPTION 'PROGRAMME_PUBLICATION_ADDRESS_TAKEN' USING ERRCODE='23514';
  END IF;
  INSERT INTO customer_private.programme_public_address(programme_id,workspace_id,slug,created_by,created_at) VALUES(programme,target,address_proposal,actor,created);
  address:=address_proposal;
 END IF;
 INSERT INTO customer_private.programme_publication(programme_id,workspace_id,version,principal_id,command_id,copy,closes_at,created_at)
 VALUES(programme,target,expected+1,actor,command,copy,closes,created) RETURNING * INTO made;
 -- The event names the programme, the version and the closing time. No public words.
 PERFORM customer_private.workspace_access_event(target,actor,command,'customer.programme_publication.published',
  jsonb_build_object('programme_id',programme,'publication_id',made.id,'version',made.version,'closesAt',customer_private.programme_publication_iso(closes)));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('programmeId',programme,'version',made.version,'state','OPEN','address',address,'closesAt',customer_private.programme_publication_iso(closes));
END $$;

-- Takes the page down. Any current owner or admin of the workspace may do it; idempotent on the version.
CREATE FUNCTION customer.withdraw_programme_publication(command uuid,target uuid,programme uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.participant_scope(command,target,programme,true);latest customer_private.programme_publication;prior customer_private.programme_publication_withdrawal;
BEGIN
 latest:=customer_private.programme_publication_latest(programme);
 IF latest.id IS NULL OR latest.workspace_id<>target THEN RAISE EXCEPTION 'Programme page unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM customer_private.programme_publication_withdrawal WHERE principal_id=actor AND command_id=command;
 IF FOUND AND prior.publication_id<>latest.id THEN RAISE EXCEPTION 'PROGRAMME_PUBLICATION_CHANGED' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT FROM customer_private.programme_publication_withdrawal WHERE publication_id=latest.id) THEN
  INSERT INTO customer_private.programme_publication_withdrawal(publication_id,principal_id,command_id) VALUES(latest.id,actor,command);
  PERFORM customer_private.workspace_access_event(target,actor,command,'customer.programme_publication.withdrawn',
   jsonb_build_object('programme_id',programme,'publication_id',latest.id,'version',latest.version));
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('programmeId',programme,'version',latest.version,'state','WITHDRAWN');
END $$;

-- Real use is an optional module and the owner's control. The page of a real (not sample) workspace is public only
-- while real use is on: with it off no organiser can sign in to take the page down, so the page must not stay public.
CREATE FUNCTION customer_private.programme_publication_real_use() RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live boolean:=false;
BEGIN
 IF to_regclass('customer_private.real_use_configuration') IS NULL THEN RETURN false; END IF;
 EXECUTE 'SELECT EXISTS(SELECT FROM customer_private.real_use_configuration WHERE enabled)' INTO live;
 RETURN coalesce(live,false);
END $$;
-- The anonymous read. Malformed, unknown, never published, withdrawn, archived and long-closed addresses, and a real
-- workspace's page while real use is off, all answer the same single value. It writes nothing and records nothing
-- about the visitor.
CREATE FUNCTION app.read_programme_publication(address text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a customer_private.programme_public_address;p customer_private.programme_publication;live text;
BEGIN
 IF address IS NULL OR length(address) NOT BETWEEN 12 AND 80 OR address !~ '^[a-z0-9]+(-[a-z0-9]+)*-[a-z0-9]{10}$' THEN RETURN jsonb_build_object('state','unknown'); END IF;
 SELECT * INTO a FROM customer_private.programme_public_address WHERE slug=address;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','unknown'); END IF;
 IF NOT coalesce((SELECT synthetic FROM app.tenant WHERE id=a.workspace_id),false) AND NOT customer_private.programme_publication_real_use() THEN
  RETURN jsonb_build_object('state','unknown');
 END IF;
 p:=customer_private.programme_publication_latest(a.programme_id);
 live:=customer_private.programme_publication_state(p);
 IF live NOT IN ('OPEN','CLOSED') THEN RETURN jsonb_build_object('state','unknown'); END IF;
 RETURN jsonb_build_object('state',live,'programme',p.copy,'address',a.slug,'version',p.version,
  'closesAt',customer_private.programme_publication_iso(p.closes_at),'publishedAt',customer_private.programme_publication_iso(p.created_at),
  'sample',coalesce((SELECT synthetic FROM app.tenant WHERE id=a.workspace_id),true));
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('state','unknown');
END $$;

-- apply, withdraw and join are the applicant's; decide is the organiser's. Refusals the screens tell apart:
--   23514 PROGRAMME_PUBLICATION_CHANGED          the page changed since the applicant read it (they read it again)
--   23514 PROGRAMME_APPLICATIONS_CLOSED          the page is not taking applications
--   23514 PROGRAMME_ALREADY_REGISTERED           the person already has a registration in this programme
--   23514 PROGRAMME_APPLICATION_CHANGED          another decision was recorded meanwhile, or a reused command differs
--   23514 PROGRAMME_APPLICATION_WITHDRAWN        the applicant took it back
--   23514 PROGRAMME_APPLICATION_JOINED           the applicant already joined (use the registration instead)
--   23514 PROGRAMME_APPLICATION_ALREADY_INVITED  a usable invitation already exists
--   23514 PROGRAMME_APPLICATION_NOT_INVITED      join without an invitation
--   23514 PROGRAMME_INVITATION_EXPIRED           the invitation lapsed (the organiser can invite again)
--   23514 PROGRAMME_PUBLICATION_PAUSED           the programme or its workspace is archived
--   53400 PROGRAMME_APPLICATION_LIMIT            the per-person or per-programme cap is reached
--   54000 PROGRAMME_APPLICATION_RATE_LIMITED     twenty applications by this person in the last hour
-- Access loss is 42501. An invitation issued here has a secret nobody holds: it can only be used by this applicant
-- through join, never as a code.
CREATE FUNCTION customer.programme_application_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;a customer_private.programme_public_address;p customer_private.programme_publication;
 ap customer_private.programme_application;other customer_private.programme_application;d customer_private.programme_application_decision;
 prior_d customer_private.programme_application_decision;prior_w customer_private.programme_application_withdrawal;
 r customer_private.programme_registration;target uuid;programme uuid;sample boolean;invited uuid;made timestamptz:=clock_timestamp();
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' OR operation IS NULL OR operation NOT IN ('apply','withdraw','decide','join') THEN
  RAISE EXCEPTION 'Invalid programme application' USING ERRCODE='23514';
 END IF;
 IF operation='apply' THEN
  IF input-ARRAY['address','version','displayLabel','statement','consented']<>'{}'::jsonb OR input->'consented' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(input->'address') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'version') IS DISTINCT FROM 'number' OR (input->>'version') !~ '^[0-9]{1,6}$'
  OR NOT customer_private.programme_publication_text(input->'displayLabel',2,120) OR NOT customer_private.programme_publication_text(input->'statement',10,1000) THEN
   RAISE EXCEPTION 'Invalid programme application' USING ERRCODE='23514';
  END IF;
  SELECT * INTO a FROM customer_private.programme_public_address WHERE slug=input->>'address';
  IF NOT FOUND THEN RAISE EXCEPTION 'Programme page unavailable' USING ERRCODE='42501'; END IF;
  target:=a.workspace_id;programme:=a.programme_id;
 ELSIF operation='decide' THEN
  IF input-ARRAY['workspaceId','programmeId','applicationId','expectedVersion','decision','note','acknowledged']<>'{}'::jsonb OR input->'acknowledged' IS DISTINCT FROM 'true'::jsonb
  OR input->>'decision' IS NULL OR input->>'decision' NOT IN ('INVITED','WAITLISTED','DECLINED')
  OR jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR (input->>'expectedVersion') !~ '^[0-9]{1,6}$'
  OR (input ? 'note' AND NOT customer_private.programme_publication_text(input->'note',10,500))
  OR (input->>'decision'='DECLINED' AND NOT input ? 'note') THEN
   RAISE EXCEPTION 'Invalid programme application' USING ERRCODE='23514';
  END IF;
  target:=(input->>'workspaceId')::uuid;programme:=(input->>'programmeId')::uuid;
 ELSE
  IF (operation='withdraw' AND (input-ARRAY['applicationId','acknowledged']<>'{}'::jsonb OR input->'acknowledged' IS DISTINCT FROM 'true'::jsonb))
  OR (operation='join' AND (input-ARRAY['applicationId','consented']<>'{}'::jsonb OR input->'consented' IS DISTINCT FROM 'true'::jsonb)) THEN
   RAISE EXCEPTION 'Invalid programme application' USING ERRCODE='23514';
  END IF;
  SELECT * INTO ap FROM customer_private.programme_application WHERE id=(input->>'applicationId')::uuid AND principal_id=customer.actor_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Application unavailable' USING ERRCODE='42501'; END IF;
  target:=ap.workspace_id;programme:=ap.programme_id;
 END IF;
 -- Takes the command lock and the access lock of the workspace, so every writer of one programme is serial.
 actor:=customer_private.participant_scope(command,target,programme,operation='decide');
 sample:=coalesce((SELECT synthetic FROM app.tenant WHERE id=target),true);

 IF operation='apply' THEN
  IF sample AND ((input->>'displayLabel') NOT LIKE 'Synthetic %' OR length(input->>'displayLabel')<11 OR (input->>'statement') NOT LIKE 'Synthetic %') THEN
   RAISE EXCEPTION 'Invalid programme application' USING ERRCODE='23514';
  END IF;
  SELECT * INTO ap FROM customer_private.programme_application q WHERE q.principal_id=actor AND q.command_id=command;
  IF FOUND THEN
   IF ap.programme_id<>programme OR ap.display_label<>input->>'displayLabel' OR ap.statement<>input->>'statement' THEN
    RAISE EXCEPTION 'PROGRAMME_APPLICATION_CHANGED' USING ERRCODE='23514';
   END IF;
   RETURN customer_private.programme_application_summary(ap)||jsonb_build_object('address',a.slug);
  END IF;
  p:=customer_private.programme_publication_latest(programme);
  IF customer_private.programme_publication_state(p)<>'OPEN' THEN RAISE EXCEPTION 'PROGRAMME_APPLICATIONS_CLOSED' USING ERRCODE='23514'; END IF;
  IF p.version<>(input->>'version')::integer THEN RAISE EXCEPTION 'PROGRAMME_PUBLICATION_CHANGED' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT FROM customer_private.programme_registration g WHERE g.programme_id=programme AND g.principal_id=actor) THEN
   RAISE EXCEPTION 'PROGRAMME_ALREADY_REGISTERED' USING ERRCODE='23514';
  END IF;
  -- A second tab or a second try while one application is still live answers with that application.
  FOR other IN SELECT * FROM customer_private.programme_application q WHERE q.programme_id=programme AND q.principal_id=actor ORDER BY q.created_at DESC LOOP
   IF customer_private.programme_application_summary(other)->>'status' IN ('SUBMITTED','WAITLISTED','INVITED','INVITATION_EXPIRED') THEN
    RETURN customer_private.programme_application_summary(other)||jsonb_build_object('address',a.slug,'existing',true);
   END IF;
  END LOOP;
  IF (SELECT count(*) FROM customer_private.programme_application q WHERE q.programme_id=programme AND q.principal_id=actor)>=customer_private.programme_application_person_cap()
  OR (SELECT count(*) FROM customer_private.programme_application q WHERE q.programme_id=programme)>=customer_private.programme_application_cap() THEN
   RAISE EXCEPTION 'PROGRAMME_APPLICATION_LIMIT' USING ERRCODE='53400';
  END IF;
  IF (SELECT count(*) FROM customer_private.programme_application q WHERE q.principal_id=actor AND q.created_at>made-interval '1 hour')>=customer_private.programme_application_hourly_limit() THEN
   RAISE EXCEPTION 'PROGRAMME_APPLICATION_RATE_LIMITED' USING ERRCODE='54000';
  END IF;
  INSERT INTO customer_private.programme_application(publication_id,workspace_id,programme_id,principal_id,command_id,display_label,statement,created_at)
  VALUES(p.id,target,programme,actor,command,input->>'displayLabel',input->>'statement',made) RETURNING * INTO ap;
  -- The event names the programme and the application. No name and no statement.
  PERFORM customer_private.workspace_access_event(target,actor,command,'customer.programme_application.submitted',
   jsonb_build_object('programme_id',programme,'application_id',ap.id));
  IF customer.actor_id() IS DISTINCT FROM actor OR customer_private.programme_publication_state(customer_private.programme_publication_latest(programme))<>'OPEN' THEN
   RAISE EXCEPTION 'Programme page unavailable' USING ERRCODE='42501';
  END IF;
  RETURN customer_private.programme_application_summary(ap)||jsonb_build_object('address',a.slug);
 END IF;

 IF operation='decide' THEN
  SELECT * INTO ap FROM customer_private.programme_application q WHERE q.id=(input->>'applicationId')::uuid AND q.workspace_id=target AND q.programme_id=programme;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO prior_d FROM customer_private.programme_application_decision q WHERE q.principal_id=actor AND q.command_id=command;
  IF FOUND THEN
   IF prior_d.application_id<>ap.id OR prior_d.decision<>input->>'decision' OR prior_d.note IS DISTINCT FROM input->>'note' OR prior_d.version<>(input->>'expectedVersion')::integer+1 THEN
    RAISE EXCEPTION 'PROGRAMME_APPLICATION_CHANGED' USING ERRCODE='23514';
   END IF;
   RETURN customer_private.programme_application_summary(ap);
  END IF;
  IF EXISTS(SELECT FROM customer_private.programme_application_withdrawal w WHERE w.application_id=ap.id) THEN
   RAISE EXCEPTION 'PROGRAMME_APPLICATION_WITHDRAWN' USING ERRCODE='23514';
  END IF;
  SELECT * INTO d FROM customer_private.programme_application_decision q WHERE q.application_id=ap.id ORDER BY q.version DESC LIMIT 1;
  IF coalesce(d.version,0)<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'PROGRAMME_APPLICATION_CHANGED' USING ERRCODE='23514'; END IF;
  IF d.invitation_id IS NOT NULL THEN
   IF EXISTS(SELECT FROM customer_private.programme_registration g WHERE g.invitation_id=d.invitation_id) THEN
    RAISE EXCEPTION 'PROGRAMME_APPLICATION_JOINED' USING ERRCODE='23514';
   END IF;
   IF customer_private.participant_invitation_active(d.invitation_id) THEN
    IF input->>'decision'='INVITED' THEN RAISE EXCEPTION 'PROGRAMME_APPLICATION_ALREADY_INVITED' USING ERRCODE='23514'; END IF;
    -- A new decision replaces a usable invitation: it is revoked in the same transaction, by the rule the organiser's own revoke uses.
    INSERT INTO customer_private.programme_participant_revocation(workspace_id,programme_id,invitation_id,registration_id,created_by,reason,withdrawn)
    VALUES(target,programme,d.invitation_id,NULL,actor,coalesce(input->>'note','The organiser recorded a new decision on this application'),false);
   END IF;
  END IF;
  IF input->>'decision'='INVITED' THEN
   IF customer_private.programme_publication_paused(target,programme) THEN RAISE EXCEPTION 'PROGRAMME_PUBLICATION_PAUSED' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT FROM customer_private.programme_registration g WHERE g.programme_id=programme AND g.principal_id=ap.principal_id) THEN
    RAISE EXCEPTION 'PROGRAMME_ALREADY_REGISTERED' USING ERRCODE='23514';
   END IF;
   IF (SELECT count(*) FROM customer_private.programme_invitation i WHERE i.programme_id=programme)>=1000 THEN
    RAISE EXCEPTION 'Programme invitation limit reached' USING ERRCODE='23514';
   END IF;
   INSERT INTO customer_private.programme_invitation(workspace_id,programme_id,created_by,label,token_hash,expires_at)
   VALUES(target,programme,actor,ap.display_label,encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text||command::text,'UTF8')),'hex'),
    clock_timestamp()+interval '7 days'-interval '1 second') RETURNING id INTO invited;
  END IF;
  INSERT INTO customer_private.programme_application_decision(application_id,version,decision,note,invitation_id,principal_id,command_id)
  VALUES(ap.id,coalesce(d.version,0)+1,input->>'decision',input->>'note',invited,actor,command);
  PERFORM customer_private.workspace_access_event(target,actor,command,'customer.programme_application.decided',
   jsonb_build_object('programme_id',programme,'application_id',ap.id,'decision',input->>'decision','version',coalesce(d.version,0)+1));
  IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
  RETURN customer_private.programme_application_summary(ap);
 END IF;

 SELECT * INTO d FROM customer_private.programme_application_decision q WHERE q.application_id=ap.id ORDER BY q.version DESC LIMIT 1;
 IF d.invitation_id IS NOT NULL THEN SELECT * INTO r FROM customer_private.programme_registration g WHERE g.invitation_id=d.invitation_id; END IF;

 IF operation='withdraw' THEN
  SELECT * INTO prior_w FROM customer_private.programme_application_withdrawal q WHERE q.principal_id=actor AND q.command_id=command;
  IF FOUND AND prior_w.application_id<>ap.id THEN RAISE EXCEPTION 'PROGRAMME_APPLICATION_CHANGED' USING ERRCODE='23514'; END IF;
  IF r.id IS NOT NULL THEN RAISE EXCEPTION 'PROGRAMME_APPLICATION_JOINED' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT FROM customer_private.programme_application_withdrawal w WHERE w.application_id=ap.id) THEN
   INSERT INTO customer_private.programme_application_withdrawal(application_id,principal_id,command_id) VALUES(ap.id,actor,command);
   IF d.invitation_id IS NOT NULL AND customer_private.participant_invitation_active(d.invitation_id) THEN
    INSERT INTO customer_private.programme_participant_revocation(workspace_id,programme_id,invitation_id,registration_id,created_by,reason,withdrawn)
    VALUES(target,programme,d.invitation_id,NULL,actor,'The applicant withdrew the application',false);
   END IF;
   PERFORM customer_private.workspace_access_event(target,actor,command,'customer.programme_application.withdrawn',
    jsonb_build_object('programme_id',programme,'application_id',ap.id));
  END IF;
  IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
  RETURN customer_private.programme_application_summary(ap);
 END IF;

 -- join: the applicant's explicit consent turns the invitation into the registration, exactly once.
 IF r.id IS NOT NULL THEN
  IF r.principal_id<>actor OR EXISTS(SELECT FROM customer_private.programme_participant_revocation v WHERE v.registration_id=r.id) THEN
   RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501';
  END IF;
  RETURN customer_private.programme_application_summary(ap);
 END IF;
 IF EXISTS(SELECT FROM customer_private.programme_application_withdrawal w WHERE w.application_id=ap.id) THEN
  RAISE EXCEPTION 'PROGRAMME_APPLICATION_WITHDRAWN' USING ERRCODE='23514';
 END IF;
 IF d.decision IS DISTINCT FROM 'INVITED' THEN RAISE EXCEPTION 'PROGRAMME_APPLICATION_NOT_INVITED' USING ERRCODE='23514'; END IF;
 IF NOT customer_private.participant_invitation_active(d.invitation_id) THEN RAISE EXCEPTION 'PROGRAMME_INVITATION_EXPIRED' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT FROM customer_private.programme_registration g WHERE g.programme_id=programme AND g.principal_id=actor) THEN
  RAISE EXCEPTION 'PROGRAMME_ALREADY_REGISTERED' USING ERRCODE='23514';
 END IF;
 IF customer_private.programme_publication_paused(target,programme) THEN RAISE EXCEPTION 'PROGRAMME_PUBLICATION_PAUSED' USING ERRCODE='23514'; END IF;
 INSERT INTO customer_private.programme_registration(workspace_id,programme_id,invitation_id,principal_id,display_label)
 VALUES(target,programme,d.invitation_id,actor,ap.display_label) RETURNING * INTO r;
 -- The same event an invitation code writes, so everything that follows a registration sees this one the same way.
 PERFORM customer_private.workspace_access_event(target,actor,command,'customer.programme.accept',
  jsonb_build_object('programme_id',programme,'resource_id',r.id,'application_id',ap.id));
 IF customer.actor_id() IS DISTINCT FROM actor OR NOT customer_private.participant_invitation_active(d.invitation_id) THEN
  RAISE EXCEPTION 'Participant access expired' USING ERRCODE='42501';
 END IF;
 RETURN customer_private.programme_application_summary(ap);
END $$;

-- The organiser's list for one programme, a page at a time, with the name and statement each applicant wrote.
CREATE FUNCTION customer.programme_applications(target uuid,programme uuid,after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);items jsonb;next_id uuid;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid application page size' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(customer_private.programme_application_summary(q) ORDER BY q.id),'[]'::jsonb) INTO items
 FROM (SELECT * FROM customer_private.programme_application WHERE workspace_id=target AND programme_id=programme AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_size) q;
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'id')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.programme_application WHERE workspace_id=target AND programme_id=programme AND id>next_id) THEN next_id:=NULL; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('programmeId',programme,'workspaceId',target,'applications',items,'nextAfter',next_id);
END $$;

-- The applicant's own applications across programmes, with the title and address of the page each was made on.
-- A page that is gone leaves the application listed with its status and without the title.
CREATE FUNCTION customer.own_programme_applications(after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();items jsonb;next_id uuid;selected uuid[];work uuid;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT FROM customer_private.principal WHERE id=actor AND disabled_at IS NULL) THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid application page size' USING ERRCODE='23514'; END IF;
 SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO selected FROM (SELECT id FROM customer_private.programme_application WHERE principal_id=actor AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_size) page;
 FOR work IN SELECT DISTINCT workspace_id FROM customer_private.programme_application WHERE id=ANY(selected) ORDER BY workspace_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||work::text,0));
  IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(customer_private.programme_application_summary(q)||jsonb_strip_nulls(jsonb_build_object(
   'address',CASE WHEN customer_private.programme_publication_state(customer_private.programme_publication_latest(q.programme_id)) IN ('OPEN','CLOSED') THEN s.slug END,
   'title',CASE WHEN customer_private.programme_publication_state(customer_private.programme_publication_latest(q.programme_id)) IN ('OPEN','CLOSED')
    THEN (customer_private.programme_publication_latest(q.programme_id)).copy->>'title' ELSE b.copy->>'title' END)) ORDER BY q.id),'[]'::jsonb)
 INTO items FROM customer_private.programme_application q
 JOIN customer_private.programme_public_address s ON s.programme_id=q.programme_id
 JOIN customer_private.programme_publication b ON b.id=q.publication_id
 WHERE q.principal_id=actor AND q.id=ANY(selected);
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'id')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.programme_application WHERE principal_id=actor AND id>next_id) THEN next_id:=NULL; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('applications',items,'nextAfter',next_id);
END $$;

REVOKE ALL ON FUNCTION customer_private.programme_publication_max_open(),customer_private.programme_publication_after_close(),customer_private.programme_publication_hourly_limit(),
 customer_private.programme_application_cap(),customer_private.programme_application_person_cap(),customer_private.programme_application_hourly_limit(),
 customer_private.programme_publication_iso(timestamptz),customer_private.programme_publication_text(jsonb,integer,integer),
 customer_private.programme_publication_copy_valid(jsonb,boolean),customer_private.programme_publication_paused(uuid,uuid),
 customer_private.programme_publication_real_use(),
 customer_private.programme_publication_latest(uuid),customer_private.programme_publication_state(customer_private.programme_publication),
 customer_private.programme_application_summary(customer_private.programme_application),
 customer.programme_publication_view(uuid,uuid),customer.publish_programme(uuid,uuid,uuid,integer,text,jsonb,timestamptz),
 customer.withdraw_programme_publication(uuid,uuid,uuid),app.read_programme_publication(text),
 customer.programme_application_command(uuid,text,jsonb),customer.programme_applications(uuid,uuid,uuid,integer),customer.own_programme_applications(uuid,integer)
 FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.programme_publication_view(uuid,uuid),customer.publish_programme(uuid,uuid,uuid,integer,text,jsonb,timestamptz),
 customer.withdraw_programme_publication(uuid,uuid,uuid),app.read_programme_publication(text),
 customer.programme_application_command(uuid,text,jsonb),customer.programme_applications(uuid,uuid,uuid,integer),customer.own_programme_applications(uuid,integer)
 TO corridra_runtime;
