-- Additive operational controls. Existing money, identity, sources and events are retained.
CREATE TABLE app.route_readiness (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, route_id uuid NOT NULL, pack_id uuid NOT NULL,
 mission_type text NOT NULL, dimension text NOT NULL CHECK(dimension IN ('offer','owner','qualification','research','communications','coverage','evidence','privacy','dependencies','support','quality','rollback','pilot')),
 version integer NOT NULL CHECK(version>0), status text NOT NULL CHECK(status IN ('PASS','BLOCKED','NOT_APPLICABLE')),
 owner_id uuid NOT NULL REFERENCES identity.principal(id), source_id uuid, valid_until timestamptz NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500), created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,route_id,mission_type,dimension,version),
 FOREIGN KEY(tenant_id,route_id) REFERENCES app.corridor_route(tenant_id,id), FOREIGN KEY(tenant_id,pack_id) REFERENCES app.corridor_pack_version(tenant_id,id), FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id),
 CHECK(status='BLOCKED' OR source_id IS NOT NULL)
);
CREATE TABLE app.route_release (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,route_id uuid NOT NULL,pack_id uuid NOT NULL,mission_type text NOT NULL,
 version integer NOT NULL CHECK(version>0),state text NOT NULL CHECK(state IN ('UNPUBLISHED','SYNTHETIC_APPROVED','PAUSED')),
 readiness_ids uuid[] NOT NULL,owner_id uuid NOT NULL REFERENCES identity.principal(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,route_id,mission_type,version),FOREIGN KEY(tenant_id,route_id) REFERENCES app.corridor_route(tenant_id,id),FOREIGN KEY(tenant_id,pack_id) REFERENCES app.corridor_pack_version(tenant_id,id)
);
CREATE TABLE app.configuration_proposal (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,route_id uuid NOT NULL,base_pack_id uuid,proposed_pack jsonb NOT NULL CHECK(jsonb_typeof(proposed_pack)='object' AND octet_length(proposed_pack::text)<=8192),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,route_id) REFERENCES app.corridor_route(tenant_id,id),FOREIGN KEY(tenant_id,base_pack_id) REFERENCES app.corridor_pack_version(tenant_id,id)
);
CREATE TABLE app.configuration_decision (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,proposal_id uuid NOT NULL,decision text NOT NULL CHECK(decision IN ('PUBLISH','REJECT')),published_pack_id uuid,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,proposal_id),FOREIGN KEY(tenant_id,proposal_id) REFERENCES app.configuration_proposal(tenant_id,id),FOREIGN KEY(tenant_id,published_pack_id) REFERENCES app.corridor_pack_version(tenant_id,id),CHECK((decision='PUBLISH')=(published_pack_id IS NOT NULL))
);
-- Corridra invoice and collection observations; never use customer commercial_record here.
CREATE TABLE app.service_document (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,mission_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('INVOICE','RECEIPT')),parent_id uuid,reverse_of uuid,
 amount_minor bigint NOT NULL CHECK(amount_minor<>0 AND abs(amount_minor)<=999999999999999999),currency text NOT NULL REFERENCES app.currency(code),source_id uuid NOT NULL,
 external_reference text NOT NULL CHECK(length(external_reference) BETWEEN 3 AND 200),occurred_at timestamptz NOT NULL CHECK(occurred_at<=now()),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,kind,external_reference),UNIQUE(tenant_id,reverse_of),FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id),FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id),FOREIGN KEY(tenant_id,parent_id) REFERENCES app.service_document(tenant_id,id),FOREIGN KEY(tenant_id,reverse_of) REFERENCES app.service_document(tenant_id,id),
 CHECK((reverse_of IS NULL AND amount_minor>0) OR (reverse_of IS NOT NULL AND amount_minor<0)),CHECK((kind='RECEIPT')=(parent_id IS NOT NULL))
);
CREATE TABLE app.mission_effort (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,mission_id uuid NOT NULL,operator_id uuid NOT NULL REFERENCES identity.principal(id),minutes integer NOT NULL CHECK(minutes BETWEEN 1 AND 1440),source_id uuid NOT NULL,reverse_of uuid,
 occurred_at timestamptz NOT NULL CHECK(occurred_at<=now()),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,reverse_of),FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id),FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id),FOREIGN KEY(tenant_id,reverse_of) REFERENCES app.mission_effort(tenant_id,id)
);
CREATE TABLE app.mission_operations_context (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,mission_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),customer_reference text,industry text,acquisition_source text,
 paying_status text NOT NULL CHECK(paying_status IN ('UNKNOWN','PAYING','NON_PAYING')),revenue_complete boolean NOT NULL DEFAULT false,cost_complete boolean NOT NULL DEFAULT false,effort_complete boolean NOT NULL DEFAULT false,
 intake_decision text NOT NULL DEFAULT 'UNKNOWN' CHECK(intake_decision IN ('UNKNOWN','ACCEPTED','REJECTED')),first_useful_result_at timestamptz CHECK(first_useful_result_at<=now()),
 source_id uuid NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,mission_id,version),FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id),FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id),
 CHECK(customer_reference IS NULL OR length(customer_reference) BETWEEN 3 AND 100),CHECK(industry IS NULL OR length(industry) BETWEEN 3 AND 100),CHECK(acquisition_source IS NULL OR length(acquisition_source) BETWEEN 3 AND 100)
);
CREATE TABLE app.operations_case (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,key text NOT NULL CHECK(length(key) BETWEEN 3 AND 100),version integer NOT NULL CHECK(version>0),
 kind text NOT NULL CHECK(kind IN ('COMMUNICATION','TASK','REPORT','PROVIDER','PRIVACY','SECURITY','INCIDENT','FRAUD')),subject_id uuid,
 state text NOT NULL CHECK(state IN ('OPEN','BLOCKED','RESOLVED')),owner_id uuid NOT NULL REFERENCES identity.principal(id),due_at timestamptz NOT NULL,source_id uuid,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,key,version),FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id),CHECK(state<>'RESOLVED' OR source_id IS NOT NULL)
);
CREATE TABLE app.operations_command (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES app.tenant(id),input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),result jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id)
);
CREATE TABLE app.ai_mission_budget (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,mission_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 0 AND 100000),source_id uuid NOT NULL,valid_until timestamptz NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),UNIQUE(tenant_id,mission_id,version),FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id),FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id)
);
CREATE FUNCTION app.guard_operations_control() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p app.corridor_pack_version; s app.source_record; q app.configuration_proposal; d app.service_document; e app.mission_effort; k text; r app.route_readiness;
BEGIN
 IF NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL','synthetic_validation') AND app.member_role(NEW.tenant_id) IN ('owner','admin') AND app.fresh_mfa() AND NEW.created_by=app.actor_id(),false) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Scoped synthetic administration with fresh MFA required' USING ERRCODE='42501'; END IF;
 IF NEW.created_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'Server-owned observation time required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':operations',0));
 IF TG_TABLE_NAME IN ('route_readiness','route_release','configuration_proposal') THEN
  IF TG_TABLE_NAME='configuration_proposal' THEN
   IF NEW.base_pack_id IS DISTINCT FROM (SELECT id FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id AND effective_from<=now() ORDER BY version DESC LIMIT 1) THEN RAISE EXCEPTION 'Current configuration base required'; END IF;
   IF NEW.proposed_pack->>'routeId' IS DISTINCT FROM NEW.route_id::text THEN RAISE EXCEPTION 'Proposal route mismatch'; END IF;
  ELSE
   SELECT * INTO p FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND id=NEW.pack_id AND route_id=NEW.route_id AND effective_from<=now();
   IF p.id IS NULL OR p.version<>(SELECT max(version) FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id AND effective_from<=now()) OR NOT (p.configuration->'missionTypes' ? NEW.mission_type) THEN RAISE EXCEPTION 'Current exact pack and enabled mission type required'; END IF;
   IF NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Active operational owner required'; END IF;
   IF TG_TABLE_NAME='route_readiness' THEN
    IF NEW.version<>coalesce((SELECT max(version) FROM app.route_readiness WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id AND mission_type=NEW.mission_type AND dimension=NEW.dimension),0)+1 OR NEW.valid_until<=now() THEN RAISE EXCEPTION 'Sequential unexpired readiness observation required'; END IF;
    IF NEW.status<>'BLOCKED' THEN
     IF NEW.dimension<>'dependencies' AND NEW.status='NOT_APPLICABLE' THEN RAISE EXCEPTION 'Mandatory readiness dimension cannot be inapplicable'; END IF;
     SELECT * INTO s FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.source_id AND app.can_access(tenant_id,classification,purpose) AND observed_at<=now() AND retention_until>=NEW.valid_until;
     IF s.id IS NULL THEN RAISE EXCEPTION 'Current retained readiness evidence required'; END IF;
    END IF;
   ELSE
    IF NEW.version<>coalesce((SELECT max(version) FROM app.route_release WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id AND mission_type=NEW.mission_type),0)+1 THEN RAISE EXCEPTION 'Sequential route release required'; END IF;
    IF NEW.state='SYNTHETIC_APPROVED' THEN
     IF p.status NOT IN ('TESTING','LIMITED','ACTIVE') OR cardinality(NEW.readiness_ids)<>13 OR cardinality(NEW.readiness_ids)<>(SELECT count(DISTINCT x) FROM unnest(NEW.readiness_ids) x) THEN RAISE EXCEPTION 'All readiness dimensions and available pack required'; END IF;
     FOREACH k IN ARRAY ARRAY['offer','owner','qualification','research','communications','coverage','evidence','privacy','dependencies','support','quality','rollback','pilot'] LOOP
      SELECT * INTO r FROM app.route_readiness WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id AND mission_type=NEW.mission_type AND dimension=k ORDER BY version DESC LIMIT 1;
      IF r.id IS NULL OR NOT(r.id=ANY(NEW.readiness_ids)) OR r.pack_id<>NEW.pack_id OR r.status='BLOCKED' OR r.valid_until<=now() OR r.created_by=NEW.created_by OR NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=r.source_id AND app.can_access(tenant_id,classification,purpose) AND retention_until>now()) THEN RAISE EXCEPTION 'Independent approval of current evidenced readiness required'; END IF;
     END LOOP;
    END IF;
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='configuration_decision' THEN
  SELECT * INTO q FROM app.configuration_proposal WHERE tenant_id=NEW.tenant_id AND id=NEW.proposal_id;
  IF q.id IS NULL OR q.created_by=NEW.created_by THEN RAISE EXCEPTION 'Independent configuration reviewer required'; END IF;
  IF NEW.decision='PUBLISH' THEN
   SELECT * INTO p FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND id=NEW.published_pack_id;
   IF p.id IS NULL OR p.created_by<>NEW.created_by OR p.route_id<>q.route_id OR p.configuration IS DISTINCT FROM q.proposed_pack->'configuration' OR p.status IS DISTINCT FROM q.proposed_pack->>'status' OR p.version<>(q.proposed_pack->>'version')::integer OR p.id::text IS DISTINCT FROM q.proposed_pack->>'id' THEN RAISE EXCEPTION 'Exact reviewed configuration publication required'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME IN ('service_document','mission_effort','mission_operations_context','ai_mission_budget') THEN
  IF NOT EXISTS(SELECT FROM app.mission WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id) THEN RAISE EXCEPTION 'Current accessible mission required'; END IF;
  SELECT * INTO s FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.source_id AND app.can_access(tenant_id,classification,purpose) AND retention_until>now() AND observed_at<=now();
  IF s.id IS NULL THEN RAISE EXCEPTION 'Current accessible source required'; END IF;
  IF TG_TABLE_NAME='service_document' THEN
   IF NEW.reverse_of IS NOT NULL THEN
    SELECT * INTO d FROM app.service_document WHERE tenant_id=NEW.tenant_id AND id=NEW.reverse_of AND reverse_of IS NULL;
    IF d.id IS NULL OR (NEW.kind,NEW.parent_id,NEW.mission_id,NEW.currency,NEW.amount_minor) IS DISTINCT FROM (d.kind,d.parent_id,d.mission_id,d.currency,-d.amount_minor) OR NEW.occurred_at<d.occurred_at THEN RAISE EXCEPTION 'Exact service compensation required'; END IF;
    IF d.kind='INVOICE' AND EXISTS(SELECT FROM app.service_document WHERE tenant_id=NEW.tenant_id AND parent_id=d.id GROUP BY parent_id HAVING sum(amount_minor)>0) THEN RAISE EXCEPTION 'Compensate receipts before their invoice'; END IF;
   ELSIF NEW.kind='RECEIPT' THEN
    SELECT * INTO d FROM app.service_document WHERE tenant_id=NEW.tenant_id AND id=NEW.parent_id AND kind='INVOICE' AND reverse_of IS NULL;
    IF d.id IS NULL OR d.mission_id<>NEW.mission_id OR d.currency<>NEW.currency OR NEW.occurred_at<d.occurred_at OR EXISTS(SELECT FROM app.service_document WHERE tenant_id=NEW.tenant_id AND reverse_of=d.id) OR NEW.amount_minor+coalesce((SELECT sum(amount_minor) FROM app.service_document WHERE tenant_id=NEW.tenant_id AND parent_id=d.id),0)>d.amount_minor THEN RAISE EXCEPTION 'Uncompensated original invoice and bounded same-currency receipt required'; END IF;
   END IF;
  ELSIF TG_TABLE_NAME='mission_effort' THEN
   IF NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.operator_id) THEN RAISE EXCEPTION 'Active effort operator required'; END IF;
   IF NEW.reverse_of IS NOT NULL THEN
    SELECT * INTO e FROM app.mission_effort WHERE tenant_id=NEW.tenant_id AND id=NEW.reverse_of AND reverse_of IS NULL;
    IF e.id IS NULL OR (NEW.mission_id,NEW.operator_id,NEW.minutes) IS DISTINCT FROM (e.mission_id,e.operator_id,e.minutes) THEN RAISE EXCEPTION 'Exact effort compensation required'; END IF;
   END IF;
  ELSIF TG_TABLE_NAME='ai_mission_budget' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':ai-budget',0));
   IF NEW.version<>coalesce((SELECT max(version) FROM app.ai_mission_budget WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id),0)+1 OR NEW.valid_until<=now() OR NEW.valid_until>s.retention_until THEN RAISE EXCEPTION 'Sequential retained mission budget required'; END IF;
  ELSE
   IF NEW.version<>coalesce((SELECT max(version) FROM app.mission_operations_context WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id),0)+1 THEN RAISE EXCEPTION 'Sequential mission context required'; END IF;
   IF NEW.intake_decision='REJECTED' AND NOT EXISTS(SELECT FROM app.mission WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id AND status='CANCELLED') THEN RAISE EXCEPTION 'Rejected intake must have a cancelled canonical mission'; END IF;
   IF NEW.first_useful_result_at IS NOT NULL AND NEW.first_useful_result_at<(SELECT created_at FROM app.mission WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id) THEN RAISE EXCEPTION 'Useful result cannot precede intake'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='operations_case' THEN
  IF NEW.version<>coalesce((SELECT max(version) FROM app.operations_case WHERE tenant_id=NEW.tenant_id AND key=NEW.key),0)+1 OR NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Sequential case and active owner required'; END IF;
  IF NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.source_id AND app.can_access(tenant_id,classification,purpose) AND retention_until>now()) THEN RAISE EXCEPTION 'Current closure evidence required'; END IF;
  IF NEW.subject_id IS NOT NULL AND ((NEW.kind='COMMUNICATION' AND NOT EXISTS(SELECT FROM app.communication WHERE tenant_id=NEW.tenant_id AND id=NEW.subject_id)) OR (NEW.kind IN ('TASK','FRAUD') AND NOT EXISTS(SELECT FROM app.network_task WHERE tenant_id=NEW.tenant_id AND id=NEW.subject_id)) OR (NEW.kind='REPORT' AND NOT EXISTS(SELECT FROM app.delivery_publication WHERE tenant_id=NEW.tenant_id AND id=NEW.subject_id)) OR (NEW.kind='PROVIDER' AND NOT EXISTS(SELECT FROM app.ai_run WHERE tenant_id=NEW.tenant_id AND id=NEW.subject_id)) OR (NEW.kind IN ('PRIVACY','SECURITY','INCIDENT') AND NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.subject_id))) THEN RAISE EXCEPTION 'Current same-tenant case subject required'; END IF;
  IF EXISTS(SELECT FROM app.operations_case WHERE tenant_id=NEW.tenant_id AND key=NEW.key AND (kind<>NEW.kind OR subject_id IS DISTINCT FROM NEW.subject_id)) THEN RAISE EXCEPTION 'Case subject history is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['route_readiness','route_release','configuration_proposal','configuration_decision','service_document','mission_effort','mission_operations_context','operations_case','operations_command','ai_mission_budget'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY read ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND app.member_role(tenant_id) IN (''owner'',''admin''))',t);
  EXECUTE format('CREATE POLICY add ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND app.member_role(tenant_id) IN (''owner'',''admin'') AND created_by=app.actor_id())',t);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO corridra_runtime',t);
  EXECUTE format('CREATE TRIGGER guard BEFORE INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_operations_control()',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',t);
  EXECUTE format('CREATE TRIGGER event AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_change()',t);
 END LOOP;
END $$;
CREATE POLICY operator_readiness ON app.route_readiness FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND app.member_role(tenant_id)='operator');
CREATE POLICY operator_release ON app.route_release FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND app.member_role(tenant_id)='operator');
CREATE POLICY operator_cases ON app.operations_case FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND app.member_role(tenant_id)='operator');
CREATE POLICY operator_context ON app.mission_operations_context FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND app.member_role(tenant_id)='operator');
CREATE POLICY ai_budget_read ON app.ai_mission_budget FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND app.member_role(tenant_id) IN ('operator','reviewer'));
REVOKE ALL ON FUNCTION app.guard_operations_control() FROM PUBLIC;
-- Respect an explicit per-service pause without rewriting historical mission assignments.
CREATE FUNCTION app.guard_route_pause() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.status='ASSIGNED' AND EXISTS(SELECT FROM app.corridor_pack_version p JOIN app.mission_type_definition t ON t.tenant_id=p.tenant_id AND t.id=NEW.mission_type_id JOIN LATERAL(SELECT state FROM app.route_release WHERE tenant_id=p.tenant_id AND route_id=p.route_id AND mission_type=t.key ORDER BY version DESC LIMIT 1) r ON true WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.pack_id AND r.state='PAUSED') THEN RAISE EXCEPTION 'Route service is paused'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_route_pause() FROM PUBLIC;
CREATE TRIGGER operational_pause BEFORE INSERT ON app.mission_route_assignment FOR EACH ROW EXECUTE FUNCTION app.guard_route_pause();
ALTER TABLE app.ai_attempt ADD COLUMN mission_budget_id uuid;
ALTER TABLE app.ai_attempt ADD FOREIGN KEY(tenant_id,mission_budget_id) REFERENCES app.ai_mission_budget(tenant_id,id);
CREATE FUNCTION app.guard_ai_mission_budget() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b app.ai_mission_budget; m uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':ai-budget',0));
 SELECT mission_id INTO m FROM app.ai_run WHERE tenant_id=NEW.tenant_id AND id=NEW.run_id;
 SELECT * INTO b FROM app.ai_mission_budget WHERE tenant_id=NEW.tenant_id AND mission_id=m ORDER BY version DESC LIMIT 1;
 IF b.id IS NOT NULL THEN
  IF b.valid_until<=now() OR NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=b.tenant_id AND id=b.source_id AND app.can_access(tenant_id,classification,purpose) AND retention_until>now()) OR NEW.reserved_minor+coalesce((SELECT sum(a.reserved_minor) FROM app.ai_attempt a JOIN app.ai_run r ON r.tenant_id=a.tenant_id AND r.id=a.run_id WHERE r.tenant_id=NEW.tenant_id AND r.mission_id=m),0)>b.amount_minor THEN RAISE EXCEPTION 'Mission AI budget unavailable or exhausted' USING ERRCODE='54000'; END IF;
 END IF;
 NEW.mission_budget_id:=b.id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_ai_mission_budget() FROM PUBLIC;
