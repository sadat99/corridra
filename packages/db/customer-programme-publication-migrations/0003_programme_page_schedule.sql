-- ADR-084 slice S1 (share kit). Optional structured dates for a published programme page, kept in a SIDECAR table keyed to
-- the page version, so a calendar file can be made without touching the page copy.
-- The copy of a page is free text ("12 to 18 April 2027, to be confirmed") and its key list is closed and enforced on
-- immutable rows (programme_publication_copy_valid, file 0001). Replacing that function would be a replacement of an
-- installed object, which this module does not do. So the structured dates live here, one row per page version at most:
-- a start day and an end day the organiser chose to state, nothing else. A page without a row has no calendar file.
-- Additive only: one new table and two new functions. No table, policy, grant, constraint or function installed by an
-- earlier file or by an older module is created again, replaced or changed.
-- The anonymous read calls the existing anonymous page read first and answers nothing (NULL) unless that read returned a
-- readable page, so it adds no way to tell an unknown, taken down, archived or long closed address from a page that has
-- no dates: every one of them is the same single value. It writes nothing and records nothing about the visitor.
-- The guard below refuses the install unless the objects this file builds on are exactly the ones it was proven against:
-- the prerequisites exist, the two page tables have the proven shape, and the three page functions it relies on have the
-- proven body. Lists are sorted in byte order (COLLATE "C"), so the result does not depend on the database's collation.
DO $guard$
DECLARE r record;shape text;
BEGIN
 IF to_regprocedure('customer_private.participant_scope(uuid,uuid,uuid,boolean)') IS NULL
 OR to_regprocedure('customer_private.workspace_access_event(uuid,uuid,uuid,text,jsonb)') IS NULL
 OR to_regprocedure('customer.actor_id()') IS NULL
 OR to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regprocedure('app.read_programme_publication(text)') IS NULL
 OR to_regprocedure('customer_private.programme_publication_latest(uuid)') IS NULL
 OR to_regprocedure('customer_private.programme_publication_paused(uuid,uuid)') IS NULL
 OR to_regprocedure('customer_private.programme_publication_state(customer_private.programme_publication)') IS NULL
 OR to_regclass('customer_private.programme_publication') IS NULL
 OR to_regclass('customer_private.programme_publication_withdrawal') IS NULL
 OR to_regclass('customer_private.programme_public_address') IS NULL
 OR to_regclass('customer_private.principal') IS NULL THEN
  RAISE EXCEPTION 'Programme page schedule prerequisite is missing';
 END IF;
 FOR r IN SELECT * FROM (VALUES
  ('customer_private.programme_publication'::regclass,'ee1cc4d2aa7d33db1aac3ef23f944b5844c92e603b17d2916f341cb79fe1ad32'),
  ('customer_private.programme_publication_withdrawal'::regclass,'07dede0e7a091cc5d4b02b70c77572ae6ccc71004c5ab6db8119c37de102e573'),
  ('customer_private.programme_public_address'::regclass,'2021f6378303cd5ac1eda3199e0373929f3ba7fa01c4473b84b82cbeb19eca9c')
 ) v(tbl,known) LOOP
  SELECT (SELECT string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||a.atthasdef::text,',' ORDER BY a.attname::text COLLATE "C")
    FROM pg_attribute a WHERE a.attrelid=r.tbl AND a.attnum>0 AND NOT a.attisdropped)
   ||'|'||coalesce((SELECT string_agg(pg_get_constraintdef(c.oid),';' ORDER BY pg_get_constraintdef(c.oid) COLLATE "C")
    FROM pg_constraint c WHERE c.conrelid=r.tbl AND c.contype='c'),'') INTO shape;
  IF shape IS NULL OR encode(sha256(convert_to(shape,'UTF8')),'hex')<>r.known THEN
   RAISE EXCEPTION 'Programme page schedule prerequisite differs: %',r.tbl;
  END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
  ('app.read_programme_publication(text)'::regprocedure,'94999f1e4ebeccda4facc80370b012ebbbc1ffb790b4ec08bfdd42da7e27d906'),
  ('customer_private.programme_publication_latest(uuid)'::regprocedure,'e3160890084cf97c4a29fbd61067022758d35949df2710ddcb1f242b0475d9d6'),
  ('customer_private.programme_publication_state(customer_private.programme_publication)'::regprocedure,'3068b1d2b0d29a1b68b98c5d84f0b844fad46854a75e67a951787f7900281af0')
 ) v(fn,known) LOOP
  IF encode(sha256(convert_to((SELECT p.prosrc FROM pg_proc p WHERE p.oid=r.fn),'UTF8')),'hex')<>r.known THEN
   RAISE EXCEPTION 'Programme page schedule prerequisite differs: %',r.fn;
  END IF;
 END LOOP;
END $guard$;

