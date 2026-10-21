-- Optional private pricing templates, bulk participant fees, programme series and exports.
-- Everything here is the organiser's own bookkeeping on invented data. It collects no money, converts no currency and sends nothing.
-- Fees land in the existing economics ledger and editions are created through the existing programme and template paths.

-- Versioned fee schedules the organiser saves in the workspace.
CREATE TABLE customer_private.pricing_template (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 50),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,seq),UNIQUE(id,workspace_id)
);
CREATE TABLE customer_private.pricing_template_revision (
 template_id uuid NOT NULL,workspace_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>=1),
 name text NOT NULL CHECK(name=btrim(name) AND length(name) BETWEEN 11 AND 120 AND name LIKE 'Synthetic %' AND name !~ '[[:cntrl:]]'),
 description text CHECK(description=btrim(description) AND length(description) BETWEEN 11 AND 500 AND description LIKE 'Synthetic %' AND description !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 retired boolean NOT NULL,
 changed_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(template_id,version),
 FOREIGN KEY(template_id,workspace_id) REFERENCES customer_private.pricing_template(id,workspace_id)
);
-- A fee schedule applied to a programme: a new version each time, holding an exact copy of the template content.
CREATE TABLE customer_private.programme_fee_schedule (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 version integer NOT NULL CHECK(version>=1),
 template_id uuid NOT NULL,template_version integer NOT NULL,
 currency text NOT NULL REFERENCES app.currency(code),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 applied_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(programme_id,version),
 FOREIGN KEY(template_id,template_version) REFERENCES customer_private.pricing_template_revision(template_id,version),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
-- One bulk fee command: the batch and one line per participant, each pointing at the ledger entry it created.
CREATE TABLE customer_private.programme_fee_batch (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,
 programme_id uuid NOT NULL,
 schedule_version integer NOT NULL,
 fee_date date NOT NULL CHECK(fee_date BETWEEN DATE '2000-01-01' AND DATE '2100-01-01'),
 group_size integer NOT NULL CHECK(group_size>=0),
 row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 200),
 currency text NOT NULL REFERENCES app.currency(code),
 total_minor numeric NOT NULL CHECK(total_minor>=row_count AND total_minor=trunc(total_minor)),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(programme_id,schedule_version) REFERENCES customer_private.programme_fee_schedule(programme_id,version),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TABLE customer_private.programme_fee_batch_line (
 batch_id uuid NOT NULL REFERENCES customer_private.programme_fee_batch(id),
 registration_id uuid NOT NULL REFERENCES customer_private.programme_registration(id),
 entry_id uuid NOT NULL UNIQUE REFERENCES customer_private.programme_ledger_entry(id),
 tier text NOT NULL,
 base_minor bigint NOT NULL CHECK(base_minor>0),
 early_bird_minor bigint NOT NULL CHECK(early_bird_minor>=0),
 group_minor bigint NOT NULL CHECK(group_minor>=0),
 amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor=base_minor-early_bird_minor-group_minor),
 PRIMARY KEY(batch_id,registration_id)
);
CREATE TABLE customer_private.pricing_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 operation text NOT NULL CHECK(operation IN ('template','schedule','bulk')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);

