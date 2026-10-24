-- Optional additive module: a simulated payment provider for real invoices (billing stage 3, ADR-065).
-- Needs the real invoicing module (ADR-064). "Corridra Pay (madeup)" is a stand-in for a payment provider. It touches no
-- network, card or bank account, and no money moves. A simulated attempt NEVER changes an invoice: the real invoice
-- ledger (payments and credit notes recorded by the team) is untouched and stays the only record of money received.
-- Every attempt, reference and refund here is marked (madeup). The refund policy is made up too: a succeeded attempt can
-- be refunded by staff, in part or in full, within a made-up window of days (default 14) recorded when the attempt
-- succeeded. A real provider adapter would replace this module's attempt and refund tables with real provider calls;
-- the customer and staff screens keep the same shapes.
-- Installing this module alone changes nothing for anyone: the control below starts closed, and only the offline
-- schema-owner operation opens it. Money here is Corridra service revenue only (domain B).

DO $guard$ BEGIN
 IF to_regprocedure('customer_private.real_invoicing_open()') IS NULL
 OR to_regprocedure('customer_private.real_invoicing_staff_actor()') IS NULL
 OR to_regprocedure('customer_private.real_invoicing_paid(uuid)') IS NULL
 OR to_regprocedure('customer_private.real_invoicing_credited(uuid)') IS NULL
 OR to_regprocedure('customer_private.real_invoicing_number(text,integer,integer)') IS NULL
 OR to_regprocedure('customer_private.billing_workspace_role(uuid,uuid)') IS NULL
 OR to_regprocedure('customer_private.lock_workspace_access(uuid,uuid)') IS NULL
 OR to_regprocedure('customer_private.billing_plain_ok(text,integer,integer)') IS NULL
 OR to_regprocedure('customer_private.billing_input_shape(jsonb,text[],text[])') IS NULL
 OR to_regprocedure('customer_private.organisation_profile_expiry()') IS NULL
 OR to_regclass('customer_private.real_invoice') IS NULL
 THEN RAISE EXCEPTION 'Simulated payments prerequisites are missing'; END IF;
END $guard$;

