-- Participant payment declaration: a participant tells the organiser "I have paid"; the organiser checks and either acknowledges
-- (which writes the PARTICIPANT_PAYMENT entry through the existing economics ledger path) or does not accept it.
-- Owner mandate, 11 Nov 2026, section 11: a payment declaration is not proof of bank receipt, and Corridra does not handle,
-- collect or check payments. No gateway, no provider, no bank, legal entity or tax data is created here.
-- A declaration alone NEVER changes a recorded or outstanding amount: only an organiser acknowledgement does, and only by
-- calling customer.programme_ledger_record (same function, same immutable-entry and guard triggers, same owner/admin scope).
-- Additive: two tables, one command table, helper functions and four customer functions. No existing table, policy, trigger,
-- function, row or event is changed or deleted. Safe to run more than once: IF NOT EXISTS / CREATE OR REPLACE, then the same
-- REVOKE and GRANT. Fails closed when a prerequisite is missing.
DO $guard$ BEGIN
 IF to_regprocedure('customer.own_programme_fee_status(uuid)') IS NULL
  OR to_regprocedure('customer.programme_ledger_record(uuid,uuid,uuid,jsonb)') IS NULL
  OR to_regprocedure('customer.programme_ledger_list(uuid,uuid,integer,integer)') IS NULL
  OR to_regprocedure('customer_private.programme_ledger_entry_json(uuid)') IS NULL
  OR to_regprocedure('customer_private.programme_ledger_expiry()') IS NULL
  OR to_regprocedure('customer_private.participant_scope(uuid,uuid,uuid,boolean)') IS NULL
  OR to_regprocedure('customer_private.coordination_registration_state(uuid)') IS NULL
  OR to_regprocedure('customer_private.coordination_expiry()') IS NULL
  OR to_regprocedure('customer_private.synthetic_context()') IS NULL
  OR to_regprocedure('app.reject_rewrite()') IS NULL
  OR to_regclass('customer_private.programme_ledger_entry') IS NULL
  OR to_regclass('customer_private.programme_registration') IS NULL
  OR to_regclass('customer_private.programme_terms_revision') IS NULL THEN
  RAISE EXCEPTION 'Participant payment declaration prerequisite is missing';
 END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS customer_private.programme_payment_declaration (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 registration_id uuid NOT NULL REFERENCES customer_private.programme_registration(id),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 currency text NOT NULL REFERENCES app.currency(code),
 amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor<=999999999999999999),
 paid_on date NOT NULL CHECK(paid_on BETWEEN DATE '2000-01-01' AND DATE '2100-01-01'),
 payer_reference text CHECK(payer_reference IS NULL OR (payer_reference=btrim(payer_reference)
  AND length(payer_reference)>=CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END AND length(payer_reference)<=120
  AND (payer_reference LIKE 'Synthetic %' OR NOT customer_private.synthetic_context()) AND payer_reference !~ '[[:cntrl:]]')),
 note text CHECK(note IS NULL OR (note=btrim(note)
  AND length(note)>=CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END AND length(note)<=500
  AND (note LIKE 'Synthetic %' OR NOT customer_private.synthetic_context()) AND note !~ '[[:cntrl:]]')),
 declared_by uuid NOT NULL REFERENCES customer_private.principal(id),
 declared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,workspace_id,programme_id),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS programme_payment_declaration_registration ON customer_private.programme_payment_declaration(registration_id,declared_at);
CREATE INDEX IF NOT EXISTS programme_payment_declaration_programme ON customer_private.programme_payment_declaration(workspace_id,programme_id,declared_at);

CREATE TABLE IF NOT EXISTS customer_private.programme_payment_decision (
 declaration_id uuid PRIMARY KEY REFERENCES customer_private.programme_payment_declaration(id),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 decision text NOT NULL CHECK(decision IN ('ACKNOWLEDGED','REJECTED')),
 reason text CHECK(reason IS NULL OR (reason=btrim(reason)
  AND length(reason)>=CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 10 END AND length(reason)<=300
  AND (reason LIKE 'Synthetic %' OR NOT customer_private.synthetic_context()) AND reason !~ '[[:cntrl:]]')),
 ledger_entry_id uuid UNIQUE REFERENCES customer_private.programme_ledger_entry(id),
 decided_by uuid NOT NULL REFERENCES customer_private.principal(id),
 decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((decision='REJECTED')=(reason IS NOT NULL)),
 CHECK((decision='ACKNOWLEDGED')=(ledger_entry_id IS NOT NULL)),
 FOREIGN KEY(declaration_id,workspace_id,programme_id) REFERENCES customer_private.programme_payment_declaration(id,workspace_id,programme_id)
);

