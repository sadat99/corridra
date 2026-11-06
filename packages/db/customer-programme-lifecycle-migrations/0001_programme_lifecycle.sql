-- Optional programme lifecycle (CRUD gap G7): rename, archive and restore a customer programme without rewriting any business row.
-- Overlay only: app.delivery_programme and customer_private.programme_creation stay exactly as created. Every change is one append-only
-- revision; customer_private.programme_current shows the latest revision, or the original row when there is none. Readers of the name
-- and reporting purpose are moved to that view below, each behind a hash guard of the definition it replaces (real-use state).
CREATE TABLE customer_private.programme_lifecycle_revision (
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 workspace_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>=1),
 kind text NOT NULL CHECK(kind IN ('rename','archive','restore')),
 -- Same bounds as creation: archive and restore copy the existing text, which creation accepted with any characters inside it, so a stricter
 -- check here would make such a programme impossible to archive. Text typed for a rename is checked more strictly in the function.
 name text NOT NULL CHECK(length(name) BETWEEN 3 AND 160),
 reporting_purpose text NOT NULL CHECK(length(reporting_purpose) BETWEEN 10 AND 500),
 archived boolean NOT NULL,
 changed_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(programme_id,version),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TABLE customer_private.programme_lifecycle_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 operation text NOT NULL CHECK(operation IN ('rename','archive','restore')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
CREATE INDEX programme_lifecycle_workspace ON customer_private.programme_lifecycle_revision(workspace_id,programme_id,version);
CREATE TRIGGER programme_lifecycle_revision_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_lifecycle_revision FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_lifecycle_command_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_lifecycle_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_lifecycle_revision_order BEFORE INSERT ON customer_private.programme_lifecycle_revision FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('programme_id');
ALTER TABLE customer_private.programme_lifecycle_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_lifecycle_command ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.programme_lifecycle_revision,customer_private.programme_lifecycle_command FROM PUBLIC,corridra_runtime,corridra_auth;

-- The one place the current name, reporting purpose and archived state of a programme come from. Same columns as the base table plus archived and version.
CREATE VIEW customer_private.programme_current AS
 SELECT d.id,d.tenant_id,coalesce(r.name,d.name) AS name,coalesce(r.reporting_purpose,d.reporting_purpose) AS reporting_purpose,
  d.created_by,d.created_at,coalesce(r.archived,false) AS archived,coalesce(r.version,0) AS version
 FROM app.delivery_programme d
 LEFT JOIN LATERAL(SELECT x.name,x.reporting_purpose,x.archived,x.version FROM customer_private.programme_lifecycle_revision x WHERE x.programme_id=d.id ORDER BY x.version DESC LIMIT 1) r ON true;
REVOKE ALL ON customer_private.programme_current FROM PUBLIC,corridra_runtime,corridra_auth;

CREATE FUNCTION customer_private.programme_active_count(target uuid) RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT count(*)::integer FROM customer_private.programme_creation pc
 JOIN customer_private.programme_current c ON c.id=pc.programme_id AND c.tenant_id=pc.workspace_id
 WHERE pc.workspace_id=target AND NOT c.archived
$$;
CREATE FUNCTION customer_private.programme_lifecycle_event(target uuid,actor uuid,command uuid,aggregate uuid,kind text,detail jsonb) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid;eid uuid:=gen_random_uuid();v integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v FROM app.domain_event e WHERE e.tenant_id=target AND e.aggregate_type='customer_programme_lifecycle' AND e.aggregate_id=aggregate::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.programme.'||kind,1,'customer_programme_lifecycle',aggregate::text,v,executor,clock_timestamp(),command,command,
 detail||jsonb_build_object('kind',kind,'synthetic',customer_private.synthetic_context(),'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.programme.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

-- One entry point for the three changes. Owner or admin of the workspace only; a command id makes a retry return the first answer;
-- expected is the version the person saw (0 before any change) and a stale value is refused; the audit event carries the old and new
-- values and nothing about participants. Restore is refused, never forced, when the workspace already has 100 active programmes.
CREATE FUNCTION customer.programme_lifecycle(command uuid,target uuid,programme uuid,operation text,expected integer,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.programme_lifecycle_command;sig jsonb;cur customer_private.programme_current;nm text;why text;next_archived boolean;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR programme IS NULL OR expected IS NULL OR expected<0 OR expected>100000 OR input IS NULL OR jsonb_typeof(input)<>'object'
  OR operation IS NULL OR operation NOT IN ('rename','archive','restore') THEN RAISE EXCEPTION 'Invalid programme change' USING ERRCODE='23514'; END IF;
 IF operation='rename' THEN
  IF input-ARRAY['name','reportingPurpose']<>'{}'::jsonb OR NOT(input ?& ARRAY['name','reportingPurpose'])
   OR jsonb_typeof(input->'name')<>'string' OR jsonb_typeof(input->'reportingPurpose')<>'string' THEN RAISE EXCEPTION 'Invalid programme change' USING ERRCODE='23514'; END IF;
 ELSIF input<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid programme change' USING ERRCODE='23514'; END IF;
 actor:=customer_private.programme_actor(command,target);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_lifecycle:'||target::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 sig:=jsonb_build_object('workspaceId',target,'programmeId',programme,'expected',expected,'input',input);
 SELECT * INTO prior FROM customer_private.programme_lifecycle_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.operation<>operation OR prior.request IS DISTINCT FROM sig THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result||jsonb_build_object('commandId',command,'replayed',true,'expiresAt',customer_private.coordination_expiry());
 END IF;
 SELECT c.* INTO cur FROM customer_private.programme_current c JOIN customer_private.programme_creation pc ON pc.programme_id=c.id AND pc.workspace_id=c.tenant_id WHERE c.id=programme AND c.tenant_id=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'Programme unavailable' USING ERRCODE='42501'; END IF;
 IF cur.version<>expected THEN RAISE EXCEPTION 'Programme changed; reload before saving' USING ERRCODE='23514'; END IF;
 IF operation='rename' THEN
  IF cur.archived THEN RAISE EXCEPTION 'Restore the programme before renaming it' USING ERRCODE='23514'; END IF;
  nm:=input->>'name';why:=input->>'reportingPurpose';
  IF nm<>btrim(nm) OR length(nm) NOT BETWEEN 3 AND 160 OR nm ~ '[[:cntrl:]]' OR why<>btrim(why) OR length(why) NOT BETWEEN 10 AND 500 OR why ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' THEN
   RAISE EXCEPTION 'Programme name and reporting purpose required' USING ERRCODE='23514'; END IF;
  IF nm=cur.name AND why=cur.reporting_purpose THEN RAISE EXCEPTION 'Nothing changed' USING ERRCODE='23514'; END IF;
  next_archived:=false;
 ELSIF operation='archive' THEN
  IF cur.archived THEN RAISE EXCEPTION 'Programme is already archived' USING ERRCODE='23514'; END IF;
  nm:=cur.name;why:=cur.reporting_purpose;next_archived:=true;
 ELSE
  IF NOT cur.archived THEN RAISE EXCEPTION 'Programme is not archived' USING ERRCODE='23514'; END IF;
  IF customer_private.programme_active_count(target)>=100 THEN RAISE EXCEPTION 'Archive another programme first: this workspace already has 100 active programmes' USING ERRCODE='23514'; END IF;
  nm:=cur.name;why:=cur.reporting_purpose;next_archived:=false;
 END IF;
 INSERT INTO customer_private.programme_lifecycle_revision(programme_id,workspace_id,version,kind,name,reporting_purpose,archived,changed_by)
 VALUES(programme,target,cur.version+1,operation,nm,why,next_archived,actor);
 PERFORM customer_private.programme_lifecycle_event(target,actor,command,programme,operation,jsonb_build_object('programmeId',programme,'version',cur.version+1,
  'before',jsonb_build_object('name',cur.name,'reportingPurpose',cur.reporting_purpose,'archived',cur.archived),
  'after',jsonb_build_object('name',nm,'reportingPurpose',why,'archived',next_archived)));
 result:=jsonb_build_object('id',programme,'workspaceId',target,'name',nm,'reportingPurpose',why,'archived',next_archived,'version',cur.version+1,'operation',operation,'createdAt',cur.created_at,'synthetic',customer_private.synthetic_context());
 INSERT INTO customer_private.programme_lifecycle_command(actor_id,command_id,workspace_id,operation,request,result) VALUES(actor,command,target,operation,sig,result);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('commandId',command,'replayed',false,'expiresAt',customer_private.coordination_expiry());
END $$;
REVOKE ALL ON FUNCTION customer_private.programme_active_count(uuid),customer_private.programme_lifecycle_event(uuid,uuid,uuid,uuid,text,jsonb),customer.programme_lifecycle(uuid,uuid,uuid,text,integer,jsonb) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.programme_lifecycle(uuid,uuid,uuid,text,integer,jsonb) TO corridra_runtime;

-- Readers and the creation cap. Each block first checks that the installed function is exactly the real-use definition it replaces.

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.delivery_report_v1(text,text)'::regprocedure),'UTF8')),'hex')<>'562d1aa2baf07719dcbc626d623cc346b7451e13000047cd498f9f1a7dd637cf' THEN RAISE EXCEPTION 'Programme lifecycle prerequisite function differs: app.delivery_report_v1';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.delivery_report_v1(h text, audience text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE l app.delivery_link:=app.delivery_authorized(h,audience);missions jsonb;name text;totals jsonb;counterparties integer;companies integer;
BEGIN
 SELECT coalesce(jsonb_agg(app.delivery_mission_dto(p) ORDER BY p.copy->>'company',p.id),'[]'::jsonb) INTO missions FROM app.delivery_publication p WHERE p.tenant_id=l.tenant_id AND p.id=ANY(l.publication_ids);
 -- Institutions receive no private evidence instructions or client declarations.
 IF audience='INSTITUTION_REPORT' THEN SELECT jsonb_agg(value-'requests') INTO missions FROM jsonb_array_elements(missions); END IF;
 SELECT p.name INTO name FROM customer_private.programme_current p WHERE p.tenant_id=l.tenant_id AND p.id=l.programme_id;
 SELECT count(DISTINCT lower(trim(p.copy->>'company')))::int INTO companies FROM app.delivery_publication p WHERE p.tenant_id=l.tenant_id AND p.id=ANY(l.publication_ids);
 SELECT count(DISTINCT coalesce((SELECT er.survivor_id FROM app.entity_resolution er JOIN app.entity_candidate ec ON ec.tenant_id=er.tenant_id AND ec.id=er.candidate_id WHERE er.tenant_id=l.tenant_id AND er.decision='MERGE' AND r.organisation_id IN(ec.left_id,ec.right_id) AND NOT EXISTS(SELECT FROM app.entity_resolution rev WHERE rev.tenant_id=er.tenant_id AND rev.reverse_of=er.id) LIMIT 1),r.organisation_id))::int INTO counterparties FROM app.delivery_publication p JOIN app.opportunity o ON o.tenant_id=p.tenant_id AND o.mission_id=p.mission_id JOIN app.target_account ta ON ta.tenant_id=o.tenant_id AND ta.id=o.target_id JOIN app.relationship r ON r.tenant_id=ta.tenant_id AND r.id=ta.relationship_id WHERE p.tenant_id=l.tenant_id AND p.id=ANY(l.publication_ids) AND o.id=ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p.copy->'opportunityIds'))) AND EXISTS(SELECT FROM app.outcome_event e WHERE e.tenant_id=o.tenant_id AND e.opportunity_id=o.id AND e.entity_type='opportunity' AND app.commercial_stage(e.snapshot->>'status')>=2);
 SELECT coalesce(jsonb_agg(jsonb_build_object('currency',currency,'contractMinor',contract_minor,'invoiceMinor',invoice_minor,'confirmedCashMinor',confirmed_cash_minor,'repeatCashMinor',repeat_cash_minor) ORDER BY currency),'[]'::jsonb) INTO totals FROM app.commercial_totals(l.tenant_id,ARRAY(SELECT DISTINCT j.value::uuid FROM app.delivery_publication p CROSS JOIN LATERAL jsonb_array_elements_text(p.copy->'opportunityIds') j WHERE p.tenant_id=l.tenant_id AND p.id=ANY(l.publication_ids) AND (p.copy->>'includeFinancials')::boolean));

 RETURN jsonb_build_object('schemaVersion',1,'scopeId',l.id,'audience',l.audience,'purpose',l.reporting_purpose,'programme',name,'generatedAt',now(),'expiresAt',l.expires_at,'allowExport',l.allow_export,'approvedParticipants',cardinality(l.publication_ids),'approvedCompanies',companies,'qualifiedCounterparties',counterparties,'totals',totals,'missions',missions,'attribution','Approved mission and opportunity scope only. Recorded activity does not establish Corridra caused an outcome. Contracts, invoices and confirmed cash are distinct; repeat cash is included in confirmed cash. Currencies are not combined. Client responses are self-declared.');
