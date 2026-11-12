-- ADR-080, owner decision of 12 November 2026: Corridra operator staff may READ public programme applications.
-- Read only. One new staff authority and one new read function; no table, no policy, no grant of an older object and no
-- older function is created, replaced or changed. Nothing here decides, edits, invites, exports or writes. The words an
-- applicant wrote are shown exactly as stored, so a redaction under an erasure request (the programme erasure module)
-- shows its placeholder here too. No audit row is written for a read: the comparable staff read, the problem report
-- queue (customer.problem_report_queue), writes none either (ADR-078).
-- Earlier applicants consented to wording that said only the organiser's owners and admins read the application, so staff
-- may read only applications created at or after the moment this file is applied, the moment the new wording applies. The
-- moment is stored once, in a table nobody can change (a row of one, no grant, immutable), and the read filters on it
-- everywhere. An application made before it is never returned to staff, whatever its state.
-- The staff authority is a separate function with its own name and words, copied in shape from staff_problem_actor so the
-- support, privacy and application-reading authorities stay independent of each other and of that optional module.
DO $guard$ BEGIN
 IF to_regprocedure('app.actor_id()') IS NULL
 OR to_regprocedure('app.fresh_mfa()') IS NULL
 OR to_regprocedure('app.can_access(uuid,text,text)') IS NULL
 OR to_regprocedure('app.member_role(uuid)') IS NULL
 OR to_regprocedure('customer_private.programme_application_summary(customer_private.programme_application)') IS NULL
 OR to_regprocedure('customer_private.programme_publication_latest(uuid)') IS NULL
 OR to_regprocedure('customer_private.programme_publication_state(customer_private.programme_publication)') IS NULL
 OR to_regclass('customer_private.programme_application') IS NULL
 OR to_regclass('customer_private.programme_publication') IS NULL
 OR to_regclass('app.tenant') IS NULL
 OR to_regclass('app.membership') IS NULL
 OR to_regclass('identity.principal') IS NULL
 OR to_regclass('identity.session') IS NULL
 OR to_regclass('identity.assurance') IS NULL
 OR to_regclass('identity."user"') IS NULL
 THEN RAISE EXCEPTION 'Staff programme application prerequisites are missing'; END IF;
END $guard$;