-- The structured dates of one page version. Keyed to the version row, so a new version starts without dates and the
-- organiser states them again if they want a calendar file for it. Immutable: a correction is a new version of the page.
CREATE TABLE customer_private.programme_publication_schedule (
 publication_id uuid PRIMARY KEY REFERENCES customer_private.programme_publication(id),
 starts_on date NOT NULL,
 ends_on date NOT NULL,
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(principal_id,command_id),
 CHECK(starts_on>=date '2000-01-01' AND ends_on<=date '2100-12-31' AND ends_on>=starts_on AND ends_on-starts_on<=365)
);
ALTER TABLE customer_private.programme_publication_schedule ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.programme_publication_schedule FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON customer_private.programme_publication_schedule FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- States the dates of the latest version of the page. A current owner or admin of the workspace that owns the programme,
-- the same authority as publishing. One schedule per version: an exact retry answers the same, the same dates stated again
-- answer the same, other dates for a version that has some are refused (publish a new version to change them).
--   23514 PROGRAMME_PUBLICATION_CHANGED       the version is not the latest, or the page was taken down, or a reused command differs
--   23514 PROGRAMME_PUBLICATION_PAUSED        the programme or its workspace is archived
--   23514 PROGRAMME_SCHEDULE_ALREADY_SET      this version already has other dates
CREATE FUNCTION customer.set_programme_schedule(command uuid,target uuid,programme uuid,expected integer,starts date,ends date) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.participant_scope(command,target,programme,true);latest customer_private.programme_publication;
 prior customer_private.programme_publication_schedule;made customer_private.programme_publication_schedule;
BEGIN
 IF expected IS NULL OR expected<1 OR starts IS NULL OR ends IS NULL OR starts<date '2000-01-01' OR ends>date '2100-12-31' OR ends<starts OR ends-starts>365 THEN
  RAISE EXCEPTION 'Invalid programme schedule' USING ERRCODE='23514';
 END IF;
 latest:=customer_private.programme_publication_latest(programme);
 IF latest.id IS NULL OR latest.workspace_id<>target THEN RAISE EXCEPTION 'Programme page unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM customer_private.programme_publication_schedule WHERE principal_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.publication_id<>latest.id OR prior.starts_on<>starts OR prior.ends_on<>ends THEN RAISE EXCEPTION 'PROGRAMME_PUBLICATION_CHANGED' USING ERRCODE='23514'; END IF;
 ELSE
  IF latest.version<>expected OR customer_private.programme_publication_state(latest) NOT IN ('OPEN','CLOSED','PAUSED') THEN
   RAISE EXCEPTION 'PROGRAMME_PUBLICATION_CHANGED' USING ERRCODE='23514';
  END IF;
  IF customer_private.programme_publication_paused(target,programme) THEN RAISE EXCEPTION 'PROGRAMME_PUBLICATION_PAUSED' USING ERRCODE='23514'; END IF;
  SELECT * INTO prior FROM customer_private.programme_publication_schedule WHERE publication_id=latest.id;
  IF FOUND THEN
   IF prior.starts_on<>starts OR prior.ends_on<>ends THEN RAISE EXCEPTION 'PROGRAMME_SCHEDULE_ALREADY_SET' USING ERRCODE='23514'; END IF;
  ELSE
   INSERT INTO customer_private.programme_publication_schedule(publication_id,starts_on,ends_on,principal_id,command_id)
   VALUES(latest.id,starts,ends,actor,command) RETURNING * INTO prior;
   -- The event names the programme, the version and nothing else. No public words, no dates.
   PERFORM customer_private.workspace_access_event(target,actor,command,'customer.programme_publication.schedule_set',
    jsonb_build_object('programme_id',programme,'publication_id',latest.id,'version',latest.version));
  END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('programmeId',programme,'version',latest.version,'startsOn',to_char(prior.starts_on,'YYYY-MM-DD'),'endsOn',to_char(prior.ends_on,'YYYY-MM-DD'));
END $$;

-- The anonymous read of the dates of a page. NULL for anything that is not a readable page, and for a readable page
-- whose latest version has no dates: one single value, so it cannot be used to tell those cases apart. It reads only
-- the version the existing page read returned.
CREATE FUNCTION app.read_programme_schedule(address text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE page jsonb;s customer_private.programme_publication_schedule;
BEGIN
 page:=app.read_programme_publication(address);
 IF page->>'state' IS DISTINCT FROM 'OPEN' AND page->>'state' IS DISTINCT FROM 'CLOSED' THEN RETURN NULL; END IF;
 SELECT sc.* INTO s FROM customer_private.programme_publication_schedule sc
 JOIN customer_private.programme_publication p ON p.id=sc.publication_id
 JOIN customer_private.programme_public_address a ON a.programme_id=p.programme_id
 WHERE a.slug=address AND p.version=(page->>'version')::integer;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('version',(page->>'version')::integer,'startsOn',to_char(s.starts_on,'YYYY-MM-DD'),'endsOn',to_char(s.ends_on,'YYYY-MM-DD'));
EXCEPTION WHEN insufficient_privilege THEN RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION customer.set_programme_schedule(uuid,uuid,uuid,integer,date,date),app.read_programme_schedule(text)
 FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.set_programme_schedule(uuid,uuid,uuid,integer,date,date),app.read_programme_schedule(text)
 TO corridra_runtime;