-- Series: a named, versioned plan that creates editions from a programme template on an explicit list of start dates.
CREATE TABLE customer_private.programme_series (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 30),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,seq),UNIQUE(id,workspace_id)
);
CREATE TABLE customer_private.programme_series_revision (
 series_id uuid NOT NULL,workspace_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>=1),
 name text NOT NULL CHECK(name=btrim(name) AND length(name) BETWEEN 11 AND 120 AND name LIKE 'Synthetic %' AND name !~ '[[:cntrl:]]'),
 description text CHECK(description=btrim(description) AND length(description) BETWEEN 11 AND 500 AND description LIKE 'Synthetic %' AND description !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
 template_id uuid NOT NULL REFERENCES customer_private.programme_template(id),
 start_dates jsonb NOT NULL CHECK(jsonb_typeof(start_dates)='array' AND jsonb_array_length(start_dates) BETWEEN 1 AND 24),
 retired boolean NOT NULL,
 changed_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(series_id,version),
 FOREIGN KEY(series_id,workspace_id) REFERENCES customer_private.programme_series(id,workspace_id)
);
-- Series membership is append-only: an edition is one programme in one series, numbered in order.
CREATE TABLE customer_private.programme_series_edition (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 series_id uuid NOT NULL,workspace_id uuid NOT NULL,
 edition_no integer NOT NULL CHECK(edition_no BETWEEN 1 AND 24),
 programme_id uuid NOT NULL UNIQUE REFERENCES customer_private.programme_creation(programme_id),
 start_date date NOT NULL CHECK(start_date BETWEEN DATE '2000-01-01' AND DATE '2100-01-01'),
 series_version integer NOT NULL,
 template_id uuid NOT NULL,template_version integer NOT NULL,
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(series_id,edition_no),
 FOREIGN KEY(series_id,workspace_id) REFERENCES customer_private.programme_series(id,workspace_id),
 FOREIGN KEY(series_id,series_version) REFERENCES customer_private.programme_series_revision(series_id,version),
 FOREIGN KEY(template_id,template_version) REFERENCES customer_private.programme_template_revision(template_id,version),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TABLE customer_private.programme_series_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 operation text NOT NULL CHECK(operation IN ('series','edition')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);

-- Every export is recorded: who, which dataset, how many rows. The rows themselves are never stored.
CREATE TABLE customer_private.programme_export_record (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 exported_by uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 programme_id uuid REFERENCES customer_private.programme_creation(programme_id),
 dataset text NOT NULL CHECK(dataset IN ('programmes','ledger')),
 row_count integer NOT NULL CHECK(row_count>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(exported_by,command_id)
);
CREATE INDEX programme_export_record_page ON customer_private.programme_export_record(workspace_id,created_at);

CREATE TRIGGER pricing_template_immutable BEFORE UPDATE OR DELETE ON customer_private.pricing_template FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER pricing_template_revision_immutable BEFORE UPDATE OR DELETE ON customer_private.pricing_template_revision FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_fee_schedule_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_fee_schedule FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_fee_batch_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_fee_batch FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_fee_batch_line_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_fee_batch_line FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER pricing_command_immutable BEFORE UPDATE OR DELETE ON customer_private.pricing_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_series_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_series FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_series_revision_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_series_revision FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_series_edition_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_series_edition FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_series_command_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_series_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_export_record_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_export_record FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER pricing_template_revision_order BEFORE INSERT ON customer_private.pricing_template_revision FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('template_id');
CREATE TRIGGER programme_fee_schedule_order BEFORE INSERT ON customer_private.programme_fee_schedule FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('programme_id');
CREATE TRIGGER programme_series_revision_order BEFORE INSERT ON customer_private.programme_series_revision FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('series_id');

ALTER TABLE customer_private.pricing_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.pricing_template_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_fee_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_fee_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_fee_batch_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.pricing_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_series_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_series_edition ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_series_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_export_record ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.pricing_template,customer_private.pricing_template_revision,customer_private.programme_fee_schedule,customer_private.programme_fee_batch,
 customer_private.programme_fee_batch_line,customer_private.pricing_command,customer_private.programme_series,customer_private.programme_series_revision,
 customer_private.programme_series_edition,customer_private.programme_series_command,customer_private.programme_export_record FROM PUBLIC,corridra_runtime,corridra_auth;

-- Database-level integrity, so even a direct insert cannot cross a programme or break the fee arithmetic.
CREATE FUNCTION customer_private.pricing_batch_line_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM customer_private.programme_fee_batch b JOIN customer_private.programme_ledger_entry e ON e.id=NEW.entry_id
  JOIN customer_private.programme_registration r ON r.id=NEW.registration_id
  WHERE b.id=NEW.batch_id AND e.programme_id=b.programme_id AND e.workspace_id=b.workspace_id AND e.kind='PARTICIPANT_FEE' AND e.registration_id=NEW.registration_id
   AND e.amount_minor=NEW.amount_minor AND e.currency=b.currency AND r.programme_id=b.programme_id) THEN
  RAISE EXCEPTION 'Fee line does not match its ledger entry' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER programme_fee_batch_line_match BEFORE INSERT ON customer_private.programme_fee_batch_line FOR EACH ROW EXECUTE FUNCTION customer_private.pricing_batch_line_guard();

-- An edition's start date must be the series date at its position, and its programme must sit in the series workspace.
CREATE FUNCTION customer_private.series_edition_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r customer_private.programme_series_revision;
BEGIN
 SELECT * INTO r FROM customer_private.programme_series_revision WHERE series_id=NEW.series_id AND version=NEW.series_version;
 IF NOT FOUND OR r.start_dates->>(NEW.edition_no-1) IS DISTINCT FROM to_char(NEW.start_date,'YYYY-MM-DD') THEN
  RAISE EXCEPTION 'Edition date does not match the series schedule' USING ERRCODE='23514';
 END IF;
 IF NEW.edition_no>1 AND NOT EXISTS(SELECT FROM customer_private.programme_series_edition p WHERE p.series_id=NEW.series_id AND p.edition_no=NEW.edition_no-1) THEN
  RAISE EXCEPTION 'Editions are created in order' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER programme_series_edition_match BEFORE INSERT ON customer_private.programme_series_edition FOR EACH ROW EXECUTE FUNCTION customer_private.series_edition_guard();

CREATE FUNCTION customer_private.pricing_event(target uuid,actor uuid,command uuid,family text,aggregate uuid,kind text,detail jsonb) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid;eid uuid:=gen_random_uuid();v integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 IF family NOT IN ('programme_pricing','programme_series','programme_export') THEN RAISE EXCEPTION 'Unknown event family' USING ERRCODE='23514'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v FROM app.domain_event e WHERE e.tenant_id=target AND e.aggregate_type='customer_'||family AND e.aggregate_id=aggregate::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.'||family||'.'||kind,1,'customer_'||family,aggregate::text,v,executor,clock_timestamp(),command,command,
 detail||jsonb_build_object('kind',kind,'synthetic',true,'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.'||family||'.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

-- The one authority check for this module. Only a current owner or admin of the workspace passes: the proof, the
-- admission, the workspace, the programme and the service executor are all confirmed by the shared helpers first.
CREATE FUNCTION customer_private.pricing_scope(command uuid,target uuid,programme uuid) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;
BEGIN
 IF programme IS NULL THEN actor:=customer_private.programme_actor(command,target);
 ELSE actor:=customer_private.participant_scope(command,target,programme,true);
 END IF;
 IF NOT EXISTS(SELECT FROM customer.collaborative_workspaces() WHERE id=target AND role IN ('owner','admin')) THEN
  RAISE EXCEPTION 'Pricing access denied' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;

-- A fee schedule holds one currency, up to 12 named tiers, up to 6 early-bird reductions by date and up to 6 group
-- reductions by participant count. Every amount is an exact whole number of minor units. The most any participant can
-- be reduced is always less than the cheapest tier, so a schedule can never produce a zero or negative fee.
CREATE FUNCTION customer_private.pricing_content(c jsonb) RETURNS jsonb
 LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE t jsonb;labels text[]:='{}';dates text[]:='{}';counts text[]:='{}';minbase numeric:=NULL;maxearly numeric:=0;maxgroup numeric:=0;lbl text;x numeric;
BEGIN
 IF c IS NULL OR jsonb_typeof(c)<>'object' OR c-ARRAY['currency','tiers','earlyBird','groupDiscounts']<>'{}'::jsonb OR NOT(c ?& ARRAY['currency','tiers','earlyBird','groupDiscounts']) THEN
  RAISE EXCEPTION 'Invalid fee schedule' USING ERRCODE='23514';
 END IF;
 IF jsonb_typeof(c->'currency')<>'string' THEN RAISE EXCEPTION 'Invalid fee schedule currency' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT FROM app.currency WHERE code=c->>'currency') THEN RAISE EXCEPTION 'Unknown currency' USING ERRCODE='23503'; END IF;
 IF jsonb_typeof(c->'tiers')<>'array' OR jsonb_array_length(c->'tiers') NOT BETWEEN 1 AND 12
  OR jsonb_typeof(c->'earlyBird')<>'array' OR jsonb_array_length(c->'earlyBird')>6
  OR jsonb_typeof(c->'groupDiscounts')<>'array' OR jsonb_array_length(c->'groupDiscounts')>6 THEN
  RAISE EXCEPTION 'Invalid fee schedule lists' USING ERRCODE='23514';
 END IF;
 FOR t IN SELECT * FROM jsonb_array_elements(c->'tiers') LOOP
  IF jsonb_typeof(t)<>'object' OR t-ARRAY['label','amountMinor']<>'{}'::jsonb OR NOT(t ?& ARRAY['label','amountMinor'])
   OR jsonb_typeof(t->'amountMinor')<>'string' OR t->>'amountMinor' !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'Invalid fee tier' USING ERRCODE='23514'; END IF;
  lbl:=customer_private.coordination_text(t->'label',11,120,true);
  IF lbl=ANY(labels) THEN RAISE EXCEPTION 'Tier names must be different' USING ERRCODE='23514'; END IF;
  labels:=labels||lbl;
  x:=(t->>'amountMinor')::numeric;
  IF minbase IS NULL OR x<minbase THEN minbase:=x; END IF;
 END LOOP;
 FOR t IN SELECT * FROM jsonb_array_elements(c->'earlyBird') LOOP
  IF jsonb_typeof(t)<>'object' OR t-ARRAY['label','untilDate','reductionMinor']<>'{}'::jsonb OR NOT(t ?& ARRAY['label','untilDate','reductionMinor'])
   OR jsonb_typeof(t->'reductionMinor')<>'string' OR t->>'reductionMinor' !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'Invalid early-bird rule' USING ERRCODE='23514'; END IF;
  PERFORM customer_private.coordination_text(t->'label',11,120,true);
  lbl:=to_char(customer_private.coordination_date(t->'untilDate',true),'YYYY-MM-DD');
  IF lbl=ANY(dates) THEN RAISE EXCEPTION 'Early-bird dates must be different' USING ERRCODE='23514'; END IF;
  dates:=dates||lbl;
  x:=(t->>'reductionMinor')::numeric;
  IF x>maxearly THEN maxearly:=x; END IF;
 END LOOP;
 FOR t IN SELECT * FROM jsonb_array_elements(c->'groupDiscounts') LOOP
  IF jsonb_typeof(t)<>'object' OR t-ARRAY['label','minParticipants','reductionMinor']<>'{}'::jsonb OR NOT(t ?& ARRAY['label','minParticipants','reductionMinor'])
   OR jsonb_typeof(t->'minParticipants')<>'number' OR t->>'minParticipants' !~ '^[1-9][0-9]{0,4}$' OR (t->>'minParticipants')::integer NOT BETWEEN 2 AND 10000
   OR jsonb_typeof(t->'reductionMinor')<>'string' OR t->>'reductionMinor' !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'Invalid group rule' USING ERRCODE='23514'; END IF;
  PERFORM customer_private.coordination_text(t->'label',11,120,true);
  lbl:=t->>'minParticipants';
  IF lbl=ANY(counts) THEN RAISE EXCEPTION 'Group sizes must be different' USING ERRCODE='23514'; END IF;
  counts:=counts||lbl;
  x:=(t->>'reductionMinor')::numeric;
  IF x>maxgroup THEN maxgroup:=x; END IF;
 END LOOP;
 IF maxearly+maxgroup>=minbase THEN RAISE EXCEPTION 'Reductions must stay below the cheapest tier' USING ERRCODE='23514'; END IF;
 RETURN c;
END $$;

CREATE FUNCTION customer_private.pricing_template_json(selected uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',t.id,'seq',t.seq,'version',v.version,'name',v.name,'description',v.description,'retired',v.retired,'content',v.content,
  'currency',v.content->>'currency','exponent',(SELECT c.exponent FROM app.currency c WHERE c.code=v.content->>'currency'),
  'tierCount',jsonb_array_length(v.content->'tiers'),'updatedAt',v.created_at,'provenance','ORGANISER_RECORDED')
 FROM customer_private.pricing_template t JOIN LATERAL(SELECT * FROM customer_private.pricing_template_revision r WHERE r.template_id=t.id ORDER BY r.version DESC LIMIT 1) v ON true WHERE t.id=selected
$$;
CREATE FUNCTION customer_private.fee_schedule_json(programme uuid,selected integer) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('version',s.version,'templateId',s.template_id,'templateVersion',s.template_version,'currency',s.currency,
  'exponent',(SELECT c.exponent FROM app.currency c WHERE c.code=s.currency),'content',s.content,'appliedAt',s.created_at,'provenance','ORGANISER_RECORDED')
 FROM customer_private.programme_fee_schedule s WHERE s.programme_id=programme AND s.version=selected
$$;

CREATE FUNCTION customer.pricing_template_save(command uuid,target uuid,expected integer,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.pricing_command;sig jsonb;tid uuid;cur integer;seqno integer;nm text;ds text;content jsonb;retire boolean;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR expected IS NULL OR expected<0 OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid fee schedule' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['templateId','name','description','content','retired']<>'{}'::jsonb OR NOT(input ?& ARRAY['templateId','name','description','content','retired'])
  OR jsonb_typeof(input->'retired')<>'boolean' OR jsonb_typeof(input->'templateId') NOT IN ('string','null') THEN RAISE EXCEPTION 'Invalid fee schedule' USING ERRCODE='23514'; END IF;
 actor:=customer_private.pricing_scope(command,target,NULL);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.pricing_template:'||target::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Pricing access expired' USING ERRCODE='42501'; END IF;
 sig:=jsonb_build_object('workspaceId',target,'expected',expected,'input',input);
 SELECT * INTO prior FROM customer_private.pricing_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.operation<>'template' OR prior.request IS DISTINCT FROM sig THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result||jsonb_build_object('workspaceId',target,'commandId',command,'replayed',true,'expiresAt',customer_private.coordination_expiry());
 END IF;
 nm:=customer_private.coordination_text(input->'name',11,120,true);
 ds:=customer_private.coordination_text(input->'description',11,500,false);
 content:=customer_private.pricing_content(input->'content');
 retire:=(input->>'retired')::boolean;
 IF jsonb_typeof(input->'templateId')='null' THEN
  IF expected<>0 OR retire THEN RAISE EXCEPTION 'A new fee schedule starts active' USING ERRCODE='23514'; END IF;
  SELECT coalesce(max(seq),0)+1 INTO seqno FROM customer_private.pricing_template WHERE workspace_id=target;
  IF seqno>50 THEN RAISE EXCEPTION 'Workspace fee schedule limit reached' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.pricing_template(workspace_id,seq,created_by) VALUES(target,seqno,actor) RETURNING id INTO tid;
  cur:=0;
 ELSE
  IF jsonb_typeof(input->'templateId')<>'string' THEN RAISE EXCEPTION 'Invalid fee schedule' USING ERRCODE='23514'; END IF;
  tid:=(input->>'templateId')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.pricing_template WHERE id=tid AND workspace_id=target) THEN RAISE EXCEPTION 'Fee schedule unavailable' USING ERRCODE='42501'; END IF;
  SELECT max(version) INTO cur FROM customer_private.pricing_template_revision WHERE template_id=tid;
  IF cur<>expected THEN RAISE EXCEPTION 'Fee schedule changed; reload before editing' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO customer_private.pricing_template_revision(template_id,workspace_id,version,name,description,content,retired,changed_by) VALUES(tid,target,cur+1,nm,ds,content,retire,actor);
 result:=jsonb_build_object('template',customer_private.pricing_template_json(tid));
 INSERT INTO customer_private.pricing_command(actor_id,command_id,workspace_id,operation,request,result) VALUES(actor,command,target,'template',sig,result);
 PERFORM customer_private.pricing_event(target,actor,command,'programme_pricing',tid,'template_saved',jsonb_build_object('templateId',tid,'version',cur+1,'retired',retire));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Pricing access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('workspaceId',target,'commandId',command,'replayed',false,'expiresAt',customer_private.coordination_expiry());
END $$;

CREATE FUNCTION customer.pricing_templates(target uuid,after_seq integer DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;items jsonb;more boolean;last_seq integer;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 OR (after_seq IS NOT NULL AND after_seq<0) THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 actor:=customer_private.pricing_scope(gen_random_uuid(),target,NULL);
 SELECT coalesce(jsonb_agg(customer_private.pricing_template_json(p.id) ORDER BY p.seq),'[]'::jsonb),max(p.seq) INTO items,last_seq
 FROM (SELECT id,seq FROM customer_private.pricing_template WHERE workspace_id=target AND (after_seq IS NULL OR seq>after_seq) ORDER BY seq LIMIT page_size) p;
 SELECT EXISTS(SELECT FROM customer_private.pricing_template WHERE workspace_id=target AND seq>coalesce(last_seq,after_seq,0)) INTO more;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Pricing access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'expiresAt',customer_private.coordination_expiry(),'templates',items,'nextAfter',CASE WHEN more THEN last_seq END);
END $$;

-- Applying a template records a new fee schedule version on the programme. It records no fee by itself.
CREATE FUNCTION customer.programme_fee_schedule_apply(command uuid,target uuid,programme uuid,expected integer,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.pricing_command;sig jsonb;tid uuid;tv integer;cur integer;rev customer_private.pricing_template_revision;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR programme IS NULL OR expected IS NULL OR expected<0 OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid fee schedule application' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['templateId','templateVersion']<>'{}'::jsonb OR NOT(input ?& ARRAY['templateId','templateVersion']) OR jsonb_typeof(input->'templateId')<>'string'
  OR jsonb_typeof(input->'templateVersion')<>'number' OR input->>'templateVersion' !~ '^[1-9][0-9]{0,6}$' THEN RAISE EXCEPTION 'Invalid fee schedule application' USING ERRCODE='23514'; END IF;
 tid:=(input->>'templateId')::uuid;tv:=(input->>'templateVersion')::integer;
 actor:=customer_private.pricing_scope(command,target,programme);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_pricing:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Pricing access expired' USING ERRCODE='42501'; END IF;
 sig:=jsonb_build_object('workspaceId',target,'programmeId',programme,'expected',expected,'input',input);
 SELECT * INTO prior FROM customer_private.pricing_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.operation<>'schedule' OR prior.request IS DISTINCT FROM sig THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',true,'expiresAt',customer_private.coordination_expiry());
 END IF;
 IF NOT EXISTS(SELECT FROM customer_private.pricing_template WHERE id=tid AND workspace_id=target) THEN RAISE EXCEPTION 'Fee schedule unavailable' USING ERRCODE='42501'; END IF;
 SELECT max(version) INTO cur FROM customer_private.pricing_template_revision WHERE template_id=tid;
 IF cur<>tv THEN RAISE EXCEPTION 'Fee schedule changed; reload before applying' USING ERRCODE='23514'; END IF;
 SELECT * INTO rev FROM customer_private.pricing_template_revision WHERE template_id=tid AND version=cur;
 IF rev.retired THEN RAISE EXCEPTION 'A retired fee schedule cannot be applied' USING ERRCODE='23514'; END IF;
 SELECT coalesce(max(version),0) INTO cur FROM customer_private.programme_fee_schedule WHERE programme_id=programme;
 IF cur<>expected THEN RAISE EXCEPTION 'The programme fee schedule changed; reload before applying' USING ERRCODE='23514'; END IF;
 INSERT INTO customer_private.programme_fee_schedule(workspace_id,programme_id,version,template_id,template_version,currency,content,applied_by)
 VALUES(target,programme,cur+1,tid,rev.version,rev.content->>'currency',rev.content,actor);
 result:=jsonb_build_object('schedule',customer_private.fee_schedule_json(programme,cur+1));
 INSERT INTO customer_private.pricing_command(actor_id,command_id,workspace_id,operation,request,result) VALUES(actor,command,target,'schedule',sig,result);
 PERFORM customer_private.pricing_event(target,actor,command,'programme_pricing',programme,'schedule_applied',jsonb_build_object('templateId',tid,'templateVersion',rev.version,'programmeId',programme,'scheduleVersion',cur+1));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Pricing access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',false,'expiresAt',customer_private.coordination_expiry());
END $$;

-- Works out every fee in a batch from the programme's current schedule. Nothing the caller sends is trusted as an amount:
-- the caller names a participant and a tier and the amount is computed here. It raises on the first invalid row, so a
-- batch is accepted whole or not at all. Used by both the preview and the recording command.
CREATE FUNCTION customer_private.pricing_compute(target uuid,programme uuid,schedule_version integer,fee_date date,lines jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s customer_private.programme_fee_schedule;n integer;l jsonb;ord integer:=0;reg uuid;tier jsonb;base numeric;early numeric;grp numeric;amt numeric;total numeric:=0;acc jsonb:='[]'::jsonb;seen uuid[]:='{}';
BEGIN
 IF jsonb_typeof(lines)<>'array' OR jsonb_array_length(lines) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Choose between 1 and 200 participants' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM customer_private.programme_fee_schedule WHERE programme_id=programme AND workspace_id=target ORDER BY version DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Apply a fee schedule to this programme first' USING ERRCODE='23514'; END IF;
 IF s.version<>schedule_version THEN RAISE EXCEPTION 'The programme fee schedule changed; reload before recording fees' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO n FROM customer_private.programme_registration r WHERE r.workspace_id=target AND r.programme_id=programme AND customer_private.coordination_registration_state(r.id)='ACTIVE';
 FOR l IN SELECT * FROM jsonb_array_elements(lines) LOOP
  ord:=ord+1;
  IF jsonb_typeof(l)<>'object' OR l-ARRAY['registrationId','tier']<>'{}'::jsonb OR NOT(l ?& ARRAY['registrationId','tier'])
   OR jsonb_typeof(l->'registrationId')<>'string' OR jsonb_typeof(l->'tier')<>'string'
   OR l->>'registrationId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'Row % is not valid',ord USING ERRCODE='23514';
  END IF;
  reg:=(l->>'registrationId')::uuid;
  IF reg=ANY(seen) THEN RAISE EXCEPTION 'Row % repeats a participant',ord USING ERRCODE='23514'; END IF;
  seen:=seen||reg;
  IF NOT EXISTS(SELECT FROM customer_private.programme_registration r WHERE r.id=reg AND r.workspace_id=target AND r.programme_id=programme AND customer_private.coordination_registration_state(r.id)='ACTIVE') THEN
   RAISE EXCEPTION 'Row % is not an active participant of this programme',ord USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT FROM customer_private.programme_ledger_entry e WHERE e.programme_id=programme AND e.registration_id=reg AND e.kind='PARTICIPANT_FEE' AND e.reverse_of IS NULL
   AND NOT EXISTS(SELECT FROM customer_private.programme_ledger_entry x WHERE x.reverse_of=e.id)) THEN
   RAISE EXCEPTION 'Row % already has a fee; correct it in the ledger first',ord USING ERRCODE='23514';
  END IF;
  SELECT value INTO tier FROM jsonb_array_elements(s.content->'tiers') WHERE value->>'label'=l->>'tier';
  IF tier IS NULL THEN RAISE EXCEPTION 'Row % names a tier that is not in the schedule',ord USING ERRCODE='23514'; END IF;
  base:=(tier->>'amountMinor')::numeric;
  SELECT coalesce(max((value->>'reductionMinor')::numeric),0) INTO early FROM jsonb_array_elements(s.content->'earlyBird') WHERE fee_date<=(value->>'untilDate')::date;
  SELECT coalesce(max((value->>'reductionMinor')::numeric),0) INTO grp FROM jsonb_array_elements(s.content->'groupDiscounts') WHERE n>=(value->>'minParticipants')::integer;
  amt:=base-early-grp;
  IF amt<1 THEN RAISE EXCEPTION 'Row % would have no fee to pay',ord USING ERRCODE='23514'; END IF;
  total:=total+amt;
  acc:=acc||jsonb_build_array(jsonb_build_object('registrationId',reg,'tier',l->>'tier','baseMinor',base::text,'earlyBirdMinor',early::text,'groupMinor',grp::text,'amountMinor',amt::text));
 END LOOP;
 RETURN jsonb_build_object('scheduleVersion',s.version,'currency',s.currency,'exponent',(SELECT c.exponent FROM app.currency c WHERE c.code=s.currency),
  'feeDate',to_char(fee_date,'YYYY-MM-DD'),'groupSize',n,'rowCount',ord,
  'perCurrency',jsonb_build_array(jsonb_build_object('currency',s.currency,'exponent',(SELECT c.exponent FROM app.currency c WHERE c.code=s.currency),'totalMinor',total::text)),
  'rows',acc);
END $$;

CREATE FUNCTION customer_private.pricing_bulk_input(input jsonb) RETURNS date
 LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF input IS NULL OR jsonb_typeof(input)<>'object' OR input-ARRAY['feeDate','rows']<>'{}'::jsonb OR NOT(input ?& ARRAY['feeDate','rows']) THEN RAISE EXCEPTION 'Invalid fee batch' USING ERRCODE='23514'; END IF;
 RETURN customer_private.coordination_date(input->'feeDate',true);
END $$;

CREATE FUNCTION customer.programme_bulk_fees_preview(target uuid,programme uuid,expected integer,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;day date;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF target IS NULL OR programme IS NULL OR expected IS NULL OR expected<1 THEN RAISE EXCEPTION 'Invalid fee batch' USING ERRCODE='23514'; END IF;
 day:=customer_private.pricing_bulk_input(input);
 actor:=customer_private.pricing_scope(gen_random_uuid(),target,programme);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_pricing:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Pricing access expired' USING ERRCODE='42501'; END IF;
 result:=customer_private.pricing_compute(target,programme,expected,day,input->'rows');
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Pricing access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.coordination_expiry(),'preview',true);
END $$;

-- Records the whole batch in one transaction through the existing economics ledger, or nothing at all.
CREATE FUNCTION customer.programme_bulk_fees_record(command uuid,target uuid,programme uuid,expected integer,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.pricing_command;sig jsonb;day date;computed jsonb;result jsonb;batch uuid;line jsonb;seqno integer;entry uuid;lines jsonb:='[]'::jsonb;total numeric;cur text;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR programme IS NULL OR expected IS NULL OR expected<1 THEN RAISE EXCEPTION 'Invalid fee batch' USING ERRCODE='23514'; END IF;
 day:=customer_private.pricing_bulk_input(input);
 actor:=customer_private.pricing_scope(command,target,programme);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_pricing:'||programme::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_ledger:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Pricing access expired' USING ERRCODE='42501'; END IF;
 sig:=jsonb_build_object('workspaceId',target,'programmeId',programme,'expected',expected,'input',input);
 SELECT * INTO prior FROM customer_private.pricing_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.operation<>'bulk' OR prior.request IS DISTINCT FROM sig THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',true,'expiresAt',customer_private.coordination_expiry());
 END IF;
 computed:=customer_private.pricing_compute(target,programme,expected,day,input->'rows');
 cur:=computed->>'currency';total:=(computed#>>'{perCurrency,0,totalMinor}')::numeric;
 INSERT INTO customer_private.programme_fee_batch(workspace_id,programme_id,schedule_version,fee_date,group_size,row_count,currency,total_minor,created_by)
 VALUES(target,programme,expected,day,(computed->>'groupSize')::integer,(computed->>'rowCount')::integer,cur,total,actor) RETURNING id INTO batch;
 SELECT coalesce(max(seq),0) INTO seqno FROM customer_private.programme_ledger_entry WHERE programme_id=programme;
 FOR line IN SELECT * FROM jsonb_array_elements(computed->'rows') LOOP
  seqno:=seqno+1;
  INSERT INTO customer_private.programme_ledger_entry(workspace_id,programme_id,seq,kind,cost_basis,registration_id,amount_minor,currency,occurred_on,description,reverse_of,recorded_by)
  VALUES(target,programme,seqno,'PARTICIPANT_FEE',NULL,(line->>'registrationId')::uuid,(line->>'amountMinor')::bigint,cur,day,'Synthetic participant fee from fee schedule version '||expected,NULL,actor)
  RETURNING id INTO entry;
  INSERT INTO customer_private.programme_fee_batch_line(batch_id,registration_id,entry_id,tier,base_minor,early_bird_minor,group_minor,amount_minor)
  VALUES(batch,(line->>'registrationId')::uuid,entry,line->>'tier',(line->>'baseMinor')::bigint,(line->>'earlyBirdMinor')::bigint,(line->>'groupMinor')::bigint,(line->>'amountMinor')::bigint);
  lines:=lines||jsonb_build_array(line||jsonb_build_object('entrySeq',seqno));
 END LOOP;
 result:=(computed-'rows')||jsonb_build_object('batchId',batch,'rows',lines);
 INSERT INTO customer_private.pricing_command(actor_id,command_id,workspace_id,operation,request,result) VALUES(actor,command,target,'bulk',sig,result);
 PERFORM customer_private.pricing_event(target,actor,command,'programme_pricing',programme,'fees_recorded',jsonb_build_object('programmeId',programme,'batchId',batch,'scheduleVersion',expected,'entries',(computed->>'rowCount')::integer));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Pricing access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',false,'expiresAt',customer_private.coordination_expiry());
END $$;

-- Everything the pricing screen needs for one programme: its current and past schedule versions and who can be given a fee.
CREATE FUNCTION customer.programme_pricing_overview(target uuid,programme uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;cur integer;people jsonb;history jsonb;counts jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 actor:=customer_private.pricing_scope(gen_random_uuid(),target,programme);
 SELECT coalesce(max(version),0) INTO cur FROM customer_private.programme_fee_schedule WHERE programme_id=programme;
 SELECT coalesce(jsonb_agg(jsonb_build_object('version',s.version,'templateId',s.template_id,'templateVersion',s.template_version,'currency',s.currency,'appliedAt',s.created_at) ORDER BY s.version DESC),'[]'::jsonb)
 INTO history FROM customer_private.programme_fee_schedule s WHERE s.programme_id=programme;
 WITH regs AS(
  SELECT r.id,r.display_label,customer_private.coordination_registration_state(r.id) state FROM customer_private.programme_registration r WHERE r.workspace_id=target AND r.programme_id=programme),
 fees AS(
  SELECT e.registration_id,e.currency,sum(e.amount_minor::numeric) due FROM customer_private.programme_ledger_entry e
  WHERE e.programme_id=programme AND e.kind='PARTICIPANT_FEE' AND e.registration_id IS NOT NULL GROUP BY e.registration_id,e.currency)
 SELECT coalesce(jsonb_agg(jsonb_build_object('registrationId',g.id,'label',g.display_label,'state',g.state,
  'hasFee',EXISTS(SELECT FROM customer_private.programme_ledger_entry e WHERE e.programme_id=programme AND e.registration_id=g.id AND e.kind='PARTICIPANT_FEE' AND e.reverse_of IS NULL
   AND NOT EXISTS(SELECT FROM customer_private.programme_ledger_entry x WHERE x.reverse_of=e.id)),
  'fees',coalesce((SELECT jsonb_agg(jsonb_build_object('currency',f.currency,'exponent',c.exponent,'dueMinor',f.due::text) ORDER BY f.currency) FROM fees f JOIN app.currency c ON c.code=f.currency WHERE f.registration_id=g.id),'[]'::jsonb))
  ORDER BY g.display_label,g.id),'[]'::jsonb)
 INTO people FROM regs g;
 SELECT jsonb_build_object('registered',count(*),'active',count(*) FILTER(WHERE customer_private.coordination_registration_state(r.id)='ACTIVE'))
 INTO counts FROM customer_private.programme_registration r WHERE r.workspace_id=target AND r.programme_id=programme;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Pricing access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.coordination_expiry(),
  'schedule',CASE WHEN cur>0 THEN customer_private.fee_schedule_json(programme,cur) END,'history',history,'participants',people,'counts',counts);
END $$;

CREATE FUNCTION customer_private.series_json(selected uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',s.id,'seq',s.seq,'version',v.version,'name',v.name,'description',v.description,'retired',v.retired,'templateId',v.template_id,
  'templateName',(SELECT r.name FROM customer_private.programme_template_revision r WHERE r.template_id=v.template_id ORDER BY r.version DESC LIMIT 1),
  'templateVersion',(SELECT max(r.version) FROM customer_private.programme_template_revision r WHERE r.template_id=v.template_id),
  'templateRetired',(SELECT r.retired FROM customer_private.programme_template_revision r WHERE r.template_id=v.template_id ORDER BY r.version DESC LIMIT 1),
  'startDates',v.start_dates,
  'editions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'editionNo',e.edition_no,'programmeId',e.programme_id,'programmeName',p.name,'startDate',to_char(e.start_date,'YYYY-MM-DD'),
    'seriesVersion',e.series_version,'templateVersion',e.template_version,'createdAt',e.created_at) ORDER BY e.edition_no)
    FROM customer_private.programme_series_edition e JOIN app.delivery_programme p ON p.tenant_id=e.workspace_id AND p.id=e.programme_id WHERE e.series_id=s.id),'[]'::jsonb),
  'nextEditionDate',v.start_dates->>(SELECT count(*)::integer FROM customer_private.programme_series_edition e WHERE e.series_id=s.id),
  'updatedAt',v.created_at,'provenance','ORGANISER_RECORDED')
 FROM customer_private.programme_series s JOIN LATERAL(SELECT * FROM customer_private.programme_series_revision r WHERE r.series_id=s.id ORDER BY r.version DESC LIMIT 1) v ON true WHERE s.id=selected
