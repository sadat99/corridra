-- Optional private repeatable programme templates. A template seeds records the coordination and economics modules own; it holds no participant data, sends nothing and moves no money.
CREATE TABLE customer_private.programme_template (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 50),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,seq),UNIQUE(id,workspace_id)
);
CREATE TABLE customer_private.programme_template_revision (
 template_id uuid NOT NULL,workspace_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>=1),
 name text NOT NULL CHECK(name=btrim(name) AND length(name) BETWEEN 11 AND 120 AND name LIKE 'Synthetic %' AND name !~ '[[:cntrl:]]'),
 description text CHECK(description=btrim(description) AND length(description) BETWEEN 11 AND 500 AND description LIKE 'Synthetic %' AND description !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 retired boolean NOT NULL,
 changed_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(template_id,version),
 FOREIGN KEY(template_id,workspace_id) REFERENCES customer_private.programme_template(id,workspace_id)
);
CREATE TABLE customer_private.programme_template_application (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,
 programme_id uuid NOT NULL UNIQUE REFERENCES customer_private.programme_creation(programme_id),
 template_id uuid NOT NULL,template_version integer NOT NULL,
 start_date date CHECK(start_date BETWEEN DATE '2000-01-01' AND DATE '2100-01-01'),
 task_count integer NOT NULL CHECK(task_count BETWEEN 0 AND 50),
 cost_count integer NOT NULL CHECK(cost_count BETWEEN 0 AND 30),
 capacity integer CHECK(capacity BETWEEN 1 AND 10000),
 applied_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(template_id,template_version) REFERENCES customer_private.programme_template_revision(template_id,version),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TABLE customer_private.programme_template_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 operation text NOT NULL CHECK(operation IN ('save','apply')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
CREATE INDEX programme_template_page ON customer_private.programme_template(workspace_id,seq);
CREATE TRIGGER programme_template_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_template FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_template_revision_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_template_revision FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_template_application_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_template_application FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_template_command_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_template_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_template_revision_order BEFORE INSERT ON customer_private.programme_template_revision FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('template_id');
ALTER TABLE customer_private.programme_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_template_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_template_application ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_template_command ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.programme_template,customer_private.programme_template_revision,customer_private.programme_template_application,customer_private.programme_template_command FROM PUBLIC,corridra_runtime,corridra_auth;

-- Content is exactly four parts, so a template can never carry a participant, a fee due, a payment, an actual cost or a date.
CREATE FUNCTION customer_private.template_content(c jsonb) RETURNS jsonb
 LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE t jsonb;k jsonb;n integer;
BEGIN
 IF c IS NULL OR jsonb_typeof(c)<>'object' OR c-ARRAY['reportingPurpose','capacity','tasks','plannedCosts']<>'{}'::jsonb OR NOT(c ?& ARRAY['reportingPurpose','capacity','tasks','plannedCosts']) THEN
  RAISE EXCEPTION 'Invalid template content' USING ERRCODE='23514';
 END IF;
 PERFORM customer_private.coordination_text(c->'reportingPurpose',11,500,true);
 IF jsonb_typeof(c->'capacity')<>'null' THEN
  IF jsonb_typeof(c->'capacity')<>'number' OR (c->>'capacity') !~ '^[1-9][0-9]{0,4}$' OR (c->>'capacity')::integer>10000 THEN RAISE EXCEPTION 'Invalid template capacity' USING ERRCODE='23514'; END IF;
 END IF;
 IF jsonb_typeof(c->'tasks')<>'array' OR jsonb_array_length(c->'tasks')>50 OR jsonb_typeof(c->'plannedCosts')<>'array' OR jsonb_array_length(c->'plannedCosts')>30 THEN
  RAISE EXCEPTION 'Invalid template lists' USING ERRCODE='23514';
 END IF;
 FOR t IN SELECT * FROM jsonb_array_elements(c->'tasks') LOOP
  IF jsonb_typeof(t)<>'object' OR t-ARRAY['title','detail','dueOffsetDays','assigneeLabel']<>'{}'::jsonb OR NOT(t ?& ARRAY['title','detail','dueOffsetDays','assigneeLabel']) THEN RAISE EXCEPTION 'Invalid template task' USING ERRCODE='23514'; END IF;
  PERFORM customer_private.coordination_text(t->'title',11,160,true);
  PERFORM customer_private.coordination_text(t->'detail',11,1000,false);
  PERFORM customer_private.coordination_text(t->'assigneeLabel',11,120,false);
  IF jsonb_typeof(t->'dueOffsetDays')<>'null' AND (jsonb_typeof(t->'dueOffsetDays')<>'number' OR (t->>'dueOffsetDays') !~ '^(0|[1-9][0-9]{0,2})$' OR (t->>'dueOffsetDays')::integer>730) THEN RAISE EXCEPTION 'Invalid template due offset' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR k IN SELECT * FROM jsonb_array_elements(c->'plannedCosts') LOOP
  IF jsonb_typeof(k)<>'object' OR k-ARRAY['kind','description','currency','amountMinor']<>'{}'::jsonb OR NOT(k ?& ARRAY['kind','description','currency','amountMinor'])
   OR jsonb_typeof(k->'kind')<>'string' OR k->>'kind' NOT IN ('ORGANISER_EXPENSE','ORGANISER_OBLIGATION','CORRIDRA_SERVICE_FEE')
   OR jsonb_typeof(k->'currency')<>'string' OR jsonb_typeof(k->'amountMinor')<>'string' OR k->>'amountMinor' !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'Invalid template cost' USING ERRCODE='23514'; END IF;
  PERFORM customer_private.coordination_text(k->'description',11,300,true);
  IF NOT EXISTS(SELECT FROM app.currency WHERE code=k->>'currency') THEN RAISE EXCEPTION 'Unknown currency' USING ERRCODE='23503'; END IF;
 END LOOP;
 RETURN c;
END $$;

CREATE FUNCTION customer_private.template_json(selected uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',t.id,'seq',t.seq,'version',v.version,'name',v.name,'description',v.description,'retired',v.retired,'content',v.content,
  'taskCount',jsonb_array_length(v.content->'tasks'),'costCount',jsonb_array_length(v.content->'plannedCosts'),'capacity',v.content->'capacity',
  'updatedAt',v.created_at,'provenance','ORGANISER_RECORDED')
 FROM customer_private.programme_template t JOIN LATERAL(SELECT * FROM customer_private.programme_template_revision r WHERE r.template_id=t.id ORDER BY r.version DESC LIMIT 1) v ON true WHERE t.id=selected
$$;
CREATE FUNCTION customer_private.template_event(target uuid,actor uuid,command uuid,aggregate uuid,kind text,detail jsonb) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid;eid uuid:=gen_random_uuid();v integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v FROM app.domain_event e WHERE e.tenant_id=target AND e.aggregate_type='customer_programme_template' AND e.aggregate_id=aggregate::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.programme_template.'||kind,1,'customer_programme_template',aggregate::text,v,executor,clock_timestamp(),command,command,
 detail||jsonb_build_object('kind',kind,'synthetic',true,'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.programme_template.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

CREATE FUNCTION customer.programme_template_save(command uuid,target uuid,expected integer,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.programme_template_command;sig jsonb;tid uuid;cur integer;seqno integer;nm text;ds text;content jsonb;retire boolean;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR expected IS NULL OR expected<0 OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid template' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['templateId','name','description','content','retired']<>'{}'::jsonb OR NOT(input ?& ARRAY['templateId','name','description','content','retired'])
  OR jsonb_typeof(input->'retired')<>'boolean' OR jsonb_typeof(input->'templateId') NOT IN ('string','null') THEN RAISE EXCEPTION 'Invalid template' USING ERRCODE='23514'; END IF;
 actor:=customer_private.programme_actor(command,target);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_template:'||target::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Template access expired' USING ERRCODE='42501'; END IF;
 sig:=jsonb_build_object('workspaceId',target,'expected',expected,'input',input);
 SELECT * INTO prior FROM customer_private.programme_template_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.operation<>'save' OR prior.request IS DISTINCT FROM sig THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result||jsonb_build_object('workspaceId',target,'commandId',command,'replayed',true,'expiresAt',customer_private.coordination_expiry());
 END IF;
 nm:=customer_private.coordination_text(input->'name',11,120,true);
 ds:=customer_private.coordination_text(input->'description',11,500,false);
 content:=customer_private.template_content(input->'content');
 retire:=(input->>'retired')::boolean;
 IF jsonb_typeof(input->'templateId')='null' THEN
  IF expected<>0 OR retire THEN RAISE EXCEPTION 'A new template starts active' USING ERRCODE='23514'; END IF;
  SELECT coalesce(max(seq),0)+1 INTO seqno FROM customer_private.programme_template WHERE workspace_id=target;
  IF seqno>50 THEN RAISE EXCEPTION 'Workspace template limit reached' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.programme_template(workspace_id,seq,created_by) VALUES(target,seqno,actor) RETURNING id INTO tid;
  cur:=0;
 ELSE
  IF jsonb_typeof(input->'templateId')<>'string' THEN RAISE EXCEPTION 'Invalid template' USING ERRCODE='23514'; END IF;
  tid:=(input->>'templateId')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.programme_template WHERE id=tid AND workspace_id=target) THEN RAISE EXCEPTION 'Template unavailable' USING ERRCODE='42501'; END IF;
  SELECT max(version) INTO cur FROM customer_private.programme_template_revision WHERE template_id=tid;
  IF cur<>expected THEN RAISE EXCEPTION 'Template changed; reload before editing' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO customer_private.programme_template_revision(template_id,workspace_id,version,name,description,content,retired,changed_by) VALUES(tid,target,cur+1,nm,ds,content,retire,actor);
 result:=jsonb_build_object('template',customer_private.template_json(tid));
 INSERT INTO customer_private.programme_template_command(actor_id,command_id,workspace_id,operation,request,result) VALUES(actor,command,target,'save',sig,result);
 PERFORM customer_private.template_event(target,actor,command,tid,'saved',jsonb_build_object('templateId',tid,'version',cur+1,'retired',retire));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Template access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('workspaceId',target,'commandId',command,'replayed',false,'expiresAt',customer_private.coordination_expiry());
END $$;

CREATE FUNCTION customer.programme_templates(target uuid,after_seq integer DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;items jsonb;more boolean;last_seq integer;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 OR (after_seq IS NOT NULL AND after_seq<0) THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 actor:=customer_private.programme_actor(gen_random_uuid(),target);
 SELECT coalesce(jsonb_agg(customer_private.template_json(p.id) ORDER BY p.seq),'[]'::jsonb),max(p.seq) INTO items,last_seq
 FROM (SELECT id,seq FROM customer_private.programme_template WHERE workspace_id=target AND (after_seq IS NULL OR seq>after_seq) ORDER BY seq LIMIT page_size) p;
 SELECT EXISTS(SELECT FROM customer_private.programme_template WHERE workspace_id=target AND seq>coalesce(last_seq,after_seq,0)) INTO more;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Template access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'expiresAt',customer_private.coordination_expiry(),'templates',items,'nextAfter',CASE WHEN more THEN last_seq END);
END $$;

-- Read-only capture of a programme's plan. It never writes and carries no participant data.
CREATE FUNCTION customer.programme_template_capture(target uuid,programme uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;purpose text;cap integer;tk jsonb;ck jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);
 SELECT reporting_purpose INTO purpose FROM app.delivery_programme WHERE tenant_id=target AND id=programme;
 SELECT capacity INTO cap FROM customer_private.programme_capacity_revision WHERE programme_id=programme ORDER BY version DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(jsonb_build_object('title',v.title,'detail',v.detail,'dueOffsetDays',NULL,'assigneeLabel',v.assignee_label) ORDER BY t.seq),'[]'::jsonb) INTO tk
 FROM customer_private.programme_task t JOIN LATERAL(SELECT * FROM customer_private.programme_task_revision r WHERE r.task_id=t.id ORDER BY r.version DESC LIMIT 1) v ON true
 WHERE t.workspace_id=target AND t.programme_id=programme AND v.status<>'CANCELLED';
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'description',e.description,'currency',e.currency,'amountMinor',e.amount_minor::text) ORDER BY e.seq),'[]'::jsonb) INTO ck
 FROM customer_private.programme_ledger_entry e
 WHERE e.workspace_id=target AND e.programme_id=programme AND e.cost_basis='PLANNED' AND e.reverse_of IS NULL
  AND NOT EXISTS(SELECT FROM customer_private.programme_ledger_entry x WHERE x.reverse_of=e.id);
 IF jsonb_array_length(tk)>50 OR jsonb_array_length(ck)>30 THEN RAISE EXCEPTION 'The programme has more tasks or costs than one template can hold' USING ERRCODE='23514'; END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Template access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.coordination_expiry(),
  'content',jsonb_build_object('reportingPurpose',purpose,'capacity',to_jsonb(cap),'tasks',tk,'plannedCosts',ck));
