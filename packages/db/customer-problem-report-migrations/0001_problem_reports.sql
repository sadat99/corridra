-- ADR-078: Report a Problem. A signed-in customer or a signed-in team member files a problem report, follows its status
-- and reads the staff notes. Owners and admins of a staff workspace triage it. Optional module: installing it is the
-- activation. There is no control table and no application switch.
-- Additive only: new tables and new functions. No existing function, policy, grant or row is replaced or changed.
-- Every statement that writes is an INSERT into a table created here, and one removal of problem report words under an
-- erasure request (see problem_report_remove_words). No event, audit or outbox row is written: the append-only report,
-- status and erasure rows are the audit record (who, when, what, why). Nothing is delivered, and a customer with no
-- workspace has no tenant for an event chain.
-- Customer and staff identities never mix: customer functions key on customer.actor_id(), team and triage functions on
-- app.actor_id(). No function accepts a person id. The erasure tables and staff_privacy_actor are the pattern only: the
-- support authority here (staff_problem_actor) is a separate function with its own name and words, so the privacy and
-- support authorities stay independent. The single use of the erasure authority is the removal of words under an
-- erasure request, as ADR-078 decision 6 states.
DO $guard$ BEGIN
 IF to_regprocedure('customer.actor_id()') IS NULL
 OR to_regprocedure('app.actor_id()') IS NULL
 OR to_regprocedure('app.fresh_mfa()') IS NULL
 OR to_regprocedure('app.can_access(uuid,text,text)') IS NULL
 OR to_regprocedure('app.member_role(uuid)') IS NULL
 OR to_regprocedure('app.real_use_allowed(uuid)') IS NULL
 OR to_regprocedure('app.tenant_processing_purpose(uuid)') IS NULL
 OR to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regprocedure('customer_private.closed_person(uuid)') IS NULL
 OR to_regprocedure('customer_private.account_actor()') IS NULL
 OR to_regprocedure('customer_private.staff_privacy_actor()') IS NULL
 OR to_regprocedure('customer_private.erasure_in_scope(uuid)') IS NULL
 OR to_regclass('customer_private.principal') IS NULL
 OR to_regclass('customer_private.workspace_member') IS NULL
 OR to_regclass('customer_private.workspace_access_revocation') IS NULL
 OR to_regclass('customer_private.real_use_configuration') IS NULL
 OR to_regclass('customer_private.erasure_request') IS NULL
 OR to_regclass('customer_private.erasure_status_event') IS NULL
 OR to_regclass('customer.workspace') IS NULL
 OR to_regclass('customer.membership') IS NULL
 OR to_regclass('app.tenant') IS NULL
 OR to_regclass('app.membership') IS NULL
 OR to_regclass('identity.principal') IS NULL
 OR to_regclass('identity.session') IS NULL
 OR to_regclass('identity.assurance') IS NULL
 OR to_regclass('identity."user"') IS NULL
 THEN RAISE EXCEPTION 'Problem report prerequisites are missing'; END IF;
END $guard$;

-- The plain text rule of packages/delivery/src/customer-service-staff.ts (control characters U+0000 to U+001F and U+007F,
-- then "://", "@" and "www." are refused, matched case-sensitively), plus a length range counted in characters.
CREATE FUNCTION customer_private.problem_report_plain(value text,min_length integer,max_length integer) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(length(value) BETWEEN min_length AND max_length AND value !~ '[\u0001-\u001f\u007f]' AND value !~ '(://|@|www\.)',false)
$$;

-- A stored path is the pathname only: it starts with the reporter's own shell (/account for a customer, /operator for a
-- team member), has no query or fragment, no uuid segment (those are stored as :id) and is at most 200 characters.
CREATE FUNCTION customer_private.problem_report_path_ok(path text,reporter_kind text) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(customer_private.problem_report_plain(path,1,200) AND path !~ '[?#]'
  AND path !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  AND ((reporter_kind='customer' AND path ~ '^/account(/|$)') OR (reporter_kind='team' AND path ~ '^/operator(/|$)')),false)
$$;

