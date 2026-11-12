-- Participant fee question: a participant flags a question about their own fee or payment status; the organiser (workspace owner
-- or admin) sees it and marks it resolved or not taken further. Record only.
-- Owner mandate, 11 Nov 2026, section 11: Corridra does not handle, collect or check payments. This module therefore has NO
-- connection to money: it reads no ledger amount, writes no ledger entry and changes no outstanding amount, recorded amount or
-- payment status. A question and its answer are two append-only rows and nothing else.
-- No free text anywhere. The reason is one of a closed set and the organiser's answer is one of two words, so no personal words
-- can enter this module and nothing here falls inside an erasure request.
-- Additive: three tables, helper functions and four customer functions. No existing table, policy, trigger, function, row or
-- event is changed or deleted. Reuses customer_private.payment_declaration_registration from real-use 0016 for the participant
-- guards (the caller's OWN, ACTIVE registration, inside the access window, fees apply) and participant_scope(...,true) for the
-- organiser. No participant label is read here: the organiser screen already holds the labels from the economics summary.
-- Safe to run more than once: IF NOT EXISTS / CREATE OR REPLACE, then the same REVOKE and GRANT. Fails closed when a
-- prerequisite is missing.
DO $guard$ BEGIN
 IF to_regprocedure('customer_private.payment_declaration_registration(uuid,uuid,boolean)') IS NULL
  OR to_regprocedure('customer_private.participant_scope(uuid,uuid,uuid,boolean)') IS NULL
  OR to_regprocedure('customer_private.coordination_expiry()') IS NULL
  OR to_regprocedure('customer_private.programme_ledger_expiry()') IS NULL
  OR to_regprocedure('customer_private.synthetic_context()') IS NULL
  OR to_regprocedure('app.reject_rewrite()') IS NULL
  OR to_regclass('customer_private.programme_registration') IS NULL
  OR to_regclass('customer_private.programme_payment_declaration') IS NULL THEN
  RAISE EXCEPTION 'Participant fee dispute prerequisite is missing';
 END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS customer_private.programme_fee_dispute (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 registration_id uuid NOT NULL REFERENCES customer_private.programme_registration(id),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 reason text NOT NULL CHECK(reason IN ('AMOUNT_WRONG','ALREADY_PAID','NOT_ATTENDING','OTHER')),
 filed_by uuid NOT NULL REFERENCES customer_private.principal(id),
 filed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,workspace_id,programme_id),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS programme_fee_dispute_registration ON customer_private.programme_fee_dispute(registration_id,filed_at);
CREATE INDEX IF NOT EXISTS programme_fee_dispute_programme ON customer_private.programme_fee_dispute(workspace_id,programme_id,filed_at);

CREATE TABLE IF NOT EXISTS customer_private.programme_fee_dispute_resolution (
 dispute_id uuid PRIMARY KEY REFERENCES customer_private.programme_fee_dispute(id),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 outcome text NOT NULL CHECK(outcome IN ('RESOLVED','DECLINED')),
 decided_by uuid NOT NULL REFERENCES customer_private.principal(id),
 decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(dispute_id,workspace_id,programme_id) REFERENCES customer_private.programme_fee_dispute(id,workspace_id,programme_id)
);

CREATE TABLE IF NOT EXISTS customer_private.programme_fee_dispute_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('FILE','DECIDE')),
 dispute_id uuid NOT NULL REFERENCES customer_private.programme_fee_dispute(id),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,command_id)
);

DO $triggers$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='programme_fee_dispute_immutable' AND tgrelid='customer_private.programme_fee_dispute'::regclass) THEN
  CREATE TRIGGER programme_fee_dispute_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_fee_dispute FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
 END IF;
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='programme_fee_dispute_resolution_immutable' AND tgrelid='customer_private.programme_fee_dispute_resolution'::regclass) THEN
  CREATE TRIGGER programme_fee_dispute_resolution_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_fee_dispute_resolution FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
 END IF;
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='programme_fee_dispute_command_immutable' AND tgrelid='customer_private.programme_fee_dispute_command'::regclass) THEN
  CREATE TRIGGER programme_fee_dispute_command_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_fee_dispute_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
 END IF;
END $triggers$;
ALTER TABLE customer_private.programme_fee_dispute ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_fee_dispute_resolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_fee_dispute_command ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.programme_fee_dispute,customer_private.programme_fee_dispute_resolution,customer_private.programme_fee_dispute_command FROM PUBLIC,corridra_runtime,corridra_auth;

-- Database-level integrity, so even a direct insert cannot break the rules the functions enforce.
CREATE OR REPLACE FUNCTION customer_private.programme_fee_dispute_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM customer_private.programme_registration r WHERE r.id=NEW.registration_id AND r.workspace_id=NEW.workspace_id
   AND r.programme_id=NEW.programme_id AND r.principal_id=NEW.filed_by) THEN
  RAISE EXCEPTION 'Registration outside this programme' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DO $triggers$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='programme_fee_dispute_guard' AND tgrelid='customer_private.programme_fee_dispute'::regclass) THEN
  CREATE TRIGGER programme_fee_dispute_guard BEFORE INSERT ON customer_private.programme_fee_dispute FOR EACH ROW EXECUTE FUNCTION customer_private.programme_fee_dispute_guard();
 END IF;