CREATE TABLE IF NOT EXISTS customer_private.programme_payment_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('DECLARE','DECIDE')),
 declaration_id uuid NOT NULL REFERENCES customer_private.programme_payment_declaration(id),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,command_id)
);

DO $triggers$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='programme_payment_declaration_immutable' AND tgrelid='customer_private.programme_payment_declaration'::regclass) THEN
  CREATE TRIGGER programme_payment_declaration_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_payment_declaration FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
 END IF;
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='programme_payment_decision_immutable' AND tgrelid='customer_private.programme_payment_decision'::regclass) THEN
  CREATE TRIGGER programme_payment_decision_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_payment_decision FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
 END IF;
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='programme_payment_command_immutable' AND tgrelid='customer_private.programme_payment_command'::regclass) THEN
  CREATE TRIGGER programme_payment_command_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_payment_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
 END IF;
END $triggers$;
ALTER TABLE customer_private.programme_payment_declaration ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_payment_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_payment_command ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.programme_payment_declaration,customer_private.programme_payment_decision,customer_private.programme_payment_command FROM PUBLIC,corridra_runtime,corridra_auth;

-- Database-level integrity, so even a direct insert cannot break the rules the functions enforce.
CREATE OR REPLACE FUNCTION customer_private.programme_payment_declaration_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM customer_private.programme_registration r WHERE r.id=NEW.registration_id AND r.workspace_id=NEW.workspace_id
   AND r.programme_id=NEW.programme_id AND r.principal_id=NEW.declared_by) THEN
  RAISE EXCEPTION 'Registration outside this programme' USING ERRCODE='23514';
 END IF;
 IF NEW.paid_on>current_date THEN RAISE EXCEPTION 'A payment cannot be dated in the future' USING ERRCODE='23514'; END IF;
 IF coalesce((SELECT sum(l.amount_minor::numeric) FROM customer_private.programme_ledger_entry l WHERE l.registration_id=NEW.registration_id
   AND l.workspace_id=NEW.workspace_id AND l.programme_id=NEW.programme_id AND l.kind='PARTICIPANT_FEE' AND l.currency=NEW.currency),0)<=0 THEN
  RAISE EXCEPTION 'No fee in this currency for this registration' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION customer_private.programme_payment_decision_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d customer_private.programme_payment_declaration;e customer_private.programme_ledger_entry;
BEGIN
 SELECT * INTO d FROM customer_private.programme_payment_declaration x WHERE x.id=NEW.declaration_id;
 IF NOT FOUND OR d.workspace_id<>NEW.workspace_id OR d.programme_id<>NEW.programme_id THEN RAISE EXCEPTION 'Declaration unavailable' USING ERRCODE='23514'; END IF;
 IF NEW.decision='ACKNOWLEDGED' THEN
  SELECT * INTO e FROM customer_private.programme_ledger_entry l WHERE l.id=NEW.ledger_entry_id;
  IF NOT FOUND OR e.kind<>'PARTICIPANT_PAYMENT' OR e.reverse_of IS NOT NULL OR e.workspace_id<>d.workspace_id OR e.programme_id<>d.programme_id
   OR e.registration_id IS DISTINCT FROM d.registration_id OR e.currency<>d.currency THEN
   RAISE EXCEPTION 'Acknowledgement needs its own payment entry' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DO $triggers$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='programme_payment_declaration_guard' AND tgrelid='customer_private.programme_payment_declaration'::regclass) THEN
  CREATE TRIGGER programme_payment_declaration_guard BEFORE INSERT ON customer_private.programme_payment_declaration FOR EACH ROW EXECUTE FUNCTION customer_private.programme_payment_declaration_guard();
 END IF;
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='programme_payment_decision_guard' AND tgrelid='customer_private.programme_payment_decision'::regclass) THEN
  CREATE TRIGGER programme_payment_decision_guard BEFORE INSERT ON customer_private.programme_payment_decision FOR EACH ROW EXECUTE FUNCTION customer_private.programme_payment_decision_guard();
 END IF;