-- The record of a problem report. Exactly one reporter, typed by kind, so customer and staff identities never share a
-- column. The side is frozen at filing; a customer report can later move to real through problem_report_side.
CREATE TABLE customer_private.problem_report (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 reference text GENERATED ALWAYS AS ('RP-'||lpad(number::text,6,'0')) STORED UNIQUE,
 reporter_kind text NOT NULL CHECK(reporter_kind IN ('customer','team')),
 customer_principal_id uuid REFERENCES customer_private.principal(id),
 staff_principal_id uuid REFERENCES identity.principal(id),
 staff_tenant_id uuid REFERENCES app.tenant(id),
 side text NOT NULL CHECK(side IN ('sample','real')),
 category text NOT NULL CHECK(category IN ('did_not_work','could_not_find','words_wrong','something_else')),
 command_id uuid NOT NULL,
 filed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((reporter_kind='customer' AND customer_principal_id IS NOT NULL AND staff_principal_id IS NULL AND staff_tenant_id IS NULL)
  OR (reporter_kind='team' AND customer_principal_id IS NULL AND staff_principal_id IS NOT NULL AND staff_tenant_id IS NOT NULL)),
 UNIQUE(id,reporter_kind),
 UNIQUE(id,reporter_kind,category),
 UNIQUE(customer_principal_id,command_id),
 UNIQUE(staff_principal_id,command_id)
);
CREATE INDEX problem_report_customer_filed ON customer_private.problem_report(customer_principal_id,filed_at DESC);
CREATE INDEX problem_report_customer_number ON customer_private.problem_report(customer_principal_id,number DESC);
CREATE INDEX problem_report_staff_filed ON customer_private.problem_report(staff_principal_id,filed_at DESC);
CREATE INDEX problem_report_staff_number ON customer_private.problem_report(staff_principal_id,staff_tenant_id,number DESC);

-- What the reporter wrote. The category is carried so the database itself requires 10 characters for Something else.
CREATE TABLE customer_private.problem_report_words (
 report_id uuid PRIMARY KEY,
 reporter_kind text NOT NULL,
 category text NOT NULL,
 page_kind text NOT NULL CHECK(page_kind IN ('this_page','another_page')),
 page_text text NOT NULL,
 detail text,
 FOREIGN KEY(report_id,reporter_kind,category) REFERENCES customer_private.problem_report(id,reporter_kind,category),
 CHECK((page_kind='this_page' AND customer_private.problem_report_path_ok(page_text,reporter_kind))
  OR (page_kind='another_page' AND customer_private.problem_report_plain(page_text,1,120))),
 CHECK(detail IS NULL OR customer_private.problem_report_plain(detail,1,1000)),
 CHECK(category<>'something_else' OR (detail IS NOT NULL AND length(detail)>=10))
);

-- The chain of states. Received is written with the report. Each later row names the state it expected and the staff
-- member and workspace that moved it. The two unique keys and the composite key make the chain linear: one row per
-- state, one move out of each state, and a move can only leave a state the report really reached.
CREATE TABLE customer_private.problem_report_status_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 report_id uuid NOT NULL REFERENCES customer_private.problem_report(id),
 state text NOT NULL CHECK(state IN ('received','in_review','resolved','closed')),
 expected_state text,
 note text,
 staff_principal_id uuid REFERENCES identity.principal(id),
 staff_tenant_id uuid REFERENCES app.tenant(id),
 command_id uuid UNIQUE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(note IS NULL OR customer_private.problem_report_plain(note,10,1000)),
 CHECK((state='received' AND expected_state IS NULL AND note IS NULL AND staff_principal_id IS NULL AND staff_tenant_id IS NULL AND command_id IS NULL)
  OR (state='in_review' AND expected_state='received' AND staff_principal_id IS NOT NULL AND staff_tenant_id IS NOT NULL AND command_id IS NOT NULL)
  OR (state='resolved' AND expected_state='in_review' AND note IS NOT NULL AND staff_principal_id IS NOT NULL AND staff_tenant_id IS NOT NULL AND command_id IS NOT NULL)
  OR (state='closed' AND expected_state IN ('received','in_review') AND note IS NOT NULL AND staff_principal_id IS NOT NULL AND staff_tenant_id IS NOT NULL AND command_id IS NOT NULL)),
 UNIQUE(report_id,state),
 UNIQUE(report_id,expected_state),
 FOREIGN KEY(report_id,expected_state) REFERENCES customer_private.problem_report_status_event(report_id,state)
);
CREATE INDEX problem_report_status_event_latest ON customer_private.problem_report_status_event(report_id,seq DESC);

-- One row per customer report whose words were removed under an erasure request. Team reports are staff data and are
-- outside the customer erasure request, so the kind is fixed to customer. One command may cover many reports.
CREATE TABLE customer_private.problem_report_erasure (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 report_id uuid NOT NULL UNIQUE,
 reporter_kind text NOT NULL CHECK(reporter_kind='customer'),
 erasure_request_id uuid NOT NULL REFERENCES customer_private.erasure_request(id),
 staff_principal_id uuid NOT NULL REFERENCES identity.principal(id),
 command_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(report_id,reporter_kind) REFERENCES customer_private.problem_report(id,reporter_kind)
);

