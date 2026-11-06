-- CRUD G4: a workspace owner can rename, archive and restore a workspace. Optional module: installing it changes
-- nothing anyone can see, because its control starts closed and only an offline schema-owner operation opens it.
-- Additive only: no existing function, policy or grant is replaced here (file 0003 replaces three, under fingerprints).
-- A rename or an archive is an append-only revision, never a delete. A rename also updates app.tenant.name in the same
-- transaction, because the name is a mutable field; invoices and signed documents keep the wording they snapshotted.
-- Archive refuses new private requests, invitations and registrations (file 0003). It does not make anything read-only.
-- Events and the audit trail hold ids and a type, never the workspace name or the reason a person gave.
-- The tables for handing ownership to another member are created here; the functions that use them are in file 0002.
DO $guard$ BEGIN
 IF to_regprocedure('customer_private.lock_workspace_access(uuid,uuid)') IS NULL
 OR to_regprocedure('customer_private.workspace_access_event(uuid,uuid,uuid,text,jsonb)') IS NULL
 OR to_regprocedure('customer_private.synthetic_context()') IS NULL
 OR to_regprocedure('customer.collaborative_workspaces()') IS NULL
 OR to_regprocedure('customer.actor_id()') IS NULL
 OR to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regclass('customer.workspace') IS NULL
 OR to_regclass('customer.membership') IS NULL
 OR to_regclass('customer_private.principal') IS NULL
 OR to_regclass('customer_private.workspace_member') IS NULL
 OR to_regclass('customer_private.workspace_access_revocation') IS NULL
 OR to_regclass('customer_private.personal_workspace') IS NULL
 OR to_regclass('app.tenant') IS NULL
 THEN RAISE EXCEPTION 'Workspace lifecycle prerequisites are missing'; END IF;
END $guard$;

CREATE TABLE customer_private.workspace_lifecycle_control (
 version integer PRIMARY KEY CHECK(version>0),enabled boolean NOT NULL,
 executor_id uuid NOT NULL REFERENCES identity.principal(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE customer_private.workspace_lifecycle_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.workspace_lifecycle_control FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER workspace_lifecycle_control_immutable BEFORE UPDATE OR DELETE ON customer_private.workspace_lifecycle_control
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- Closed unless the latest control row says enabled. No row means closed.
CREATE FUNCTION customer_private.workspace_lifecycle_open() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT enabled FROM customer_private.workspace_lifecycle_control ORDER BY version DESC LIMIT 1),false)
$$;

-- No row means version 0: the name in app.tenant and not archived. A reason is required for a rename only, because an
-- archive can be undone by a restore.
CREATE TABLE customer_private.workspace_revision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 version integer NOT NULL CHECK(version>=1),
 kind text NOT NULL CHECK(kind IN ('rename','archive','restore')),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 previous_name text NOT NULL,
 archived boolean NOT NULL,
 reason text,
 changed_by uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,version),
 CHECK((kind='rename' AND NOT archived AND reason IS NOT NULL AND length(reason) BETWEEN 10 AND 500)
  OR (kind='archive' AND archived AND reason IS NULL) OR (kind='restore' AND NOT archived AND reason IS NULL))
);
CREATE INDEX workspace_revision_latest ON customer_private.workspace_revision(tenant_id,version DESC);

CREATE TABLE customer_private.workspace_lifecycle_request (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('rename','archive','restore','offer','cancel','accept','decline')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);