END $function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.create_programme(uuid,uuid,text,text)'::regprocedure),'UTF8')),'hex')<>'082dfdfb629ff8250904c7b3d2cfc4ed8f14f83593e02458762015f85fde5f4b' THEN RAISE EXCEPTION 'Programme lifecycle prerequisite function differs: customer.create_programme';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.create_programme(command uuid, target uuid, programme_name text, why text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.programme_actor(command,target);prior customer_private.programme_creation;
 programme app.delivery_programme;executor uuid;nonce text;proof text:=current_setting('corridra.customer_proof_hash',true);expiry timestamptz;
 payload jsonb:=jsonb_build_object('workspaceId',target,'name',programme_name,'reportingPurpose',why);
BEGIN
 IF programme_name IS NULL OR why IS NULL OR length(programme_name) NOT BETWEEN 3 AND 160 OR length(why) NOT BETWEEN 10 AND 500 THEN
  RAISE EXCEPTION 'Programme name and reporting purpose required' USING ERRCODE='23514';
 END IF;
 SELECT * INTO prior FROM customer_private.programme_creation WHERE principal_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.input IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Programme command conflicts' USING ERRCODE='23514'; END IF;
  SELECT * INTO programme FROM app.delivery_programme WHERE id=prior.programme_id AND tenant_id=prior.workspace_id;
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_lifecycle:'||target::text,0));
  IF customer_private.programme_active_count(target)>=100 THEN
   RAISE EXCEPTION 'Programme workspace limit reached' USING ERRCODE='23514'; END IF;
  SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
  WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL FOR SHARE OF p;
  IF executor IS NULL THEN RAISE EXCEPTION 'Programme execution unavailable' USING ERRCODE='42501'; END IF;
  SELECT expires_at INTO expiry FROM customer_private.session_proof WHERE hash=proof AND expires_at>clock_timestamp();
  IF expiry IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer proof expired' USING ERRCODE='42501'; END IF;
  programme.id:=gen_random_uuid();programme.tenant_id:=target;programme.name:=programme_name;
  programme.reporting_purpose:=why;programme.created_by:=executor;programme.created_at:=now();
  nonce:=encode(sha256(convert_to(gen_random_uuid()::text||proof,'UTF8')),'hex');
  INSERT INTO customer_private.programme_execution_grant(nonce_hash,proof_hash,principal_id,workspace_id,executor_id,relation_oid,record_digest,backend_pid,transaction_id,command_id,expires_at)
  VALUES(nonce,proof,actor,target,executor,'app.delivery_programme'::regclass,encode(sha256(convert_to(to_jsonb(programme)::text,'UTF8')),'hex'),pg_backend_pid(),txid_current(),command,expiry);
  PERFORM set_config('corridra.customer_programme_execution',nonce,true),set_config('corridra.correlation_id',command::text,true),set_config('corridra.causation_id',command::text,true);
  INSERT INTO app.delivery_programme(id,tenant_id,name,reporting_purpose,created_by,created_at)
  VALUES(programme.id,programme.tenant_id,programme.name,programme.reporting_purpose,programme.created_by,programme.created_at);
  DELETE FROM customer_private.programme_execution_grant WHERE nonce_hash=nonce;
  PERFORM set_config('corridra.customer_programme_execution','',true);
  INSERT INTO customer_private.programme_creation(programme_id,workspace_id,principal_id,command_id,input)
  VALUES(programme.id,target,actor,command,payload);
 END IF;
 IF programme.id IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('id',programme.id,'workspaceId',programme.tenant_id,'name',programme.name,
 'reportingPurpose',programme.reporting_purpose,'createdAt',programme.created_at,'synthetic',customer_private.synthetic_context());
