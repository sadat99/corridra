-- ADR-087 U4, the member notice (decision 4b and 4d). Required before U5 opens any access; this file opens none.
-- What this file adds, and nothing else:
--   1. One new value, MEMBER_NOTICE, in the type check of app.inbox_notification (commercial readiness 0001:14). The check is
--      found by what it constrains (the type column alone), never by its name, because an unnamed check may carry another name
--      on another database. It is replaced, keeping its name, only when its live definition hashes to the exact text this file
--      was written against; otherwise nothing changes and the install refuses.
--   2. customer_private.member_notice_delivery: one row per workspace, the moment its notice was delivered (the start of the 4d
--      clock) and opens_at, exactly 24 hours later (the switch-on time the notice names). Written once and never reset.
--   3. customer_private.member_notice_dismissal: one row per member who dismissed the notice in that workspace.
--      Both tables have row level security on and no grant to the runtime or auth roles: they are read and written only through
--      the functions below. Both are history: app.reject_rewrite() refuses every UPDATE and DELETE, so a clock is never reset
--      and a dismissal never undone.
--   4. customer_private.member_notice_deliver(workspace, delivered_by): owner run only (no runtime, auth or PUBLIC grant). For
--      one workspace, once: it records the delivery and writes exactly one MEMBER_NOTICE inbox row to each current member
--      (customer_private.workspace_member_current, ADR-033 amendment). Run again, it writes nothing and keeps the first time.
--      The inbox payload carries the workspace id, opensAt and the decision 4b words with their [date and time] marker, which
--      the application fills with opensAt in the reader's time zone.
--   5. customer.member_notice_state(workspace), customer.member_notice_for_saved(saved report) and
--      customer.member_notice_dismiss(workspace), definers executable by the runtime only. They answer only a current member
--      of that workspace (for a saved report: the workspace of the request it was delivered for, held by the caller); dismiss
--      records the caller's own row only.
-- No read access to any saved report, decision card or book changes here. Members who join after the delivery see the /account
-- notice (it follows the workspace record) but get no inbox row.
-- Rollback: rollback/0001_drop_member_notice.sql restores the exact original check and drops what this file created, and refuses
-- once any notice was delivered or dismissed, because those rows are history and are never deleted (ADR-087 Rollback). The
-- application switch CORRIDRA_MEMBER_NOTICE off hides the /account notice and the MEMBER_NOTICE inbox items at once.
DO $guard$
DECLARE checks int; live text;
BEGIN
 IF to_regclass('app.inbox_notification') IS NULL THEN
  RAISE EXCEPTION 'Member notice needs the commercial readiness inbox (app.inbox_notification) first';
 END IF;
 -- Delivery relies on the event key and its unique index (commercial readiness 0002) to write one row per member, once.
 IF NOT EXISTS(SELECT FROM pg_attribute a WHERE a.attrelid='app.inbox_notification'::regclass AND a.attname='event_key' AND NOT a.attisdropped)
  OR to_regclass('app.inbox_notification_event_idx') IS NULL THEN
  RAISE EXCEPTION 'Member notice needs commercial readiness 0002 first: app.inbox_notification.event_key and inbox_notification_event_idx';
 END IF;
 IF to_regprocedure('app.reject_rewrite()') IS NULL THEN
  RAISE EXCEPTION 'Member notice needs app.reject_rewrite() (core migrations)';
 END IF;
 IF to_regprocedure('customer_private.workspace_member_current(uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'Member notice needs customer migration 0004_workspace_member_current.sql first';
 END IF;
 IF to_regprocedure('customer.actor_id()') IS NULL OR to_regclass('customer.workspace') IS NULL THEN
  RAISE EXCEPTION 'Member notice needs the customer workspace modules';
 END IF;
 IF to_regclass('customer_private.member_notice_delivery') IS NOT NULL
  OR to_regclass('customer_private.member_notice_dismissal') IS NOT NULL
  OR to_regprocedure('customer_private.member_notice_deliver(uuid,text)') IS NOT NULL
  OR to_regprocedure('customer.member_notice_state(uuid)') IS NOT NULL
  OR to_regprocedure('customer.member_notice_for_saved(uuid)') IS NOT NULL
  OR to_regprocedure('customer.member_notice_dismiss(uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'Member notice: an object of this module already exists outside this module';
 END IF;
 SELECT count(*),max(pg_get_constraintdef(c.oid)) INTO checks,live FROM pg_constraint c
  WHERE c.conrelid='app.inbox_notification'::regclass AND c.contype='c'
   AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid='app.inbox_notification'::regclass AND a.attname='type')];
 IF checks<>1 THEN
  RAISE EXCEPTION 'Member notice: expected exactly one check on app.inbox_notification(type), found %',checks;
 END IF;
 -- original-check-begin
 IF encode(sha256(convert_to(live,'UTF8')),'hex')<>'5846e8bd9a5b660413c04d72a9149d909e3f281c16afb548061a660b654dbd90' THEN
  RAISE EXCEPTION 'Member notice: the inbox type check differs from the one this file was written against';
 END IF;
 -- original-check-end