END $triggers$;

-- Same guard sequence as customer.own_programme_fee_status: the caller's OWN, ACTIVE registration, inside the access window.
CREATE OR REPLACE FUNCTION customer_private.payment_declaration_registration(command uuid,selected uuid,require_fees boolean) RETURNS customer_private.programme_registration
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;reg customer_private.programme_registration;fees boolean:=false;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF selected IS NULL THEN RAISE EXCEPTION 'Invalid registration' USING ERRCODE='23514'; END IF;
 SELECT * INTO reg FROM customer_private.programme_registration r WHERE r.id=selected AND r.principal_id=customer.actor_id();
 IF NOT FOUND THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
 actor:=customer_private.participant_scope(command,reg.workspace_id,reg.programme_id,false);
 IF reg.principal_id<>actor OR customer_private.coordination_registration_state(reg.id)<>'ACTIVE' THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 IF require_fees THEN
  SELECT t.fees_apply INTO fees FROM customer_private.programme_terms_revision t WHERE t.programme_id=reg.programme_id ORDER BY t.version DESC LIMIT 1;
  IF NOT coalesce(fees,false) THEN RAISE EXCEPTION 'Fees do not apply to this programme' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN reg;
END $$;

CREATE OR REPLACE FUNCTION customer_private.programme_payment_event(target uuid,actor uuid,command uuid,programme uuid,declaration uuid,act text) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid;eid uuid:=gen_random_uuid();v integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 IF act NOT IN ('declared','acknowledged','rejected') THEN RAISE EXCEPTION 'Invalid event' USING ERRCODE='23514'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v FROM app.domain_event e WHERE e.tenant_id=target AND e.aggregate_type='customer_programme_payment' AND e.aggregate_id=programme::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.programme_payment.'||act,1,'customer_programme_payment',programme::text,v,executor,clock_timestamp(),command,command,
 jsonb_build_object('declarationId',declaration,'synthetic',customer_private.synthetic_context(),'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.programme_payment.'||act);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

-- One declaration as the caller may see it. For the participant, the rejection reason is shown and nothing else of the decision.
CREATE OR REPLACE FUNCTION customer_private.programme_payment_declaration_json(selected uuid,for_organiser boolean) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',d.id,'registrationId',d.registration_id,'currency',d.currency,'exponent',c.exponent,'amountMinor',d.amount_minor::text,
  'paidOn',to_char(d.paid_on,'YYYY-MM-DD'),'payerReference',d.payer_reference,'note',d.note,'declaredAt',d.declared_at,
  'status',CASE WHEN x.declaration_id IS NULL THEN 'AWAITING_REVIEW' ELSE x.decision END,
  'reason',x.reason,'decidedAt',x.decided_at,'verified',false)
  || CASE WHEN for_organiser THEN jsonb_build_object('registrationLabel',r.display_label,'ledgerEntryId',x.ledger_entry_id) ELSE '{}'::jsonb END
 FROM customer_private.programme_payment_declaration d JOIN app.currency c ON c.code=d.currency
 JOIN customer_private.programme_registration r ON r.id=d.registration_id
 LEFT JOIN customer_private.programme_payment_decision x ON x.declaration_id=d.id WHERE d.id=selected
$$;