-- Handing ownership to an active member. An offer names the member, holds seven days and is open until an outcome
-- row exists; expiry is computed on read, so no job runs.
CREATE TABLE customer_private.workspace_transfer_offer (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 from_principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 to_member_id uuid NOT NULL,
 to_principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '7 days 1 second'),
 CHECK(from_principal_id<>to_principal_id),
 FOREIGN KEY(tenant_id,to_member_id) REFERENCES customer_private.workspace_member(tenant_id,id),
 FOREIGN KEY(to_principal_id,to_member_id) REFERENCES customer_private.workspace_member(principal_id,id)
);
CREATE INDEX workspace_transfer_offer_tenant ON customer_private.workspace_transfer_offer(tenant_id,created_at DESC);
CREATE TABLE customer_private.workspace_transfer_outcome (
 offer_id uuid PRIMARY KEY REFERENCES customer_private.workspace_transfer_offer(id),
 state text NOT NULL CHECK(state IN ('accepted','cancelled','declined')),
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Who owned a workspace after each handover. The first grant is the creation time of the membership row.
CREATE TABLE customer_private.workspace_ownership_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 from_principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 to_principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 offer_id uuid NOT NULL UNIQUE REFERENCES customer_private.workspace_transfer_offer(id),
 occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 command_id uuid NOT NULL UNIQUE
);
CREATE INDEX workspace_ownership_history_tenant ON customer_private.workspace_ownership_history(tenant_id,seq DESC);

CREATE TRIGGER workspace_revision_immutable BEFORE UPDATE OR DELETE ON customer_private.workspace_revision FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER workspace_lifecycle_request_immutable BEFORE UPDATE OR DELETE ON customer_private.workspace_lifecycle_request FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER workspace_transfer_offer_immutable BEFORE UPDATE OR DELETE ON customer_private.workspace_transfer_offer FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER workspace_transfer_outcome_immutable BEFORE UPDATE OR DELETE ON customer_private.workspace_transfer_outcome FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER workspace_ownership_history_immutable BEFORE UPDATE OR DELETE ON customer_private.workspace_ownership_history FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.workspace_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.workspace_lifecycle_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.workspace_transfer_offer ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.workspace_transfer_outcome ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.workspace_ownership_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.workspace_revision,customer_private.workspace_lifecycle_request,customer_private.workspace_transfer_offer,
 customer_private.workspace_transfer_outcome,customer_private.workspace_ownership_history FROM PUBLIC,corridra_runtime,corridra_auth;

-- A uuid carried inside a command, or null when the value is not a string that looks like one.
CREATE FUNCTION customer_private.workspace_command_uuid(value jsonb) RETURNS uuid
 LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(value)='string' AND (value#>>'{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (value#>>'{}')::uuid END
$$;
-- Whether the workspace is archived now: the newest revision decides, by its version number.
CREATE FUNCTION customer_private.workspace_archived(target uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT r.archived FROM customer_private.workspace_revision r WHERE r.tenant_id=target ORDER BY r.version DESC LIMIT 1),false)
$$;
CREATE FUNCTION customer_private.workspace_current(target uuid) RETURNS TABLE(version integer,name text,archived boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT max(r.version) FROM customer_private.workspace_revision r WHERE r.tenant_id=target),0),t.name,customer_private.workspace_archived(target)
 FROM app.tenant t WHERE t.id=target
$$;
-- The one gate every writing path calls. The caller already holds the access lock of the workspace, the same lock an
-- archive takes, so a request cannot slip in beside an archive.
CREATE FUNCTION customer_private.workspace_open_guard(target uuid) RETURNS void
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF customer_private.workspace_archived(target) THEN
  RAISE EXCEPTION 'This workspace is archived. Restore it to send new private requests, invitations and registrations.' USING ERRCODE='55000';
 END IF;
