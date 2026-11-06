-- CRUD G5: a person can close their own account with 30 days to undo, and can file an erasure request that staff answer
-- within the legal deadline. Optional module: installing it changes nothing anyone can see, because its control starts
-- closed and only an offline schema-owner operation opens it.
-- Additive only: no existing function, policy, grant or row is replaced or changed. Every statement that writes in this
-- file is an INSERT into a new table, or the event chain of the existing events, audit and outbox tables.
-- Closing deletes nothing. Day 30 is a fact computed on read (the account is then final); no job runs and no row is
-- removed, so invoices, signed decisions, evidence and the audit trail stay exactly as they were.
-- Erasure is a request with a reference and a due date. Staff read the queue and append status rows; no function here
-- edits or deletes anything a person or the law relies on. Completing a request stays a manual step.
-- Events and the audit trail hold ids and a type, never the person's words or the staff note.
DO $guard$ BEGIN
 IF to_regprocedure('customer.actor_id()') IS NULL
 OR to_regprocedure('app.actor_id()') IS NULL
 OR to_regprocedure('app.fresh_mfa()') IS NULL
 OR to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regprocedure('customer_private.workspace_archived(uuid)') IS NULL
 OR to_regclass('customer_private.workspace_lifecycle_control') IS NULL
 OR to_regclass('customer_private.workspace_revision') IS NULL
 OR to_regclass('customer_private.principal') IS NULL
 OR to_regclass('customer_private.configuration') IS NULL
 OR to_regclass('customer_private.workspace_member') IS NULL
 OR to_regclass('customer_private.workspace_access_revocation') IS NULL
 OR to_regclass('customer.workspace') IS NULL
 OR to_regclass('customer.membership') IS NULL
 OR to_regclass('app.domain_event') IS NULL
 OR to_regclass('app.membership') IS NULL
 OR to_regclass('identity.principal') IS NULL
 THEN RAISE EXCEPTION 'Account lifecycle prerequisites are missing'; END IF;
END $guard$;

CREATE TABLE customer_private.account_lifecycle_control (
 version integer PRIMARY KEY CHECK(version>0),enabled boolean NOT NULL,
 executor_id uuid NOT NULL REFERENCES identity.principal(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE customer_private.account_lifecycle_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.account_lifecycle_control FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER account_lifecycle_control_immutable BEFORE UPDATE OR DELETE ON customer_private.account_lifecycle_control
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- Closed unless the latest control row says enabled. No row means closed. One boolean covers closing and erasure.
CREATE FUNCTION customer_private.account_lifecycle_open() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT enabled FROM customer_private.account_lifecycle_control ORDER BY version DESC LIMIT 1),false)
$$;

-- The state of an account is the latest row by seq, never by clock. Closed rows carry the day the undo window ends.
CREATE TABLE customer_private.account_closure_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 state text NOT NULL CHECK(state IN ('closed','restored')),
 occurred_at timestamptz NOT NULL,
 final_at timestamptz,
 command_id uuid NOT NULL UNIQUE,
 CHECK((state='closed' AND final_at=occurred_at+interval '30 days') OR (state='restored' AND final_at IS NULL))
);
CREATE INDEX account_closure_event_latest ON customer_private.account_closure_event(principal_id,seq DESC);

CREATE TABLE customer_private.account_lifecycle_request (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('close','undo','file_erasure')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);

CREATE TABLE customer_private.erasure_request (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 reference text GENERATED ALWAYS AS ('ER-'||lpad(number::text,6,'0')) STORED UNIQUE,
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 filed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 due_at timestamptz NOT NULL,
 command_id uuid NOT NULL UNIQUE,
 CHECK(due_at=filed_at+interval '30 days')
);
CREATE INDEX erasure_request_principal ON customer_private.erasure_request(principal_id,number DESC);

-- Staff append; they never rewrite. The note says what was kept and why, and the person can read it.
CREATE TABLE customer_private.erasure_status_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 request_id uuid NOT NULL REFERENCES customer_private.erasure_request(id),
 state text NOT NULL CHECK(state IN ('received','in_progress','completed','declined')),
 note text,
 staff_principal_id uuid REFERENCES identity.principal(id),
 command_id uuid UNIQUE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(state IN ('received','in_progress') OR (note IS NOT NULL AND length(note) BETWEEN 10 AND 1000)),
 CHECK(note IS NULL OR length(note) BETWEEN 10 AND 1000),
 CHECK((state='received')=(staff_principal_id IS NULL))
);
CREATE INDEX erasure_status_event_latest ON customer_private.erasure_status_event(request_id,seq DESC);