-- The shared immutable-record trigger always refuses, so it cannot let the words go when an erasure row exists. This guard
-- refuses every change to the words, and refuses their removal unless an erasure row for the same report exists.
CREATE FUNCTION customer_private.problem_report_words_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND EXISTS(SELECT FROM customer_private.problem_report_erasure e WHERE e.report_id=OLD.report_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Immutable record; append a new record' USING ERRCODE='23514';
END $$;

CREATE TRIGGER problem_report_immutable BEFORE UPDATE OR DELETE ON customer_private.problem_report FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER problem_report_words_guard BEFORE UPDATE OR DELETE ON customer_private.problem_report_words FOR EACH ROW EXECUTE FUNCTION customer_private.problem_report_words_guard();
CREATE TRIGGER problem_report_status_event_immutable BEFORE UPDATE OR DELETE ON customer_private.problem_report_status_event FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER problem_report_erasure_immutable BEFORE UPDATE OR DELETE ON customer_private.problem_report_erasure FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.problem_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.problem_report_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.problem_report_status_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.problem_report_erasure ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.problem_report,customer_private.problem_report_words,customer_private.problem_report_status_event,
 customer_private.problem_report_erasure FROM PUBLIC,corridra_runtime,corridra_auth;

-- The deployment is real when the real-use configuration is enabled (the text inside app.real_use_allowed).
CREATE FUNCTION customer_private.problem_report_deployment_real() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM customer_private.real_use_configuration WHERE enabled)
$$;

-- Has EVER held a membership or an invited membership in a real (non-synthetic) workspace. There is deliberately no
-- revocation clause: those rows are immutable, so a person who has been real can never move back to sample (ADR-078
-- decision 5). The erasure scope (account module 0004) asks the same question about the present, which can move back.
CREATE FUNCTION customer_private.problem_report_real_person(person uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM customer.membership m JOIN app.tenant t ON t.id=m.tenant_id WHERE m.principal_id=person AND NOT t.synthetic)
  OR EXISTS(SELECT FROM customer_private.workspace_member wm JOIN app.tenant t ON t.id=wm.tenant_id WHERE wm.principal_id=person AND NOT t.synthetic)
$$;

-- The side stored when a customer files: real when the person has ever held a real workspace, else sample when they hold
-- any workspace now (a membership, or an invited member who has not been removed), else the state of the deployment.
CREATE FUNCTION customer_private.problem_report_filing_side(person uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE
  WHEN customer_private.problem_report_real_person(person) THEN 'real'
  WHEN EXISTS(SELECT FROM customer.membership m WHERE m.principal_id=person)
   OR EXISTS(SELECT FROM customer_private.workspace_member wm WHERE wm.principal_id=person
    AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=wm.id)) THEN 'sample'
  WHEN customer_private.problem_report_deployment_real() THEN 'real'
  ELSE 'sample' END
$$;

-- The one side of a report. A team report keeps the side stored at filing. A customer report is real when its stored side
-- is real or its reporter has ever held a real workspace, otherwise sample. Exactly one value for every report.
CREATE FUNCTION customer_private.problem_report_side(report uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN r.side='real' OR (r.reporter_kind='customer' AND customer_private.problem_report_real_person(r.customer_principal_id))
  THEN 'real' ELSE 'sample' END FROM customer_private.problem_report r WHERE r.id=report
$$;

-- Which staff see a report, for the staff workspace named in the session: staff of a sample workspace see sample reports,
-- staff of a real workspace see real ones. A team report is also limited to the workspace it was filed in.
CREATE FUNCTION customer_private.problem_report_in_scope(report uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT s.synthetic=(customer_private.problem_report_side(r.id)='sample') AND (r.reporter_kind='customer' OR r.staff_tenant_id=s.id)
  FROM customer_private.problem_report r,app.tenant s
  WHERE r.id=report AND s.id=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid),false)
$$;

