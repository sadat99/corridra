-- Move records (ADR-068): what a person must do next, set by the Corridra team about one request and
-- read by the person who submitted it. Optional authority; installing this schema alone changes nothing
-- anyone can see. The control starts closed and only an offline schema-owner operation opens it.
-- Additive only: no existing table, policy, trigger, grant or function is changed.
-- History is exact: a Move is set once and closed once (DONE or CLEARED); nothing is updated or deleted.

DO $guard$ BEGIN
 IF to_regprocedure('customer_private.request_actor()') IS NULL
 OR to_regprocedure('customer_private.synthetic_context()') IS NULL
 OR to_regprocedure('customer.actor_id()') IS NULL
 OR to_regprocedure('app.actor_id()') IS NULL
 OR to_regprocedure('app.can_access(uuid,text,text)') IS NULL
 OR to_regprocedure('app.member_role(uuid)') IS NULL
 OR to_regprocedure('app.real_use_allowed(uuid)') IS NULL
 OR to_regprocedure('app.tenant_processing_purpose(uuid)') IS NULL
 OR to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regprocedure('app.record_change()') IS NULL
 OR to_regclass('customer_private.owned_request') IS NULL
 OR to_regclass('customer_private.request_revocation') IS NULL
 OR to_regclass('customer_private.configuration') IS NULL
 OR to_regclass('app.mission') IS NULL
 OR to_regclass('app.mission_intake') IS NULL
 THEN RAISE EXCEPTION 'Move record prerequisites are missing'; END IF;
END $guard$;

CREATE TABLE customer_private.move_control (
 version integer PRIMARY KEY CHECK(version>0),enabled boolean NOT NULL,
 executor_id uuid NOT NULL REFERENCES identity.principal(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE customer_private.move_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.move_control FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER move_control_immutable BEFORE UPDATE OR DELETE ON customer_private.move_control
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- Closed unless the latest control row says enabled. No row means closed.
CREATE FUNCTION customer_private.move_open() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT enabled FROM customer_private.move_control ORDER BY version DESC LIMIT 1),false)
$$;
REVOKE ALL ON FUNCTION customer_private.move_open() FROM PUBLIC,corridra_runtime,corridra_auth;

-- One row per staff command. Idempotent by command id: the same id with the same input is a replay.
CREATE TABLE app.mission_move_command (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,mission_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('SET','DONE','CLEAR')),
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id)
);
-- A Move. The words are plain (no markup, no link, no address, nothing that looks like money).
CREATE TABLE app.mission_move (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,mission_id uuid NOT NULL,
 command_id uuid NOT NULL REFERENCES app.mission_move_command(id),
 position smallint NOT NULL CHECK(position BETWEEN 1 AND 5),
 verb text NOT NULL CHECK(verb IN ('Read','Answer','Add','Confirm','Choose','Send')),
 object text NOT NULL CHECK(
  length(object) BETWEEN 3 AND 80
  AND object !~ '[[:cntrl:]<>]'
  AND object !~* '(https?:|www\.|@|\.(com|net|org|io|co|cn|bd|es)\M)'
  AND object !~* '(\m(usd|eur|gbp|bdt|cny|rmb|inr)\M|[$€£৳¥]|[0-9][0-9,.]* ?[km]\M|[0-9]{1,3}(,[0-9]{3})+|[0-9]+\.[0-9]{2}\M)'),
 holder text NOT NULL CHECK(holder IN ('customer','team','third')),
 due_on date,
 created_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(command_id,position),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id)
);
CREATE INDEX mission_move_mission_idx ON app.mission_move(tenant_id,mission_id,created_at);
-- A Move is closed once. DONE: it was done. CLEARED: the team replaced or withdrew it.
CREATE TABLE app.mission_move_close (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,mission_id uuid NOT NULL,
 move_id uuid NOT NULL UNIQUE REFERENCES app.mission_move(id),
 outcome text NOT NULL CHECK(outcome IN ('DONE','CLEARED')),
 command_id uuid NOT NULL REFERENCES app.mission_move_command(id),
 closed_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id)
);

-- Nothing is rewritten or deleted.
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.mission_move_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.mission_move FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.mission_move_close FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- Guards. Definer functions so they can read the closed control and the other tables whatever the caller may see.
CREATE FUNCTION app.guard_mission_move_command() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.actor_id IS DISTINCT FROM app.actor_id() THEN RAISE EXCEPTION 'Actor mismatch' USING ERRCODE='42501'; END IF;
 -- Every Move write begins with a command row, so the authenticator check is made here as well as in the
 -- application: a path that reaches the pool without it cannot write a Move five minutes after the last check.
 IF NOT app.fresh_mfa() THEN RAISE EXCEPTION 'Verify your authenticator again to continue' USING ERRCODE='42501'; END IF;
 IF NOT customer_private.move_open() THEN RAISE EXCEPTION 'Move records are not open' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION app.guard_mission_move() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cmd app.mission_move_command; open_now integer;
BEGIN
 SELECT * INTO cmd FROM app.mission_move_command WHERE id=NEW.command_id;
 IF NOT FOUND OR cmd.kind<>'SET' OR (cmd.tenant_id,cmd.mission_id,cmd.actor_id) IS DISTINCT FROM (NEW.tenant_id,NEW.mission_id,NEW.created_by)
  OR NEW.created_by IS DISTINCT FROM app.actor_id() THEN RAISE EXCEPTION 'Move does not belong to this command' USING ERRCODE='42501'; END IF;
 -- Today in any time zone: a day of grace on the past side, because the database date is UTC and staff may be behind it.
 IF NEW.due_on IS NOT NULL AND (NEW.due_on<current_date-1 OR NEW.due_on>current_date+365) THEN RAISE EXCEPTION 'A due date must be today or up to a year ahead' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO open_now FROM app.mission_move m WHERE m.tenant_id=NEW.tenant_id AND m.mission_id=NEW.mission_id
  AND NOT EXISTS(SELECT FROM app.mission_move_close c WHERE c.move_id=m.id);
 IF open_now>=5 THEN RAISE EXCEPTION 'At most five open Moves per request' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION app.guard_mission_move_close() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cmd app.mission_move_command; mv app.mission_move;