CREATE TRIGGER account_closure_event_immutable BEFORE UPDATE OR DELETE ON customer_private.account_closure_event FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER account_lifecycle_request_immutable BEFORE UPDATE OR DELETE ON customer_private.account_lifecycle_request FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER erasure_request_immutable BEFORE UPDATE OR DELETE ON customer_private.erasure_request FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER erasure_status_event_immutable BEFORE UPDATE OR DELETE ON customer_private.erasure_status_event FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.account_closure_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.account_lifecycle_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.erasure_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.erasure_status_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.account_closure_event,customer_private.account_lifecycle_request,customer_private.erasure_request,
 customer_private.erasure_status_event FROM PUBLIC,corridra_runtime,corridra_auth;

-- The signed-in person, ignoring closure on purpose so a closed person can undo. A disabled person is refused.
CREATE FUNCTION customer_private.account_actor() RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM customer_private.principal WHERE id=actor AND disabled_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;

-- Events need a workspace. The person's earliest workspace is used (an owner row, or an active invited member), and an
-- archived one counts. A person with none is told to write to the privacy contact: no system workspace is created.
CREATE FUNCTION customer_private.account_chain_tenant(person uuid) RETURNS uuid
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE chosen uuid;
BEGIN
 SELECT w.tenant_id INTO chosen FROM customer.workspace w WHERE
  EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=w.tenant_id AND m.principal_id=person)
  OR EXISTS(SELECT FROM customer_private.workspace_member m WHERE m.tenant_id=w.tenant_id AND m.principal_id=person
   AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=m.id))
 ORDER BY w.created_at,w.tenant_id LIMIT 1;
 IF chosen IS NULL THEN
  RAISE EXCEPTION 'There is no workspace on this account. Write to the privacy contact on the privacy page.' USING ERRCODE='23514';
 END IF;
 RETURN chosen;
END $$;

-- Where the account stands now. final is a read-time fact: the latest row is closed and day 30 has passed.
CREATE FUNCTION customer_private.account_status(person uuid) RETURNS TABLE(status text,closed_at timestamptz,final_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN e.state IS DISTINCT FROM 'closed' THEN 'active' WHEN clock_timestamp()<e.final_at THEN 'closed' ELSE 'final' END,
  CASE WHEN e.state='closed' THEN e.occurred_at END,CASE WHEN e.state='closed' THEN e.final_at END
 FROM (SELECT 1) one LEFT JOIN LATERAL (SELECT c.state,c.occurred_at,c.final_at FROM customer_private.account_closure_event c
  WHERE c.principal_id=person ORDER BY c.seq DESC LIMIT 1) e ON true
$$;

-- The erasure request the person has now, if any: the latest by number, with its latest status row.
CREATE FUNCTION customer_private.account_erasure(person uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('reference',r.reference,'filedAt',r.filed_at,'dueAt',r.due_at,'status',s.state,'note',s.note)
 FROM customer_private.erasure_request r
 JOIN LATERAL (SELECT x.state,x.note FROM customer_private.erasure_status_event x WHERE x.request_id=r.id ORDER BY x.seq DESC LIMIT 1) s ON true
 WHERE r.principal_id=person ORDER BY r.number DESC LIMIT 1
$$;

-- One event, one audit row and one outbox row per operation, for a person or for staff. Ids and a type only.
CREATE FUNCTION customer_private.account_lifecycle_event(tenant uuid,person uuid,initiator uuid,initiator_kind text,command uuid,kind text,payload jsonb)
 RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid;eid uuid:=gen_random_uuid();version integer;
BEGIN
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO version FROM app.domain_event e
 WHERE e.tenant_id=tenant AND e.aggregate_type='customer_account_lifecycle' AND e.aggregate_id=person::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,tenant,kind,1,'customer_account_lifecycle',person::text,version,CASE WHEN initiator_kind='staff' THEN initiator ELSE executor END,
  clock_timestamp(),command,command,payload||jsonb_build_object('initiator_kind',initiator_kind,'initiator_id',initiator,'principal_id',person));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),tenant,eid,
  CASE WHEN initiator_kind='staff' THEN initiator ELSE executor END,kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),tenant,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,tenant);
END $$;