END $function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.my_programme_reminders(date)'::regprocedure),'UTF8')),'hex')<>'45ec031a92e3d367e884fea52be28a74438657203a27413bf85df6eece91e6ca' THEN RAISE EXCEPTION 'Programme lifecycle prerequisite function differs: customer.my_programme_reminders';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.my_programme_reminders(as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer.actor_id();today date;assigned jsonb;shared jsonb;terms jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 today:=coalesce(as_of,current_date);
 IF today NOT BETWEEN DATE '2000-01-01' AND DATE '2100-01-01' THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('workspaceId',x.workspace_id,'programmeId',x.programme_id,'programmeName',x.programme_name,'taskId',x.id,'version',x.version,
  'title',x.title,'dueOn',to_char(x.due_on,'YYYY-MM-DD'),'state',x.state) ORDER BY x.due_on,x.programme_name,x.seq),'[]'::jsonb) INTO assigned
 FROM (SELECT t.id,t.workspace_id,t.programme_id,t.seq,p.name programme_name,v.version,v.title,v.due_on,CASE WHEN v.due_on<today THEN 'OVERDUE' ELSE 'DUE_SOON' END state
  FROM customer.collaborative_workspaces() w JOIN customer_private.programme_task t ON t.workspace_id=w.id
  JOIN customer_private.programme_current p ON p.tenant_id=t.workspace_id AND p.id=t.programme_id
  JOIN LATERAL(SELECT * FROM customer_private.programme_task_plan_revision x WHERE x.task_id=t.id ORDER BY x.version DESC LIMIT 1) pl ON pl.assignee_principal=actor
  JOIN LATERAL(SELECT * FROM customer_private.programme_task_revision r WHERE r.task_id=t.id ORDER BY r.version DESC LIMIT 1) v ON v.status IN ('OPEN','IN_PROGRESS') AND v.due_on IS NOT NULL AND v.due_on<=today+3
  ORDER BY v.due_on,p.name,t.seq LIMIT 100) x;
 SELECT coalesce(jsonb_agg(jsonb_build_object('registrationId',x.registration_id,'programmeName',x.programme_name,'title',x.title,'dueOn',to_char(x.due_on,'YYYY-MM-DD'),'state',x.state) ORDER BY x.due_on,x.programme_name,x.seq),'[]'::jsonb) INTO shared
 FROM (SELECT g.id registration_id,t.seq,p.name programme_name,v.title,v.due_on,CASE WHEN v.due_on<today THEN 'OVERDUE' ELSE 'DUE_SOON' END state
  FROM customer_private.programme_registration g JOIN customer_private.programme_enrolment e ON e.registration_id=g.id
  JOIN customer_private.programme_current p ON p.tenant_id=g.workspace_id AND p.id=g.programme_id
  JOIN customer_private.programme_task t ON t.workspace_id=g.workspace_id AND t.programme_id=g.programme_id
  JOIN LATERAL(SELECT * FROM customer_private.programme_task_plan_revision x WHERE x.task_id=t.id ORDER BY x.version DESC LIMIT 1) pl ON pl.participant_visible
  JOIN LATERAL(SELECT * FROM customer_private.programme_task_revision r WHERE r.task_id=t.id ORDER BY r.version DESC LIMIT 1) v ON v.status IN ('OPEN','IN_PROGRESS') AND v.due_on IS NOT NULL AND v.due_on<=today+3
  WHERE g.principal_id=actor AND customer_private.coordination_registration_state(g.id)='ACTIVE'
  AND (SELECT r.status FROM customer_private.programme_enrolment_revision r WHERE r.enrolment_id=e.id ORDER BY r.version DESC LIMIT 1)='PLACED'
  ORDER BY v.due_on,p.name,t.seq LIMIT 100) x;
 SELECT coalesce(jsonb_agg(jsonb_build_object('registrationId',x.registration_id,'programmeName',x.programme_name,'version',x.tv) ORDER BY x.programme_name,x.registration_id),'[]'::jsonb) INTO terms
 FROM (SELECT y.registration_id,y.programme_name,y.tv FROM (SELECT g.id registration_id,p.name programme_name,(SELECT max(t.version) FROM customer_private.programme_terms_revision t WHERE t.programme_id=g.programme_id) tv
  FROM customer_private.programme_registration g JOIN customer_private.programme_enrolment e ON e.registration_id=g.id
  JOIN customer_private.programme_current p ON p.tenant_id=g.workspace_id AND p.id=g.programme_id
  WHERE g.principal_id=actor AND customer_private.coordination_registration_state(g.id)='ACTIVE'
  AND (SELECT r.status FROM customer_private.programme_enrolment_revision r WHERE r.enrolment_id=e.id ORDER BY r.version DESC LIMIT 1) IN ('PLACED','WAITLISTED')) y
  WHERE y.tv IS NOT NULL AND NOT EXISTS(SELECT FROM customer_private.programme_terms_acceptance a WHERE a.registration_id=y.registration_id AND a.terms_version=y.tv)
  ORDER BY y.programme_name,y.registration_id LIMIT 100) x;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('asOf',to_char(today,'YYYY-MM-DD'),'windowDays',3,'expiresAt',customer_private.coordination_expiry(),'sendsMessages',false,
  'assignedToYou',assigned,'forParticipant',shared,'termsToAccept',terms);