-- The control. Closed unless real invoicing is open AND the latest control row says enabled. No row means closed.
CREATE TABLE customer_private.simulated_payments_control (
 version integer PRIMARY KEY CHECK(version>0),enabled boolean NOT NULL,
 refund_window_days integer NOT NULL DEFAULT 14 CHECK(refund_window_days BETWEEN 1 AND 90),
 executor_id uuid NOT NULL REFERENCES identity.principal(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- A customer owner or admin starts an attempt for one real invoice. The provider reference is made up and says so.
CREATE TABLE customer_private.simulated_payment_attempt (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,invoice_id uuid NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 199999999998),
 currency text NOT NULL REFERENCES app.currency(code),
 provider_ref text NOT NULL CHECK(provider_ref ~ '^SIMPAY-[0-9A-F]{12} [(]madeup[)]$'),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 expires_at timestamptz NOT NULL,
 money_domain text NOT NULL DEFAULT 'B' CHECK(money_domain='B'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id),UNIQUE(provider_ref),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES customer_private.real_invoice(tenant_id,id),
 CHECK(expires_at>created_at)
);
CREATE INDEX simulated_payment_attempt_workspace ON customer_private.simulated_payment_attempt(tenant_id,created_at DESC);
CREATE INDEX simulated_payment_attempt_invoice ON customer_private.simulated_payment_attempt(invoice_id,created_at DESC);
-- The outcome is chosen on the simulated checkout. The refund window in force is kept with it.
CREATE TABLE customer_private.simulated_payment_outcome (
 attempt_id uuid PRIMARY KEY,tenant_id uuid NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('succeeded','declined')),
 refund_window_days integer NOT NULL CHECK(refund_window_days BETWEEN 1 AND 90),
 decided_by uuid NOT NULL REFERENCES customer_private.principal(id),
 decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,attempt_id) REFERENCES customer_private.simulated_payment_attempt(tenant_id,id)
);
CREATE TABLE customer_private.simulated_payment_refund (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 attempt_id uuid NOT NULL,tenant_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 100),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 199999999998),
 reason text NOT NULL CHECK(customer_private.billing_plain_ok(reason,10,500)),
 recorded_by uuid NOT NULL REFERENCES identity.principal(id),
 staff_tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(attempt_id,seq),
 FOREIGN KEY(tenant_id,attempt_id) REFERENCES customer_private.simulated_payment_attempt(tenant_id,id)
);
-- Commands are keyed by (person, command id): customers in one table, staff in the other.
CREATE TABLE customer_private.simulated_payment_customer_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('start','complete')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
CREATE TABLE customer_private.simulated_payment_staff_command (
 actor_id uuid NOT NULL REFERENCES identity.principal(id),command_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('refund')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
CREATE TRIGGER simulated_payments_control_immutable BEFORE UPDATE OR DELETE ON customer_private.simulated_payments_control FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER simulated_payment_attempt_immutable BEFORE UPDATE OR DELETE ON customer_private.simulated_payment_attempt FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER simulated_payment_outcome_immutable BEFORE UPDATE OR DELETE ON customer_private.simulated_payment_outcome FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER simulated_payment_refund_immutable BEFORE UPDATE OR DELETE ON customer_private.simulated_payment_refund FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER simulated_payment_customer_command_immutable BEFORE UPDATE OR DELETE ON customer_private.simulated_payment_customer_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER simulated_payment_staff_command_immutable BEFORE UPDATE OR DELETE ON customer_private.simulated_payment_staff_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.simulated_payments_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.simulated_payment_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.simulated_payment_outcome ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.simulated_payment_refund ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.simulated_payment_customer_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.simulated_payment_staff_command ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.simulated_payments_control,customer_private.simulated_payment_attempt,customer_private.simulated_payment_outcome,
 customer_private.simulated_payment_refund,customer_private.simulated_payment_customer_command,customer_private.simulated_payment_staff_command
 FROM PUBLIC,corridra_runtime,corridra_auth;

-- Open means real invoicing is open and the latest control row says enabled.
CREATE FUNCTION customer_private.simulated_payments_open() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT customer_private.real_invoicing_open()
 AND coalesce((SELECT enabled FROM customer_private.simulated_payments_control ORDER BY version DESC LIMIT 1),false)
$$;
CREATE FUNCTION customer_private.simulated_payments_window() RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT refund_window_days FROM customer_private.simulated_payments_control ORDER BY version DESC LIMIT 1),14)
$$;
CREATE FUNCTION customer_private.simulated_payment_refunded(att uuid) RETURNS bigint
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(sum(r.amount_minor),0)::bigint FROM customer_private.simulated_payment_refund r WHERE r.attempt_id=att
$$;
CREATE FUNCTION customer_private.simulated_payment_state(att uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT o.outcome FROM customer_private.simulated_payment_outcome o WHERE o.attempt_id=att),
  CASE WHEN (SELECT a.expires_at FROM customer_private.simulated_payment_attempt a WHERE a.id=att)<=clock_timestamp() THEN 'expired' ELSE 'started' END)
$$;
-- Staff authority: the protected staff authority of real invoicing, while simulated payments are open (55000 when closed).
CREATE FUNCTION customer_private.simulated_payments_staff_actor() RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;
BEGIN
 actor:=customer_private.real_invoicing_staff_actor();
 IF NOT customer_private.simulated_payments_open() THEN
  RAISE EXCEPTION 'Simulated payments are switched off' USING ERRCODE='55000'; END IF;
 RETURN actor;
END $$;