CREATE OR REPLACE FUNCTION customer.declare_programme_payment(command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reg customer_private.programme_registration;actor uuid;prior customer_private.programme_payment_command;d customer_private.programme_payment_declaration;
 cur text;amt bigint;day date;payer text;memo text;req jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid payment declaration' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['registrationId','currency','amountMinor','paidOn','payerReference','note']<>'{}'::jsonb OR NOT(input ?& ARRAY['registrationId','currency','amountMinor','paidOn','payerReference','note'])
  OR jsonb_typeof(input->'registrationId')<>'string' OR jsonb_typeof(input->'currency')<>'string' OR jsonb_typeof(input->'amountMinor')<>'string' OR jsonb_typeof(input->'paidOn')<>'string'
  OR jsonb_typeof(input->'payerReference') NOT IN ('string','null') OR jsonb_typeof(input->'note') NOT IN ('string','null')
  OR input->>'registrationId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid payment declaration' USING ERRCODE='23514'; END IF;
 reg:=customer_private.payment_declaration_registration(command,(input->>'registrationId')::uuid,true);
 actor:=customer.actor_id();
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.payment_declaration:'||reg.id::text,0));
 req:=jsonb_build_object('payload',input);
 SELECT * INTO prior FROM customer_private.programme_payment_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.action<>'DECLARE' OR prior.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('registrationId',reg.id,'expiresAt',customer_private.coordination_expiry(),'commandId',command,'replayed',true,
   'declaration',customer_private.programme_payment_declaration_json(prior.declaration_id,false));
 END IF;
 cur:=input->>'currency';
 IF cur !~ '^[A-Z]{3}$' OR NOT EXISTS(SELECT FROM app.currency c WHERE c.code=cur) THEN RAISE EXCEPTION 'Invalid currency' USING ERRCODE='23514'; END IF;
 IF input->>'amountMinor' !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'Invalid amount' USING ERRCODE='23514'; END IF;
 amt:=(input->>'amountMinor')::bigint;
 IF input->>'paidOn' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='23514'; END IF;
 BEGIN day:=(input->>'paidOn')::date;IF to_char(day,'YYYY-MM-DD')<>input->>'paidOn' THEN RAISE EXCEPTION 'bad date'; END IF;
 EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='23514'; END;
 IF day>current_date THEN RAISE EXCEPTION 'A payment cannot be dated in the future' USING ERRCODE='23514'; END IF;
 -- Only a currency the organiser has a fee for on this registration can be declared.
 IF coalesce((SELECT sum(l.amount_minor::numeric) FROM customer_private.programme_ledger_entry l WHERE l.registration_id=reg.id AND l.workspace_id=reg.workspace_id
   AND l.programme_id=reg.programme_id AND l.kind='PARTICIPANT_FEE' AND l.currency=cur),0)<=0 THEN RAISE EXCEPTION 'No fee in this currency for this registration' USING ERRCODE='23514'; END IF;
 -- Bounded queue for the organiser: at most 20 declarations of one registration wait for a decision.
 IF (SELECT count(*) FROM customer_private.programme_payment_declaration x WHERE x.registration_id=reg.id
   AND NOT EXISTS(SELECT FROM customer_private.programme_payment_decision y WHERE y.declaration_id=x.id))>=20 THEN RAISE EXCEPTION 'Too many declarations are awaiting review' USING ERRCODE='23514'; END IF;
 payer:=input->>'payerReference';memo:=input->>'note';
 INSERT INTO customer_private.programme_payment_declaration(registration_id,workspace_id,programme_id,currency,amount_minor,paid_on,payer_reference,note,declared_by)
 VALUES(reg.id,reg.workspace_id,reg.programme_id,cur,amt,day,payer,memo,actor) RETURNING * INTO d;
 INSERT INTO customer_private.programme_payment_command(actor_id,command_id,action,declaration_id,request) VALUES(actor,command,'DECLARE',d.id,req);
 PERFORM customer_private.programme_payment_event(reg.workspace_id,actor,command,reg.programme_id,d.id,'declared');
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrationId',reg.id,'expiresAt',customer_private.coordination_expiry(),'commandId',command,'replayed',false,
  'declaration',customer_private.programme_payment_declaration_json(d.id,false));
END $$;

CREATE OR REPLACE FUNCTION customer.own_programme_payment_declarations(registration uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reg customer_private.programme_registration;fees boolean:=false;items jsonb:='[]'::jsonb;actor uuid;
BEGIN
 reg:=customer_private.payment_declaration_registration(gen_random_uuid(),registration,false);
 actor:=customer.actor_id();
 SELECT t.fees_apply INTO fees FROM customer_private.programme_terms_revision t WHERE t.programme_id=reg.programme_id ORDER BY t.version DESC LIMIT 1;
 IF coalesce(fees,false) THEN
  SELECT coalesce(jsonb_agg(customer_private.programme_payment_declaration_json(s.id,false) ORDER BY s.declared_at DESC,s.id),'[]'::jsonb) INTO items
  FROM (SELECT d.id,d.declared_at FROM customer_private.programme_payment_declaration d WHERE d.registration_id=reg.id ORDER BY d.declared_at DESC,d.id LIMIT 50) s;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrationId',reg.id,'programmeId',reg.programme_id,'expiresAt',customer_private.coordination_expiry(),
  'provenance','PARTICIPANT_DECLARED','verified',false,'collectsPayments',false,'declarations',items);