BEGIN
 SELECT * INTO cmd FROM app.mission_move_command WHERE id=NEW.command_id;
 SELECT * INTO mv FROM app.mission_move WHERE id=NEW.move_id;
 IF NOT FOUND OR cmd.id IS NULL OR (cmd.tenant_id,cmd.mission_id,cmd.actor_id) IS DISTINCT FROM (NEW.tenant_id,NEW.mission_id,NEW.closed_by)
  OR (mv.tenant_id,mv.mission_id) IS DISTINCT FROM (NEW.tenant_id,NEW.mission_id)
  OR NEW.closed_by IS DISTINCT FROM app.actor_id() THEN RAISE EXCEPTION 'Close does not belong to this command' USING ERRCODE='42501'; END IF;
 IF NOT ((cmd.kind='DONE' AND NEW.outcome='DONE') OR (cmd.kind IN ('SET','CLEAR') AND NEW.outcome='CLEARED')) THEN
  RAISE EXCEPTION 'Close outcome does not match its command' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_mission_move_command(),app.guard_mission_move(),app.guard_mission_move_close() FROM PUBLIC;
CREATE TRIGGER guard BEFORE INSERT ON app.mission_move_command FOR EACH ROW EXECUTE FUNCTION app.guard_mission_move_command();
CREATE TRIGGER guard BEFORE INSERT ON app.mission_move FOR EACH ROW EXECUTE FUNCTION app.guard_mission_move();
CREATE TRIGGER guard BEFORE INSERT ON app.mission_move_close FOR EACH ROW EXECUTE FUNCTION app.guard_mission_move_close();
-- Events hold ids only (record_change keeps the id, version, status and role, never the words).
CREATE TRIGGER mission_move_event AFTER INSERT ON app.mission_move FOR EACH ROW EXECUTE FUNCTION app.record_change();
CREATE TRIGGER mission_move_close_event AFTER INSERT ON app.mission_move_close FOR EACH ROW EXECUTE FUNCTION app.record_change();

-- The Corridra team reads and adds; nobody changes. Synthetic and real tenants are separate policies, as for replies.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['mission_move_command','mission_move','mission_move_close'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY read ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation''))',t);
  EXECUTE format('CREATE POLICY add ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator''))',t);
  EXECUTE format('CREATE POLICY real_use_read ON app.%I FOR SELECT TO corridra_runtime USING(app.real_use_allowed(tenant_id) AND app.can_access(tenant_id,''INTERNAL'',app.tenant_processing_purpose(tenant_id)))',t);
  EXECUTE format('CREATE POLICY real_use_add ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.real_use_allowed(tenant_id) AND app.can_access(tenant_id,''INTERNAL'',app.tenant_processing_purpose(tenant_id)) AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator''))',t);
  EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,corridra_auth',t);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO corridra_runtime',t);
 END LOOP;
END $$;

-- What the person reads: the open Moves of the requests they submitted, and nothing else. Another customer,
-- another tenant, a revoked request and a request past its retention window are not distinguishable from
-- nothing. Closed control returns an empty list.
CREATE FUNCTION customer.private_request_moves(after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor(); items jsonb; next_id uuid;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514'; END IF;
 IF NOT customer_private.move_open() THEN
  IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('open',false,'requests','[]'::jsonb,'nextAfter',NULL,'synthetic',customer_private.synthetic_context());
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('requestId',o.id,'moves',(
   SELECT jsonb_agg(jsonb_build_object('id',m.id,'verb',m.verb,'object',m.object,'holder',m.holder,'dueOn',m.due_on,'setAt',m.created_at) ORDER BY m.position,m.created_at)
   FROM app.mission_move m WHERE m.tenant_id=o.mission_tenant_id AND m.mission_id=o.mission_id
   AND NOT EXISTS(SELECT FROM app.mission_move_close c WHERE c.move_id=m.id))) ORDER BY o.id),'[]'::jsonb) INTO items
 FROM (SELECT r.id,r.mission_tenant_id,r.mission_id FROM customer_private.owned_request r
   WHERE r.principal_id=actor AND (after_id IS NULL OR r.id>after_id)
   AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=r.id)
   AND EXISTS(SELECT FROM app.mission_intake i WHERE i.id=r.mission_id AND i.tenant_id=r.mission_tenant_id AND i.retention_until>clock_timestamp())
   AND EXISTS(SELECT FROM app.mission_move m WHERE m.tenant_id=r.mission_tenant_id AND m.mission_id=r.mission_id
     AND NOT EXISTS(SELECT FROM app.mission_move_close c WHERE c.move_id=m.id))
   ORDER BY r.id LIMIT page_size) o;
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'requestId')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.owned_request r WHERE r.principal_id=actor AND r.id>next_id
    AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=r.id)
    AND EXISTS(SELECT FROM app.mission_move m WHERE m.tenant_id=r.mission_tenant_id AND m.mission_id=r.mission_id
     AND NOT EXISTS(SELECT FROM app.mission_move_close c WHERE c.move_id=m.id))) THEN next_id:=NULL; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('open',true,'requests',items,'nextAfter',next_id,'synthetic',customer_private.synthetic_context());
END $$;
REVOKE ALL ON FUNCTION customer.private_request_moves(uuid,integer) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.private_request_moves(uuid,integer) TO corridra_runtime;