$$;

CREATE FUNCTION customer.programme_series_save(command uuid,target uuid,expected integer,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.programme_series_command;sig jsonb;sid uuid;cur integer;seqno integer;nm text;ds text;tid uuid;dates jsonb:='[]'::jsonb;retire boolean;result jsonb;d jsonb;day date;last_day date;made integer;ed customer_private.programme_series_edition;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR expected IS NULL OR expected<0 OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid series' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['seriesId','name','description','templateId','startDates','retired']<>'{}'::jsonb OR NOT(input ?& ARRAY['seriesId','name','description','templateId','startDates','retired'])
  OR jsonb_typeof(input->'retired')<>'boolean' OR jsonb_typeof(input->'seriesId') NOT IN ('string','null') OR jsonb_typeof(input->'templateId')<>'string'
  OR jsonb_typeof(input->'startDates')<>'array' OR jsonb_array_length(input->'startDates') NOT BETWEEN 1 AND 24 THEN RAISE EXCEPTION 'Invalid series' USING ERRCODE='23514'; END IF;
 actor:=customer_private.pricing_scope(command,target,NULL);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_series_list:'||target::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Series access expired' USING ERRCODE='42501'; END IF;
 sig:=jsonb_build_object('workspaceId',target,'expected',expected,'input',input);
 SELECT * INTO prior FROM customer_private.programme_series_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.operation<>'series' OR prior.request IS DISTINCT FROM sig THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result||jsonb_build_object('workspaceId',target,'commandId',command,'replayed',true,'expiresAt',customer_private.coordination_expiry());
 END IF;
 nm:=customer_private.coordination_text(input->'name',11,120,true);
 ds:=customer_private.coordination_text(input->'description',11,500,false);
 retire:=(input->>'retired')::boolean;
 tid:=(input->>'templateId')::uuid;
 IF NOT EXISTS(SELECT FROM customer_private.programme_template WHERE id=tid AND workspace_id=target) THEN RAISE EXCEPTION 'Template unavailable' USING ERRCODE='42501'; END IF;
 -- Start dates are an explicit list, in strictly increasing order.
 FOR d IN SELECT * FROM jsonb_array_elements(input->'startDates') LOOP
  day:=customer_private.coordination_date(d,true);
  IF last_day IS NOT NULL AND day<=last_day THEN RAISE EXCEPTION 'Start dates must be in increasing order' USING ERRCODE='23514'; END IF;
  last_day:=day;
  dates:=dates||to_jsonb(to_char(day,'YYYY-MM-DD'));
 END LOOP;
 IF jsonb_typeof(input->'seriesId')='null' THEN
  IF expected<>0 OR retire THEN RAISE EXCEPTION 'A new series starts active' USING ERRCODE='23514'; END IF;
  IF (SELECT r.retired FROM customer_private.programme_template_revision r WHERE r.template_id=tid ORDER BY r.version DESC LIMIT 1) THEN RAISE EXCEPTION 'A retired template cannot start a series' USING ERRCODE='23514'; END IF;
  SELECT coalesce(max(seq),0)+1 INTO seqno FROM customer_private.programme_series WHERE workspace_id=target;
  IF seqno>30 THEN RAISE EXCEPTION 'Workspace series limit reached' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.programme_series(workspace_id,seq,created_by) VALUES(target,seqno,actor) RETURNING id INTO sid;
  cur:=0;
 ELSE
  IF jsonb_typeof(input->'seriesId')<>'string' THEN RAISE EXCEPTION 'Invalid series' USING ERRCODE='23514'; END IF;
  sid:=(input->>'seriesId')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.programme_series WHERE id=sid AND workspace_id=target) THEN RAISE EXCEPTION 'Series unavailable' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_series:'||sid::text,0));
  SELECT max(version) INTO cur FROM customer_private.programme_series_revision WHERE series_id=sid;
  IF cur<>expected THEN RAISE EXCEPTION 'Series changed; reload before editing' USING ERRCODE='23514'; END IF;
  -- Editions already created keep their dates: the schedule can grow or change after them, never rewrite them.
  SELECT count(*) INTO made FROM customer_private.programme_series_edition WHERE series_id=sid;
  IF jsonb_array_length(dates)<made THEN RAISE EXCEPTION 'The schedule cannot drop dates of editions that already exist' USING ERRCODE='23514'; END IF;
  FOR ed IN SELECT * FROM customer_private.programme_series_edition WHERE series_id=sid LOOP
   IF dates->>(ed.edition_no-1) IS DISTINCT FROM to_char(ed.start_date,'YYYY-MM-DD') THEN RAISE EXCEPTION 'The schedule cannot change the date of an edition that already exists' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 INSERT INTO customer_private.programme_series_revision(series_id,workspace_id,version,name,description,template_id,start_dates,retired,changed_by) VALUES(sid,target,cur+1,nm,ds,tid,dates,retire,actor);
 result:=jsonb_build_object('series',customer_private.series_json(sid));
 INSERT INTO customer_private.programme_series_command(actor_id,command_id,workspace_id,operation,request,result) VALUES(actor,command,target,'series',sig,result);
 PERFORM customer_private.pricing_event(target,actor,command,'programme_series',sid,'series_saved',jsonb_build_object('seriesId',sid,'version',cur+1,'retired',retire,'dates',jsonb_array_length(dates)));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Series access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('workspaceId',target,'commandId',command,'replayed',false,'expiresAt',customer_private.coordination_expiry());