END $$;

CREATE OR REPLACE FUNCTION customer.programme_payment_declarations_pending(target uuid,programme uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;items jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF target IS NULL OR programme IS NULL THEN RAISE EXCEPTION 'Invalid programme' USING ERRCODE='23514'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);
 SELECT coalesce(jsonb_agg(customer_private.programme_payment_declaration_json(s.id,true) || jsonb_build_object('outstandingMinor',s.outstanding::text) ORDER BY s.declared_at,s.id),'[]'::jsonb) INTO items
 FROM (SELECT d.id,d.declared_at,
   coalesce((SELECT sum(CASE WHEN l.kind='PARTICIPANT_FEE' THEN l.amount_minor::numeric ELSE -l.amount_minor::numeric END)
     FROM customer_private.programme_ledger_entry l WHERE l.registration_id=d.registration_id AND l.workspace_id=d.workspace_id AND l.programme_id=d.programme_id
     AND l.currency=d.currency AND l.kind IN ('PARTICIPANT_FEE','PARTICIPANT_PAYMENT')),0) outstanding
  FROM customer_private.programme_payment_declaration d
  WHERE d.workspace_id=target AND d.programme_id=programme AND NOT EXISTS(SELECT FROM customer_private.programme_payment_decision y WHERE y.declaration_id=d.id)
  ORDER BY d.declared_at,d.id LIMIT 100) s;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.programme_ledger_expiry(),
  'provenance','PARTICIPANT_DECLARED','verified',false,'declarations',items);
END $$;