END $$;

CREATE FUNCTION customer.programme_template_apply(command uuid,target uuid,programme uuid,expected integer,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.programme_template_command;sig jsonb;tid uuid;cur integer;rev customer_private.programme_template_revision;starts_on date;
 t jsonb;k jsonb;tseq integer:=0;lseq integer;new_task uuid;result jsonb;ntasks integer;ncosts integer;cap integer;day date;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR programme IS NULL OR expected IS NULL OR expected<1 OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid application' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['templateId','startDate']<>'{}'::jsonb OR NOT(input ?& ARRAY['templateId','startDate']) OR jsonb_typeof(input->'templateId')<>'string' THEN RAISE EXCEPTION 'Invalid application' USING ERRCODE='23514'; END IF;
 tid:=(input->>'templateId')::uuid;
 starts_on:=customer_private.coordination_date(input->'startDate',false);
 actor:=customer_private.participant_scope(command,target,programme,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_template:'||target::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_coordination:'||programme::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_ledger:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Template access expired' USING ERRCODE='42501'; END IF;
 sig:=jsonb_build_object('workspaceId',target,'programmeId',programme,'expected',expected,'input',input);
 SELECT * INTO prior FROM customer_private.programme_template_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.operation<>'apply' OR prior.request IS DISTINCT FROM sig THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',true,'expiresAt',customer_private.coordination_expiry());
 END IF;
 IF NOT EXISTS(SELECT FROM customer_private.programme_template WHERE id=tid AND workspace_id=target) THEN RAISE EXCEPTION 'Template unavailable' USING ERRCODE='42501'; END IF;
 SELECT max(version) INTO cur FROM customer_private.programme_template_revision WHERE template_id=tid;
 IF cur<>expected THEN RAISE EXCEPTION 'Template changed; reload before applying' USING ERRCODE='23514'; END IF;
 SELECT * INTO rev FROM customer_private.programme_template_revision WHERE template_id=tid AND version=cur;
 IF rev.retired THEN RAISE EXCEPTION 'A retired template cannot be applied' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT FROM customer_private.programme_template_application WHERE programme_id=programme)
  OR EXISTS(SELECT FROM customer_private.programme_task WHERE programme_id=programme)
  OR EXISTS(SELECT FROM customer_private.programme_capacity_revision WHERE programme_id=programme)
  OR EXISTS(SELECT FROM customer_private.programme_ledger_entry WHERE programme_id=programme) THEN
  RAISE EXCEPTION 'A template can only be applied to an empty programme' USING ERRCODE='23514';
 END IF;
 ntasks:=jsonb_array_length(rev.content->'tasks');ncosts:=jsonb_array_length(rev.content->'plannedCosts');
 cap:=CASE WHEN jsonb_typeof(rev.content->'capacity')='number' THEN (rev.content->>'capacity')::integer END;
 IF cap IS NOT NULL THEN
  INSERT INTO customer_private.programme_capacity_revision(programme_id,workspace_id,version,capacity,reason,set_by) VALUES(programme,target,1,cap,'Synthetic capacity from a programme template',actor);
 END IF;
 FOR t IN SELECT * FROM jsonb_array_elements(rev.content->'tasks') LOOP
  tseq:=tseq+1;
  INSERT INTO customer_private.programme_task(workspace_id,programme_id,seq,created_by) VALUES(target,programme,tseq,actor) RETURNING id INTO new_task;
  day:=CASE WHEN starts_on IS NOT NULL AND jsonb_typeof(t->'dueOffsetDays')='number' THEN starts_on+(t->>'dueOffsetDays')::integer END;
  IF day IS NOT NULL AND day>DATE '2100-01-01' THEN RAISE EXCEPTION 'A due date falls outside the supported range' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.programme_task_revision(task_id,workspace_id,programme_id,version,title,detail,status,due_on,assignee_label,changed_by)
  VALUES(new_task,target,programme,1,t->>'title',t->>'detail','OPEN',day,t->>'assigneeLabel',actor);
 END LOOP;
 lseq:=0;
 FOR k IN SELECT * FROM jsonb_array_elements(rev.content->'plannedCosts') LOOP
  lseq:=lseq+1;
  INSERT INTO customer_private.programme_ledger_entry(workspace_id,programme_id,seq,kind,cost_basis,registration_id,amount_minor,currency,occurred_on,description,reverse_of,recorded_by)
  VALUES(target,programme,lseq,k->>'kind','PLANNED',NULL,(k->>'amountMinor')::bigint,k->>'currency',coalesce(starts_on,current_date),k->>'description',NULL,actor);
 END LOOP;
 INSERT INTO customer_private.programme_template_application(workspace_id,programme_id,template_id,template_version,start_date,task_count,cost_count,capacity,applied_by)
 VALUES(target,programme,tid,cur,starts_on,ntasks,ncosts,cap,actor);
 result:=jsonb_build_object('templateId',tid,'templateVersion',cur,'tasksCreated',ntasks,'plannedCostsCreated',ncosts,'capacity',to_jsonb(cap),'startDate',to_char(starts_on,'YYYY-MM-DD'));
 INSERT INTO customer_private.programme_template_command(actor_id,command_id,workspace_id,operation,request,result) VALUES(actor,command,target,'apply',sig,result);
 PERFORM customer_private.template_event(target,actor,command,programme,'applied',jsonb_build_object('templateId',tid,'version',cur,'programmeId',programme,'tasks',ntasks,'plannedCosts',ncosts));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Template access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',false,'expiresAt',customer_private.coordination_expiry());
END $$;

REVOKE ALL ON FUNCTION customer_private.template_content(jsonb),customer_private.template_json(uuid),customer_private.template_event(uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.programme_template_save(uuid,uuid,integer,jsonb),customer.programme_templates(uuid,integer,integer),customer.programme_template_capture(uuid,uuid),customer.programme_template_apply(uuid,uuid,uuid,integer,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.programme_template_save(uuid,uuid,integer,jsonb),customer.programme_templates(uuid,integer,integer),customer.programme_template_capture(uuid,uuid),customer.programme_template_apply(uuid,uuid,uuid,integer,jsonb) TO corridra_runtime;