END $$;
REVOKE ALL ON FUNCTION customer_private.workspace_lifecycle_open(),customer_private.workspace_command_uuid(jsonb),customer_private.workspace_archived(uuid),
 customer_private.workspace_current(uuid),customer_private.workspace_open_guard(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;

-- Signed-in. With no workspace: the workspaces the person can reach, each with its version and whether it is archived.
-- With a workspace: how it stands, its last 20 revisions, the open ownership offer the person may see (the owner, and the
-- member it names) and the workspace_member id of the person who became owner by a handover, so the team list can label
-- them. A reason is returned to owners and admins only. No principal id leaves the database.
CREATE FUNCTION customer.workspace_lifecycle_state(target uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();caller_role text;cur record;history jsonb;pending jsonb;owner_member uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF target IS NULL THEN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('workspaceId',w.id,'archived',c.archived,'version',c.version) ORDER BY w.id)
   FROM customer.collaborative_workspaces() w CROSS JOIN LATERAL customer_private.workspace_current(w.id) c),'[]'::jsonb);
 END IF;
 SELECT w.role INTO caller_role FROM customer.collaborative_workspaces() w WHERE w.id=target;
 IF caller_role IS NULL THEN RAISE EXCEPTION 'Workspace access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO cur FROM customer_private.workspace_current(target);
 SELECT coalesce(jsonb_agg(jsonb_build_object('version',r.version,'kind',r.kind,'name',r.name,'previousName',r.previous_name,'at',r.created_at,
  'byYou',r.changed_by=actor,'reason',CASE WHEN caller_role IN ('owner','admin') THEN r.reason END) ORDER BY r.version DESC),'[]'::jsonb) INTO history
 FROM (SELECT * FROM customer_private.workspace_revision WHERE tenant_id=target ORDER BY version DESC LIMIT 20) r;
 SELECT jsonb_build_object('offerId',o.id,'toMemberId',o.to_member_id,'expiresAt',o.expires_at,'toYou',o.to_principal_id=actor,'byYou',o.from_principal_id=actor) INTO pending
 FROM customer_private.workspace_transfer_offer o
 WHERE o.tenant_id=target AND o.expires_at>clock_timestamp() AND (o.from_principal_id=actor OR o.to_principal_id=actor)
 AND NOT EXISTS(SELECT FROM customer_private.workspace_transfer_outcome x WHERE x.offer_id=o.id) ORDER BY o.created_at DESC LIMIT 1;
 SELECT o.to_member_id INTO owner_member FROM customer_private.workspace_ownership_history h
 JOIN customer_private.workspace_transfer_offer o ON o.id=h.offer_id WHERE h.tenant_id=target ORDER BY h.seq DESC LIMIT 1;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('open',customer_private.workspace_lifecycle_open(),'workspaceId',target,'name',cur.name,'archived',cur.archived,
  'version',cur.version,'role',caller_role,'history',history,'offer',pending,'ownerMemberId',owner_member);
END $$;