-- The organiser decides once. ACKNOWLEDGED writes the PARTICIPANT_PAYMENT entry through customer.programme_ledger_record in this
-- same transaction (amount = what the organiser enters as received, else the declared amount); REJECTED leaves the ledger untouched.
CREATE OR REPLACE FUNCTION customer.decide_programme_payment(command uuid,target uuid,programme uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.programme_payment_command;d customer_private.programme_payment_declaration;x customer_private.programme_payment_decision;
 verdict text;why text;got_amt bigint;got_day date;written jsonb;entry_id uuid;req jsonb;ledger_command uuid;describe text;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR programme IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid payment decision' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['declarationId','decision','reason','receivedAmountMinor','receivedOn']<>'{}'::jsonb OR NOT(input ?& ARRAY['declarationId','decision','reason','receivedAmountMinor','receivedOn'])
  OR jsonb_typeof(input->'declarationId')<>'string' OR jsonb_typeof(input->'decision')<>'string' OR jsonb_typeof(input->'reason') NOT IN ('string','null')
  OR jsonb_typeof(input->'receivedAmountMinor') NOT IN ('string','null') OR jsonb_typeof(input->'receivedOn') NOT IN ('string','null')
  OR input->>'declarationId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid payment decision' USING ERRCODE='23514'; END IF;
 verdict:=input->>'decision';
 IF verdict NOT IN ('ACKNOWLEDGED','REJECTED') THEN RAISE EXCEPTION 'Invalid payment decision' USING ERRCODE='23514'; END IF;
 actor:=customer_private.participant_scope(command,target,programme,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.payment_declaration_decision:'||(input->>'declarationId'),0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 req:=jsonb_build_object('workspaceId',target,'programmeId',programme,'payload',input);
 SELECT * INTO prior FROM customer_private.programme_payment_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.action<>'DECIDE' OR prior.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  SELECT * INTO x FROM customer_private.programme_payment_decision y WHERE y.declaration_id=prior.declaration_id;
  RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.programme_ledger_expiry(),'commandId',command,'replayed',true,
   'declaration',customer_private.programme_payment_declaration_json(prior.declaration_id,true),
   'entry',CASE WHEN x.ledger_entry_id IS NULL THEN NULL ELSE customer_private.programme_ledger_entry_json(x.ledger_entry_id) END);
 END IF;
 SELECT * INTO d FROM customer_private.programme_payment_declaration y WHERE y.id=(input->>'declarationId')::uuid AND y.workspace_id=target AND y.programme_id=programme;
 IF NOT FOUND THEN RAISE EXCEPTION 'Declaration unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM customer_private.programme_payment_decision y WHERE y.declaration_id=d.id) THEN RAISE EXCEPTION 'Declaration already decided' USING ERRCODE='23514'; END IF;
 why:=input->>'reason';
 IF verdict='REJECTED' THEN
  IF input->>'receivedAmountMinor' IS NOT NULL OR input->>'receivedOn' IS NOT NULL OR why IS NULL THEN RAISE EXCEPTION 'Invalid payment decision' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.programme_payment_decision(declaration_id,workspace_id,programme_id,decision,reason,ledger_entry_id,decided_by)
  VALUES(d.id,target,programme,'REJECTED',why,NULL,actor);
  entry_id:=NULL;
 ELSE
  IF why IS NOT NULL THEN RAISE EXCEPTION 'Invalid payment decision' USING ERRCODE='23514'; END IF;
  got_amt:=d.amount_minor;got_day:=d.paid_on;
  IF input->>'receivedAmountMinor' IS NOT NULL THEN
   IF input->>'receivedAmountMinor' !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'Invalid amount' USING ERRCODE='23514'; END IF;
   got_amt:=(input->>'receivedAmountMinor')::bigint;
  END IF;
  IF input->>'receivedOn' IS NOT NULL THEN
   IF input->>'receivedOn' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='23514'; END IF;
   BEGIN got_day:=(input->>'receivedOn')::date;IF to_char(got_day,'YYYY-MM-DD')<>input->>'receivedOn' THEN RAISE EXCEPTION 'bad date'; END IF;
   EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='23514'; END;
  END IF;
  describe:=CASE WHEN customer_private.synthetic_context() THEN 'Synthetic payment declared by the participant, acknowledged by the organiser'
   ELSE 'Payment declared by the participant, acknowledged by the organiser' END;
  -- Derived, stable command id: a replay of this decision cannot write a second ledger entry.
  ledger_command:=md5('customer.payment_decision:'||actor::text||':'||command::text)::uuid;
  written:=customer.programme_ledger_record(ledger_command,target,programme,jsonb_build_object('kind','PARTICIPANT_PAYMENT','costBasis',NULL,'registrationId',d.registration_id,
   'amountMinor',got_amt::text,'currency',d.currency,'occurredOn',to_char(got_day,'YYYY-MM-DD'),'description',describe));
  entry_id:=(written->'entry'->>'id')::uuid;
  INSERT INTO customer_private.programme_payment_decision(declaration_id,workspace_id,programme_id,decision,reason,ledger_entry_id,decided_by)
  VALUES(d.id,target,programme,'ACKNOWLEDGED',NULL,entry_id,actor);
 END IF;
 INSERT INTO customer_private.programme_payment_command(actor_id,command_id,action,declaration_id,request) VALUES(actor,command,'DECIDE',d.id,req);
 PERFORM customer_private.programme_payment_event(target,actor,command,programme,d.id,CASE WHEN verdict='ACKNOWLEDGED' THEN 'acknowledged' ELSE 'rejected' END);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.programme_ledger_expiry(),'commandId',command,'replayed',false,
  'declaration',customer_private.programme_payment_declaration_json(d.id,true),
  'entry',CASE WHEN entry_id IS NULL THEN NULL ELSE customer_private.programme_ledger_entry_json(entry_id) END);
END $$;

REVOKE ALL ON FUNCTION customer_private.programme_payment_declaration_guard(),customer_private.programme_payment_decision_guard(),
 customer_private.payment_declaration_registration(uuid,uuid,boolean),customer_private.programme_payment_event(uuid,uuid,uuid,uuid,uuid,text),
 customer_private.programme_payment_declaration_json(uuid,boolean) FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.declare_programme_payment(uuid,jsonb),customer.own_programme_payment_declarations(uuid),
 customer.programme_payment_declarations_pending(uuid,uuid),customer.decide_programme_payment(uuid,uuid,uuid,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.declare_programme_payment(uuid,jsonb),customer.own_programme_payment_declarations(uuid),
 customer.programme_payment_declarations_pending(uuid,uuid),customer.decide_programme_payment(uuid,uuid,uuid,jsonb) TO corridra_runtime;