-- A team member of the staff workspace named in the session: any of the five roles, a live session, a sample workspace or
-- a real one while real use is open. Unlike the privacy and support queues there is no fresh authenticator check, because
-- filing a problem report is not a protected action. The rows it reads are locked for the transaction.
CREATE FUNCTION customer_private.problem_report_team_actor() RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff uuid:=app.actor_id(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
BEGIN
 IF staff IS NULL OR t IS NULL OR NOT coalesce(app.can_access(t,'INTERNAL',app.tenant_processing_purpose(t)),false)
  OR coalesce(app.member_role(t),'') NOT IN ('owner','admin','operator','reviewer','viewer')
  OR NOT EXISTS(SELECT FROM app.tenant WHERE id=t AND (synthetic OR app.real_use_allowed(id))) THEN
  RAISE EXCEPTION 'Problem report access denied' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM identity.session s JOIN identity.assurance a ON a.session_id=s.id JOIN identity.principal p ON p.identity_id=s."userId"
 JOIN identity."user" u ON u.id=p.identity_id JOIN app.membership m ON m.user_id=p.id AND m.tenant_id=t
 WHERE p.id=staff AND p.disabled_at IS NULL AND u."twoFactorEnabled" AND m.revoked_at IS NULL AND m.role IN ('owner','admin','operator','reviewer','viewer')
 AND p.operating_country=ANY(m.allowed_countries) AND current_setting('corridra.purpose',true)=ANY(m.allowed_purposes)
 AND encode(sha256(convert_to(s.token,'UTF8')),'hex')=current_setting('corridra.session_hash',true)
 AND s."expiresAt">clock_timestamp() AND s."createdAt">clock_timestamp()-interval '24 hours'
 FOR SHARE OF s,a,p,u,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Problem report access denied' USING ERRCODE='42501'; END IF;
 RETURN staff;
END $$;

-- Staff who may read and move the problem report queue. The same checks as staff_privacy_actor (an owner or admin of the
-- staff workspace in the session, a fresh authenticator check, a live session) under its own name and words, so a later
-- change to the privacy authority can never silently change this one, and the reverse.
CREATE FUNCTION customer_private.staff_problem_actor() RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff uuid:=app.actor_id(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
BEGIN
 IF staff IS NULL OR t IS NULL OR NOT coalesce(app.can_access(t,'INTERNAL',app.tenant_processing_purpose(t)),false)
  OR coalesce(app.member_role(t),'') NOT IN ('owner','admin') OR NOT app.fresh_mfa()
  OR NOT EXISTS(SELECT FROM app.tenant WHERE id=t AND (synthetic OR app.real_use_allowed(id))) THEN
  RAISE EXCEPTION 'Problem report queue access denied' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM identity.session s JOIN identity.assurance a ON a.session_id=s.id JOIN identity.principal p ON p.identity_id=s."userId"
 JOIN identity."user" u ON u.id=p.identity_id JOIN app.membership m ON m.user_id=p.id AND m.tenant_id=t
 WHERE p.id=staff AND p.disabled_at IS NULL AND u."twoFactorEnabled" AND m.revoked_at IS NULL AND m.role IN ('owner','admin')
 AND p.operating_country=ANY(m.allowed_countries) AND current_setting('corridra.purpose',true)=ANY(m.allowed_purposes)
 AND encode(sha256(convert_to(s.token,'UTF8')),'hex')=current_setting('corridra.session_hash',true)
 AND s."expiresAt">clock_timestamp() AND s."createdAt">clock_timestamp()-interval '24 hours' AND a.verified_at>clock_timestamp()-interval '5 minutes'
 FOR SHARE OF s,a,p,u,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Problem report queue access denied' USING ERRCODE='42501'; END IF;
 RETURN staff;
END $$;

-- The only reading of a filing request. Exactly the keys category, pageKind, page and (optional) detail, trimmed of
-- spaces, tabs and line breaks at the ends. An empty detail is the same as no detail. The result is the normal form the
-- command stores and compares, so a replay is judged on what was kept and not on spacing.
CREATE FUNCTION customer_private.problem_report_parse(reporter_kind text,command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE category text;page_kind text;page text;detail text;
BEGIN
 IF command IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' OR input-ARRAY['category','pageKind','page','detail']<>'{}'::jsonb
  OR jsonb_typeof(input->'category') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'pageKind') IS DISTINCT FROM 'string'
  OR jsonb_typeof(input->'page') IS DISTINCT FROM 'string'
  OR (input?'detail' AND jsonb_typeof(input->'detail') NOT IN ('string','null')) THEN
  RAISE EXCEPTION 'Invalid problem report' USING ERRCODE='22023';
 END IF;
 category:=input->>'category';
 page_kind:=input->>'pageKind';
 page:=btrim(input->>'page',E' \t\r\n');
 detail:=NULLIF(btrim(input->>'detail',E' \t\r\n'),'');
 IF category NOT IN ('did_not_work','could_not_find','words_wrong','something_else') OR page_kind NOT IN ('this_page','another_page')
  OR NOT ((page_kind='this_page' AND customer_private.problem_report_path_ok(page,reporter_kind))
   OR (page_kind='another_page' AND customer_private.problem_report_plain(page,1,120)))
  OR (detail IS NOT NULL AND NOT customer_private.problem_report_plain(detail,1,1000))
  OR (category='something_else' AND (detail IS NULL OR length(detail)<10)) THEN
  RAISE EXCEPTION 'Invalid problem report' USING ERRCODE='22023';
 END IF;
 RETURN jsonb_build_object('category',category,'pageKind',page_kind,'page',page,'detail',detail);
END $$;

REVOKE ALL ON FUNCTION customer_private.problem_report_plain(text,integer,integer),customer_private.problem_report_path_ok(text,text),
 customer_private.problem_report_words_guard(),customer_private.problem_report_deployment_real(),customer_private.problem_report_real_person(uuid),
 customer_private.problem_report_filing_side(uuid),customer_private.problem_report_side(uuid),customer_private.problem_report_in_scope(uuid),
 customer_private.problem_report_team_actor(),customer_private.staff_problem_actor(),customer_private.problem_report_parse(text,uuid,jsonb)
 FROM PUBLIC,corridra_runtime,corridra_auth;

-- Customer filing, self only: there is no person id in the input. Order: the shape of the request, the signed-in person,
-- one lock per person, the person checked again, a replay of the same command (answered before the count), the closed
-- account gate, the limit of 10 in a rolling 24 hours counted from the person's own report rows, then the three rows.
-- The same command id with the same body answers with the first result; with a different body it is refused. If the
-- words were removed under an erasure request the replay answers without comparing them.
CREATE FUNCTION customer.problem_report_command(command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;body jsonb;previous customer_private.problem_report%ROWTYPE;kept customer_private.problem_report_words%ROWTYPE;
 made customer_private.problem_report%ROWTYPE;recent integer;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 body:=customer_private.problem_report_parse('customer',command,input);
 actor:=customer_private.account_actor();
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.problem_report:'||actor::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO previous FROM customer_private.problem_report r WHERE r.customer_principal_id=actor AND r.command_id=command;
 IF FOUND THEN
  SELECT * INTO kept FROM customer_private.problem_report_words w WHERE w.report_id=previous.id;
  IF previous.category<>body->>'category' OR (FOUND AND jsonb_build_object('category',kept.category,'pageKind',kept.page_kind,'page',kept.page_text,'detail',kept.detail)<>body) THEN
   RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('reference',previous.reference,'status','received','filedAt',previous.filed_at,'changed',false);
 END IF;
 IF customer_private.closed_person(actor) THEN RAISE EXCEPTION 'That account is closed' USING ERRCODE='23514'; END IF;
 SELECT count(*)::integer INTO recent FROM customer_private.problem_report r
 WHERE r.customer_principal_id=actor AND r.filed_at>clock_timestamp()-interval '24 hours';
 IF recent>=10 THEN RAISE EXCEPTION 'Too many problem reports in the last 24 hours' USING ERRCODE='54000'; END IF;
 INSERT INTO customer_private.problem_report(reporter_kind,customer_principal_id,side,category,command_id)
 VALUES('customer',actor,customer_private.problem_report_filing_side(actor),body->>'category',command) RETURNING * INTO made;
 INSERT INTO customer_private.problem_report_words(report_id,reporter_kind,category,page_kind,page_text,detail)
 VALUES(made.id,made.reporter_kind,made.category,body->>'pageKind',body->>'page',body->>'detail');
 INSERT INTO customer_private.problem_report_status_event(report_id,state) VALUES(made.id,'received');
 RETURN jsonb_build_object('reference',made.reference,'status','received','filedAt',made.filed_at,'changed',true);
END $$;

-- Team filing, self only, in the staff workspace named in the session. The limit counts the person's reports across
-- workspaces. A command id used earlier in another workspace is a conflict. The closed account gate is for customers.
CREATE FUNCTION app.problem_report_command(command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;body jsonb;
 previous customer_private.problem_report%ROWTYPE;kept customer_private.problem_report_words%ROWTYPE;
 made customer_private.problem_report%ROWTYPE;recent integer;
BEGIN
 IF app.actor_id() IS NULL THEN RAISE EXCEPTION 'Problem report access denied' USING ERRCODE='42501'; END IF;
 body:=customer_private.problem_report_parse('team',command,input);
 actor:=customer_private.problem_report_team_actor();
 PERFORM pg_advisory_xact_lock(hashtextextended('team.problem_report:'||actor::text,0));
 IF app.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Problem report access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO previous FROM customer_private.problem_report r WHERE r.staff_principal_id=actor AND r.command_id=command;
 IF FOUND THEN
  SELECT * INTO kept FROM customer_private.problem_report_words w WHERE w.report_id=previous.id;
  IF previous.staff_tenant_id<>tenant OR previous.category<>body->>'category'
   OR (FOUND AND jsonb_build_object('category',kept.category,'pageKind',kept.page_kind,'page',kept.page_text,'detail',kept.detail)<>body) THEN
   RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('reference',previous.reference,'status','received','filedAt',previous.filed_at,'changed',false);
 END IF;
 SELECT count(*)::integer INTO recent FROM customer_private.problem_report r
 WHERE r.staff_principal_id=actor AND r.filed_at>clock_timestamp()-interval '24 hours';
 IF recent>=10 THEN RAISE EXCEPTION 'Too many problem reports in the last 24 hours' USING ERRCODE='54000'; END IF;
 INSERT INTO customer_private.problem_report(reporter_kind,staff_principal_id,staff_tenant_id,side,category,command_id)
 VALUES('team',actor,tenant,(SELECT CASE WHEN t.synthetic THEN 'sample' ELSE 'real' END FROM app.tenant t WHERE t.id=tenant),body->>'category',command)
 RETURNING * INTO made;
 INSERT INTO customer_private.problem_report_words(report_id,reporter_kind,category,page_kind,page_text,detail)
 VALUES(made.id,made.reporter_kind,made.category,body->>'pageKind',body->>'page',body->>'detail');
 INSERT INTO customer_private.problem_report_status_event(report_id,state) VALUES(made.id,'received');
 RETURN jsonb_build_object('reference',made.reference,'status','received','filedAt',made.filed_at,'changed',true);
END $$;

-- The reporter's own list, newest first, paged by number. A closed account can still read. The side is not shown.
CREATE FUNCTION customer.problem_report_list(before_number bigint DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;
BEGIN
 actor:=customer_private.account_actor();
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid problem report request' USING ERRCODE='22023'; END IF;
 RETURN coalesce((SELECT jsonb_agg(page.item ORDER BY page.number DESC) FROM (
  SELECT r.number,jsonb_build_object('reference',r.reference,'number',r.number,'category',r.category,'filedAt',r.filed_at,
   'status',s.state,'updatedAt',s.created_at,
   'wordsRemoved',EXISTS(SELECT FROM customer_private.problem_report_erasure e WHERE e.report_id=r.id)) AS item
  FROM customer_private.problem_report r
  JOIN LATERAL (SELECT x.state,x.created_at FROM customer_private.problem_report_status_event x WHERE x.report_id=r.id ORDER BY x.seq DESC LIMIT 1) s ON true
  WHERE r.customer_principal_id=actor AND (before_number IS NULL OR r.number<before_number)
  ORDER BY r.number DESC LIMIT page_size) page),'[]'::jsonb);
END $$;

-- One of the reporter's own problem reports, with the words (or that they were removed) and every status row with its
-- note, in order. Unknown, another person's (a co-member's too) and malformed references all answer the same way.
CREATE FUNCTION customer.problem_report_get(ref text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;result jsonb;
BEGIN
 actor:=customer_private.account_actor();
 SELECT jsonb_build_object('reference',r.reference,'category',r.category,'filedAt',r.filed_at,'status',s.state,'updatedAt',s.created_at,
  'words',CASE WHEN EXISTS(SELECT FROM customer_private.problem_report_erasure e WHERE e.report_id=r.id) THEN jsonb_build_object('removed',true)
   ELSE jsonb_build_object('pageKind',w.page_kind,'page',w.page_text,'detail',w.detail) END,
  'history',(SELECT jsonb_agg(jsonb_build_object('state',x.state,'note',x.note,'createdAt',x.created_at) ORDER BY x.seq)
   FROM customer_private.problem_report_status_event x WHERE x.report_id=r.id)) INTO result
 FROM customer_private.problem_report r
 JOIN LATERAL (SELECT x.state,x.created_at FROM customer_private.problem_report_status_event x WHERE x.report_id=r.id ORDER BY x.seq DESC LIMIT 1) s ON true
 LEFT JOIN customer_private.problem_report_words w ON w.report_id=r.id
 WHERE r.reference=ref AND r.customer_principal_id=actor;
 IF result IS NULL THEN RAISE EXCEPTION 'Problem report not found' USING ERRCODE='23514'; END IF;
 RETURN result;
END $$;

-- The same two reads for a team member: only the reports the caller filed in the selected workspace.
CREATE FUNCTION app.problem_report_list(before_number bigint DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
BEGIN
 actor:=customer_private.problem_report_team_actor();
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid problem report request' USING ERRCODE='22023'; END IF;
 RETURN coalesce((SELECT jsonb_agg(page.item ORDER BY page.number DESC) FROM (
  SELECT r.number,jsonb_build_object('reference',r.reference,'number',r.number,'category',r.category,'filedAt',r.filed_at,
   'status',s.state,'updatedAt',s.created_at,'wordsRemoved',false) AS item
  FROM customer_private.problem_report r
  JOIN LATERAL (SELECT x.state,x.created_at FROM customer_private.problem_report_status_event x WHERE x.report_id=r.id ORDER BY x.seq DESC LIMIT 1) s ON true
  WHERE r.staff_principal_id=actor AND r.staff_tenant_id=tenant AND (before_number IS NULL OR r.number<before_number)
  ORDER BY r.number DESC LIMIT page_size) page),'[]'::jsonb);
END $$;

CREATE FUNCTION app.problem_report_get(ref text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;result jsonb;
BEGIN
 actor:=customer_private.problem_report_team_actor();
 SELECT jsonb_build_object('reference',r.reference,'category',r.category,'filedAt',r.filed_at,'status',s.state,'updatedAt',s.created_at,
  'words',jsonb_build_object('pageKind',w.page_kind,'page',w.page_text,'detail',w.detail),
  'history',(SELECT jsonb_agg(jsonb_build_object('state',x.state,'note',x.note,'createdAt',x.created_at) ORDER BY x.seq)
   FROM customer_private.problem_report_status_event x WHERE x.report_id=r.id)) INTO result
 FROM customer_private.problem_report r
 JOIN LATERAL (SELECT x.state,x.created_at FROM customer_private.problem_report_status_event x WHERE x.report_id=r.id ORDER BY x.seq DESC LIMIT 1) s ON true
 JOIN customer_private.problem_report_words w ON w.report_id=r.id
 WHERE r.reference=ref AND r.staff_principal_id=actor AND r.staff_tenant_id=tenant;
 IF result IS NULL THEN RAISE EXCEPTION 'Problem report not found' USING ERRCODE='23514'; END IF;
 RETURN result;
END $$;

-- Staff only. The queue in scope for the staff workspace in the session, oldest first, paged by number. total is the
-- number matching the filter; counts are for all four states; oldestReceivedAt is the oldest report still in Received.
-- Items carry the reference, number, reporter kind, filed time, category, the page and detail (null when removed),
-- the side, the latest status and the history with notes. Never a name, an email or a workspace.
CREATE FUNCTION customer.problem_report_queue(after_number bigint DEFAULT NULL,page_size integer DEFAULT 25,state_filter text DEFAULT NULL) RETURNS jsonb
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
    'wordsRemoved',EXISTS(SELECT FROM customer_private.problem_report_erasure e WHERE e.report_id=p.id),
    'pageKind',w.page_kind,'page',w.page_text,'detail',w.detail,
    'history',(SELECT jsonb_agg(jsonb_build_object('state',x.state,'note',x.note,'createdAt',x.created_at) ORDER BY x.seq)
      FROM customer_private.problem_report_status_event x WHERE x.report_id=p.id)) ORDER BY p.number)
   FROM page p LEFT JOIN customer_private.problem_report_words w ON w.report_id=p.id),'[]'::jsonb),
  'total',(SELECT count(*) FROM shown),
  'counts',jsonb_build_object('received',(SELECT count(*) FROM scoped WHERE state='received'),'in_review',(SELECT count(*) FROM scoped WHERE state='in_review'),
   'resolved',(SELECT count(*) FROM scoped WHERE state='resolved'),'closed',(SELECT count(*) FROM scoped WHERE state='closed')),
  'oldestReceivedAt',(SELECT min(filed_at) FROM scoped WHERE state='received')) INTO result;
 RETURN result;
END $$;

-- Staff only. Moves one problem report along the allowed arrows: received to in_review or closed, in_review to resolved or
-- closed. Resolved and closed need a note of 10 to 1000 plain characters that the reporter reads; in_review may have one.
-- A report that is missing or outside the staff side answers as not found. The same command id and the same decision
-- answers again; any other use of the id is refused. Nothing is edited or removed.
CREATE FUNCTION customer.problem_report_transition(command uuid,report uuid,expected_state text,to_state text,note text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff uuid;tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;filed customer_private.problem_report%ROWTYPE;
 prior customer_private.problem_report_status_event%ROWTYPE;current_state text;words text:=NULLIF(btrim(note,E' \t\r\n'),'');
 made customer_private.problem_report_status_event%ROWTYPE;
BEGIN
 staff:=customer_private.staff_problem_actor();
 IF command IS NULL OR report IS NULL OR expected_state IS NULL OR to_state IS NULL
  OR expected_state NOT IN ('received','in_review','resolved','closed') OR to_state NOT IN ('received','in_review','resolved','closed')
  OR (words IS NOT NULL AND NOT customer_private.problem_report_plain(words,10,1000))
  OR (to_state IN ('resolved','closed') AND words IS NULL) THEN
  RAISE EXCEPTION 'Invalid problem report change' USING ERRCODE='22023';
 END IF;
 SELECT * INTO filed FROM customer_private.problem_report r WHERE r.id=report;
 IF NOT FOUND OR NOT customer_private.problem_report_in_scope(report) THEN RAISE EXCEPTION 'Problem report not found' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.problem_report.status:'||report::text,0));
 SELECT * INTO prior FROM customer_private.problem_report_status_event x WHERE x.command_id=command;
 IF FOUND THEN
  IF prior.report_id<>report OR prior.state<>to_state OR prior.note IS DISTINCT FROM words OR prior.staff_principal_id<>staff THEN
   RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('id',filed.id,'reference',filed.reference,'status',prior.state,'note',prior.note,'changed',false);
 END IF;
 SELECT x.state INTO current_state FROM customer_private.problem_report_status_event x WHERE x.report_id=report ORDER BY x.seq DESC LIMIT 1;
 IF current_state IS DISTINCT FROM expected_state THEN
  RAISE EXCEPTION 'This problem report has changed. Reload and try again' USING ERRCODE='23514';
 END IF;
 IF NOT ((current_state='received' AND to_state IN ('in_review','closed')) OR (current_state='in_review' AND to_state IN ('resolved','closed'))) THEN
  RAISE EXCEPTION 'That change is not allowed from this status' USING ERRCODE='23514';
 END IF;
 INSERT INTO customer_private.problem_report_status_event(report_id,state,expected_state,note,staff_principal_id,staff_tenant_id,command_id)
 VALUES(report,to_state,expected_state,words,staff,tenant,command) RETURNING * INTO made;
 RETURN jsonb_build_object('id',filed.id,'reference',filed.reference,'status',made.state,'note',made.note,'changed',true);
END $$;

-- Staff under the ERASURE authority (staff_privacy_actor and erasure_in_scope), not the support authority. Given an erasure
-- request that is in progress or completed, writes an erasure row for each customer report of that person whose words are
-- still there, then removes those words. The reference, category, times, status history and notes stay. A second call
-- removes nothing. Team reports are staff data and are never touched. Owner-only gating is the application permission.
CREATE FUNCTION customer.problem_report_remove_words(command uuid,erasure_request uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff uuid;filed customer_private.erasure_request%ROWTYPE;current_state text;report uuid;removed integer:=0;
BEGIN
 staff:=customer_private.staff_privacy_actor();
 IF command IS NULL OR erasure_request IS NULL THEN RAISE EXCEPTION 'Invalid problem report change' USING ERRCODE='22023'; END IF;
 SELECT * INTO filed FROM customer_private.erasure_request r WHERE r.id=erasure_request;
 IF NOT FOUND OR NOT customer_private.erasure_in_scope(filed.principal_id) THEN RAISE EXCEPTION 'Erasure request not found' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.account.lifecycle:'||filed.principal_id::text,0));
 SELECT x.state INTO current_state FROM customer_private.erasure_status_event x WHERE x.request_id=erasure_request ORDER BY x.seq DESC LIMIT 1;
 IF current_state IS NULL OR current_state NOT IN ('in_progress','completed') THEN
  RAISE EXCEPTION 'Words can be removed only for an erasure request that is in progress or completed' USING ERRCODE='23514';
 END IF;
 FOR report IN SELECT r.id FROM customer_private.problem_report r
  WHERE r.reporter_kind='customer' AND r.customer_principal_id=filed.principal_id
  AND NOT EXISTS(SELECT FROM customer_private.problem_report_erasure e WHERE e.report_id=r.id) ORDER BY r.number LOOP
  INSERT INTO customer_private.problem_report_erasure(report_id,reporter_kind,erasure_request_id,staff_principal_id,command_id)
  VALUES(report,'customer',erasure_request,staff,command);
  DELETE FROM customer_private.problem_report_words w WHERE w.report_id=report;
  removed:=removed+1;
 END LOOP;
 RETURN jsonb_build_object('reference',filed.reference,'removed',removed);
END $$;

REVOKE ALL ON FUNCTION customer.problem_report_command(uuid,jsonb),customer.problem_report_list(bigint,integer),customer.problem_report_get(text),
 customer.problem_report_queue(bigint,integer,text),customer.problem_report_transition(uuid,uuid,text,text,text),
 customer.problem_report_remove_words(uuid,uuid),
 app.problem_report_command(uuid,jsonb),app.problem_report_list(bigint,integer),app.problem_report_get(text)
 FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.problem_report_command(uuid,jsonb),customer.problem_report_list(bigint,integer),customer.problem_report_get(text),
 customer.problem_report_queue(bigint,integer,text),customer.problem_report_transition(uuid,uuid,text,text,text),
 customer.problem_report_remove_words(uuid,uuid),
 app.problem_report_command(uuid,jsonb),app.problem_report_list(bigint,integer),app.problem_report_get(text)
 TO corridra_runtime;