END $triggers$;

CREATE OR REPLACE FUNCTION customer_private.programme_fee_dispute_event(target uuid,actor uuid,command uuid,programme uuid,dispute uuid,act text) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid;eid uuid:=gen_random_uuid();v integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 IF act NOT IN ('filed','resolved','declined') THEN RAISE EXCEPTION 'Invalid event' USING ERRCODE='23514'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v FROM app.domain_event e WHERE e.tenant_id=target AND e.aggregate_type='customer_programme_fee_dispute' AND e.aggregate_id=programme::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.programme_fee_dispute.'||act,1,'customer_programme_fee_dispute',programme::text,v,executor,clock_timestamp(),command,command,
 jsonb_build_object('disputeId',dispute,'synthetic',customer_private.synthetic_context(),'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.programme_fee_dispute.'||act);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

-- One question as the caller may see it. The same words for the participant and the organiser. No amount, no label, no free text.
CREATE OR REPLACE FUNCTION customer_private.programme_fee_dispute_json(selected uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',d.id,'registrationId',d.registration_id,'reason',d.reason,'filedAt',d.filed_at,
  'status',CASE WHEN x.dispute_id IS NULL THEN 'OPEN' ELSE x.outcome END,'decidedAt',x.decided_at)
 FROM customer_private.programme_fee_dispute d
 LEFT JOIN customer_private.programme_fee_dispute_resolution x ON x.dispute_id=d.id WHERE d.id=selected
$$;

CREATE OR REPLACE FUNCTION customer.file_programme_fee_dispute(command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reg customer_private.programme_registration;actor uuid;prior customer_private.programme_fee_dispute_command;d customer_private.programme_fee_dispute;why text;req jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid fee question' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['registrationId','reason']<>'{}'::jsonb OR NOT(input ?& ARRAY['registrationId','reason'])
  OR jsonb_typeof(input->'registrationId')<>'string' OR jsonb_typeof(input->'reason')<>'string'
  OR input->>'registrationId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR input->>'reason' NOT IN ('AMOUNT_WRONG','ALREADY_PAID','NOT_ATTENDING','OTHER') THEN RAISE EXCEPTION 'Invalid fee question' USING ERRCODE='23514'; END IF;
 reg:=customer_private.payment_declaration_registration(command,(input->>'registrationId')::uuid,true);
 actor:=customer.actor_id();
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.fee_dispute:'||reg.id::text,0));
 req:=jsonb_build_object('payload',input);
 SELECT * INTO prior FROM customer_private.programme_fee_dispute_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.action<>'FILE' OR prior.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('registrationId',reg.id,'expiresAt',customer_private.coordination_expiry(),'commandId',command,'replayed',true,'recordOnly',true,
   'dispute',customer_private.programme_fee_dispute_json(prior.dispute_id));
 END IF;
 why:=input->>'reason';
 -- Bounded queue for the organiser: one open question per reason and at most four open questions for one registration.
 IF EXISTS(SELECT FROM customer_private.programme_fee_dispute x WHERE x.registration_id=reg.id AND x.reason=why
   AND NOT EXISTS(SELECT FROM customer_private.programme_fee_dispute_resolution y WHERE y.dispute_id=x.id)) THEN
  RAISE EXCEPTION 'This question is already open' USING ERRCODE='23514';
 END IF;
 IF (SELECT count(*) FROM customer_private.programme_fee_dispute x WHERE x.registration_id=reg.id
   AND NOT EXISTS(SELECT FROM customer_private.programme_fee_dispute_resolution y WHERE y.dispute_id=x.id))>=4 THEN
  RAISE EXCEPTION 'Too many questions are awaiting the organiser' USING ERRCODE='23514';
 END IF;
 INSERT INTO customer_private.programme_fee_dispute(registration_id,workspace_id,programme_id,reason,filed_by)
 VALUES(reg.id,reg.workspace_id,reg.programme_id,why,actor) RETURNING * INTO d;
 INSERT INTO customer_private.programme_fee_dispute_command(actor_id,command_id,action,dispute_id,request) VALUES(actor,command,'FILE',d.id,req);
 PERFORM customer_private.programme_fee_dispute_event(reg.workspace_id,actor,command,reg.programme_id,d.id,'filed');
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrationId',reg.id,'expiresAt',customer_private.coordination_expiry(),'commandId',command,'replayed',false,'recordOnly',true,
  'dispute',customer_private.programme_fee_dispute_json(d.id));
END $$;