CREATE TRIGGER mission_budget BEFORE INSERT ON app.ai_attempt FOR EACH ROW EXECUTE FUNCTION app.guard_ai_mission_budget();
CREATE INDEX service_document_mission ON app.service_document(tenant_id,mission_id,created_at);
CREATE INDEX mission_effort_mission ON app.mission_effort(tenant_id,mission_id,created_at);

-- Bounded exponential backoff preserves the receipt-wins and immutable attempt contracts.
CREATE OR REPLACE FUNCTION app.finish_communication(mid uuid,h text,lease uuid,result text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.communication_dispatch; state text;
BEGIN
 SELECT * INTO j FROM app.communication_dispatch WHERE id=mid AND capability_hash=h FOR UPDATE;
 IF j.id IS NULL THEN RETURN 'UNAVAILABLE'; END IF;
 IF j.status='DELIVERED' THEN RETURN 'DELIVERED'; END IF;
 IF j.lease_id IS DISTINCT FROM lease OR j.status<>'RUNNING' THEN RETURN 'WAIT'; END IF;
 IF result NOT IN ('DELIVERED','TRANSIENT','PERMANENT') THEN RAISE EXCEPTION 'Invalid delivery outcome'; END IF;
 IF EXISTS(SELECT FROM app.communication_receipt WHERE id=mid) THEN state:='DELIVERED';
 ELSIF result='DELIVERED' THEN RAISE EXCEPTION 'A delivery receipt is required';
 ELSE state:=CASE WHEN result='PERMANENT' OR j.attempts>=3 THEN 'DEAD' ELSE 'PENDING' END; END IF;
 UPDATE app.communication_dispatch SET status=state,last_error=CASE WHEN state='DELIVERED' THEN NULL ELSE result END,available_at=now()+make_interval(secs=>least(60,5*power(2,greatest(j.attempts-1,0)))::integer),lease_until=NULL,lease_id=NULL,updated_at=now() WHERE id=mid;
 UPDATE app.outbox_delivery SET delivered_at=CASE WHEN state='DELIVERED' THEN now() ELSE NULL END,available_at=now()+make_interval(secs=>least(60,5*power(2,greatest(j.attempts-1,0)))::integer),lease_until=NULL WHERE event_id=j.event_id;
 INSERT INTO app.communication_attempt(tenant_id,message_id,attempt,status,reason) VALUES(j.tenant_id,mid,j.attempts,state,result);
 RETURN state;
END $$;
