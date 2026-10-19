-- Optional private programme coordination and reporting. Organiser plans and participant-reported results; sends nothing, moves no money, verifies nothing.
CREATE TABLE customer_private.programme_task (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 200),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(programme_id,seq),UNIQUE(id,workspace_id,programme_id),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TABLE customer_private.programme_task_revision (
 task_id uuid NOT NULL,workspace_id uuid NOT NULL,programme_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>=1),
 title text NOT NULL CHECK(title=btrim(title) AND length(title) BETWEEN 11 AND 160 AND title LIKE 'Synthetic %' AND title !~ '[[:cntrl:]]'),
 detail text CHECK(detail=btrim(detail) AND length(detail) BETWEEN 11 AND 1000 AND detail LIKE 'Synthetic %' AND detail !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
 status text NOT NULL CHECK(status IN ('OPEN','IN_PROGRESS','DONE','CANCELLED')),
 due_on date CHECK(due_on BETWEEN DATE '2000-01-01' AND DATE '2100-01-01'),
 assignee_label text CHECK(assignee_label=btrim(assignee_label) AND length(assignee_label) BETWEEN 11 AND 120 AND assignee_label LIKE 'Synthetic %' AND assignee_label !~ '[[:cntrl:]]'),
 changed_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(task_id,version),
 FOREIGN KEY(task_id,workspace_id,programme_id) REFERENCES customer_private.programme_task(id,workspace_id,programme_id)
);
CREATE TABLE customer_private.programme_capacity_revision (
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 version integer NOT NULL CHECK(version>=1),
 capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 10000),
 reason text NOT NULL CHECK(reason=btrim(reason) AND length(reason) BETWEEN 11 AND 300 AND reason LIKE 'Synthetic %' AND reason !~ '[[:cntrl:]]'),
 set_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(programme_id,version),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TABLE customer_private.programme_attendance_revision (
 registration_id uuid NOT NULL REFERENCES customer_private.programme_registration(id),
 workspace_id uuid NOT NULL,programme_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>=1),
 state text NOT NULL CHECK(state IN ('ATTENDED','ABSENT')),
 recorded_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(registration_id,version),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TABLE customer_private.programme_participant_record (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,programme_id uuid NOT NULL,
 registration_id uuid NOT NULL REFERENCES customer_private.programme_registration(id),
 kind text NOT NULL CHECK(kind IN ('FEEDBACK','OUTCOME')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,kind),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE UNIQUE INDEX programme_participant_feedback_one ON customer_private.programme_participant_record(registration_id) WHERE kind='FEEDBACK';
CREATE TABLE customer_private.programme_participant_record_revision (
 record_id uuid NOT NULL,kind text NOT NULL,
 version integer NOT NULL CHECK(version>=1),
 shared boolean NOT NULL,retracted boolean NOT NULL,
 rating smallint CHECK(rating BETWEEN 1 AND 5),
 outcome_kind text CHECK(outcome_kind IN ('MEETING_HELD','FOLLOW_UP_AGREED','SAMPLE_OR_QUOTE_REQUESTED','PRELIMINARY_AGREEMENT','NO_PROGRESS')),
 occurred_on date CHECK(occurred_on BETWEEN DATE '2000-01-01' AND DATE '2100-01-01'),
 note text CHECK(note=btrim(note) AND length(note) BETWEEN 11 AND 500 AND note LIKE 'Synthetic %' AND note !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(record_id,version),
 FOREIGN KEY(record_id,kind) REFERENCES customer_private.programme_participant_record(id,kind),
 CHECK((kind='FEEDBACK' AND rating IS NOT NULL AND outcome_kind IS NULL AND occurred_on IS NULL) OR (kind='OUTCOME' AND rating IS NULL AND outcome_kind IS NOT NULL AND occurred_on IS NOT NULL)),
 CHECK(NOT retracted OR NOT shared)
);
CREATE TABLE customer_private.programme_coordination_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 operation text NOT NULL CHECK(operation IN ('task','capacity','attendance','record')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
CREATE INDEX programme_task_page ON customer_private.programme_task(workspace_id,programme_id,seq);
CREATE INDEX programme_attendance_programme ON customer_private.programme_attendance_revision(programme_id,registration_id,version);
CREATE INDEX programme_participant_record_programme ON customer_private.programme_participant_record(programme_id,kind);
CREATE TRIGGER programme_task_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_task FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_task_revision_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_task_revision FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_capacity_revision_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_capacity_revision FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_attendance_revision_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_attendance_revision FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_participant_record_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_participant_record FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_participant_record_revision_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_participant_record_revision FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_coordination_command_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_coordination_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.programme_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_task_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_capacity_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_attendance_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_participant_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_participant_record_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_coordination_command ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.programme_task,customer_private.programme_task_revision,customer_private.programme_capacity_revision,customer_private.programme_attendance_revision,
 customer_private.programme_participant_record,customer_private.programme_participant_record_revision,customer_private.programme_coordination_command FROM PUBLIC,corridra_runtime,corridra_auth;

-- Database-level integrity, so even a direct insert cannot skip a version or cross a programme.
CREATE FUNCTION customer_private.coordination_version_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE latest integer;
BEGIN
 EXECUTE format('SELECT coalesce(max(version),0) FROM customer_private.%I WHERE %I=$1',TG_TABLE_NAME,TG_ARGV[0]) INTO latest USING (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
 IF NEW.version<>latest+1 THEN RAISE EXCEPTION 'Revision out of order' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER programme_task_revision_order BEFORE INSERT ON customer_private.programme_task_revision FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('task_id');
CREATE TRIGGER programme_capacity_revision_order BEFORE INSERT ON customer_private.programme_capacity_revision FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('programme_id');
CREATE TRIGGER programme_attendance_revision_order BEFORE INSERT ON customer_private.programme_attendance_revision FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('registration_id');
CREATE TRIGGER programme_participant_record_revision_order BEFORE INSERT ON customer_private.programme_participant_record_revision FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('record_id');
CREATE FUNCTION customer_private.coordination_registration_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM customer_private.programme_registration r WHERE r.id=NEW.registration_id AND r.workspace_id=NEW.workspace_id AND r.programme_id=NEW.programme_id) THEN
  RAISE EXCEPTION 'Registration outside this programme' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER programme_attendance_registration BEFORE INSERT ON customer_private.programme_attendance_revision FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_registration_guard();
CREATE TRIGGER programme_participant_record_registration BEFORE INSERT ON customer_private.programme_participant_record FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_registration_guard();

CREATE FUNCTION customer_private.coordination_expiry() RETURNS timestamptz
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT least(clock_timestamp()+interval '60 seconds',(SELECT expires_at FROM customer_private.session_proof WHERE hash=current_setting('corridra.customer_proof_hash',true)))
$$;
-- Free text must be a JSON string that begins with Synthetic, has no control characters and no outer spaces.
CREATE FUNCTION customer_private.coordination_text(v jsonb,min_length integer,max_length integer,required boolean) RETURNS text
 LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF v IS NULL OR jsonb_typeof(v)='null' THEN
  IF required THEN RAISE EXCEPTION 'Text required' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 IF jsonb_typeof(v)<>'string' OR (v#>>'{}')<>btrim(v#>>'{}') OR length(v#>>'{}') NOT BETWEEN min_length AND max_length
  OR (v#>>'{}') NOT LIKE 'Synthetic %' OR (v#>>'{}') ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' THEN
  RAISE EXCEPTION 'Invalid synthetic text' USING ERRCODE='23514';
 END IF;
 RETURN v#>>'{}';
END $$;
CREATE FUNCTION customer_private.coordination_date(v jsonb,required boolean) RETURNS date
 LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE d date;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)='null' THEN
  IF required THEN RAISE EXCEPTION 'Date required' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 IF jsonb_typeof(v)<>'string' OR (v#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='23514'; END IF;
 BEGIN d:=(v#>>'{}')::date;IF to_char(d,'YYYY-MM-DD')<>(v#>>'{}') THEN RAISE EXCEPTION 'bad'; END IF;
 EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='23514'; END;
 IF d NOT BETWEEN DATE '2000-01-01' AND DATE '2100-01-01' THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='23514'; END IF;
 RETURN d;
END $$;
CREATE FUNCTION customer_private.coordination_registration_state(selected uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN v.id IS NULL THEN 'ACTIVE' WHEN v.withdrawn THEN 'WITHDRAWN' ELSE 'REMOVED' END
 FROM customer_private.programme_registration r LEFT JOIN customer_private.programme_participant_revocation v ON v.registration_id=r.id WHERE r.id=selected
$$;
CREATE FUNCTION customer_private.programme_task_json(selected uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',t.id,'seq',t.seq,'version',v.version,'title',v.title,'detail',v.detail,'status',v.status,
  'dueOn',to_char(v.due_on,'YYYY-MM-DD'),'assigneeLabel',v.assignee_label,'createdAt',t.created_at,'updatedAt',v.created_at,'provenance','ORGANISER_RECORDED')
 FROM customer_private.programme_task t JOIN LATERAL(SELECT * FROM customer_private.programme_task_revision r WHERE r.task_id=t.id ORDER BY r.version DESC LIMIT 1) v ON true WHERE t.id=selected
$$;
CREATE FUNCTION customer_private.coordination_event(target uuid,actor uuid,command uuid,programme uuid,kind text,reference uuid) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid;eid uuid:=gen_random_uuid();v integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v FROM app.domain_event e WHERE e.tenant_id=target AND e.aggregate_type='customer_programme_coordination' AND e.aggregate_id=programme::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.programme_coordination.'||kind,1,'customer_programme_coordination',programme::text,v,executor,clock_timestamp(),command,command,
 jsonb_build_object('referenceId',reference,'kind',kind,'synthetic',true,'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.programme_coordination.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

CREATE FUNCTION customer.programme_task_save(command uuid,target uuid,programme uuid,expected integer,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.programme_coordination_command;sig jsonb;tid uuid;cur integer;seqno integer;st text;result jsonb;
 ttl text;det text;due date;lab text;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR programme IS NULL OR expected IS NULL OR expected<0 OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid task' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['taskId','title','detail','status','dueOn','assigneeLabel']<>'{}'::jsonb OR NOT(input ?& ARRAY['taskId','title','detail','status','dueOn','assigneeLabel']) THEN RAISE EXCEPTION 'Invalid task' USING ERRCODE='23514'; END IF;
 actor:=customer_private.participant_scope(command,target,programme,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_coordination:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Coordination access expired' USING ERRCODE='42501'; END IF;
 sig:=jsonb_build_object('workspaceId',target,'programmeId',programme,'expected',expected,'input',input);
 SELECT * INTO prior FROM customer_private.programme_coordination_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.operation<>'task' OR prior.request IS DISTINCT FROM sig THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',true,'expiresAt',customer_private.coordination_expiry());
 END IF;
 ttl:=customer_private.coordination_text(input->'title',11,160,true);
 det:=customer_private.coordination_text(input->'detail',11,1000,false);
 lab:=customer_private.coordination_text(input->'assigneeLabel',11,120,false);
 due:=customer_private.coordination_date(input->'dueOn',false);
 IF jsonb_typeof(input->'status')<>'string' OR input->>'status' NOT IN ('OPEN','IN_PROGRESS','DONE','CANCELLED') THEN RAISE EXCEPTION 'Invalid task status' USING ERRCODE='23514'; END IF;
 st:=input->>'status';
 IF jsonb_typeof(input->'taskId')='null' THEN
  IF expected<>0 OR st<>'OPEN' THEN RAISE EXCEPTION 'A new task starts open' USING ERRCODE='23514'; END IF;
  SELECT coalesce(max(seq),0)+1 INTO seqno FROM customer_private.programme_task WHERE programme_id=programme;
  IF seqno>200 THEN RAISE EXCEPTION 'Programme task limit reached' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.programme_task(workspace_id,programme_id,seq,created_by) VALUES(target,programme,seqno,actor) RETURNING id INTO tid;
  cur:=0;
 ELSE
  IF jsonb_typeof(input->'taskId')<>'string' THEN RAISE EXCEPTION 'Invalid task' USING ERRCODE='23514'; END IF;
  tid:=(input->>'taskId')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.programme_task WHERE id=tid AND workspace_id=target AND programme_id=programme) THEN RAISE EXCEPTION 'Task unavailable' USING ERRCODE='42501'; END IF;
  SELECT max(version) INTO cur FROM customer_private.programme_task_revision WHERE task_id=tid;
  IF cur<>expected THEN RAISE EXCEPTION 'Task changed; reload before editing' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO customer_private.programme_task_revision(task_id,workspace_id,programme_id,version,title,detail,status,due_on,assignee_label,changed_by)
 VALUES(tid,target,programme,cur+1,ttl,det,st,due,lab,actor);
 result:=jsonb_build_object('task',customer_private.programme_task_json(tid));
 INSERT INTO customer_private.programme_coordination_command(actor_id,command_id,workspace_id,programme_id,operation,request,result) VALUES(actor,command,target,programme,'task',sig,result);
 PERFORM customer_private.coordination_event(target,actor,command,programme,'task_saved',tid);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Coordination access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',false,'expiresAt',customer_private.coordination_expiry());
END $$;

CREATE FUNCTION customer.programme_tasks(target uuid,programme uuid,after_seq integer DEFAULT NULL,page_size integer DEFAULT 50) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;items jsonb;more boolean;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 OR (after_seq IS NOT NULL AND after_seq<0) THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);
 SELECT coalesce(jsonb_agg(customer_private.programme_task_json(p.id) ORDER BY p.seq),'[]'::jsonb) INTO items
 FROM (SELECT id,seq FROM customer_private.programme_task WHERE workspace_id=target AND programme_id=programme AND (after_seq IS NULL OR seq>after_seq) ORDER BY seq LIMIT page_size) p;
 SELECT EXISTS(SELECT FROM customer_private.programme_task WHERE workspace_id=target AND programme_id=programme AND seq>coalesce((items->(jsonb_array_length(items)-1)->>'seq')::integer,after_seq,0)) INTO more;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Coordination access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.coordination_expiry(),'tasks',items,
  'nextAfter',CASE WHEN more AND jsonb_array_length(items)>0 THEN (items->(jsonb_array_length(items)-1)->>'seq')::integer END);
END $$;

CREATE FUNCTION customer.programme_capacity_set(command uuid,target uuid,programme uuid,expected integer,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.programme_coordination_command;sig jsonb;cur integer;cap integer;why text;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR programme IS NULL OR expected IS NULL OR expected<0 OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid capacity' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['capacity','reason']<>'{}'::jsonb OR NOT(input ?& ARRAY['capacity','reason']) OR jsonb_typeof(input->'capacity')<>'number' OR (input->>'capacity') !~ '^[1-9][0-9]{0,4}$' THEN RAISE EXCEPTION 'Invalid capacity' USING ERRCODE='23514'; END IF;
 cap:=(input->>'capacity')::integer;
 IF cap>10000 THEN RAISE EXCEPTION 'Invalid capacity' USING ERRCODE='23514'; END IF;
 actor:=customer_private.participant_scope(command,target,programme,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_coordination:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Coordination access expired' USING ERRCODE='42501'; END IF;
 sig:=jsonb_build_object('workspaceId',target,'programmeId',programme,'expected',expected,'input',input);
 SELECT * INTO prior FROM customer_private.programme_coordination_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.operation<>'capacity' OR prior.request IS DISTINCT FROM sig THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',true,'expiresAt',customer_private.coordination_expiry());
 END IF;
 why:=customer_private.coordination_text(input->'reason',11,300,true);
 SELECT coalesce(max(version),0) INTO cur FROM customer_private.programme_capacity_revision WHERE programme_id=programme;
 IF cur<>expected THEN RAISE EXCEPTION 'Capacity changed; reload before editing' USING ERRCODE='23514'; END IF;
 INSERT INTO customer_private.programme_capacity_revision(programme_id,workspace_id,version,capacity,reason,set_by) VALUES(programme,target,cur+1,cap,why,actor);
 result:=jsonb_build_object('capacity',cap,'version',cur+1,'reason',why);
 INSERT INTO customer_private.programme_coordination_command(actor_id,command_id,workspace_id,programme_id,operation,request,result) VALUES(actor,command,target,programme,'capacity',sig,result);
 PERFORM customer_private.coordination_event(target,actor,command,programme,'capacity_set',programme);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Coordination access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',false,'expiresAt',customer_private.coordination_expiry());
END $$;

CREATE FUNCTION customer.programme_attendance_set(command uuid,target uuid,programme uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.programme_coordination_command;sig jsonb;reg uuid;st text;latest customer_private.programme_attendance_revision;result jsonb;ver integer;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR programme IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid attendance' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['registrationId','state']<>'{}'::jsonb OR NOT(input ?& ARRAY['registrationId','state']) OR jsonb_typeof(input->'registrationId')<>'string'
  OR jsonb_typeof(input->'state')<>'string' OR input->>'state' NOT IN ('ATTENDED','ABSENT') THEN RAISE EXCEPTION 'Invalid attendance' USING ERRCODE='23514'; END IF;
 reg:=(input->>'registrationId')::uuid;st:=input->>'state';
 actor:=customer_private.participant_scope(command,target,programme,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_coordination:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Coordination access expired' USING ERRCODE='42501'; END IF;
 sig:=jsonb_build_object('workspaceId',target,'programmeId',programme,'input',input);
 SELECT * INTO prior FROM customer_private.programme_coordination_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.operation<>'attendance' OR prior.request IS DISTINCT FROM sig THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',true,'expiresAt',customer_private.coordination_expiry());
 END IF;
 IF NOT EXISTS(SELECT FROM customer_private.programme_registration WHERE id=reg AND workspace_id=target AND programme_id=programme) THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
 IF customer_private.coordination_registration_state(reg)<>'ACTIVE' THEN RAISE EXCEPTION 'Only an active registration can be marked' USING ERRCODE='23514'; END IF;
 SELECT * INTO latest FROM customer_private.programme_attendance_revision WHERE registration_id=reg ORDER BY version DESC LIMIT 1;
 IF FOUND AND latest.state=st THEN ver:=latest.version;
 ELSE
  ver:=coalesce(latest.version,0)+1;
  INSERT INTO customer_private.programme_attendance_revision(registration_id,workspace_id,programme_id,version,state,recorded_by) VALUES(reg,target,programme,ver,st,actor);
  PERFORM customer_private.coordination_event(target,actor,command,programme,'attendance_set',reg);
 END IF;
 result:=jsonb_build_object('registrationId',reg,'state',st,'version',ver);
 INSERT INTO customer_private.programme_coordination_command(actor_id,command_id,workspace_id,programme_id,operation,request,result) VALUES(actor,command,target,programme,'attendance',sig,result);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Coordination access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',false,'expiresAt',customer_private.coordination_expiry());
END $$;

-- Participant side. The signed-in account must own an active registration; the organiser never writes these records.
CREATE FUNCTION customer_private.participant_record_json(selected uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('recordId',r.id,'kind',r.kind,'version',v.version,'shared',v.shared,'retracted',v.retracted,'rating',v.rating,
  'outcomeKind',v.outcome_kind,'occurredOn',to_char(v.occurred_on,'YYYY-MM-DD'),'note',v.note,'updatedAt',v.created_at,'provenance','PARTICIPANT_REPORTED')
 FROM customer_private.programme_participant_record r JOIN LATERAL(SELECT * FROM customer_private.programme_participant_record_revision x WHERE x.record_id=r.id ORDER BY x.version DESC LIMIT 1) v ON true WHERE r.id=selected
$$;
CREATE FUNCTION customer.programme_record_submit(command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;reg customer_private.programme_registration;prior customer_private.programme_coordination_command;sig jsonb;k text;rid uuid;expected integer;cur integer;
 latest customer_private.programme_participant_record_revision;rate smallint;okind text;day date;nt text;sh boolean;ret boolean;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid record' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['registrationId','kind','recordId','expectedVersion','rating','outcomeKind','occurredOn','note','shared','retracted','acknowledged']<>'{}'::jsonb
  OR NOT(input ?& ARRAY['registrationId','kind','recordId','expectedVersion','rating','outcomeKind','occurredOn','note','shared','retracted','acknowledged'])
  OR input->'acknowledged' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'registrationId')<>'string' OR jsonb_typeof(input->'kind')<>'string' OR input->>'kind' NOT IN ('FEEDBACK','OUTCOME')
  OR jsonb_typeof(input->'shared')<>'boolean' OR jsonb_typeof(input->'retracted')<>'boolean' OR jsonb_typeof(input->'expectedVersion')<>'number' OR (input->>'expectedVersion') !~ '^[0-9]{1,6}$'
  OR jsonb_typeof(input->'recordId') NOT IN ('string','null') THEN RAISE EXCEPTION 'Invalid record' USING ERRCODE='23514'; END IF;
 SELECT * INTO reg FROM customer_private.programme_registration WHERE id=(input->>'registrationId')::uuid AND principal_id=customer.actor_id();
 IF NOT FOUND THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
 actor:=customer_private.participant_scope(command,reg.workspace_id,reg.programme_id,false);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_coordination:'||reg.programme_id::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor OR reg.principal_id<>actor THEN RAISE EXCEPTION 'Coordination access expired' USING ERRCODE='42501'; END IF;
 sig:=jsonb_build_object('workspaceId',reg.workspace_id,'programmeId',reg.programme_id,'input',input);
 SELECT * INTO prior FROM customer_private.programme_coordination_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.operation<>'record' OR prior.request IS DISTINCT FROM sig THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result||jsonb_build_object('commandId',command,'replayed',true,'expiresAt',customer_private.coordination_expiry());
 END IF;
 IF customer_private.coordination_registration_state(reg.id)<>'ACTIVE' THEN RAISE EXCEPTION 'Only an active registration can record results' USING ERRCODE='23514'; END IF;
 k:=input->>'kind';expected:=(input->>'expectedVersion')::integer;sh:=(input->>'shared')::boolean;ret:=(input->>'retracted')::boolean;
 IF jsonb_typeof(input->'recordId')='string' THEN
  rid:=(input->>'recordId')::uuid;
  SELECT max(v.version) INTO cur FROM customer_private.programme_participant_record r JOIN customer_private.programme_participant_record_revision v ON v.record_id=r.id WHERE r.id=rid AND r.registration_id=reg.id AND r.kind=k;
  IF cur IS NULL THEN RAISE EXCEPTION 'Record unavailable' USING ERRCODE='42501'; END IF;
 ELSIF k='FEEDBACK' THEN
  SELECT r.id INTO rid FROM customer_private.programme_participant_record r WHERE r.registration_id=reg.id AND r.kind='FEEDBACK';
  IF rid IS NOT NULL THEN RAISE EXCEPTION 'Feedback already exists; edit it' USING ERRCODE='23514'; END IF;
  cur:=0;
 ELSE
  IF (SELECT count(*) FROM customer_private.programme_participant_record WHERE registration_id=reg.id AND kind='OUTCOME')>=50 THEN RAISE EXCEPTION 'Outcome limit reached' USING ERRCODE='23514'; END IF;
  cur:=0;
 END IF;
 IF cur<>expected THEN RAISE EXCEPTION 'Record changed; reload before editing' USING ERRCODE='23514'; END IF;
 IF cur>0 THEN SELECT * INTO latest FROM customer_private.programme_participant_record_revision WHERE record_id=rid AND version=cur; END IF;
 IF ret THEN
  -- A retraction needs an existing record and keeps its content, which no one can see again.
  IF cur=0 THEN RAISE EXCEPTION 'Nothing to retract' USING ERRCODE='23514'; END IF;
  IF sh THEN RAISE EXCEPTION 'A retracted record cannot be shared' USING ERRCODE='23514'; END IF;
  rate:=latest.rating;okind:=latest.outcome_kind;day:=latest.occurred_on;nt:=latest.note;
 ELSE
  nt:=customer_private.coordination_text(input->'note',11,500,false);
  IF k='FEEDBACK' THEN
   IF jsonb_typeof(input->'rating')<>'number' OR (input->>'rating') !~ '^[1-5]$' OR jsonb_typeof(input->'outcomeKind')<>'null' OR jsonb_typeof(input->'occurredOn')<>'null' THEN RAISE EXCEPTION 'Invalid feedback' USING ERRCODE='23514'; END IF;
   rate:=(input->>'rating')::smallint;
  ELSE
   IF jsonb_typeof(input->'rating')<>'null' OR jsonb_typeof(input->'outcomeKind')<>'string' OR input->>'outcomeKind' NOT IN ('MEETING_HELD','FOLLOW_UP_AGREED','SAMPLE_OR_QUOTE_REQUESTED','PRELIMINARY_AGREEMENT','NO_PROGRESS') THEN RAISE EXCEPTION 'Invalid outcome' USING ERRCODE='23514'; END IF;
   okind:=input->>'outcomeKind';day:=customer_private.coordination_date(input->'occurredOn',true);
   IF day>current_date THEN RAISE EXCEPTION 'An outcome cannot be dated in the future' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF rid IS NULL THEN
  INSERT INTO customer_private.programme_participant_record(workspace_id,programme_id,registration_id,kind) VALUES(reg.workspace_id,reg.programme_id,reg.id,k) RETURNING id INTO rid;
 END IF;
 INSERT INTO customer_private.programme_participant_record_revision(record_id,kind,version,shared,retracted,rating,outcome_kind,occurred_on,note) VALUES(rid,k,cur+1,sh,ret,rate,okind,day,nt);
 result:=jsonb_build_object('registrationId',reg.id,'record',customer_private.participant_record_json(rid));
 INSERT INTO customer_private.programme_coordination_command(actor_id,command_id,workspace_id,programme_id,operation,request,result) VALUES(actor,command,reg.workspace_id,reg.programme_id,'record',sig,result);
 PERFORM customer_private.coordination_event(reg.workspace_id,actor,command,reg.programme_id,'record_saved',rid);
 IF customer.actor_id() IS DISTINCT FROM actor OR customer_private.coordination_registration_state(reg.id)<>'ACTIVE' THEN RAISE EXCEPTION 'Coordination access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('commandId',command,'replayed',false,'expiresAt',customer_private.coordination_expiry());
END $$;

CREATE FUNCTION customer.own_programme_records(registration uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;reg customer_private.programme_registration;feedback jsonb;outcomes jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF registration IS NULL THEN RAISE EXCEPTION 'Invalid registration' USING ERRCODE='23514'; END IF;
 SELECT * INTO reg FROM customer_private.programme_registration WHERE id=registration AND principal_id=customer.actor_id();
 IF NOT FOUND THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),reg.workspace_id,reg.programme_id,false);
 IF reg.principal_id<>actor OR customer_private.coordination_registration_state(reg.id)<>'ACTIVE' THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
 SELECT customer_private.participant_record_json(r.id) INTO feedback FROM customer_private.programme_participant_record r WHERE r.registration_id=reg.id AND r.kind='FEEDBACK';
 SELECT coalesce(jsonb_agg(customer_private.participant_record_json(r.id) ORDER BY r.created_at,r.id),'[]'::jsonb) INTO outcomes FROM customer_private.programme_participant_record r WHERE r.registration_id=reg.id AND r.kind='OUTCOME';
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Coordination access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrationId',reg.id,'programmeId',reg.programme_id,'expiresAt',customer_private.coordination_expiry(),'feedback',feedback,'outcomes',outcomes);
END $$;

-- Organiser report: plan versus actual, with each figure labelled by who reported it. Only records the participant chose to share are counted as shared.
CREATE FUNCTION customer.programme_report(target uuid,programme uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;cap jsonb;att jsonb;tasks jsonb;fb jsonb;outc jsonb;rep jsonb;people jsonb;active_n integer;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_coordination:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Coordination access expired' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO active_n FROM customer_private.programme_registration r WHERE r.workspace_id=target AND r.programme_id=programme AND customer_private.coordination_registration_state(r.id)='ACTIVE';
 SELECT coalesce((SELECT jsonb_build_object('capacity',c.capacity,'version',c.version,'reason',c.reason) FROM customer_private.programme_capacity_revision c WHERE c.programme_id=programme ORDER BY c.version DESC LIMIT 1),
  jsonb_build_object('capacity',NULL,'version',0,'reason',NULL)) INTO cap;
 WITH regs AS(SELECT r.id,r.display_label,customer_private.coordination_registration_state(r.id) state FROM customer_private.programme_registration r WHERE r.workspace_id=target AND r.programme_id=programme),
  last_att AS(SELECT DISTINCT ON (a.registration_id) a.registration_id,a.state,a.version FROM customer_private.programme_attendance_revision a WHERE a.programme_id=programme ORDER BY a.registration_id,a.version DESC)
 SELECT coalesce(jsonb_agg(jsonb_build_object('registrationId',g.id,'label',g.display_label,'state',g.state,'attendance',l.state,'attendanceVersion',coalesce(l.version,0)) ORDER BY g.display_label,g.id),'[]'::jsonb),
  jsonb_build_object('attended',count(*) FILTER(WHERE g.state='ACTIVE' AND l.state='ATTENDED'),'absent',count(*) FILTER(WHERE g.state='ACTIVE' AND l.state='ABSENT'),
   'notRecorded',count(*) FILTER(WHERE g.state='ACTIVE' AND l.state IS NULL),'withdrawnOrRemoved',count(*) FILTER(WHERE g.state<>'ACTIVE'),'provenance','ORGANISER_RECORDED')
 INTO people,att FROM regs g LEFT JOIN last_att l ON l.registration_id=g.id;
 WITH cur AS(SELECT DISTINCT ON (v.task_id) v.task_id,v.status,v.due_on FROM customer_private.programme_task_revision v WHERE v.programme_id=programme ORDER BY v.task_id,v.version DESC)
 SELECT jsonb_build_object('open',count(*) FILTER(WHERE status='OPEN'),'inProgress',count(*) FILTER(WHERE status='IN_PROGRESS'),'done',count(*) FILTER(WHERE status='DONE'),
  'cancelled',count(*) FILTER(WHERE status='CANCELLED'),'overdue',count(*) FILTER(WHERE status IN ('OPEN','IN_PROGRESS') AND due_on<current_date),'provenance','ORGANISER_RECORDED')
 INTO tasks FROM cur;
 WITH cur AS(SELECT DISTINCT ON (v.record_id) v.record_id,r.kind,r.registration_id,v.shared,v.retracted,v.rating,v.outcome_kind,v.occurred_on,v.note
  FROM customer_private.programme_participant_record r JOIN customer_private.programme_participant_record_revision v ON v.record_id=r.id
  WHERE r.workspace_id=target AND r.programme_id=programme AND customer_private.coordination_registration_state(r.registration_id)='ACTIVE' ORDER BY v.record_id,v.version DESC),
  f AS(SELECT * FROM cur WHERE kind='FEEDBACK' AND NOT retracted),o AS(SELECT * FROM cur WHERE kind='OUTCOME' AND NOT retracted)
 SELECT jsonb_build_object('responses',(SELECT count(*) FROM f),'shared',(SELECT count(*) FROM f WHERE shared),'notShared',(SELECT count(*) FROM f WHERE NOT shared),
   'ratingCount',(SELECT count(*) FROM f WHERE shared),'ratingSum',coalesce((SELECT sum(rating) FROM f WHERE shared),0),
   'distribution',jsonb_build_object('1',(SELECT count(*) FROM f WHERE shared AND rating=1),'2',(SELECT count(*) FROM f WHERE shared AND rating=2),'3',(SELECT count(*) FROM f WHERE shared AND rating=3),
    '4',(SELECT count(*) FROM f WHERE shared AND rating=4),'5',(SELECT count(*) FROM f WHERE shared AND rating=5)),
   'comments',coalesce((SELECT jsonb_agg(f.note ORDER BY f.record_id) FROM f WHERE f.shared AND f.note IS NOT NULL),'[]'::jsonb),'provenance','PARTICIPANT_REPORTED'),
  jsonb_build_object('total',(SELECT count(*) FROM o),'shared',(SELECT count(*) FROM o WHERE shared),'notShared',(SELECT count(*) FROM o WHERE NOT shared),
   'byKind',coalesce((SELECT jsonb_object_agg(k.outcome_kind,k.n) FROM (SELECT outcome_kind,count(*) n FROM o WHERE shared GROUP BY outcome_kind) k),'{}'::jsonb),
   'items',coalesce((SELECT jsonb_agg(jsonb_build_object('label',g.display_label,'outcomeKind',o.outcome_kind,'occurredOn',to_char(o.occurred_on,'YYYY-MM-DD'),'note',o.note) ORDER BY o.occurred_on DESC,o.record_id)
     FROM o JOIN customer_private.programme_registration g ON g.id=o.registration_id WHERE o.shared),'[]'::jsonb),'provenance','PARTICIPANT_REPORTED')
 INTO fb,outc;
 SELECT jsonb_build_object('returningParticipants',count(*),'basis','Active registrants who also registered in another programme of this workspace') INTO rep
 FROM customer_private.programme_registration r WHERE r.workspace_id=target AND r.programme_id=programme AND customer_private.coordination_registration_state(r.id)='ACTIVE'
  AND EXISTS(SELECT FROM customer_private.programme_registration o WHERE o.workspace_id=target AND o.principal_id=r.principal_id AND o.programme_id<>programme);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Coordination access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.coordination_expiry(),'asOf',to_char(current_date,'YYYY-MM-DD'),
  'verified',false,'sendsMessages',false,'activeParticipants',active_n,'capacity',cap,'attendance',att,'tasks',tasks,'feedback',fb,'outcomes',outc,'repeat',rep,'participants',people);
END $$;

REVOKE ALL ON FUNCTION customer_private.coordination_version_guard(),customer_private.coordination_registration_guard(),customer_private.coordination_expiry(),customer_private.coordination_text(jsonb,integer,integer,boolean),
 customer_private.coordination_date(jsonb,boolean),customer_private.coordination_registration_state(uuid),customer_private.programme_task_json(uuid),customer_private.coordination_event(uuid,uuid,uuid,uuid,text,uuid),
 customer_private.participant_record_json(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.programme_task_save(uuid,uuid,uuid,integer,jsonb),customer.programme_tasks(uuid,uuid,integer,integer),customer.programme_capacity_set(uuid,uuid,uuid,integer,jsonb),
 customer.programme_attendance_set(uuid,uuid,uuid,jsonb),customer.programme_record_submit(uuid,jsonb),customer.own_programme_records(uuid),customer.programme_report(uuid,uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.programme_task_save(uuid,uuid,uuid,integer,jsonb),customer.programme_tasks(uuid,uuid,integer,integer),customer.programme_capacity_set(uuid,uuid,uuid,integer,jsonb),
 customer.programme_attendance_set(uuid,uuid,uuid,jsonb),customer.programme_record_submit(uuid,jsonb),customer.own_programme_records(uuid),customer.programme_report(uuid,uuid) TO corridra_runtime;