CREATE OR REPLACE FUNCTION customer.own_programme_fee_disputes(registration uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reg customer_private.programme_registration;fees boolean:=false;items jsonb:='[]'::jsonb;actor uuid;
BEGIN
 reg:=customer_private.payment_declaration_registration(gen_random_uuid(),registration,false);
 actor:=customer.actor_id();
 SELECT t.fees_apply INTO fees FROM customer_private.programme_terms_revision t WHERE t.programme_id=reg.programme_id ORDER BY t.version DESC LIMIT 1;
 IF coalesce(fees,false) THEN
  SELECT coalesce(jsonb_agg(customer_private.programme_fee_dispute_json(s.id) ORDER BY s.filed_at DESC,s.id),'[]'::jsonb) INTO items
  FROM (SELECT d.id,d.filed_at FROM customer_private.programme_fee_dispute d WHERE d.registration_id=reg.id ORDER BY d.filed_at DESC,d.id LIMIT 50) s;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrationId',reg.id,'programmeId',reg.programme_id,'expiresAt',customer_private.coordination_expiry(),
  'recordOnly',true,'collectsPayments',false,'disputes',items);
END $$;

-- The organiser's open questions for one programme. Owner or admin of the workspace only (participant_scope with manage = true).
CREATE OR REPLACE FUNCTION customer.programme_fee_disputes_open(target uuid,programme uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;items jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF target IS NULL OR programme IS NULL THEN RAISE EXCEPTION 'Invalid programme' USING ERRCODE='23514'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);
 SELECT coalesce(jsonb_agg(customer_private.programme_fee_dispute_json(s.id) ORDER BY s.filed_at,s.id),'[]'::jsonb) INTO items
 FROM (SELECT d.id,d.filed_at FROM customer_private.programme_fee_dispute d
  WHERE d.workspace_id=target AND d.programme_id=programme AND NOT EXISTS(SELECT FROM customer_private.programme_fee_dispute_resolution y WHERE y.dispute_id=d.id)
  ORDER BY d.filed_at,d.id LIMIT 100) s;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.programme_ledger_expiry(),'recordOnly',true,'disputes',items);
END $$;

-- The organiser answers once, with one of two words. This writes one row and one event; it reads and writes no ledger entry.
CREATE OR REPLACE FUNCTION customer.decide_programme_fee_dispute(command uuid,target uuid,programme uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.programme_fee_dispute_command;d customer_private.programme_fee_dispute;verdict text;req jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR programme IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid fee question answer' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['disputeId','outcome']<>'{}'::jsonb OR NOT(input ?& ARRAY['disputeId','outcome'])
  OR jsonb_typeof(input->'disputeId')<>'string' OR jsonb_typeof(input->'outcome')<>'string'
  OR input->>'disputeId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid fee question answer' USING ERRCODE='23514'; END IF;
 verdict:=input->>'outcome';
 IF verdict NOT IN ('RESOLVED','DECLINED') THEN RAISE EXCEPTION 'Invalid fee question answer' USING ERRCODE='23514'; END IF;
 actor:=customer_private.participant_scope(command,target,programme,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.fee_dispute_decision:'||(input->>'disputeId'),0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 req:=jsonb_build_object('workspaceId',target,'programmeId',programme,'payload',input);
 SELECT * INTO prior FROM customer_private.programme_fee_dispute_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.action<>'DECIDE' OR prior.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.programme_ledger_expiry(),'commandId',command,'replayed',true,'recordOnly',true,
   'dispute',customer_private.programme_fee_dispute_json(prior.dispute_id));
 END IF;
 SELECT * INTO d FROM customer_private.programme_fee_dispute y WHERE y.id=(input->>'disputeId')::uuid AND y.workspace_id=target AND y.programme_id=programme;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fee question unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM customer_private.programme_fee_dispute_resolution y WHERE y.dispute_id=d.id) THEN RAISE EXCEPTION 'Fee question already answered' USING ERRCODE='23514'; END IF;
 INSERT INTO customer_private.programme_fee_dispute_resolution(dispute_id,workspace_id,programme_id,outcome,decided_by) VALUES(d.id,target,programme,verdict,actor);
 INSERT INTO customer_private.programme_fee_dispute_command(actor_id,command_id,action,dispute_id,request) VALUES(actor,command,'DECIDE',d.id,req);
 PERFORM customer_private.programme_fee_dispute_event(target,actor,command,programme,d.id,CASE WHEN verdict='RESOLVED' THEN 'resolved' ELSE 'declined' END);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.programme_ledger_expiry(),'commandId',command,'replayed',false,'recordOnly',true,
  'dispute',customer_private.programme_fee_dispute_json(d.id));
END $$;

REVOKE ALL ON FUNCTION customer_private.programme_fee_dispute_guard(),customer_private.programme_fee_dispute_event(uuid,uuid,uuid,uuid,uuid,text),
 customer_private.programme_fee_dispute_json(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.file_programme_fee_dispute(uuid,jsonb),customer.own_programme_fee_disputes(uuid),
 customer.programme_fee_disputes_open(uuid,uuid),customer.decide_programme_fee_dispute(uuid,uuid,uuid,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.file_programme_fee_dispute(uuid,jsonb),customer.own_programme_fee_disputes(uuid),
 customer.programme_fee_disputes_open(uuid,uuid),customer.decide_programme_fee_dispute(uuid,uuid,uuid,jsonb) TO corridra_runtime;