END $function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.own_programme_place(uuid)'::regprocedure),'UTF8')),'hex')<>'879396878b955b7d8aa55386d8153bd7007841eed3c14c3c4fb1d16064123448' THEN RAISE EXCEPTION 'Programme lifecycle prerequisite function differs: customer.own_programme_place';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.own_programme_place(registration uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid;reg customer_private.programme_registration;tv integer;ev integer;enr customer_private.programme_enrolment;head customer_private.programme_enrolment_revision;
 cap integer;rule customer_private.programme_places_revision;fees jsonb:='[]'::jsonb;tasks jsonb:='[]'::jsonb;choices jsonb;name text;accepted integer;terms jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF registration IS NULL THEN RAISE EXCEPTION 'Invalid registration' USING ERRCODE='23514'; END IF;
 SELECT * INTO reg FROM customer_private.programme_registration r WHERE r.id=registration AND r.principal_id=customer.actor_id();
 IF NOT FOUND THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),reg.workspace_id,reg.programme_id,false);
 IF reg.principal_id<>actor OR customer_private.coordination_registration_state(reg.id)<>'ACTIVE' THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_places:'||reg.programme_id::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 SELECT p.name INTO name FROM customer_private.programme_current p WHERE p.tenant_id=reg.workspace_id AND p.id=reg.programme_id;
 SELECT coalesce(max(t.version),0) INTO tv FROM customer_private.programme_terms_revision t WHERE t.programme_id=reg.programme_id;
 SELECT coalesce(max(e.version),0) INTO ev FROM customer_private.programme_eligibility_revision e WHERE e.programme_id=reg.programme_id;
 SELECT * INTO enr FROM customer_private.programme_enrolment e WHERE e.registration_id=reg.id;
 IF FOUND THEN SELECT * INTO head FROM customer_private.programme_enrolment_revision v WHERE v.enrolment_id=enr.id ORDER BY v.version DESC LIMIT 1; END IF;
 cap:=customer_private.terms_maximum(reg.programme_id);
 SELECT * INTO rule FROM customer_private.programme_places_revision r WHERE r.programme_id=reg.programme_id ORDER BY r.version DESC LIMIT 1;
 SELECT max(a.terms_version) INTO accepted FROM customer_private.programme_terms_acceptance a WHERE a.registration_id=reg.id;
 terms:=CASE WHEN tv>0 THEN customer_private.terms_json(reg.programme_id,tv) END;
 -- Fees are read from the organiser's ledger as recorded; this module stores no money.
 IF terms IS NOT NULL AND (terms->>'feesApply')::boolean THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('currency',s.currency,'exponent',c.exponent,'dueMinor',s.total::text) ORDER BY s.currency),'[]'::jsonb) INTO fees
  FROM (SELECT l.currency,sum(l.amount_minor) total FROM customer_private.programme_ledger_entry l WHERE l.registration_id=reg.id AND l.kind='PARTICIPANT_FEE' GROUP BY l.currency HAVING sum(l.amount_minor)<>0) s
  JOIN app.currency c ON c.code=s.currency;
 END IF;
 IF head.status='PLACED' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('title',x.title,'dueOn',to_char(x.due_on,'YYYY-MM-DD')) ORDER BY x.due_on NULLS LAST,x.seq),'[]'::jsonb) INTO tasks
  FROM (SELECT t.seq,v.title,v.due_on FROM customer_private.programme_task t
   JOIN LATERAL(SELECT * FROM customer_private.programme_task_plan_revision p WHERE p.task_id=t.id ORDER BY p.version DESC LIMIT 1) pl ON true
   JOIN LATERAL(SELECT * FROM customer_private.programme_task_revision r WHERE r.task_id=t.id ORDER BY r.version DESC LIMIT 1) v ON true
   WHERE t.workspace_id=reg.workspace_id AND t.programme_id=reg.programme_id AND pl.participant_visible AND v.status IN ('OPEN','IN_PROGRESS')) x;
 END IF;
 -- The person's own workspaces, so they can choose which organisation profile to be checked against.
 SELECT coalesce(jsonb_agg(jsonb_build_object('workspaceId',w.id,'name',w.name,'hasProfile',EXISTS(SELECT FROM customer_private.organisation_profile_revision p WHERE p.tenant_id=w.id)) ORDER BY w.name,w.id),'[]'::jsonb) INTO choices
 FROM customer.collaborative_workspaces() w;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrationId',reg.id,'programmeId',reg.programme_id,'programmeName',name,'expiresAt',customer_private.coordination_expiry(),
  'terms',terms,'acceptedVersion',accepted,'termsCurrent',CASE WHEN tv=0 THEN NULL ELSE accepted IS NOT DISTINCT FROM tv END,
  'criteria',CASE WHEN ev>0 THEN customer_private.eligibility_json(reg.programme_id,ev) END,
  'enrolment',jsonb_build_object('status',coalesce(head.status,'NOT_APPLIED'),'position',CASE WHEN enr.id IS NOT NULL THEN customer_private.terms_queue_position(enr.id) END,
   'reasons',to_jsonb(coalesce(head.reasons,ARRAY[]::text[]))),
  'placesAvailable',cap IS NULL OR customer_private.terms_taken(reg.programme_id)<cap,'waitlist',coalesce(rule.waitlist,false),
  'fees',fees,'tasks',tasks,'profileChoices',choices,'sendsMessages',false);