-- Database guards, for every writer. Attempt: a real workspace, the invoice's own currency, no more than is outstanding,
-- one live attempt per invoice at a time, and the made-up reference. Outcome: by the person who started it, before it
-- expires. Refund: only for a succeeded attempt, inside the made-up window, never more than was paid in the attempt.
CREATE FUNCTION customer_private.simulated_payment_attempt_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_inv customer_private.real_invoice;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.invoice:'||NEW.invoice_id::text,0));
 IF NOT customer_private.simulated_payments_open() THEN RAISE EXCEPTION 'Simulated payments are switched off' USING ERRCODE='55000'; END IF;
 SELECT * INTO v_inv FROM customer_private.real_invoice i WHERE i.id=NEW.invoice_id;
 IF NOT FOUND OR v_inv.tenant_id<>NEW.tenant_id OR EXISTS(SELECT FROM app.tenant t WHERE t.id=NEW.tenant_id AND t.synthetic) THEN
  RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 IF NEW.currency<>v_inv.currency THEN RAISE EXCEPTION 'The currency must be the invoice currency' USING ERRCODE='23514'; END IF;
 IF NEW.amount_minor>v_inv.total_minor-customer_private.real_invoicing_paid(v_inv.id)-customer_private.real_invoicing_credited(v_inv.id) THEN
  RAISE EXCEPTION 'That is more than is still outstanding on this invoice' USING ERRCODE='23514'; END IF;
 IF NEW.expires_at>clock_timestamp()+interval '1 hour' THEN RAISE EXCEPTION 'A simulated checkout lasts at most an hour' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT FROM customer_private.simulated_payment_attempt a WHERE a.invoice_id=NEW.invoice_id
  AND customer_private.simulated_payment_state(a.id)='started') THEN
  RAISE EXCEPTION 'A simulated payment for this invoice is already in progress' USING ERRCODE='23505'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER simulated_payment_attempt_guard BEFORE INSERT ON customer_private.simulated_payment_attempt FOR EACH ROW EXECUTE FUNCTION customer_private.simulated_payment_attempt_guard();

CREATE FUNCTION customer_private.simulated_payment_outcome_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a customer_private.simulated_payment_attempt;
BEGIN
 SELECT * INTO a FROM customer_private.simulated_payment_attempt x WHERE x.id=NEW.attempt_id;
 IF NOT FOUND OR a.tenant_id<>NEW.tenant_id THEN RAISE EXCEPTION 'Payment unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.simulated_payment:'||a.id::text,0));
 IF NOT customer_private.simulated_payments_open() THEN RAISE EXCEPTION 'Simulated payments are switched off' USING ERRCODE='55000'; END IF;
 IF NEW.decided_by<>a.created_by THEN RAISE EXCEPTION 'Only the person who started a payment can finish it' USING ERRCODE='42501'; END IF;
 IF a.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'This simulated checkout has expired' USING ERRCODE='23514'; END IF;
 IF NEW.refund_window_days<>customer_private.simulated_payments_window() THEN RAISE EXCEPTION 'The refund window changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER simulated_payment_outcome_guard BEFORE INSERT ON customer_private.simulated_payment_outcome FOR EACH ROW EXECUTE FUNCTION customer_private.simulated_payment_outcome_guard();

CREATE FUNCTION customer_private.simulated_payment_refund_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a customer_private.simulated_payment_attempt; o customer_private.simulated_payment_outcome; v_prev integer;
BEGIN
 SELECT * INTO a FROM customer_private.simulated_payment_attempt x WHERE x.id=NEW.attempt_id;
 IF NOT FOUND OR a.tenant_id<>NEW.tenant_id THEN RAISE EXCEPTION 'Payment unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.simulated_payment:'||a.id::text,0));
 IF NOT customer_private.simulated_payments_open() THEN RAISE EXCEPTION 'Simulated payments are switched off' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT FROM app.tenant t WHERE t.id=NEW.tenant_id AND t.synthetic) THEN RAISE EXCEPTION 'Payment unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM customer_private.simulated_payment_outcome x WHERE x.attempt_id=a.id;
 IF NOT FOUND OR o.outcome<>'succeeded' THEN RAISE EXCEPTION 'Only a succeeded payment can be refunded' USING ERRCODE='23514'; END IF;
 IF clock_timestamp()>o.decided_at+make_interval(days=>o.refund_window_days) THEN
  RAISE EXCEPTION 'The made-up refund window has passed' USING ERRCODE='23514'; END IF;
 SELECT coalesce(max(r.seq),0) INTO v_prev FROM customer_private.simulated_payment_refund r WHERE r.attempt_id=a.id;
 IF NEW.seq<>v_prev+1 THEN RAISE EXCEPTION 'Refunds must follow in order' USING ERRCODE='23514'; END IF;
 IF NEW.amount_minor>a.amount_minor-customer_private.simulated_payment_refunded(a.id) THEN
  RAISE EXCEPTION 'That is more than is left to refund' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER simulated_payment_refund_guard BEFORE INSERT ON customer_private.simulated_payment_refund FOR EACH ROW EXECUTE FUNCTION customer_private.simulated_payment_refund_guard();