-- Rename, archive and restore, owner only. One command id per decision: a repeat answers with the first result, the same
-- id for anything else is refused. A stale expectedVersion writes nothing and answers with how the workspace stands now,
-- so the same command id can be sent again with the fresh version. Restore works while the control is paused, so a pause
-- can never trap an archive.
CREATE FUNCTION customer.workspace_lifecycle_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;target uuid;previous customer_private.workspace_lifecycle_request%ROWTYPE;cur record;
 next_name text;note text;allowed text[];next_version integer;result jsonb;kind text;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF input IS NULL OR jsonb_typeof(input)<>'object' OR operation IS NULL OR operation NOT IN ('rename','archive','restore') THEN
  RAISE EXCEPTION 'Invalid workspace command' USING ERRCODE='22023';
 END IF;
 allowed:=CASE operation WHEN 'rename' THEN ARRAY['workspaceId','name','reason','expectedVersion']
  WHEN 'archive' THEN ARRAY['workspaceId','expectedVersion','confirmName'] ELSE ARRAY['workspaceId','expectedVersion'] END;
 IF input-allowed<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid workspace command' USING ERRCODE='22023'; END IF;
 target:=customer_private.workspace_command_uuid(input->'workspaceId');
 IF target IS NULL OR jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR input->>'expectedVersion' !~ '^[0-9]{1,9}$'
  OR (operation='rename' AND (jsonb_typeof(input->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string'))
  OR (operation='archive' AND jsonb_typeof(input->'confirmName') IS DISTINCT FROM 'string') THEN
  RAISE EXCEPTION 'Invalid workspace command' USING ERRCODE='22023';
 END IF;
 actor:=customer_private.lock_workspace_access(command,target);
 SELECT * INTO previous FROM customer_private.workspace_lifecycle_request q WHERE q.actor_id=actor AND q.command_id=command;
 IF FOUND THEN
  IF previous.operation<>operation OR previous.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN previous.result;
 END IF;
 IF NOT EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=target AND m.principal_id=actor AND m.role='owner') THEN
  RAISE EXCEPTION 'Workspace owner required' USING ERRCODE='42501';
 END IF;
 IF operation<>'restore' AND NOT customer_private.workspace_lifecycle_open() THEN
  RAISE EXCEPTION 'Workspace changes are not available yet' USING ERRCODE='0A000';
 END IF;
 SELECT * INTO cur FROM customer_private.workspace_current(target);
 IF cur.version<>(input->>'expectedVersion')::integer THEN
  RETURN jsonb_build_object('stale',true,'workspaceId',target,'currentVersion',cur.version,'currentName',cur.name,'archived',cur.archived);
 END IF;
 next_version:=cur.version+1;
 IF operation='rename' THEN
  IF cur.archived THEN RAISE EXCEPTION 'Restore the workspace before renaming it' USING ERRCODE='23514'; END IF;
  next_name:=btrim(input->>'name');note:=btrim(input->>'reason');
  IF length(next_name) NOT BETWEEN (CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND 120
   OR (next_name NOT LIKE 'Synthetic %' AND customer_private.synthetic_context()) OR next_name ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION 'Enter a workspace name of 2 to 120 characters' USING ERRCODE='22023';
  END IF;
  IF length(note) NOT BETWEEN 10 AND 500 OR note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Enter a reason of 10 to 500 characters' USING ERRCODE='22023'; END IF;
  IF next_name=cur.name THEN RAISE EXCEPTION 'Name is unchanged' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.workspace_revision(tenant_id,version,kind,name,previous_name,archived,reason,changed_by,command_id)
  VALUES(target,next_version,'rename',next_name,cur.name,false,note,actor,command);
  UPDATE app.tenant SET name=next_name WHERE id=target;
  kind:='customer.workspace.renamed';
 ELSIF operation='archive' THEN
  IF input->>'confirmName' IS DISTINCT FROM cur.name THEN RAISE EXCEPTION 'Type the workspace name to confirm' USING ERRCODE='22023'; END IF;
  IF cur.archived THEN RAISE EXCEPTION 'This workspace is already archived' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.workspace_revision(tenant_id,version,kind,name,previous_name,archived,changed_by,command_id)
  VALUES(target,next_version,'archive',cur.name,cur.name,true,actor,command);
  kind:='customer.workspace.archived';
 ELSE
  IF NOT cur.archived THEN RAISE EXCEPTION 'This workspace is not archived' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.workspace_revision(tenant_id,version,kind,name,previous_name,archived,changed_by,command_id)
  VALUES(target,next_version,'restore',cur.name,cur.name,false,actor,command);
  kind:='customer.workspace.restored';
 END IF;
 SELECT * INTO cur FROM customer_private.workspace_current(target);
 result:=jsonb_build_object('workspaceId',target,'name',cur.name,'archived',cur.archived,'version',cur.version,'operation',operation);
 PERFORM customer_private.workspace_access_event(target,actor,command,kind,jsonb_build_object('workspaceId',target,'version',cur.version));
 INSERT INTO customer_private.workspace_lifecycle_request(actor_id,command_id,operation,request,result) VALUES(actor,command,operation,input,result);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION customer.workspace_lifecycle_state(uuid),customer.workspace_lifecycle_command(uuid,text,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.workspace_lifecycle_state(uuid),customer.workspace_lifecycle_command(uuid,text,jsonb) TO corridra_runtime;