END $function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.own_programme_registrations(uuid,integer)'::regprocedure),'UTF8')),'hex')<>'d0d563ac3f460336bfd44b39c217e4ccbde8bbe3452a759dd761ff5a96897e7c' THEN RAISE EXCEPTION 'Programme lifecycle prerequisite function differs: customer.own_programme_registrations';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.own_programme_registrations(after_id uuid DEFAULT NULL::uuid, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer.actor_id();items jsonb;next_id uuid;selected uuid[];work uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid participant page size' USING ERRCODE='23514'; END IF;
 SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO selected FROM (SELECT id FROM customer_private.programme_registration WHERE principal_id=actor AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_size) page;
 FOR work IN SELECT DISTINCT workspace_id FROM customer_private.programme_registration WHERE id=ANY(selected) ORDER BY workspace_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||work::text,0));
  IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'programmeId',r.programme_id,'status',coalesce(v.status,'REGISTERED'),'synthetic',customer_private.synthetic_context())||
 CASE WHEN v.status IS NULL THEN jsonb_build_object('name',p.name,'reportingPurpose',p.reporting_purpose,'displayLabel',r.display_label,'consentedAt',r.consented_at) ELSE '{}'::jsonb END ORDER BY r.id),'[]'::jsonb)
 INTO items FROM (SELECT * FROM customer_private.programme_registration WHERE principal_id=actor AND id=ANY(selected)) r
 JOIN customer_private.programme_current p ON p.tenant_id=r.workspace_id AND p.id=r.programme_id
 JOIN app.tenant t ON t.id=r.workspace_id AND (t.synthetic OR customer_private.real_session())
 LEFT JOIN LATERAL(SELECT CASE WHEN withdrawn THEN 'WITHDRAWN' ELSE 'REVOKED' END status FROM customer_private.programme_participant_revocation WHERE registration_id=r.id) v ON true;
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'id')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.programme_registration WHERE principal_id=actor AND id>next_id) THEN next_id:=NULL; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrations',items,'nextAfter',next_id,'synthetic',customer_private.synthetic_context());
END $function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_export(uuid,uuid,text,uuid)'::regprocedure),'UTF8')),'hex')<>'e9162514b6fb9d789d7e95f644aff907a9de38618f46962787f01a850e242af9' THEN RAISE EXCEPTION 'Programme lifecycle prerequisite function differs: customer.programme_export';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_export(command uuid, target uuid, dataset text, programme uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
   FROM customer_private.programme_creation pc JOIN customer_private.programme_current p ON p.tenant_id=pc.workspace_id AND p.id=pc.programme_id
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
END $function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_participant_preview(text)'::regprocedure),'UTF8')),'hex')<>'1eff03ab6d5cd5f4277d63036184d91c7d9b8296909724406266baa2352ba0a0' THEN RAISE EXCEPTION 'Programme lifecycle prerequisite function differs: customer.programme_participant_preview';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_participant_preview(digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE i customer_private.programme_invitation;actor uuid;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF digest IS NULL OR digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO i FROM customer_private.programme_invitation WHERE token_hash=digest;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),i.workspace_id,i.programme_id,false);
 IF NOT customer_private.participant_invitation_active(i.id) OR EXISTS(SELECT FROM customer_private.programme_registration WHERE invitation_id=i.id) THEN
  RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object('programmeId',p.id,'name',p.name,'reportingPurpose',p.reporting_purpose,'expiresAt',i.expires_at,'synthetic',customer_private.synthetic_context())
 INTO result FROM customer_private.programme_current p WHERE p.tenant_id=i.workspace_id AND p.id=i.programme_id;
 IF customer.actor_id() IS DISTINCT FROM actor OR NOT customer_private.participant_invitation_active(i.id) THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 RETURN result;