CREATE TABLE customer_private.programme_application_staff_reading (
 only_row boolean PRIMARY KEY DEFAULT true CHECK(only_row),
 effective_from timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO customer_private.programme_application_staff_reading DEFAULT VALUES;
ALTER TABLE customer_private.programme_application_staff_reading ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.programme_application_staff_reading FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON customer_private.programme_application_staff_reading FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- Staff who may read applications: an owner or admin of the staff workspace in the session, a fresh authenticator
-- check and a live session, in a sample workspace or in a real one while real use is open. The real-use module is optional
-- (the publication module installs without it), so its two functions are used only where they exist: without them the
-- processing purpose is the one in the session and only a sample workspace is allowed.
CREATE FUNCTION customer_private.staff_application_actor() RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff uuid:=app.actor_id(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 purpose text:=current_setting('corridra.purpose',true);real_ok boolean:=false;
BEGIN
 IF t IS NULL THEN RAISE EXCEPTION 'Programme application access denied' USING ERRCODE='42501'; END IF;
 IF to_regprocedure('app.tenant_processing_purpose(uuid)') IS NOT NULL THEN EXECUTE 'SELECT app.tenant_processing_purpose($1)' INTO purpose USING t; END IF;
 IF to_regprocedure('app.real_use_allowed(uuid)') IS NOT NULL THEN EXECUTE 'SELECT coalesce(app.real_use_allowed($1),false)' INTO real_ok USING t; END IF;
 IF staff IS NULL OR purpose IS NULL OR NOT coalesce(app.can_access(t,'INTERNAL',purpose),false)
  OR coalesce(app.member_role(t),'') NOT IN ('owner','admin') OR NOT app.fresh_mfa()
  OR NOT EXISTS(SELECT FROM app.tenant WHERE id=t AND (synthetic OR real_ok)) THEN
  RAISE EXCEPTION 'Programme application access denied' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM identity.session s JOIN identity.assurance a ON a.session_id=s.id JOIN identity.principal p ON p.identity_id=s."userId"
 JOIN identity."user" u ON u.id=p.identity_id JOIN app.membership m ON m.user_id=p.id AND m.tenant_id=t
 WHERE p.id=staff AND p.disabled_at IS NULL AND u."twoFactorEnabled" AND m.revoked_at IS NULL AND m.role IN ('owner','admin')
 AND p.operating_country=ANY(m.allowed_countries) AND current_setting('corridra.purpose',true)=ANY(m.allowed_purposes)
 AND encode(sha256(convert_to(s.token,'UTF8')),'hex')=current_setting('corridra.session_hash',true)
 AND s."expiresAt">clock_timestamp() AND s."createdAt">clock_timestamp()-interval '24 hours' AND a.verified_at>clock_timestamp()-interval '5 minutes'
 FOR SHARE OF s,a,p,u,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Programme application access denied' USING ERRCODE='42501'; END IF;
 RETURN staff;
END $$;

-- The staff reading of applications, newest first. Staff of a sample workspace see the applications of sample workspaces,
-- staff of a real workspace see those of real workspaces. Each row is the organiser's own summary of the application (the
-- applicant's display name and statement as stored, the status, the organiser's decision note and the times) with the
-- programme title and organiser name of the page version that was read and the address of the page. No account
-- reference, email, private request, contact or price is returned, and no id of a person. Only applications created at or
-- after the stored moment of this file are returned.
CREATE FUNCTION customer.staff_programme_applications(after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff_tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;sample boolean;items jsonb;next_id uuid;total bigint;
 cursor_at timestamptz;since timestamptz;
BEGIN
 PERFORM customer_private.staff_application_actor();
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid application page size' USING ERRCODE='22023'; END IF;
 SELECT synthetic INTO sample FROM app.tenant WHERE id=staff_tenant;
 SELECT effective_from INTO since FROM customer_private.programme_application_staff_reading;
 IF after_id IS NOT NULL THEN
  SELECT q.created_at INTO cursor_at FROM customer_private.programme_application q JOIN app.tenant w ON w.id=q.workspace_id
  WHERE q.id=after_id AND w.synthetic=sample AND q.created_at>=since;
  IF cursor_at IS NULL THEN RAISE EXCEPTION 'Invalid application cursor' USING ERRCODE='22023'; END IF;
 END IF;
 SELECT count(*) INTO total FROM customer_private.programme_application q JOIN app.tenant w ON w.id=q.workspace_id WHERE w.synthetic=sample AND q.created_at>=since;
 SELECT coalesce(jsonb_agg(customer_private.programme_application_summary(q.a)||jsonb_build_object(
   'workspaceId',(q.a).workspace_id,'programmeTitle',q.title,'organiser',q.organiser,'address',q.slug,'pageState',q.page_state) ORDER BY q.at DESC,q.aid DESC),'[]'::jsonb)
 INTO items FROM (
  SELECT a,a.created_at AS at,a.id AS aid,b.copy->>'title' AS title,b.copy->>'organiser' AS organiser,s.slug,
   customer_private.programme_publication_state(customer_private.programme_publication_latest(a.programme_id)) AS page_state
  FROM customer_private.programme_application a
  JOIN app.tenant w ON w.id=a.workspace_id
  JOIN customer_private.programme_public_address s ON s.programme_id=a.programme_id
  JOIN customer_private.programme_publication b ON b.id=a.publication_id
  WHERE w.synthetic=sample AND a.created_at>=since AND (after_id IS NULL OR (a.created_at,a.id)<(cursor_at,after_id))
  ORDER BY a.created_at DESC,a.id DESC LIMIT page_size) q;
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'id')::uuid;
  SELECT x.created_at INTO cursor_at FROM customer_private.programme_application x WHERE x.id=next_id;
  IF NOT EXISTS(SELECT FROM customer_private.programme_application a JOIN app.tenant w ON w.id=a.workspace_id
   WHERE w.synthetic=sample AND a.created_at>=since AND (a.created_at,a.id)<(cursor_at,next_id)) THEN next_id:=NULL; END IF;
 END IF;
 RETURN jsonb_strip_nulls(jsonb_build_object('applications',items,'total',total,'nextAfter',next_id));
END $$;

REVOKE ALL ON FUNCTION customer_private.staff_application_actor(),customer.staff_programme_applications(uuid,integer)
 FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.staff_programme_applications(uuid,integer) TO corridra_runtime;