-- Staff who may read and move the erasure queue: a signed-in staff owner or admin with a fresh authenticator check.
CREATE FUNCTION customer_private.staff_privacy_actor() RETURNS uuid
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff uuid:=app.actor_id();
BEGIN
 IF staff IS NULL OR NOT app.fresh_mfa() OR NOT EXISTS(SELECT FROM app.membership m WHERE m.user_id=staff
  AND m.role IN ('owner','admin') AND m.revoked_at IS NULL) THEN
  RAISE EXCEPTION 'Privacy queue access denied' USING ERRCODE='42501';
 END IF;
 RETURN staff;
END $$;

REVOKE ALL ON FUNCTION customer_private.account_lifecycle_open(),customer_private.account_actor(),customer_private.account_chain_tenant(uuid),
 customer_private.account_status(uuid),customer_private.account_erasure(uuid),
 customer_private.account_lifecycle_event(uuid,uuid,uuid,text,uuid,text,jsonb),customer_private.staff_privacy_actor()
 FROM PUBLIC,corridra_runtime,corridra_auth;

-- The workspaces that stop a person closing: the person is the owner and the workspace is not archived.
CREATE FUNCTION customer_private.account_blockers(person uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('workspaceId',w.tenant_id,'name',t.name) ORDER BY w.created_at,w.tenant_id),'[]'::jsonb)
 FROM customer.membership m JOIN customer.workspace w ON w.tenant_id=m.tenant_id JOIN app.tenant t ON t.id=w.tenant_id
 WHERE m.principal_id=person AND m.role='owner' AND NOT customer_private.workspace_archived(w.tenant_id)
$$;
REVOKE ALL ON FUNCTION customer_private.account_blockers(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;

-- Signed-in, self only, callable by a closed person. status is active, closed or final; closedAt and undoUntil are null
-- while active. blockers lists the workspaces the person must hand over or archive before closing.
CREATE FUNCTION customer.account_lifecycle_state() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();cur record;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO cur FROM customer_private.account_status(actor);
 RETURN jsonb_build_object('open',customer_private.account_lifecycle_open(),'status',cur.status,'closedAt',cur.closed_at,'undoUntil',cur.final_at,
  'canUndo',cur.status='closed','erasure',customer_private.account_erasure(actor),'blockers',customer_private.account_blockers(actor));
END $$;

-- True when the signed-in person has closed the account (undo window open or passed). It ignores the control, so pausing
-- the module never reopens a closed account. False for anyone not signed in.
CREATE FUNCTION customer.account_closed_gate() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT e.state='closed' FROM customer_private.account_closure_event e
  WHERE e.principal_id=customer.actor_id() ORDER BY e.seq DESC LIMIT 1),false)
$$;