END $function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_series_revenue(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'26fe2e205f57f655366f47fee797ee615ce2761d03a43ce440489afae63fa7f4' THEN RAISE EXCEPTION 'Programme lifecycle prerequisite function differs: customer.programme_series_revenue';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_series_revenue(target uuid, series uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
   FROM customer_private.programme_series_edition e JOIN customer_private.programme_current p ON p.tenant_id=e.workspace_id AND p.id=e.programme_id WHERE e.series_id=series AND e.workspace_id=target),
  (SELECT coalesce(jsonb_agg(jsonb_build_object('currency',t.currency,'exponent',c.exponent,'editions',t.n,'feesDue',t.fees::text,'paymentsRecorded',t.paid::text,'outstanding',(t.fees-t.paid)::text,
    'plannedCosts',t.planned::text,'actualCosts',t.actual::text,'marginOnActual',(t.fees-t.actual)::text,'cashMargin',(t.paid-t.actual)::text) ORDER BY t.currency),'[]'::jsonb)
   FROM (SELECT currency,count(*) n,sum(fees) fees,sum(paid) paid,sum(planned) planned,sum(actual) actual FROM fig GROUP BY currency) t JOIN app.currency c ON c.code=t.currency)
 INTO eds,tot;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Series access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'seriesId',series,'expiresAt',customer_private.coordination_expiry(),'provenance','ORGANISER_RECORDED','verified',false,
  'projection',false,'editions',eds,'totals',tot);
