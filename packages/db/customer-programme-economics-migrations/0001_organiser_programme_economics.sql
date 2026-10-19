-- Optional private organiser bookkeeping per programme. Records what the organiser says; moves no money.
CREATE TABLE customer_private.programme_ledger_entry (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 seq integer NOT NULL CHECK(seq>=1),
 kind text NOT NULL CHECK(kind IN ('PARTICIPANT_FEE','PARTICIPANT_PAYMENT','ORGANISER_EXPENSE','ORGANISER_OBLIGATION','CORRIDRA_SERVICE_FEE')),
 cost_basis text CHECK(cost_basis IN ('PLANNED','ACTUAL')),
 registration_id uuid REFERENCES customer_private.programme_registration(id),
 amount_minor bigint NOT NULL CHECK(amount_minor<>0 AND abs(amount_minor)<=999999999999999999),
 currency text NOT NULL REFERENCES app.currency(code),
 occurred_on date NOT NULL CHECK(occurred_on BETWEEN DATE '2000-01-01' AND DATE '2100-01-01'),
 description text NOT NULL CHECK(description=btrim(description) AND length(description) BETWEEN 11 AND 300 AND description LIKE 'Synthetic %' AND description !~ '[[:cntrl:]]'),
 reverse_of uuid UNIQUE REFERENCES customer_private.programme_ledger_entry(id),
 provenance text NOT NULL DEFAULT 'ORGANISER_RECORDED' CHECK(provenance='ORGANISER_RECORDED'),
 recorded_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(programme_id,seq),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id),
 CHECK((kind IN ('ORGANISER_EXPENSE','ORGANISER_OBLIGATION','CORRIDRA_SERVICE_FEE'))=(cost_basis IS NOT NULL)),
 CHECK((kind IN ('PARTICIPANT_FEE','PARTICIPANT_PAYMENT'))=(registration_id IS NOT NULL)),
 CHECK((reverse_of IS NULL AND amount_minor>0) OR (reverse_of IS NOT NULL AND amount_minor<0))
);
CREATE INDEX programme_ledger_entry_page ON customer_private.programme_ledger_entry(workspace_id,programme_id,seq);
CREATE TABLE customer_private.programme_ledger_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 entry_id uuid NOT NULL UNIQUE REFERENCES customer_private.programme_ledger_entry(id),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
CREATE TRIGGER programme_ledger_entry_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_ledger_entry FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_ledger_command_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_ledger_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.programme_ledger_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_ledger_command ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.programme_ledger_entry,customer_private.programme_ledger_command FROM PUBLIC,corridra_runtime,corridra_auth;

-- Database-level integrity, so even a direct insert cannot break the rules the functions enforce.
CREATE FUNCTION customer_private.programme_ledger_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o customer_private.programme_ledger_entry;
BEGIN
 IF NEW.registration_id IS NOT NULL AND NOT EXISTS(SELECT FROM customer_private.programme_registration r WHERE r.id=NEW.registration_id AND r.workspace_id=NEW.workspace_id AND r.programme_id=NEW.programme_id) THEN
  RAISE EXCEPTION 'Registration outside this programme' USING ERRCODE='23514';
 END IF;
 IF NEW.reverse_of IS NOT NULL THEN
  SELECT * INTO o FROM customer_private.programme_ledger_entry WHERE id=NEW.reverse_of;
  IF NOT FOUND OR o.reverse_of IS NOT NULL OR o.workspace_id<>NEW.workspace_id OR o.programme_id<>NEW.programme_id OR o.kind<>NEW.kind OR o.currency<>NEW.currency
   OR o.cost_basis IS DISTINCT FROM NEW.cost_basis OR o.registration_id IS DISTINCT FROM NEW.registration_id OR NEW.amount_minor<>-o.amount_minor THEN
   RAISE EXCEPTION 'Exact compensating entry required' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER programme_ledger_guard BEFORE INSERT ON customer_private.programme_ledger_entry FOR EACH ROW EXECUTE FUNCTION customer_private.programme_ledger_guard();