-- close, undo and file_erasure, self only: there is no person id anywhere in the input. One command id per decision:
-- a repeat answers with the first result, the same id for anything else is refused. Undo works while the control is
-- paused. A person with no workspace cannot close or file, and is told whom to write to.
CREATE FUNCTION customer.account_lifecycle_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;tenant uuid;previous customer_private.account_lifecycle_request%ROWTYPE;cur record;result jsonb;
 stamp timestamptz;filed customer_private.erasure_request%ROWTYPE;open_state text;eref text;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' OR operation IS NULL OR operation NOT IN ('close','undo','file_erasure')
  OR input-(CASE operation WHEN 'close' THEN ARRAY['confirmation'] ELSE ARRAY[]::text[] END)<>'{}'::jsonb THEN
  RAISE EXCEPTION 'Invalid account command' USING ERRCODE='22023';
 END IF;
 IF operation='close' AND input->>'confirmation' IS DISTINCT FROM 'Close my account' THEN
  RAISE EXCEPTION 'Type Close my account to confirm' USING ERRCODE='22023';
 END IF;
 actor:=customer_private.account_actor();
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.account.command:'||actor::text||':'||command::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.account.lifecycle:'||actor::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO previous FROM customer_private.account_lifecycle_request q WHERE q.actor_id=actor AND q.command_id=command;
 IF FOUND THEN
  IF previous.operation<>operation OR previous.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN previous.result;
 END IF;
 IF operation<>'undo' AND NOT customer_private.account_lifecycle_open() THEN
  RAISE EXCEPTION 'Account changes are not available yet' USING ERRCODE='0A000';
 END IF;
 SELECT * INTO cur FROM customer_private.account_status(actor);
 IF operation='close' THEN
  IF cur.status<>'active' THEN
   result:=jsonb_build_object('operation','close','changed',false,'status',cur.status,'closedAt',cur.closed_at,'undoUntil',cur.final_at);
  ELSE
   tenant:=customer_private.account_chain_tenant(actor);
   IF customer_private.account_blockers(actor)<>'[]'::jsonb THEN
    RAISE EXCEPTION 'Transfer ownership or archive the workspace first' USING ERRCODE='23514';
   END IF;
   stamp:=clock_timestamp();
   INSERT INTO customer_private.account_closure_event(principal_id,state,occurred_at,final_at,command_id)
   VALUES(actor,'closed',stamp,stamp+interval '30 days',command);
   PERFORM customer_private.account_lifecycle_event(tenant,actor,actor,'customer',command,'customer.account.closed','{}'::jsonb);
   result:=jsonb_build_object('operation','close','changed',true,'status','closed','closedAt',stamp,'undoUntil',stamp+interval '30 days');
  END IF;
 ELSIF operation='undo' THEN
  IF cur.status='final' THEN
   SELECT r.reference INTO eref FROM customer_private.erasure_request r WHERE r.principal_id=actor ORDER BY r.number DESC LIMIT 1;
   RAISE EXCEPTION '%',CASE WHEN eref IS NULL THEN 'This request is with our team. Write to the privacy contact on the privacy page.'
    ELSE 'This request is with our team (reference '||eref||'). Write to the privacy contact on the privacy page.' END USING ERRCODE='23514';
  END IF;
  IF cur.status<>'closed' THEN RAISE EXCEPTION 'Your account is not closed' USING ERRCODE='23514'; END IF;
  tenant:=customer_private.account_chain_tenant(actor);
  INSERT INTO customer_private.account_closure_event(principal_id,state,occurred_at,command_id) VALUES(actor,'restored',clock_timestamp(),command);
  PERFORM customer_private.account_lifecycle_event(tenant,actor,actor,'customer',command,'customer.account.restored','{}'::jsonb);
  result:=jsonb_build_object('operation','undo','changed',true,'status','active','closedAt',NULL,'undoUntil',NULL);
 ELSE
  SELECT r.* INTO filed FROM customer_private.erasure_request r
  WHERE r.principal_id=actor AND (SELECT x.state FROM customer_private.erasure_status_event x WHERE x.request_id=r.id ORDER BY x.seq DESC LIMIT 1) IN ('received','in_progress')
  ORDER BY r.number DESC LIMIT 1;
  IF FOUND THEN
   result:=jsonb_build_object('operation','file_erasure','changed',false,'reference',filed.reference,'filedAt',filed.filed_at,'dueAt',filed.due_at);
  ELSE
   tenant:=customer_private.account_chain_tenant(actor);
   stamp:=clock_timestamp();
   INSERT INTO customer_private.erasure_request(principal_id,filed_at,due_at,command_id) VALUES(actor,stamp,stamp+interval '30 days',command) RETURNING * INTO filed;
   INSERT INTO customer_private.erasure_status_event(request_id,state) VALUES(filed.id,'received');
   PERFORM customer_private.account_lifecycle_event(tenant,actor,actor,'customer',command,'customer.account.erasure_requested',jsonb_build_object('request_id',filed.id));
   result:=jsonb_build_object('operation','file_erasure','changed',true,'reference',filed.reference,'filedAt',filed.filed_at,'dueAt',filed.due_at);
  END IF;
 END IF;
 INSERT INTO customer_private.account_lifecycle_request(actor_id,command_id,operation,request,result) VALUES(actor,command,operation,input,result);
 RETURN result;
END $$;