END $function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_template_capture(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'95c351a29f4288160abf7b8807e1e37fef6931722934a94940d892c319a95487' THEN RAISE EXCEPTION 'Programme lifecycle prerequisite function differs: customer.programme_template_capture';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_template_capture(target uuid, programme uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid;purpose text;cap integer;tk jsonb;ck jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);
 SELECT reporting_purpose INTO purpose FROM customer_private.programme_current WHERE tenant_id=target AND id=programme;
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
END $function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programmes(uuid,uuid,integer)'::regprocedure),'UTF8')),'hex')<>'b6b20a19efbbeb830242aaa0a9d611da4050f951a1b25e11cf549a898dc997f8' THEN RAISE EXCEPTION 'Programme lifecycle prerequisite function differs: customer.programmes';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programmes(target uuid, after_id uuid DEFAULT NULL::uuid, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.programme_actor(gen_random_uuid(),target);items jsonb;next_id uuid;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'workspaceId',p.tenant_id,'name',p.name,'reportingPurpose',p.reporting_purpose,'createdAt',p.created_at,'archived',p.archived,'version',p.version,'synthetic',customer_private.synthetic_context()) ORDER BY p.id),'[]'::jsonb) INTO items
 FROM (SELECT d.* FROM customer_private.programme_current d JOIN customer_private.programme_creation c ON c.workspace_id=d.tenant_id AND c.programme_id=d.id
 WHERE d.tenant_id=target AND (after_id IS NULL OR d.id>after_id) ORDER BY d.id LIMIT page_size) p;
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'id')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.programme_creation WHERE workspace_id=target AND programme_id>next_id) THEN next_id:=NULL; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('programmes',items,'workspaceId',target,'nextAfter',next_id,'synthetic',customer_private.synthetic_context());
END $function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.series_json(uuid)'::regprocedure),'UTF8')),'hex')<>'72d90ebb8f38af1dc145b0b7400522495bf4d3a5383c640265fd5a9cb6067f68' THEN RAISE EXCEPTION 'Programme lifecycle prerequisite function differs: customer_private.series_json';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.series_json(selected uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('id',s.id,'seq',s.seq,'version',v.version,'name',v.name,'description',v.description,'retired',v.retired,'templateId',v.template_id,
  'templateName',(SELECT r.name FROM customer_private.programme_template_revision r WHERE r.template_id=v.template_id ORDER BY r.version DESC LIMIT 1),
  'templateVersion',(SELECT max(r.version) FROM customer_private.programme_template_revision r WHERE r.template_id=v.template_id),
  'templateRetired',(SELECT r.retired FROM customer_private.programme_template_revision r WHERE r.template_id=v.template_id ORDER BY r.version DESC LIMIT 1),
  'startDates',v.start_dates,
  'editions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'editionNo',e.edition_no,'programmeId',e.programme_id,'programmeName',p.name,'startDate',to_char(e.start_date,'YYYY-MM-DD'),
    'seriesVersion',e.series_version,'templateVersion',e.template_version,'createdAt',e.created_at) ORDER BY e.edition_no)
    FROM customer_private.programme_series_edition e JOIN customer_private.programme_current p ON p.tenant_id=e.workspace_id AND p.id=e.programme_id WHERE e.series_id=s.id),'[]'::jsonb),
  'nextEditionDate',v.start_dates->>(SELECT count(*)::integer FROM customer_private.programme_series_edition e WHERE e.series_id=s.id),
  'updatedAt',v.created_at,'provenance','ORGANISER_RECORDED')
 FROM customer_private.programme_series s JOIN LATERAL(SELECT * FROM customer_private.programme_series_revision r WHERE r.series_id=s.id ORDER BY r.version DESC LIMIT 1) v ON true WHERE s.id=selected