-- One attempt as JSON. Customers and staff see the same fields; staff also see the workspace name. Nothing here is real.
CREATE FUNCTION customer_private.simulated_payment_json(att uuid,audience text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a customer_private.simulated_payment_attempt; i customer_private.real_invoice; o customer_private.simulated_payment_outcome; v_state text; v_refunded bigint; v_open_until timestamptz; v_left bigint; v_refunds jsonb;
BEGIN
 SELECT * INTO a FROM customer_private.simulated_payment_attempt x WHERE x.id=att;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO i FROM customer_private.real_invoice x WHERE x.id=a.invoice_id;
 SELECT * INTO o FROM customer_private.simulated_payment_outcome x WHERE x.attempt_id=a.id;
 v_state:=customer_private.simulated_payment_state(a.id);
 v_refunded:=customer_private.simulated_payment_refunded(a.id);
 v_open_until:=CASE WHEN v_state='succeeded' THEN o.decided_at+make_interval(days=>o.refund_window_days) END;
 v_left:=CASE WHEN v_state='succeeded' AND clock_timestamp()<=v_open_until THEN a.amount_minor-v_refunded ELSE 0 END;
 SELECT coalesce(jsonb_agg(jsonb_build_object('seq',r.seq,'amountMinor',r.amount_minor::text,'reason',r.reason,'recordedAt',r.created_at) ORDER BY r.seq),'[]'::jsonb)
  INTO v_refunds FROM customer_private.simulated_payment_refund r WHERE r.attempt_id=a.id;
 RETURN jsonb_build_object('id',a.id,'invoiceId',a.invoice_id,'invoiceNumber',customer_private.real_invoicing_number('INV',i.invoice_year,i.invoice_seq),
  'workspaceId',a.tenant_id,'amountMinor',a.amount_minor::text,'currency',a.currency,'state',v_state,'providerRef',a.provider_ref,
  'providerName','Corridra Pay (madeup)','createdAt',a.created_at,'expiresAt',a.expires_at,'decidedAt',o.decided_at,
  'refundedMinor',v_refunded::text,'refundableMinor',v_left::text,'refundOpenUntil',v_open_until,'refunds',v_refunds,
  'simulated',true,'madeup',true,'moneyMoves',false,'moneyDomain','B')
  ||CASE WHEN audience='staff' THEN jsonb_build_object('workspaceName',(SELECT w.name FROM app.tenant w WHERE w.id=a.tenant_id)) ELSE '{}'::jsonb END;
END $$;

CREATE FUNCTION customer_private.simulated_payments_emit(target uuid,aggregate uuid,kind text,item_seq integer,initiator_kind text,initiator uuid,command uuid) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE eid uuid:=gen_random_uuid(); executor uuid; event_actor uuid;
BEGIN
 IF target IS NULL OR kind NOT IN ('attempt.started','attempt.succeeded','attempt.declined','refund.recorded') OR initiator_kind NOT IN ('customer','staff') THEN
  RAISE EXCEPTION 'Payment unavailable' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 -- A staff change is attributed to the staff person; a customer change to the service executor.
 event_actor:=CASE WHEN initiator_kind='staff' THEN initiator ELSE executor END;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.simulated_payments.'||kind,1,'customer_simulated_payment',aggregate::text,item_seq,event_actor,clock_timestamp(),command,command,
  jsonb_build_object('attemptId',aggregate,'seq',item_seq,'synthetic',false,'simulated',true,'initiator_kind',initiator_kind,'initiator_id',initiator));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,event_actor,'customer.simulated_payments.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