END
$guard$;

-- 1. The inbox type check, same name, one value added.
DO $type$
DECLARE name text;
BEGIN
 SELECT c.conname INTO name FROM pg_constraint c
  WHERE c.conrelid='app.inbox_notification'::regclass AND c.contype='c'
   AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid='app.inbox_notification'::regclass AND a.attname='type')];
 EXECUTE format('ALTER TABLE app.inbox_notification DROP CONSTRAINT %I',name);
 EXECUTE format($c$ALTER TABLE app.inbox_notification ADD CONSTRAINT %I CHECK(type IN ('TEAM_INVITE','CONTRIBUTOR_INVITE','PARTICIPANT_INVITE','TASK_ASSIGNED','QUOTE_SENT','QUOTE_ACCEPTED','REPORT_PUBLISHED','REQUEST_RECEIVED','REPLY_POSTED','MEMBER_NOTICE'))$c$,name);
END
$type$;

-- 2 and 3. The delivery record and the dismissals.
CREATE TABLE customer_private.member_notice_delivery (
 workspace_id uuid PRIMARY KEY REFERENCES customer.workspace(tenant_id),
 delivered_at timestamptz NOT NULL,
 opens_at timestamptz NOT NULL,
 delivered_by text NOT NULL CHECK(length(delivered_by) BETWEEN 1 AND 200),
 CHECK(opens_at=delivered_at+interval '24 hours')
);
CREATE TABLE customer_private.member_notice_dismissal (
 workspace_id uuid NOT NULL REFERENCES customer_private.member_notice_delivery(workspace_id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 dismissed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,principal_id)
);
ALTER TABLE customer_private.member_notice_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.member_notice_dismissal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.member_notice_delivery FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON customer_private.member_notice_dismissal FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER member_notice_delivery_immutable BEFORE UPDATE OR DELETE ON customer_private.member_notice_delivery
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER member_notice_dismissal_immutable BEFORE UPDATE OR DELETE ON customer_private.member_notice_dismissal
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- 4. Delivery, owner run, once per workspace.
CREATE FUNCTION customer_private.member_notice_deliver(workspace uuid,delivered_by text)
 RETURNS TABLE(delivered boolean,delivered_at timestamptz,opens_at timestamptz,notices integer)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE moment timestamptz:=clock_timestamp(); recorded customer_private.member_notice_delivery; written integer;