$function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.service_request_context(uuid,uuid,text,text)'::regprocedure),'UTF8')),'hex')<>'b61b1034763e0518e7201decffba50837e0ea33ab5f767c2927bb1cfec8e5cd9' THEN RAISE EXCEPTION 'Programme lifecycle prerequisite function differs: customer_private.service_request_context';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.service_request_context(target uuid, actor uuid, kind text, ref text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE label text; page jsonb; company jsonb; after_id uuid; rounds integer:=0;
BEGIN
 IF kind='programme' THEN
  SELECT d.name INTO label FROM customer_private.programme_current d JOIN customer_private.programme_creation c ON c.workspace_id=d.tenant_id AND c.programme_id=d.id
  WHERE d.tenant_id=target AND d.id::text=ref;
 ELSIF kind='request' THEN
  SELECT 'Private request from '||to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') INTO label FROM customer_private.owned_request o
  WHERE o.id::text=ref AND o.workspace_id=target AND o.principal_id=actor
  AND NOT EXISTS(SELECT FROM customer_private.request_revocation r WHERE r.request_id=o.id);
 ELSIF kind='company' THEN
  BEGIN
   LOOP
    page:=customer.company_portfolio(after_id,5);
    SELECT value INTO company FROM jsonb_array_elements(page->'companies') WHERE value->>'id'=ref LIMIT 1;
    IF company IS NOT NULL THEN label:=company->'contexts'->0->>'company'; EXIT; END IF;
    after_id:=(page->>'nextAfter')::uuid;
    rounds:=rounds+1;
    EXIT WHEN after_id IS NULL OR rounds>=20;
   END LOOP;
  EXCEPTION WHEN OTHERS THEN label:=NULL;
  END;
 END IF;
 IF label IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'That place is not available for a help request' USING ERRCODE='42501'; END IF;
 RETURN label;
END $function$;