-- Customers: an owner or admin sees the invoices they could try the simulated flow on and every attempt; a member sees
-- nothing. A workspace whose simulated payments are closed is told so (55000), never "denied".
CREATE FUNCTION customer.simulated_payments_overview(target uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer.actor_id(); v_access text; v_attempts jsonb:='[]'::jsonb; v_payable jsonb:='[]'::jsonb;
BEGIN
 IF v_actor IS NULL OR target IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 v_access:=customer_private.billing_workspace_role(target,v_actor);
 IF v_access IS NULL OR EXISTS(SELECT FROM app.tenant t WHERE t.id=target AND t.synthetic) THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 IF NOT customer_private.simulated_payments_open() THEN RAISE EXCEPTION 'Simulated payments are switched off' USING ERRCODE='55000'; END IF;
 IF v_access='writer' THEN
  SELECT coalesce(jsonb_agg(customer_private.simulated_payment_json(q.id,'customer') ORDER BY q.created_at DESC,q.id),'[]'::jsonb) INTO v_attempts
  FROM (SELECT a.id,a.created_at FROM customer_private.simulated_payment_attempt a WHERE a.tenant_id=target ORDER BY a.created_at DESC,a.id LIMIT 50) q;
  SELECT coalesce(jsonb_agg(jsonb_build_object('invoiceId',q.id,'number',customer_private.real_invoicing_number('INV',q.invoice_year,q.invoice_seq),
   'currency',q.currency,'outstandingMinor',q.outstanding::text) ORDER BY q.invoice_year DESC,q.invoice_seq DESC),'[]'::jsonb) INTO v_payable
  FROM (SELECT i.id,i.invoice_year,i.invoice_seq,i.currency,i.total_minor-customer_private.real_invoicing_paid(i.id)-customer_private.real_invoicing_credited(i.id) AS outstanding
   FROM customer_private.real_invoice i WHERE i.tenant_id=target) q WHERE q.outstanding>0;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM v_actor OR customer_private.billing_workspace_role(target,v_actor) IS DISTINCT FROM v_access THEN RAISE EXCEPTION 'Access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'canPay',v_access='writer','provider',jsonb_build_object('name','Corridra Pay (madeup)','madeup',true,
  'refundWindowDays',customer_private.simulated_payments_window(),'refundPolicy','Refunds are possible within '||customer_private.simulated_payments_window()::text||' days (madeup)'),
  'payable',v_payable,'attempts',v_attempts,'simulated',true,'moneyMoves',false,'paymentTaken',false,'synthetic',false,'expiresAt',customer_private.organisation_profile_expiry());
END $$;