END $$;

CREATE FUNCTION customer.programme_series_list(target uuid,after_seq integer DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;items jsonb;more boolean;last_seq integer;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 30 OR (after_seq IS NOT NULL AND after_seq<0) THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 actor:=customer_private.pricing_scope(gen_random_uuid(),target,NULL);
 SELECT coalesce(jsonb_agg(customer_private.series_json(p.id) ORDER BY p.seq),'[]'::jsonb),max(p.seq) INTO items,last_seq
 FROM (SELECT id,seq FROM customer_private.programme_series WHERE workspace_id=target AND (after_seq IS NULL OR seq>after_seq) ORDER BY seq LIMIT page_size) p;
 SELECT EXISTS(SELECT FROM customer_private.programme_series WHERE workspace_id=target AND seq>coalesce(last_seq,after_seq,0)) INTO more;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Series access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'expiresAt',customer_private.coordination_expiry(),'series',items,'nextAfter',CASE WHEN more THEN last_seq END);
END $$;

-- Creates the next edition: a new programme through the existing programme creation, seeded by the existing template
-- application (settings, tasks and planned costs), then linked to the series. No participant, fee, payment or
-- personal data is copied. Any failure rolls the whole step back.
CREATE FUNCTION customer.programme_series_edition_create(command uuid,target uuid,series uuid,expected integer,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.programme_series_command;sig jsonb;cur integer;s customer_private.programme_series_revision;trev customer_private.programme_template_revision;tv integer;made integer;nm text;start_on date;
 prog jsonb;applied jsonb;pid uuid;edition uuid;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR series IS NULL OR expected IS NULL OR expected<1 OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid edition' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['name','templateVersion','editionNo']<>'{}'::jsonb OR NOT(input ?& ARRAY['name','templateVersion','editionNo']) OR jsonb_typeof(input->'templateVersion')<>'number' OR input->>'templateVersion' !~ '^[1-9][0-9]{0,6}$'
  OR jsonb_typeof(input->'editionNo')<>'number' OR input->>'editionNo' !~ '^[1-9][0-9]?$' THEN RAISE EXCEPTION 'Invalid edition' USING ERRCODE='23514'; END IF;
 tv:=(input->>'templateVersion')::integer;
 actor:=customer_private.pricing_scope(command,target,NULL);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_series:'||series::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Series access expired' USING ERRCODE='42501'; END IF;
 sig:=jsonb_build_object('workspaceId',target,'seriesId',series,'expected',expected,'input',input);
 SELECT * INTO prior FROM customer_private.programme_series_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.operation<>'edition' OR prior.request IS DISTINCT FROM sig THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result||jsonb_build_object('workspaceId',target,'seriesId',series,'commandId',command,'replayed',true,'expiresAt',customer_private.coordination_expiry());
 END IF;
 IF NOT EXISTS(SELECT FROM customer_private.programme_series WHERE id=series AND workspace_id=target) THEN RAISE EXCEPTION 'Series unavailable' USING ERRCODE='42501'; END IF;
 SELECT max(version) INTO cur FROM customer_private.programme_series_revision WHERE series_id=series;
 IF cur<>expected THEN RAISE EXCEPTION 'Series changed; reload before creating an edition' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM customer_private.programme_series_revision WHERE series_id=series AND version=cur;
 IF s.retired THEN RAISE EXCEPTION 'A retired series cannot create editions' USING ERRCODE='23514'; END IF;
 SELECT * INTO trev FROM customer_private.programme_template_revision WHERE template_id=s.template_id ORDER BY version DESC LIMIT 1;
 IF trev.version<>tv THEN RAISE EXCEPTION 'Template changed; reload before creating an edition' USING ERRCODE='23514'; END IF;
 IF trev.retired THEN RAISE EXCEPTION 'A retired template cannot create editions' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO made FROM customer_private.programme_series_edition WHERE series_id=series;
 IF made>=jsonb_array_length(s.start_dates) THEN RAISE EXCEPTION 'Every scheduled edition has already been created' USING ERRCODE='23514'; END IF;
 IF (input->>'editionNo')::integer<>made+1 THEN RAISE EXCEPTION 'Editions changed; reload before creating the next one' USING ERRCODE='23514'; END IF;
 start_on:=(s.start_dates->>made)::date;
 nm:=customer_private.coordination_text(input->'name',11,160,true);
 prog:=customer.create_programme(md5(command::text||':programme')::uuid,target,nm,trev.content->>'reportingPurpose');
 pid:=(prog->>'id')::uuid;
 applied:=customer.programme_template_apply(md5(command::text||':template')::uuid,target,pid,trev.version,
  jsonb_build_object('templateId',s.template_id,'startDate',to_char(start_on,'YYYY-MM-DD')));
 INSERT INTO customer_private.programme_series_edition(series_id,workspace_id,edition_no,programme_id,start_date,series_version,template_id,template_version,created_by)
 VALUES(series,target,made+1,pid,start_on,cur,s.template_id,trev.version,actor) RETURNING id INTO edition;
 result:=jsonb_build_object('edition',jsonb_build_object('id',edition,'editionNo',made+1,'programmeId',pid,'startDate',to_char(start_on,'YYYY-MM-DD'),'seriesVersion',cur,'templateVersion',trev.version),
  'tasksCreated',(applied->>'tasksCreated')::integer,'plannedCostsCreated',(applied->>'plannedCostsCreated')::integer);
 INSERT INTO customer_private.programme_series_command(actor_id,command_id,workspace_id,operation,request,result) VALUES(actor,command,target,'edition',sig,result);
 PERFORM customer_private.pricing_event(target,actor,command,'programme_series',series,'edition_created',jsonb_build_object('seriesId',series,'seriesVersion',cur,'programmeId',pid,'editionNo',made+1,'templateId',s.template_id,'templateVersion',trev.version));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Series access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('workspaceId',target,'seriesId',series,'commandId',command,'replayed',false,'expiresAt',customer_private.coordination_expiry());
END $$;

-- Read-only repeat revenue and margin across the editions of a series, from the organiser's own ledger. Every figure
-- is a per-currency sum of what was recorded. Nothing is converted, projected or summed across currencies.
CREATE FUNCTION customer.programme_series_revenue(target uuid,series uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;eds jsonb;tot jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF target IS NULL OR series IS NULL THEN RAISE EXCEPTION 'Invalid series' USING ERRCODE='23514'; END IF;
 actor:=customer_private.pricing_scope(gen_random_uuid(),target,NULL);
 IF NOT EXISTS(SELECT FROM customer_private.programme_series WHERE id=series AND workspace_id=target) THEN RAISE EXCEPTION 'Series unavailable' USING ERRCODE='42501'; END IF;
 WITH fig AS(
  SELECT e.edition_no,l.currency,
   coalesce(sum(l.amount_minor::numeric) FILTER(WHERE l.kind='PARTICIPANT_FEE'),0) fees,
   coalesce(sum(l.amount_minor::numeric) FILTER(WHERE l.kind='PARTICIPANT_PAYMENT'),0) paid,
   coalesce(sum(l.amount_minor::numeric) FILTER(WHERE l.kind IN ('ORGANISER_EXPENSE','ORGANISER_OBLIGATION','CORRIDRA_SERVICE_FEE') AND l.cost_basis='PLANNED'),0) planned,
   coalesce(sum(l.amount_minor::numeric) FILTER(WHERE l.kind IN ('ORGANISER_EXPENSE','ORGANISER_OBLIGATION','CORRIDRA_SERVICE_FEE') AND l.cost_basis='ACTUAL'),0) actual
  FROM customer_private.programme_series_edition e JOIN customer_private.programme_ledger_entry l ON l.programme_id=e.programme_id AND l.workspace_id=e.workspace_id
  WHERE e.series_id=series AND e.workspace_id=target GROUP BY e.edition_no,l.currency)
 SELECT
  (SELECT coalesce(jsonb_agg(jsonb_build_object('editionNo',e.edition_no,'programmeId',e.programme_id,'programmeName',p.name,'startDate',to_char(e.start_date,'YYYY-MM-DD'),
    'registered',(SELECT count(*) FROM customer_private.programme_registration r WHERE r.programme_id=e.programme_id),
    'active',(SELECT count(*) FROM customer_private.programme_registration r WHERE r.programme_id=e.programme_id AND customer_private.coordination_registration_state(r.id)='ACTIVE'),
    'figures',coalesce((SELECT jsonb_agg(jsonb_build_object('currency',f.currency,'exponent',c.exponent,'feesDue',f.fees::text,'paymentsRecorded',f.paid::text,'outstanding',(f.fees-f.paid)::text,
      'plannedCosts',f.planned::text,'actualCosts',f.actual::text,'marginOnActual',(f.fees-f.actual)::text,'cashMargin',(f.paid-f.actual)::text,
      'feesDueChange',(SELECT (f.fees-q.fees)::text FROM fig q WHERE q.edition_no=e.edition_no-1 AND q.currency=f.currency)) ORDER BY f.currency)
      FROM fig f JOIN app.currency c ON c.code=f.currency WHERE f.edition_no=e.edition_no),'[]'::jsonb)) ORDER BY e.edition_no),'[]'::jsonb)
   FROM customer_private.programme_series_edition e JOIN app.delivery_programme p ON p.tenant_id=e.workspace_id AND p.id=e.programme_id WHERE e.series_id=series AND e.workspace_id=target),
  (SELECT coalesce(jsonb_agg(jsonb_build_object('currency',t.currency,'exponent',c.exponent,'editions',t.n,'feesDue',t.fees::text,'paymentsRecorded',t.paid::text,'outstanding',(t.fees-t.paid)::text,
    'plannedCosts',t.planned::text,'actualCosts',t.actual::text,'marginOnActual',(t.fees-t.actual)::text,'cashMargin',(t.paid-t.actual)::text) ORDER BY t.currency),'[]'::jsonb)
   FROM (SELECT currency,count(*) n,sum(fees) fees,sum(paid) paid,sum(planned) planned,sum(actual) actual FROM fig GROUP BY currency) t JOIN app.currency c ON c.code=t.currency)
 INTO eds,tot;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Series access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'seriesId',series,'expiresAt',customer_private.coordination_expiry(),'provenance','ORGANISER_RECORDED','verified',false,
  'projection',false,'editions',eds,'totals',tot);
END $$;

-- Exports the workspace's own programmes or ledger as rows (the application writes the file). Owner and admin only,
-- bounded in size, and every export is recorded and audited. Participant labels are deliberately not exported.
CREATE FUNCTION customer.programme_export(command uuid,target uuid,dataset text,programme uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;rows_out jsonb;n integer;prior customer_private.programme_export_record;rid uuid;had boolean;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR dataset IS NULL OR dataset NOT IN ('programmes','ledger') OR (dataset='programmes' AND programme IS NOT NULL) THEN RAISE EXCEPTION 'Invalid export' USING ERRCODE='23514'; END IF;
 actor:=customer_private.pricing_scope(command,target,programme);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Export access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM customer_private.programme_export_record WHERE exported_by=actor AND command_id=command;
 had:=FOUND;
 IF had AND (prior.workspace_id<>target OR prior.dataset<>dataset OR prior.programme_id IS DISTINCT FROM programme) THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
 IF dataset='programmes' THEN
  SELECT coalesce(jsonb_agg(x.r ORDER BY x.ord),'[]'::jsonb),count(*) INTO rows_out,n FROM (
   SELECT p.name||p.id::text ord,jsonb_build_object('programmeId',p.id,'name',p.name,'createdAt',p.created_at,
    'registered',(SELECT count(*) FROM customer_private.programme_registration r WHERE r.programme_id=p.id),
    'active',(SELECT count(*) FROM customer_private.programme_registration r WHERE r.programme_id=p.id AND customer_private.coordination_registration_state(r.id)='ACTIVE'),
    'currency',coalesce(f.currency,''),'exponent',c.exponent,
    'feesDueMinor',coalesce(f.fees,0)::text,'paymentsRecordedMinor',coalesce(f.paid,0)::text,'plannedCostsMinor',coalesce(f.planned,0)::text,'actualCostsMinor',coalesce(f.actual,0)::text) r
   FROM customer_private.programme_creation pc JOIN app.delivery_programme p ON p.tenant_id=pc.workspace_id AND p.id=pc.programme_id
   LEFT JOIN LATERAL(SELECT l.currency,
     coalesce(sum(l.amount_minor::numeric) FILTER(WHERE l.kind='PARTICIPANT_FEE'),0) fees,
     coalesce(sum(l.amount_minor::numeric) FILTER(WHERE l.kind='PARTICIPANT_PAYMENT'),0) paid,
     coalesce(sum(l.amount_minor::numeric) FILTER(WHERE l.kind IN ('ORGANISER_EXPENSE','ORGANISER_OBLIGATION','CORRIDRA_SERVICE_FEE') AND l.cost_basis='PLANNED'),0) planned,
     coalesce(sum(l.amount_minor::numeric) FILTER(WHERE l.kind IN ('ORGANISER_EXPENSE','ORGANISER_OBLIGATION','CORRIDRA_SERVICE_FEE') AND l.cost_basis='ACTUAL'),0) actual
    FROM customer_private.programme_ledger_entry l WHERE l.programme_id=p.id GROUP BY l.currency) f ON true
   LEFT JOIN app.currency c ON c.code=f.currency
   WHERE pc.workspace_id=target ORDER BY 1,f.currency LIMIT 2001) x;
  IF n>2000 THEN RAISE EXCEPTION 'Too many rows for one export' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT coalesce(jsonb_agg(x.r ORDER BY x.p,x.s),'[]'::jsonb),count(*) INTO rows_out,n FROM (
   SELECT l.programme_id::text p,l.seq s,jsonb_build_object('programmeId',l.programme_id,'seq',l.seq,'kind',l.kind,'costBasis',l.cost_basis,'registrationId',l.registration_id,
    'amountMinor',l.amount_minor::text,'currency',l.currency,'exponent',c.exponent,'occurredOn',to_char(l.occurred_on,'YYYY-MM-DD'),'description',l.description,
    'reversesSeq',(SELECT o.seq FROM customer_private.programme_ledger_entry o WHERE o.id=l.reverse_of),'recordedAt',l.created_at) r
   FROM customer_private.programme_ledger_entry l JOIN app.currency c ON c.code=l.currency
   WHERE l.workspace_id=target AND (programme IS NULL OR l.programme_id=programme) ORDER BY 1,2 LIMIT 10001) x;
  IF n>10000 THEN RAISE EXCEPTION 'Too many rows for one export; choose one programme' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT had THEN
  rid:=gen_random_uuid();
  INSERT INTO customer_private.programme_export_record(id,exported_by,command_id,workspace_id,programme_id,dataset,row_count) VALUES(rid,actor,command,target,programme,dataset,n);
  PERFORM customer_private.pricing_event(target,actor,command,'programme_export',rid,'exported',jsonb_build_object('exportId',rid,'dataset',dataset,'rows',n,'scoped',programme IS NOT NULL));
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Export access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'dataset',dataset,'rowCount',n,'rows',rows_out,'replayed',had,'expiresAt',customer_private.coordination_expiry());
END $$;

REVOKE ALL ON FUNCTION customer_private.pricing_batch_line_guard(),customer_private.series_edition_guard(),customer_private.pricing_event(uuid,uuid,uuid,text,uuid,text,jsonb),
 customer_private.pricing_scope(uuid,uuid,uuid),customer_private.pricing_content(jsonb),customer_private.pricing_template_json(uuid),customer_private.fee_schedule_json(uuid,integer),
 customer_private.pricing_compute(uuid,uuid,integer,date,jsonb),customer_private.pricing_bulk_input(jsonb),customer_private.series_json(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.pricing_template_save(uuid,uuid,integer,jsonb),customer.pricing_templates(uuid,integer,integer),customer.programme_fee_schedule_apply(uuid,uuid,uuid,integer,jsonb),
 customer.programme_bulk_fees_preview(uuid,uuid,integer,jsonb),customer.programme_bulk_fees_record(uuid,uuid,uuid,integer,jsonb),customer.programme_pricing_overview(uuid,uuid),
 customer.programme_series_save(uuid,uuid,integer,jsonb),customer.programme_series_list(uuid,integer,integer),customer.programme_series_edition_create(uuid,uuid,uuid,integer,jsonb),
 customer.programme_series_revenue(uuid,uuid),customer.programme_export(uuid,uuid,text,uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.pricing_template_save(uuid,uuid,integer,jsonb),customer.pricing_templates(uuid,integer,integer),customer.programme_fee_schedule_apply(uuid,uuid,uuid,integer,jsonb),
 customer.programme_bulk_fees_preview(uuid,uuid,integer,jsonb),customer.programme_bulk_fees_record(uuid,uuid,uuid,integer,jsonb),customer.programme_pricing_overview(uuid,uuid),
 customer.programme_series_save(uuid,uuid,integer,jsonb),customer.programme_series_list(uuid,integer,integer),customer.programme_series_edition_create(uuid,uuid,uuid,integer,jsonb),
 customer.programme_series_revenue(uuid,uuid),customer.programme_export(uuid,uuid,text,uuid) TO corridra_runtime;