CREATE FUNCTION customer_private.programme_ledger_expiry() RETURNS timestamptz
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT least(clock_timestamp()+interval '60 seconds',(SELECT expires_at FROM customer_private.session_proof WHERE hash=current_setting('corridra.customer_proof_hash',true)))
$$;

CREATE FUNCTION customer_private.programme_ledger_entry_json(entry uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',e.id,'seq',e.seq,'kind',e.kind,'costBasis',e.cost_basis,'registrationId',e.registration_id,
  'registrationLabel',r.display_label,'amountMinor',e.amount_minor::text,'currency',e.currency,'exponent',c.exponent,'occurredOn',to_char(e.occurred_on,'YYYY-MM-DD'),
  'description',e.description,'reverseOf',e.reverse_of,'reversedBy',(SELECT x.id FROM customer_private.programme_ledger_entry x WHERE x.reverse_of=e.id),
  'provenance',e.provenance,'recordedAt',e.created_at)
 FROM customer_private.programme_ledger_entry e JOIN app.currency c ON c.code=e.currency
 LEFT JOIN customer_private.programme_registration r ON r.id=e.registration_id WHERE e.id=entry
$$;

CREATE FUNCTION customer_private.programme_ledger_event(target uuid,actor uuid,command uuid,programme uuid,entry uuid,entry_kind text,entry_seq integer) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid;eid uuid:=gen_random_uuid();v integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v FROM app.domain_event e WHERE e.tenant_id=target AND e.aggregate_type='customer_programme_ledger' AND e.aggregate_id=programme::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.programme_ledger.recorded',1,'customer_programme_ledger',programme::text,v,executor,clock_timestamp(),command,command,
 jsonb_build_object('entryId',entry,'seq',entry_seq,'kind',entry_kind,'synthetic',true,'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.programme_ledger.recorded');
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

CREATE FUNCTION customer.programme_ledger_record(command uuid,target uuid,programme uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.programme_ledger_command;orig customer_private.programme_ledger_entry;e customer_private.programme_ledger_entry;
 k text;basis text;reg uuid;amt bigint;cur text;day date;descr text;rev uuid;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR programme IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid ledger entry' USING ERRCODE='23514'; END IF;
 actor:=customer_private.participant_scope(command,target,programme,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_ledger:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Ledger access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM customer_private.programme_ledger_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.request IS DISTINCT FROM jsonb_build_object('workspaceId',target,'programmeId',programme,'entry',input) THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.programme_ledger_expiry(),'commandId',command,'replayed',true,'entry',customer_private.programme_ledger_entry_json(prior.entry_id));
 END IF;
 IF input ? 'reverseOf' THEN
  -- A correction names only the original, a date and a reason. Everything else is copied exactly.
  IF input-ARRAY['reverseOf','occurredOn','description']<>'{}'::jsonb OR NOT(input ?& ARRAY['reverseOf','occurredOn','description']) OR jsonb_typeof(input->'reverseOf')<>'string' THEN RAISE EXCEPTION 'Invalid ledger correction' USING ERRCODE='23514'; END IF;
  rev:=(input->>'reverseOf')::uuid;
  SELECT * INTO orig FROM customer_private.programme_ledger_entry WHERE id=rev AND workspace_id=target AND programme_id=programme;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry unavailable' USING ERRCODE='42501'; END IF;
  k:=orig.kind;basis:=orig.cost_basis;reg:=orig.registration_id;cur:=orig.currency;amt:=-orig.amount_minor;
 ELSE
  IF input-ARRAY['kind','costBasis','registrationId','amountMinor','currency','occurredOn','description']<>'{}'::jsonb OR NOT(input ?& ARRAY['kind','costBasis','registrationId','amountMinor','currency','occurredOn','description'])
   OR jsonb_typeof(input->'kind')<>'string' OR jsonb_typeof(input->'costBasis') NOT IN ('string','null') OR jsonb_typeof(input->'registrationId') NOT IN ('string','null')
   OR jsonb_typeof(input->'amountMinor')<>'string' OR jsonb_typeof(input->'currency')<>'string' THEN RAISE EXCEPTION 'Invalid ledger entry' USING ERRCODE='23514'; END IF;
  k:=input->>'kind';basis:=input->>'costBasis';reg:=(input->>'registrationId')::uuid;cur:=input->>'currency';
  IF input->>'amountMinor' !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'Invalid amount' USING ERRCODE='23514'; END IF;
  amt:=(input->>'amountMinor')::bigint;
 END IF;
 IF jsonb_typeof(input->'occurredOn')<>'string' OR jsonb_typeof(input->'description')<>'string' OR input->>'occurredOn' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid ledger entry' USING ERRCODE='23514'; END IF;
 BEGIN day:=(input->>'occurredOn')::date;IF to_char(day,'YYYY-MM-DD')<>input->>'occurredOn' THEN RAISE EXCEPTION 'bad date'; END IF;
 EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='23514'; END;
 descr:=input->>'description';
 IF k='PARTICIPANT_PAYMENT' AND day>current_date THEN RAISE EXCEPTION 'A payment cannot be dated in the future' USING ERRCODE='23514'; END IF;
 SELECT coalesce(max(seq),0)+1 INTO e.seq FROM customer_private.programme_ledger_entry WHERE programme_id=programme;
 INSERT INTO customer_private.programme_ledger_entry(workspace_id,programme_id,seq,kind,cost_basis,registration_id,amount_minor,currency,occurred_on,description,reverse_of,recorded_by)
 VALUES(target,programme,e.seq,k,basis,reg,CASE WHEN rev IS NULL THEN amt ELSE amt END,cur,day,descr,rev,actor) RETURNING * INTO e;
 INSERT INTO customer_private.programme_ledger_command(actor_id,command_id,workspace_id,programme_id,entry_id,request) VALUES(actor,command,target,programme,e.id,jsonb_build_object('workspaceId',target,'programmeId',programme,'entry',input));
 PERFORM customer_private.programme_ledger_event(target,actor,command,programme,e.id,e.kind,e.seq);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Ledger access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.programme_ledger_expiry(),'commandId',command,'replayed',false,'entry',customer_private.programme_ledger_entry_json(e.id));