-- Staff only. The queue of erasure requests, oldest first, paged by number. accountStatus is active, closed or final for
-- the person who filed, with closedAt and undoUntil, so staff can say that an account is closed and can still be undone.
CREATE FUNCTION customer.erasure_queue(after_number bigint DEFAULT NULL,page_size integer DEFAULT 25,state_filter text DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM customer_private.staff_privacy_actor();
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 OR (state_filter IS NOT NULL AND state_filter NOT IN ('received','in_progress','completed','declined')) THEN
  RAISE EXCEPTION 'Invalid queue request' USING ERRCODE='22023';
 END IF;
 RETURN coalesce((SELECT jsonb_agg(item ORDER BY (item->>'number')::bigint) FROM (
  SELECT jsonb_build_object('id',r.id,'number',r.number,'reference',r.reference,'filedAt',r.filed_at,'dueAt',r.due_at,
   'daysLeft',ceil(extract(epoch FROM r.due_at-clock_timestamp())/86400)::integer,'status',s.state,'note',s.note,'principalId',r.principal_id,
   'accountStatus',a.status,'closedAt',a.closed_at,'undoUntil',a.final_at) AS item
  FROM customer_private.erasure_request r
  JOIN LATERAL (SELECT x.state,x.note FROM customer_private.erasure_status_event x WHERE x.request_id=r.id ORDER BY x.seq DESC LIMIT 1) s ON true
  CROSS JOIN LATERAL customer_private.account_status(r.principal_id) a
  WHERE (after_number IS NULL OR r.number>after_number) AND (state_filter IS NULL OR s.state=state_filter)
  ORDER BY r.number LIMIT page_size) page),'[]'::jsonb);
END $$;

-- Staff only. Moves one request along the allowed arrows: received to in_progress, in_progress to completed or declined,
-- received to declined. Completing or declining needs a note of 10 to 1000 characters saying what was kept and why. The
-- same command id and the same decision answers again; any other use of the id is refused. Nothing is edited or deleted.
CREATE FUNCTION customer.erasure_transition(command uuid,request uuid,expected_state text,to_state text,note text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff uuid;filed customer_private.erasure_request%ROWTYPE;prior customer_private.erasure_status_event%ROWTYPE;
 current_state text;words text:=btrim(note);tenant uuid;made customer_private.erasure_status_event%ROWTYPE;
BEGIN
 staff:=customer_private.staff_privacy_actor();
 IF command IS NULL OR request IS NULL OR expected_state IS NULL OR to_state IS NULL
  OR expected_state NOT IN ('received','in_progress') OR to_state NOT IN ('in_progress','completed','declined')
  OR (words IS NOT NULL AND (length(words) NOT BETWEEN 10 AND 1000 OR words ~ '[[:cntrl:]]'))
  OR (to_state IN ('completed','declined') AND words IS NULL) THEN
  RAISE EXCEPTION 'Invalid erasure transition' USING ERRCODE='22023';
 END IF;
 SELECT * INTO filed FROM customer_private.erasure_request r WHERE r.id=request;
 IF NOT FOUND THEN RAISE EXCEPTION 'Erasure request not found' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.account.lifecycle:'||filed.principal_id::text,0));
 SELECT * INTO prior FROM customer_private.erasure_status_event x WHERE x.command_id=command;
 IF FOUND THEN
  IF prior.request_id<>request OR prior.state<>to_state OR prior.note IS DISTINCT FROM words OR prior.staff_principal_id<>staff THEN
   RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('id',filed.id,'reference',filed.reference,'status',prior.state,'note',prior.note,'changed',false);
 END IF;
 SELECT x.state INTO current_state FROM customer_private.erasure_status_event x WHERE x.request_id=request ORDER BY x.seq DESC LIMIT 1;
 IF current_state IS DISTINCT FROM expected_state THEN
  RAISE EXCEPTION 'This request has changed. Reload and try again' USING ERRCODE='23514';
 END IF;
 IF NOT ((current_state='received' AND to_state IN ('in_progress','declined')) OR (current_state='in_progress' AND to_state IN ('completed','declined'))) THEN
  RAISE EXCEPTION 'That change is not allowed from this status' USING ERRCODE='23514';
 END IF;
 tenant:=customer_private.account_chain_tenant(filed.principal_id);
 INSERT INTO customer_private.erasure_status_event(request_id,state,note,staff_principal_id,command_id) VALUES(request,to_state,words,staff,command) RETURNING * INTO made;
 PERFORM customer_private.account_lifecycle_event(tenant,filed.principal_id,staff,'staff',command,'customer.account.erasure_'||to_state,jsonb_build_object('request_id',request));
 RETURN jsonb_build_object('id',filed.id,'reference',filed.reference,'status',made.state,'note',made.note,'changed',true);
END $$;

REVOKE ALL ON FUNCTION customer.account_lifecycle_state(),customer.account_closed_gate(),customer.account_lifecycle_command(uuid,text,jsonb),
 customer.erasure_queue(bigint,integer,text),customer.erasure_transition(uuid,uuid,text,text,text) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.account_lifecycle_state(),customer.account_closed_gate(),customer.account_lifecycle_command(uuid,text,jsonb),
 customer.erasure_queue(bigint,integer,text),customer.erasure_transition(uuid,uuid,text,text,text) TO corridra_runtime;