-- Customer commands: start a simulated checkout for one invoice, then finish it as succeeded or declined. Idempotent by
-- (person, command id). Neither writes anything to the invoice.
CREATE FUNCTION customer.simulated_payment_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; target uuid; prior customer_private.simulated_payment_customer_command; v_inv customer_private.real_invoice; v_att uuid; v_amount bigint; v_out text; result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR operation IS NULL OR operation NOT IN ('start','complete')
  OR jsonb_typeof(input->'workspaceId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid payment command' USING ERRCODE='23514'; END IF;
 IF operation='start' THEN
  IF NOT customer_private.billing_input_shape(input,ARRAY['workspaceId','invoiceId','amountMinor'],ARRAY[]::text[])
   OR jsonb_typeof(input->'invoiceId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'amountMinor') IS DISTINCT FROM 'string'
   OR (input->>'amountMinor') !~ '^[1-9][0-9]{0,11}$' THEN RAISE EXCEPTION 'Invalid payment command' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT customer_private.billing_input_shape(input,ARRAY['workspaceId','attemptId','outcome'],ARRAY[]::text[])
   OR jsonb_typeof(input->'attemptId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'outcome') IS DISTINCT FROM 'string'
   OR (input->>'outcome') NOT IN ('succeeded','declined') THEN RAISE EXCEPTION 'Invalid payment command' USING ERRCODE='23514'; END IF;
 END IF;
 target:=(input->>'workspaceId')::uuid;
 actor:=customer_private.lock_workspace_access(command,target);
 IF customer_private.billing_workspace_role(target,actor) IS DISTINCT FROM 'writer' THEN RAISE EXCEPTION 'Workspace owner or admin required' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM app.tenant t WHERE t.id=target AND t.synthetic) THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 IF NOT customer_private.simulated_payments_open() THEN RAISE EXCEPTION 'Simulated payments are switched off' USING ERRCODE='55000'; END IF;
 SELECT * INTO prior FROM customer_private.simulated_payment_customer_command x WHERE x.actor_id=actor AND x.command_id=command;
 IF FOUND THEN
  IF prior.operation<>operation OR prior.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 IF operation='start' THEN
  SELECT * INTO v_inv FROM customer_private.real_invoice i WHERE i.id=(input->>'invoiceId')::uuid AND i.tenant_id=target;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
  v_amount:=(input->>'amountMinor')::bigint;
  v_att:=gen_random_uuid();
  INSERT INTO customer_private.simulated_payment_attempt(id,tenant_id,invoice_id,amount_minor,currency,provider_ref,created_by,expires_at)
  VALUES(v_att,target,v_inv.id,v_amount,v_inv.currency,'SIMPAY-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))||' (madeup)',actor,clock_timestamp()+interval '30 minutes');
  PERFORM customer_private.simulated_payments_emit(target,v_att,'attempt.started',1,'customer',actor,command);
 ELSE
  v_att:=(input->>'attemptId')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.simulated_payment_attempt a WHERE a.id=v_att AND a.tenant_id=target) THEN RAISE EXCEPTION 'Payment unavailable' USING ERRCODE='42501'; END IF;
  v_out:=input->>'outcome';
  INSERT INTO customer_private.simulated_payment_outcome(attempt_id,tenant_id,outcome,refund_window_days,decided_by)
  VALUES(v_att,target,v_out,customer_private.simulated_payments_window(),actor);
  PERFORM customer_private.simulated_payments_emit(target,v_att,'attempt.'||v_out,2,'customer',actor,command);
 END IF;
 result:=jsonb_build_object('attempt',customer_private.simulated_payment_json(v_att,'customer'),'commandId',command,'operation',operation,'simulated',true,'synthetic',false);
 INSERT INTO customer_private.simulated_payment_customer_command(actor_id,command_id,operation,request,result) VALUES(actor,command,operation,input,result);
 RETURN result;
END $$;

-- Staff: every simulated attempt in real workspaces, newest first, and the made-up refund.
CREATE FUNCTION app.simulated_payments_staff_list(after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.simulated_payments_staff_actor(); v_items jsonb; v_next uuid; v_cursor customer_private.simulated_payment_attempt;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 IF after_id IS NOT NULL THEN
  SELECT * INTO v_cursor FROM customer_private.simulated_payment_attempt a WHERE a.id=after_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 END IF;
 WITH mine AS(SELECT a.id,a.created_at FROM customer_private.simulated_payment_attempt a JOIN app.tenant w ON w.id=a.tenant_id AND NOT w.synthetic
  WHERE (after_id IS NULL OR (a.created_at,a.id)<(v_cursor.created_at,v_cursor.id)) ORDER BY a.created_at DESC,a.id DESC LIMIT page_size+1),
 visible AS(SELECT * FROM mine ORDER BY created_at DESC,id DESC LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(customer_private.simulated_payment_json(v.id,'staff') ORDER BY v.created_at DESC,v.id DESC) FROM visible v),'[]'::jsonb),
  CASE WHEN (SELECT count(*) FROM mine)>page_size THEN (SELECT id FROM visible ORDER BY created_at ASC,id ASC LIMIT 1) ELSE NULL END INTO v_items,v_next;
 IF app.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('attempts',v_items,'nextAfter',v_next,'provider',jsonb_build_object('name','Corridra Pay (madeup)','madeup',true,
  'refundWindowDays',customer_private.simulated_payments_window()),'simulated',true,'moneyMoves',false,'synthetic',false);
END $$;

CREATE FUNCTION app.simulated_payments_staff_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.simulated_payments_staff_actor(); prior customer_private.simulated_payment_staff_command; a customer_private.simulated_payment_attempt; v_seq integer; v_staff_tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid; result jsonb;
BEGIN
 IF command IS NULL OR input IS NULL OR operation IS NULL OR operation<>'refund'
  OR NOT customer_private.billing_input_shape(input,ARRAY['attemptId','amountMinor','reason'],ARRAY[]::text[])
  OR jsonb_typeof(input->'attemptId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'amountMinor') IS DISTINCT FROM 'string'
  OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR (input->>'amountMinor') !~ '^[1-9][0-9]{0,11}$'
  OR NOT customer_private.billing_plain_ok(input->>'reason',10,500) THEN
  RAISE EXCEPTION 'Invalid payment command' USING ERRCODE='23514'; END IF;
 SELECT * INTO prior FROM customer_private.simulated_payment_staff_command x WHERE x.actor_id=v_actor AND x.command_id=command;
 IF FOUND THEN
  IF prior.operation<>operation OR prior.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result;
 END IF;
 SELECT * INTO a FROM customer_private.simulated_payment_attempt x WHERE x.id=(input->>'attemptId')::uuid
  AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND NOT w.synthetic);
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.simulated_payment:'||a.id::text,0));
 SELECT coalesce(max(r.seq),0)+1 INTO v_seq FROM customer_private.simulated_payment_refund r WHERE r.attempt_id=a.id;
 INSERT INTO customer_private.simulated_payment_refund(attempt_id,tenant_id,seq,amount_minor,reason,recorded_by,staff_tenant_id)
 VALUES(a.id,a.tenant_id,v_seq,(input->>'amountMinor')::bigint,input->>'reason',v_actor,v_staff_tenant);
 PERFORM customer_private.simulated_payments_emit(a.tenant_id,a.id,'refund.recorded',v_seq+2,'staff',v_actor,command);
 IF app.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 result:=jsonb_build_object('state','refunded','attempt',customer_private.simulated_payment_json(a.id,'staff'),'commandId',command,'operation',operation,'simulated',true,'synthetic',false);
 INSERT INTO customer_private.simulated_payment_staff_command(actor_id,command_id,operation,request,result) VALUES(v_actor,command,operation,input,result);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION customer_private.simulated_payments_open(),customer_private.simulated_payments_window(),customer_private.simulated_payment_refunded(uuid),
 customer_private.simulated_payment_state(uuid),customer_private.simulated_payments_staff_actor(),customer_private.simulated_payment_attempt_guard(),
 customer_private.simulated_payment_outcome_guard(),customer_private.simulated_payment_refund_guard(),customer_private.simulated_payment_json(uuid,text),
 customer_private.simulated_payments_emit(uuid,uuid,text,integer,text,uuid,uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.simulated_payments_overview(uuid),customer.simulated_payment_command(uuid,text,jsonb),
 app.simulated_payments_staff_list(uuid,integer),app.simulated_payments_staff_command(uuid,text,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.simulated_payments_overview(uuid),customer.simulated_payment_command(uuid,text,jsonb),
 app.simulated_payments_staff_list(uuid,integer),app.simulated_payments_staff_command(uuid,text,jsonb) TO corridra_runtime;