BEGIN
 IF workspace IS NULL OR NOT EXISTS(SELECT FROM customer.workspace w WHERE w.tenant_id=workspace) THEN
  RAISE EXCEPTION 'Unknown workspace' USING ERRCODE='22023';
 END IF;
 INSERT INTO customer_private.member_notice_delivery(workspace_id,delivered_at,opens_at,delivered_by)
 VALUES(workspace,moment,moment+interval '24 hours',delivered_by)
 ON CONFLICT(workspace_id) DO NOTHING RETURNING * INTO recorded;
 IF recorded IS NULL THEN
  -- Delivered before: nothing is written and the first time is kept, so the clock never restarts.
  SELECT * INTO recorded FROM customer_private.member_notice_delivery d WHERE d.workspace_id=workspace;
  RETURN QUERY SELECT false,recorded.delivered_at,recorded.opens_at,0;
  RETURN;
 END IF;
 INSERT INTO app.inbox_notification(recipient_kind,recipient_account_id,type,event_key,payload,created_at)
 SELECT 'customer',p.principal_id,'MEMBER_NOTICE','member-notice:'||workspace::text,
  jsonb_build_object('workspaceId',workspace::text,
   'opensAt',to_char(recorded.opens_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   -- decision-4b-begin
   'words','Owners and admins of this workspace can read the reports you save and the decision cards you make here, and download the Trip Book and Supplier Book of your saved reports. This includes items you saved before today. They cannot remove or withdraw them. If there is anything you do not want them to see, you can remove it before [date and time].'
   -- decision-4b-end
   ),moment
 FROM (SELECT m.principal_id FROM customer.membership m WHERE m.tenant_id=workspace
  UNION SELECT w.principal_id FROM customer_private.workspace_member w WHERE w.tenant_id=workspace) p
 WHERE customer_private.workspace_member_current(workspace,p.principal_id)
 ON CONFLICT(recipient_kind,recipient_account_id,type,event_key) WHERE event_key IS NOT NULL DO NOTHING;
 GET DIAGNOSTICS written=ROW_COUNT;
 RETURN QUERY SELECT true,recorded.delivered_at,recorded.opens_at,written;
END $$;
REVOKE ALL ON FUNCTION customer_private.member_notice_deliver(uuid,text) FROM PUBLIC,corridra_runtime,corridra_auth;

-- 5. What a current member reads and does.
CREATE FUNCTION customer.member_notice_state(workspace uuid)
 RETURNS TABLE(delivered_at timestamptz,opens_at timestamptz,dismissed boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT d.delivered_at,d.opens_at,
  EXISTS(SELECT FROM customer_private.member_notice_dismissal x WHERE x.workspace_id=d.workspace_id AND x.principal_id=a.id)
 FROM customer_private.member_notice_delivery d, (SELECT customer.actor_id() AS id) a
 WHERE d.workspace_id=workspace AND a.id IS NOT NULL AND customer_private.workspace_member_current(workspace,a.id)
$$;
-- The notice for the workspace a saved report belongs to: the workspace of the request it was delivered for, when the caller
-- holds the report (not removed) and wrote that request. Nothing for anyone else, and nothing while the delivery tables are absent.
CREATE FUNCTION customer.member_notice_for_saved(saved uuid)
 RETURNS TABLE(workspace_id uuid,delivered_at timestamptz,opens_at timestamptz,dismissed boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE person uuid:=customer.actor_id(); home uuid;
BEGIN
 IF person IS NULL OR saved IS NULL OR to_regclass('app.customer_delivery_assignment') IS NULL THEN RETURN; END IF;
 SELECT o.workspace_id INTO home FROM customer_private.saved_mission m
  JOIN app.customer_delivery_assignment a ON a.tenant_id=m.link_tenant_id AND a.link_id=m.link_id
  JOIN customer_private.owned_request o ON o.id=a.request_id AND o.principal_id=person
  WHERE m.id=saved AND m.principal_id=person AND m.removed_at IS NULL
  LIMIT 1;
 IF home IS NULL THEN RETURN; END IF;
 RETURN QUERY SELECT home,s.delivered_at,s.opens_at,s.dismissed FROM customer.member_notice_state(home) s;
END $$;
CREATE FUNCTION customer.member_notice_dismiss(workspace uuid) RETURNS boolean
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE person uuid:=customer.actor_id();
BEGIN
 IF person IS NULL OR workspace IS NULL OR NOT customer_private.workspace_member_current(workspace,person)
  OR NOT EXISTS(SELECT FROM customer_private.member_notice_delivery d WHERE d.workspace_id=workspace) THEN
  RAISE EXCEPTION 'Workspace access denied' USING ERRCODE='42501';
 END IF;
 INSERT INTO customer_private.member_notice_dismissal(workspace_id,principal_id) VALUES(workspace,person)
 ON CONFLICT DO NOTHING;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION customer.member_notice_state(uuid) FROM PUBLIC,corridra_auth;
REVOKE ALL ON FUNCTION customer.member_notice_dismiss(uuid) FROM PUBLIC,corridra_auth;
REVOKE ALL ON FUNCTION customer.member_notice_for_saved(uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.member_notice_for_saved(uuid) TO corridra_runtime;
GRANT EXECUTE ON FUNCTION customer.member_notice_state(uuid) TO corridra_runtime;
GRANT EXECUTE ON FUNCTION customer.member_notice_dismiss(uuid) TO corridra_runtime;
COMMENT ON TABLE customer_private.member_notice_delivery IS
 'ADR-087 U4: when each workspace''s member notice was delivered (start of the 4d clock) and opens_at, 24 hours later. Never reset.';

-- The definers are owned by whoever installs them. They call the membership helper, so its owner must be able to.
DO $owner$
DECLARE holder text;
BEGIN
 SELECT pg_get_userbyid(p.proowner) INTO holder FROM pg_proc p WHERE p.oid='customer.member_notice_state(uuid)'::regprocedure;
 IF NOT has_function_privilege(holder,'customer_private.workspace_member_current(uuid,uuid)','EXECUTE') THEN
  EXECUTE format('GRANT EXECUTE ON FUNCTION customer_private.workspace_member_current(uuid,uuid) TO %I',holder);
 END IF;
 IF NOT has_function_privilege(holder,'customer.actor_id()','EXECUTE') THEN
  EXECUTE format('GRANT EXECUTE ON FUNCTION customer.actor_id() TO %I',holder);
 END IF;
END
$owner$;

DO $proof$
DECLARE f record; live text;
BEGIN
 SELECT pg_get_constraintdef(c.oid) INTO live FROM pg_constraint c
  WHERE c.conrelid='app.inbox_notification'::regclass AND c.contype='c'
   AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid='app.inbox_notification'::regclass AND a.attname='type')];
 -- replaced-check-begin
 IF encode(sha256(convert_to(live,'UTF8')),'hex')<>'909f926eb790433d7842d1a4e405282a1ea20dd161d373b3345e855f46407891' THEN
  RAISE EXCEPTION 'Member notice: the new inbox type check is not the one this file defines';
 END IF;
 -- replaced-check-end
 FOR f IN SELECT p.oid::regprocedure::text AS sig,p.prosecdef,p.proconfig,p.proacl FROM pg_proc p
  WHERE p.oid IN ('customer_private.member_notice_deliver(uuid,text)'::regprocedure,
   'customer.member_notice_state(uuid)'::regprocedure,'customer.member_notice_dismiss(uuid)'::regprocedure,
   'customer.member_notice_for_saved(uuid)'::regprocedure) LOOP
  IF NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
   RAISE EXCEPTION 'Member notice: % is not the definer this file defines',f.sig;
  END IF;
  IF EXISTS(SELECT FROM aclexplode(f.proacl) a WHERE a.grantee=0) THEN
   RAISE EXCEPTION 'Member notice: PUBLIC must not execute %',f.sig;
  END IF;
  IF has_function_privilege('corridra_auth',f.sig,'EXECUTE') THEN
   RAISE EXCEPTION 'Member notice: the auth role must not execute %',f.sig;
  END IF;
 END LOOP;
 IF has_function_privilege('corridra_runtime','customer_private.member_notice_deliver(uuid,text)','EXECUTE') THEN
  RAISE EXCEPTION 'Member notice: the runtime role must not deliver';
 END IF;
 IF NOT has_function_privilege('corridra_runtime','customer.member_notice_state(uuid)','EXECUTE')
  OR NOT has_function_privilege('corridra_runtime','customer.member_notice_dismiss(uuid)','EXECUTE')
  OR NOT has_function_privilege('corridra_runtime','customer.member_notice_for_saved(uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'Member notice: the runtime role must read the state and dismiss';
 END IF;
 IF has_table_privilege('corridra_runtime','customer_private.member_notice_delivery','SELECT,INSERT,UPDATE,DELETE')
  OR has_table_privilege('corridra_runtime','customer_private.member_notice_dismissal','SELECT,INSERT,UPDATE,DELETE') THEN
  RAISE EXCEPTION 'Member notice: the runtime role must not touch the tables directly';
 END IF;
 -- History: both tables refuse every UPDATE and DELETE through app.reject_rewrite(), enabled, before the row is touched.
 IF (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled='O'
   AND t.tgfoid='app.reject_rewrite()'::regprocedure AND t.tgtype=27
   AND t.tgrelid IN ('customer_private.member_notice_delivery'::regclass,'customer_private.member_notice_dismissal'::regclass))<>2 THEN
  RAISE EXCEPTION 'Member notice: both tables must refuse UPDATE and DELETE through app.reject_rewrite()';
 END IF;
END
$proof$;