END $$;

CREATE FUNCTION customer.programme_ledger_list(target uuid,programme uuid,before_seq integer DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;items jsonb;next_before integer;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 OR (before_seq IS NOT NULL AND before_seq<1) THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);
 WITH page AS(SELECT e.id,e.seq FROM customer_private.programme_ledger_entry e WHERE e.workspace_id=target AND e.programme_id=programme AND (before_seq IS NULL OR e.seq<before_seq) ORDER BY e.seq DESC LIMIT page_size+1),
 visible AS(SELECT * FROM page ORDER BY seq DESC LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(customer_private.programme_ledger_entry_json(v.id) ORDER BY v.seq DESC) FROM visible v),'[]'::jsonb),
 CASE WHEN (SELECT count(*) FROM page)>page_size THEN (SELECT min(seq) FROM visible) ELSE NULL END INTO items,next_before;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Ledger access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.programme_ledger_expiry(),'entries',items,'nextBefore',next_before);
END $$;

CREATE FUNCTION customer.programme_economics(target uuid,programme uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;money jsonb;people jsonb;counts jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_ledger:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Ledger access expired' USING ERRCODE='42501'; END IF;
 -- Totals are per currency only. Nothing is converted or summed across currencies.
 WITH t AS(
  SELECT e.currency,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='PARTICIPANT_FEE'),0) fees,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='PARTICIPANT_PAYMENT'),0) paid,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='ORGANISER_EXPENSE' AND e.cost_basis='PLANNED'),0) pe,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='ORGANISER_OBLIGATION' AND e.cost_basis='PLANNED'),0) po,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='CORRIDRA_SERVICE_FEE' AND e.cost_basis='PLANNED'),0) ps,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='ORGANISER_EXPENSE' AND e.cost_basis='ACTUAL'),0) ae,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='ORGANISER_OBLIGATION' AND e.cost_basis='ACTUAL'),0) ao,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='CORRIDRA_SERVICE_FEE' AND e.cost_basis='ACTUAL'),0) a_s
  FROM customer_private.programme_ledger_entry e WHERE e.workspace_id=target AND e.programme_id=programme GROUP BY e.currency)
 SELECT coalesce(jsonb_agg(jsonb_build_object('currency',t.currency,'exponent',c.exponent,
  'feesDue',t.fees::text,'paymentsRecorded',t.paid::text,'outstanding',(t.fees-t.paid)::text,
  'plannedCosts',jsonb_build_object('expenses',t.pe::text,'obligations',t.po::text,'corridraServiceFees',t.ps::text,'total',(t.pe+t.po+t.ps)::text),
  'actualCosts',jsonb_build_object('expenses',t.ae::text,'obligations',t.ao::text,'corridraServiceFees',t.a_s::text,'total',(t.ae+t.ao+t.a_s)::text),
  'marginIfPlanned',(t.fees-(t.pe+t.po+t.ps))::text,'marginOnActual',(t.fees-(t.ae+t.ao+t.a_s))::text,'cashMargin',(t.paid-(t.ae+t.ao+t.a_s))::text) ORDER BY t.currency),'[]'::jsonb)
 INTO money FROM t JOIN app.currency c ON c.code=t.currency;
 WITH regs AS(
  SELECT r.id,r.display_label,CASE WHEN v.id IS NULL THEN 'ACTIVE' WHEN v.withdrawn THEN 'WITHDRAWN' ELSE 'REMOVED' END state
  FROM customer_private.programme_registration r LEFT JOIN customer_private.programme_participant_revocation v ON v.registration_id=r.id
  WHERE r.workspace_id=target AND r.programme_id=programme),
 per AS(
  SELECT e.registration_id,e.currency,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='PARTICIPANT_FEE'),0) due,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='PARTICIPANT_PAYMENT'),0) paid
  FROM customer_private.programme_ledger_entry e WHERE e.workspace_id=target AND e.programme_id=programme AND e.registration_id IS NOT NULL GROUP BY e.registration_id,e.currency)
 SELECT coalesce(jsonb_agg(jsonb_build_object('registrationId',g.id,'label',g.display_label,'state',g.state,'amounts',
  coalesce((SELECT jsonb_agg(jsonb_build_object('currency',p.currency,'exponent',c.exponent,'due',p.due::text,'recorded',p.paid::text,
   'status',CASE WHEN p.due=0 AND p.paid=0 THEN 'NO_FEE' WHEN p.paid=0 THEN 'UNPAID' WHEN p.paid<p.due THEN 'PART_PAID' WHEN p.paid=p.due THEN 'PAID' ELSE 'OVERPAID' END) ORDER BY p.currency)
   FROM per p JOIN app.currency c ON c.code=p.currency WHERE p.registration_id=g.id),'[]'::jsonb)) ORDER BY g.display_label,g.id),'[]'::jsonb)
 INTO people FROM regs g;
 SELECT jsonb_build_object('registered',count(*),'active',count(*) FILTER(WHERE v.id IS NULL),'withdrawnOrRemoved',count(*) FILTER(WHERE v.id IS NOT NULL))
 INTO counts FROM customer_private.programme_registration r LEFT JOIN customer_private.programme_participant_revocation v ON v.registration_id=r.id WHERE r.workspace_id=target AND r.programme_id=programme;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Ledger access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.programme_ledger_expiry(),
  'provenance','ORGANISER_RECORDED','verified',false,'collectsPayments',false,'currencies',money,'participants',people,'counts',counts);
END $$;

REVOKE ALL ON FUNCTION customer_private.programme_ledger_guard(),customer_private.programme_ledger_expiry(),customer_private.programme_ledger_entry_json(uuid),customer_private.programme_ledger_event(uuid,uuid,uuid,uuid,uuid,text,integer) FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.programme_ledger_record(uuid,uuid,uuid,jsonb),customer.programme_ledger_list(uuid,uuid,integer,integer),customer.programme_economics(uuid,uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.programme_ledger_record(uuid,uuid,uuid,jsonb),customer.programme_ledger_list(uuid,uuid,integer,integer),customer.programme_economics(uuid,uuid) TO corridra_runtime;
