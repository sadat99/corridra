-- Optional private independent-organiser rules per programme: versioned terms, versioned eligibility criteria,
-- minimum and maximum places with an ordered waiting list, account-linked task owners and in-app reminders.
-- Records what the organiser sets and what each participant accepts; sends nothing, moves no money, verifies nothing.
-- The maximum is the existing capacity record (customer_private.programme_capacity_revision), written here only
-- through the same version order, so there is one place where the maximum lives. Fees are read from the existing
-- economics ledger and never copied.
CREATE TABLE customer_private.programme_terms_revision (
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 version integer NOT NULL CHECK(version>=1),
 included text NOT NULL CHECK(included=btrim(included) AND length(included) BETWEEN 11 AND 1000 AND included LIKE 'Synthetic %' AND included !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
 excluded text CHECK(excluded=btrim(excluded) AND length(excluded) BETWEEN 11 AND 1000 AND excluded LIKE 'Synthetic %' AND excluded !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
 cancellation_terms text NOT NULL CHECK(cancellation_terms=btrim(cancellation_terms) AND length(cancellation_terms) BETWEEN 11 AND 1000 AND cancellation_terms LIKE 'Synthetic %' AND cancellation_terms !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
 change_terms text NOT NULL CHECK(change_terms=btrim(change_terms) AND length(change_terms) BETWEEN 11 AND 1000 AND change_terms LIKE 'Synthetic %' AND change_terms !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
 fees_apply boolean NOT NULL,
 fee_note text CHECK(fee_note=btrim(fee_note) AND length(fee_note) BETWEEN 11 AND 500 AND fee_note LIKE 'Synthetic %' AND fee_note !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
 reason text NOT NULL CHECK(reason=btrim(reason) AND length(reason) BETWEEN 11 AND 300 AND reason LIKE 'Synthetic %' AND reason !~ '[[:cntrl:]]'),
 set_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(programme_id,version),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id),
 CHECK(fees_apply OR fee_note IS NULL)
);
CREATE TABLE customer_private.programme_eligibility_revision (
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 version integer NOT NULL CHECK(version>=1),
 allowed_roles text[] NOT NULL CHECK(allowed_roles <@ ARRAY['BUYER','SELLER','SUPPLIER','MANUFACTURER','DISTRIBUTOR','ORGANISER']::text[] AND cardinality(allowed_roles)<=6),
 sectors text[] NOT NULL CHECK(cardinality(sectors)<=10),
 countries text[] NOT NULL CHECK(cardinality(countries)<=30),
 size_bands text[] NOT NULL CHECK(size_bands <@ ARRAY['1-10','11-50','51-200','201-1000','1000+']::text[] AND cardinality(size_bands)<=5),
 min_profile_fields smallint NOT NULL CHECK(min_profile_fields BETWEEN 0 AND 7),
 reason text NOT NULL CHECK(reason=btrim(reason) AND length(reason) BETWEEN 11 AND 300 AND reason LIKE 'Synthetic %' AND reason !~ '[[:cntrl:]]'),
 set_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(programme_id,version),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TABLE customer_private.programme_places_revision (
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 version integer NOT NULL CHECK(version>=1),
 minimum_participants integer NOT NULL CHECK(minimum_participants BETWEEN 1 AND 10000),
 waitlist boolean NOT NULL,
 reason text NOT NULL CHECK(reason=btrim(reason) AND length(reason) BETWEEN 11 AND 300 AND reason LIKE 'Synthetic %' AND reason !~ '[[:cntrl:]]'),
 set_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(programme_id,version),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TABLE customer_private.programme_terms_acceptance (
 registration_id uuid NOT NULL REFERENCES customer_private.programme_registration(id),
 workspace_id uuid NOT NULL,programme_id uuid NOT NULL,
 terms_version integer NOT NULL,
 accepted_by uuid NOT NULL REFERENCES customer_private.principal(id),
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(registration_id,terms_version),
 FOREIGN KEY(programme_id,terms_version) REFERENCES customer_private.programme_terms_revision(programme_id,version),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TABLE customer_private.programme_enrolment (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,programme_id uuid NOT NULL,
 registration_id uuid NOT NULL UNIQUE REFERENCES customer_private.programme_registration(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,workspace_id,programme_id,registration_id),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TABLE customer_private.programme_enrolment_revision (
 enrolment_id uuid NOT NULL,workspace_id uuid NOT NULL,programme_id uuid NOT NULL,registration_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>=1),
 status text NOT NULL CHECK(status IN ('PLACED','WAITLISTED','NOT_ELIGIBLE','CANCELLED')),
 queue_no integer CHECK(queue_no>=1),
 eligibility_version integer,terms_version integer,
 reasons text[] NOT NULL DEFAULT ARRAY[]::text[] CHECK(reasons <@ ARRAY['NO_PROFILE','ROLE','SECTOR','COUNTRY','SIZE','COMPLETENESS']::text[]),
 profile_workspace_id uuid REFERENCES customer.workspace(tenant_id),
 cause text NOT NULL CHECK(cause IN ('APPLIED','PROMOTED','CANCELLED_BY_PARTICIPANT')),
 changed_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(enrolment_id,version),
 FOREIGN KEY(enrolment_id,workspace_id,programme_id,registration_id) REFERENCES customer_private.programme_enrolment(id,workspace_id,programme_id,registration_id),
 FOREIGN KEY(programme_id,eligibility_version) REFERENCES customer_private.programme_eligibility_revision(programme_id,version),
 FOREIGN KEY(programme_id,terms_version) REFERENCES customer_private.programme_terms_revision(programme_id,version),
 CHECK((status='WAITLISTED')=(queue_no IS NOT NULL)),
 CHECK((status='NOT_ELIGIBLE')=(cardinality(reasons)>0)),
 CHECK(cause<>'PROMOTED' OR status='PLACED'),
 CHECK((cause='CANCELLED_BY_PARTICIPANT')=(status='CANCELLED'))
);
CREATE UNIQUE INDEX programme_enrolment_queue ON customer_private.programme_enrolment_revision(programme_id,queue_no) WHERE queue_no IS NOT NULL;
CREATE INDEX programme_enrolment_programme ON customer_private.programme_enrolment(workspace_id,programme_id,id);
CREATE TABLE customer_private.programme_task_plan_revision (
 task_id uuid NOT NULL,workspace_id uuid NOT NULL,programme_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>=1),
 assignee_principal uuid REFERENCES customer_private.principal(id),
 participant_visible boolean NOT NULL,
 set_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(task_id,version),
 FOREIGN KEY(task_id,workspace_id,programme_id) REFERENCES customer_private.programme_task(id,workspace_id,programme_id)
);
CREATE INDEX programme_task_plan_assignee ON customer_private.programme_task_plan_revision(assignee_principal,task_id,version DESC);
CREATE TABLE customer_private.programme_terms_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 operation text NOT NULL CHECK(operation IN ('terms','eligibility','places','refresh','assign','apply','accept_terms','cancel','task_done')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['programme_terms_revision','programme_eligibility_revision','programme_places_revision','programme_terms_acceptance','programme_enrolment',
  'programme_enrolment_revision','programme_task_plan_revision','programme_terms_command'] LOOP
  EXECUTE format('ALTER TABLE customer_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON customer_private.%I FROM PUBLIC,corridra_runtime,corridra_auth',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON customer_private.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',t);
 END LOOP;
END $$;

-- Integrity in the database, so even a direct insert cannot skip a version, cross a programme or overbook.
CREATE TRIGGER programme_terms_revision_order BEFORE INSERT ON customer_private.programme_terms_revision FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('programme_id');
CREATE TRIGGER programme_eligibility_revision_order BEFORE INSERT ON customer_private.programme_eligibility_revision FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('programme_id');
CREATE TRIGGER programme_places_revision_order BEFORE INSERT ON customer_private.programme_places_revision FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('programme_id');
CREATE TRIGGER programme_enrolment_revision_order BEFORE INSERT ON customer_private.programme_enrolment_revision FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('enrolment_id');
CREATE TRIGGER programme_task_plan_revision_order BEFORE INSERT ON customer_private.programme_task_plan_revision FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('task_id');
CREATE TRIGGER programme_terms_acceptance_registration BEFORE INSERT ON customer_private.programme_terms_acceptance FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_registration_guard();
CREATE TRIGGER programme_enrolment_registration BEFORE INSERT ON customer_private.programme_enrolment FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_registration_guard();
CREATE TRIGGER programme_enrolment_revision_registration BEFORE INSERT ON customer_private.programme_enrolment_revision FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_registration_guard();

CREATE FUNCTION customer_private.terms_maximum(programme uuid) RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT c.capacity FROM customer_private.programme_capacity_revision c WHERE c.programme_id=programme ORDER BY c.version DESC LIMIT 1
$$;
-- People who hold a place now: the latest enrolment state is PLACED and the registration is still active.
CREATE FUNCTION customer_private.terms_taken(programme uuid,skip uuid DEFAULT NULL) RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT count(*)::integer FROM customer_private.programme_enrolment e
 WHERE e.programme_id=programme AND e.id IS DISTINCT FROM skip
 AND customer_private.coordination_registration_state(e.registration_id)='ACTIVE'
 AND (SELECT r.status FROM customer_private.programme_enrolment_revision r WHERE r.enrolment_id=e.id ORDER BY r.version DESC LIMIT 1)='PLACED'
$$;
CREATE FUNCTION customer_private.terms_enrolment_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior text;cap integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_places:'||NEW.programme_id::text,0));
 SELECT r.status INTO prior FROM customer_private.programme_enrolment_revision r WHERE r.enrolment_id=NEW.enrolment_id ORDER BY r.version DESC LIMIT 1;
 IF NOT((prior IS NULL AND NEW.status IN ('PLACED','WAITLISTED','NOT_ELIGIBLE'))
  OR (prior IN ('NOT_ELIGIBLE','CANCELLED') AND NEW.status IN ('PLACED','WAITLISTED','NOT_ELIGIBLE'))
  OR (prior='WAITLISTED' AND NEW.status IN ('PLACED','CANCELLED'))
  OR (prior='PLACED' AND NEW.status='CANCELLED')) THEN
  RAISE EXCEPTION 'Enrolment change not allowed' USING ERRCODE='23514';
 END IF;
 IF NEW.status='PLACED' THEN
  cap:=customer_private.terms_maximum(NEW.programme_id);
  IF cap IS NOT NULL AND customer_private.terms_taken(NEW.programme_id,NEW.enrolment_id)>=cap THEN RAISE EXCEPTION 'No place available' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER programme_enrolment_revision_places BEFORE INSERT ON customer_private.programme_enrolment_revision FOR EACH ROW EXECUTE FUNCTION customer_private.terms_enrolment_guard();
-- The older capacity writer (ADR-047) stays as it was, but no writer can set a maximum below the people who hold places.
CREATE FUNCTION customer_private.terms_capacity_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_places:'||NEW.programme_id::text,0));
 IF NEW.capacity<customer_private.terms_taken(NEW.programme_id) THEN
  RAISE EXCEPTION 'Fewer places than the people already placed' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER programme_capacity_revision_places BEFORE INSERT ON customer_private.programme_capacity_revision FOR EACH ROW EXECUTE FUNCTION customer_private.terms_capacity_guard();
CREATE FUNCTION customer_private.terms_acceptance_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM customer_private.programme_registration r WHERE r.id=NEW.registration_id AND r.principal_id=NEW.accepted_by) THEN
  RAISE EXCEPTION 'Only the registered participant can accept terms' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER programme_terms_acceptance_owner BEFORE INSERT ON customer_private.programme_terms_acceptance FOR EACH ROW EXECUTE FUNCTION customer_private.terms_acceptance_guard();

-- Current people who may own a task: original workspace members and active invited members whose account is enabled.
-- The key is opaque and stable, so a principal id is never shown.
CREATE FUNCTION customer_private.terms_directory(target uuid) RETURNS TABLE(key uuid,principal_id uuid,label text,role text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT overlay(overlay(md5('programme-assignee:'||target::text||':'||x.pid::text) placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid,x.pid,x.lbl,x.rl FROM (
  SELECT m.principal_id pid,CASE m.role WHEN 'owner' THEN 'Workspace owner' WHEN 'admin' THEN 'Workspace admin' ELSE 'Workspace member' END lbl,m.role rl
  FROM customer.membership m WHERE m.tenant_id=target
  UNION ALL
  SELECT wm.principal_id,i.label,customer_private.workspace_member_role_now(wm.id)
  FROM customer_private.workspace_member wm JOIN customer_private.workspace_invitation i ON i.id=wm.source_invitation_id
  WHERE wm.tenant_id=target AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=wm.id)
  AND NOT EXISTS(SELECT FROM customer.membership o WHERE o.tenant_id=wm.tenant_id AND o.principal_id=wm.principal_id)
 ) x JOIN customer_private.principal p ON p.id=x.pid AND p.disabled_at IS NULL
$$;
CREATE FUNCTION customer_private.terms_plan_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.assignee_principal IS NOT NULL AND NOT EXISTS(SELECT FROM customer_private.terms_directory(NEW.workspace_id) d WHERE d.principal_id=NEW.assignee_principal) THEN
  RAISE EXCEPTION 'Task owner must be a current workspace member' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER programme_task_plan_revision_member BEFORE INSERT ON customer_private.programme_task_plan_revision FOR EACH ROW EXECUTE FUNCTION customer_private.terms_plan_guard();

CREATE FUNCTION customer_private.terms_string_array(v jsonb,max_items integer,min_length integer,max_length integer) RETURNS text[]
 LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE items text[];
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>max_items OR EXISTS(SELECT FROM jsonb_array_elements(v) e WHERE jsonb_typeof(e)<>'string') THEN
  RAISE EXCEPTION 'Invalid list' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(array_agg(e COLLATE "C" ORDER BY e COLLATE "C"),ARRAY[]::text[]) INTO items FROM jsonb_array_elements_text(v) e;
 IF EXISTS(SELECT FROM unnest(items) s WHERE s<>btrim(s) OR length(s) NOT BETWEEN min_length AND max_length OR s ~ '[[:cntrl:]]')
  OR (SELECT count(DISTINCT lower(s)) FROM unnest(items) s)<>cardinality(items) THEN
  RAISE EXCEPTION 'Invalid list' USING ERRCODE='23514';
 END IF;
 RETURN items;
END $$;
-- Why a profile does not meet the criteria, as codes only. The profile content itself is never returned.
CREATE FUNCTION customer_private.terms_eligibility_reasons(c customer_private.programme_eligibility_revision,d jsonb) RETURNS text[]
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE found_reasons text[]:=ARRAY[]::text[];filled integer;
BEGIN
 IF d IS NULL THEN RETURN ARRAY['NO_PROFILE']; END IF;
 IF cardinality(c.allowed_roles)>0 AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(d->'commercialRoles') r WHERE r=ANY(c.allowed_roles)) THEN found_reasons:=array_append(found_reasons,'ROLE'); END IF;
 IF cardinality(c.sectors)>0 AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(d->'sectors') s WHERE lower(s) IN (SELECT lower(x) FROM unnest(c.sectors) x)) THEN found_reasons:=array_append(found_reasons,'SECTOR'); END IF;
 IF cardinality(c.countries)>0 AND NOT ((d->>'countryCode')=ANY(c.countries)) THEN found_reasons:=array_append(found_reasons,'COUNTRY'); END IF;
 IF cardinality(c.size_bands)>0 AND NOT ((d->>'sizeBand')=ANY(c.size_bands)) THEN found_reasons:=array_append(found_reasons,'SIZE'); END IF;
 -- Seven details count: legal name, country, size band, a role, a sector, a website and a summary.
 filled:=(CASE WHEN length(d->>'legalName')>0 THEN 1 ELSE 0 END)+(CASE WHEN length(d->>'countryCode')>0 THEN 1 ELSE 0 END)+(CASE WHEN length(d->>'sizeBand')>0 THEN 1 ELSE 0 END)
  +(CASE WHEN jsonb_array_length(d->'commercialRoles')>0 THEN 1 ELSE 0 END)+(CASE WHEN jsonb_array_length(d->'sectors')>0 THEN 1 ELSE 0 END)
  +(CASE WHEN jsonb_typeof(d->'website')='string' THEN 1 ELSE 0 END)+(CASE WHEN length(d->>'summary')>0 THEN 1 ELSE 0 END);
 IF filled<c.min_profile_fields THEN found_reasons:=array_append(found_reasons,'COMPLETENESS'); END IF;
 RETURN found_reasons;
END $$;

CREATE FUNCTION customer_private.terms_event(target uuid,actor uuid,command uuid,programme uuid,kind text,reference uuid) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid;eid uuid:=gen_random_uuid();v integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v FROM app.domain_event e WHERE e.tenant_id=target AND e.aggregate_type='customer_programme_terms' AND e.aggregate_id=programme::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.programme_terms.'||kind,1,'customer_programme_terms',programme::text,v,executor,clock_timestamp(),command,command,
 jsonb_build_object('referenceId',reference,'kind',kind,'synthetic',true,'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.programme_terms.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

-- Opens a command: authority, the two programme locks, the account re-check and the exact-retry rule.
-- A repeated command id returns the first answer; the same id with different content conflicts.
CREATE FUNCTION customer_private.terms_open(command uuid,operation text,target uuid,programme uuid,manage boolean,signature jsonb,OUT actor uuid,OUT replay jsonb)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior customer_private.programme_terms_command;
BEGIN
 actor:=customer_private.participant_scope(command,target,programme,manage);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_coordination:'||programme::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_places:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM customer_private.programme_terms_command q WHERE q.actor_id=actor AND q.command_id=command;
 IF FOUND THEN
  IF prior.operation<>operation OR prior.request IS DISTINCT FROM signature THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  replay:=prior.result;
 END IF;
END $$;
CREATE FUNCTION customer_private.terms_close(command uuid,operation text,target uuid,programme uuid,actor uuid,signature jsonb,result jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO customer_private.programme_terms_command(actor_id,command_id,workspace_id,programme_id,operation,request,result) VALUES(actor,command,target,programme,operation,signature,result);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',false,'expiresAt',customer_private.coordination_expiry());
END $$;
CREATE FUNCTION customer_private.terms_replayed(replay jsonb,command uuid,target uuid,programme uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT replay||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',true,'expiresAt',customer_private.coordination_expiry())
$$;

CREATE FUNCTION customer_private.terms_json(programme uuid,selected integer) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('version',t.version,'included',t.included,'excluded',t.excluded,'cancellationTerms',t.cancellation_terms,'changeTerms',t.change_terms,
  'feesApply',t.fees_apply,'feeNote',t.fee_note,'reason',t.reason,'publishedAt',t.created_at)
 FROM customer_private.programme_terms_revision t WHERE t.programme_id=programme AND t.version=selected
$$;
CREATE FUNCTION customer_private.eligibility_json(programme uuid,selected integer) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('version',e.version,'roles',to_jsonb(e.allowed_roles),'sectors',to_jsonb(e.sectors),'countries',to_jsonb(e.countries),'sizeBands',to_jsonb(e.size_bands),
  'minProfileFields',e.min_profile_fields,'reason',e.reason,'updatedAt',e.created_at)
 FROM customer_private.programme_eligibility_revision e WHERE e.programme_id=programme AND e.version=selected
$$;
-- Where a waiting person stands: 1 is next, counting only people whose registration is still active.
CREATE FUNCTION customer_private.terms_queue_position(selected uuid) RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH waiting AS(SELECT DISTINCT ON (r.enrolment_id) r.enrolment_id,r.status,r.queue_no,r.registration_id FROM customer_private.programme_enrolment_revision r
  WHERE r.programme_id=(SELECT e.programme_id FROM customer_private.programme_enrolment e WHERE e.id=selected) ORDER BY r.enrolment_id,r.version DESC)
 SELECT CASE WHEN me.status='WAITLISTED' THEN (SELECT count(*)::integer FROM waiting w WHERE w.status='WAITLISTED' AND w.queue_no<=me.queue_no
  AND customer_private.coordination_registration_state(w.registration_id)='ACTIVE') END FROM waiting me WHERE me.enrolment_id=selected
$$;
-- Moves waiting people up in queue order while a place is free. Each move is a real change with its own event.
CREATE FUNCTION customer_private.terms_reconcile(target uuid,programme uuid,actor uuid,command uuid) RETURNS integer
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cap integer:=customer_private.terms_maximum(programme);head customer_private.programme_enrolment_revision;moved integer:=0;
BEGIN
 LOOP
  EXIT WHEN cap IS NOT NULL AND customer_private.terms_taken(programme)>=cap;
  SELECT w.* INTO head FROM (SELECT DISTINCT ON (r.enrolment_id) r.* FROM customer_private.programme_enrolment_revision r WHERE r.programme_id=programme ORDER BY r.enrolment_id,r.version DESC) w
  WHERE w.status='WAITLISTED' AND customer_private.coordination_registration_state(w.registration_id)='ACTIVE' ORDER BY w.queue_no LIMIT 1;
  EXIT WHEN NOT FOUND;
  INSERT INTO customer_private.programme_enrolment_revision(enrolment_id,workspace_id,programme_id,registration_id,version,status,queue_no,eligibility_version,terms_version,reasons,profile_workspace_id,cause,changed_by)
  VALUES(head.enrolment_id,head.workspace_id,programme,head.registration_id,head.version+1,'PLACED',NULL,head.eligibility_version,head.terms_version,ARRAY[]::text[],head.profile_workspace_id,'PROMOTED',actor);
  PERFORM customer_private.terms_event(target,actor,command,programme,'place_promoted',head.enrolment_id);
  moved:=moved+1;
 END LOOP;
 RETURN moved;
END $$;

-- Organiser: everything the four panels need in one read. Terms, criteria and the places rule with their histories,
-- the task owners and the people who can own a task.
CREATE FUNCTION customer.programme_terms_state(target uuid,programme uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;tv integer;ev integer;rule customer_private.programme_places_revision;cap integer;tasks jsonb;members jsonb;th jsonb;eh jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_places:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(t.version),0) INTO tv FROM customer_private.programme_terms_revision t WHERE t.programme_id=programme;
 SELECT coalesce(max(e.version),0) INTO ev FROM customer_private.programme_eligibility_revision e WHERE e.programme_id=programme;
 SELECT * INTO rule FROM customer_private.programme_places_revision r WHERE r.programme_id=programme ORDER BY r.version DESC LIMIT 1;
 cap:=customer_private.terms_maximum(programme);
 SELECT coalesce(jsonb_agg(customer_private.terms_json(programme,h.version) ORDER BY h.version DESC),'[]'::jsonb) INTO th
 FROM (SELECT version FROM customer_private.programme_terms_revision WHERE programme_id=programme ORDER BY version DESC LIMIT 20) h;
 SELECT coalesce(jsonb_agg(customer_private.eligibility_json(programme,h.version) ORDER BY h.version DESC),'[]'::jsonb) INTO eh
 FROM (SELECT version FROM customer_private.programme_eligibility_revision WHERE programme_id=programme ORDER BY version DESC LIMIT 20) h;
 SELECT coalesce(jsonb_agg(customer_private.programme_task_json(t.id)||jsonb_build_object('plan',jsonb_build_object('version',coalesce(pl.version,0),
  'assigneeKey',d.key,'assigneeLabel',d.label,'assigneeActive',CASE WHEN pl.assignee_principal IS NULL THEN NULL ELSE d.key IS NOT NULL END,
  'participantVisible',coalesce(pl.participant_visible,false))) ORDER BY t.seq),'[]'::jsonb) INTO tasks
 FROM customer_private.programme_task t
 LEFT JOIN LATERAL(SELECT * FROM customer_private.programme_task_plan_revision x WHERE x.task_id=t.id ORDER BY x.version DESC LIMIT 1) pl ON true
 LEFT JOIN customer_private.terms_directory(target) d ON d.principal_id=pl.assignee_principal
 WHERE t.workspace_id=target AND t.programme_id=programme;
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',d.key,'label',d.label,'role',d.role,'isYou',d.principal_id=actor) ORDER BY d.label,d.key),'[]'::jsonb) INTO members FROM customer_private.terms_directory(target) d;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.coordination_expiry(),'sendsMessages',false,
  'terms',jsonb_build_object('current',CASE WHEN tv>0 THEN customer_private.terms_json(programme,tv) END,'history',th),
  'eligibility',jsonb_build_object('current',CASE WHEN ev>0 THEN customer_private.eligibility_json(programme,ev) END,'history',eh),
  'places',jsonb_build_object('version',coalesce(rule.version,0),'minimum',rule.minimum_participants,'maximum',cap,'waitlist',coalesce(rule.waitlist,false),'reason',rule.reason,
   'placed',customer_private.terms_taken(programme)),
  'tasks',tasks,'members',members);
END $$;

CREATE FUNCTION customer.programme_terms_publish(command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target uuid;programme uuid;opened record;sig jsonb;cur integer;expected integer;inc text;exc text;canc text;chg text;fee text;why text;latest customer_private.programme_terms_revision;fees boolean;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' OR input-ARRAY['workspaceId','programmeId','expectedVersion','included','excluded','cancellationTerms','changeTerms','feesApply','feeNote','reason']<>'{}'::jsonb
  OR NOT(input ?& ARRAY['workspaceId','programmeId','expectedVersion','included','excluded','cancellationTerms','changeTerms','feesApply','feeNote','reason'])
  OR jsonb_typeof(input->'workspaceId')<>'string' OR jsonb_typeof(input->'programmeId')<>'string' OR jsonb_typeof(input->'expectedVersion')<>'number' OR (input->>'expectedVersion') !~ '^[0-9]{1,6}$'
  OR jsonb_typeof(input->'feesApply')<>'boolean' THEN RAISE EXCEPTION 'Invalid terms' USING ERRCODE='23514'; END IF;
 target:=(input->>'workspaceId')::uuid;programme:=(input->>'programmeId')::uuid;expected:=(input->>'expectedVersion')::integer;fees:=(input->>'feesApply')::boolean;
 sig:=jsonb_build_object('operation','terms','input',input);
 opened:=customer_private.terms_open(command,'terms',target,programme,true,sig);
 IF opened.replay IS NOT NULL THEN RETURN customer_private.terms_replayed(opened.replay,command,target,programme); END IF;
 inc:=customer_private.coordination_text(input->'included',11,1000,true);
 exc:=customer_private.coordination_text(input->'excluded',11,1000,false);
 canc:=customer_private.coordination_text(input->'cancellationTerms',11,1000,true);
 chg:=customer_private.coordination_text(input->'changeTerms',11,1000,true);
 fee:=customer_private.coordination_text(input->'feeNote',11,500,false);
 why:=customer_private.coordination_text(input->'reason',11,300,true);
 IF NOT fees AND fee IS NOT NULL THEN RAISE EXCEPTION 'A fee note needs fees to apply' USING ERRCODE='23514'; END IF;
 SELECT * INTO latest FROM customer_private.programme_terms_revision t WHERE t.programme_id=programme ORDER BY t.version DESC LIMIT 1;
 cur:=coalesce(latest.version,0);
 IF cur<>expected THEN RAISE EXCEPTION 'Terms changed; reload before editing' USING ERRCODE='23514'; END IF;
 IF FOUND AND latest.included=inc AND latest.excluded IS NOT DISTINCT FROM exc AND latest.cancellation_terms=canc AND latest.change_terms=chg AND latest.fees_apply=fees AND latest.fee_note IS NOT DISTINCT FROM fee THEN
  RAISE EXCEPTION 'Nothing changed in the terms' USING ERRCODE='23514';
 END IF;
 INSERT INTO customer_private.programme_terms_revision(programme_id,workspace_id,version,included,excluded,cancellation_terms,change_terms,fees_apply,fee_note,reason,set_by)
 VALUES(programme,target,cur+1,inc,exc,canc,chg,fees,fee,why,opened.actor);
 result:=jsonb_build_object('terms',customer_private.terms_json(programme,cur+1));
 PERFORM customer_private.terms_event(target,opened.actor,command,programme,'terms_published',programme);
 RETURN customer_private.terms_close(command,'terms',target,programme,opened.actor,sig,result);
END $$;

CREATE FUNCTION customer.programme_eligibility_set(command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target uuid;programme uuid;opened record;sig jsonb;cur integer;expected integer;roles text[];secs text[];ctry text[];sizes text[];minf integer;why text;latest customer_private.programme_eligibility_revision;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' OR input-ARRAY['workspaceId','programmeId','expectedVersion','roles','sectors','countries','sizeBands','minProfileFields','reason']<>'{}'::jsonb
  OR NOT(input ?& ARRAY['workspaceId','programmeId','expectedVersion','roles','sectors','countries','sizeBands','minProfileFields','reason'])
  OR jsonb_typeof(input->'workspaceId')<>'string' OR jsonb_typeof(input->'programmeId')<>'string' OR jsonb_typeof(input->'expectedVersion')<>'number' OR (input->>'expectedVersion') !~ '^[0-9]{1,6}$'
  OR jsonb_typeof(input->'minProfileFields')<>'number' OR (input->>'minProfileFields') !~ '^[0-7]$' THEN RAISE EXCEPTION 'Invalid eligibility criteria' USING ERRCODE='23514'; END IF;
 target:=(input->>'workspaceId')::uuid;programme:=(input->>'programmeId')::uuid;expected:=(input->>'expectedVersion')::integer;minf:=(input->>'minProfileFields')::integer;
 sig:=jsonb_build_object('operation','eligibility','input',input);
 opened:=customer_private.terms_open(command,'eligibility',target,programme,true,sig);
 IF opened.replay IS NOT NULL THEN RETURN customer_private.terms_replayed(opened.replay,command,target,programme); END IF;
 roles:=customer_private.terms_string_array(input->'roles',6,3,20);
 secs:=customer_private.terms_string_array(input->'sectors',10,2,60);
 ctry:=customer_private.terms_string_array(input->'countries',30,2,20);
 sizes:=customer_private.terms_string_array(input->'sizeBands',5,3,10);
 IF EXISTS(SELECT FROM unnest(roles) r WHERE r NOT IN ('BUYER','SELLER','SUPPLIER','MANUFACTURER','DISTRIBUTOR','ORGANISER'))
  OR EXISTS(SELECT FROM unnest(sizes) s WHERE s NOT IN ('1-10','11-50','51-200','201-1000','1000+'))
  OR EXISTS(SELECT FROM unnest(ctry) c WHERE NOT EXISTS(SELECT FROM app.market_scope m WHERE m.key=c AND m.kind='COUNTRY')) THEN
  RAISE EXCEPTION 'Invalid eligibility criteria' USING ERRCODE='23514';
 END IF;
 why:=customer_private.coordination_text(input->'reason',11,300,true);
 SELECT * INTO latest FROM customer_private.programme_eligibility_revision e WHERE e.programme_id=programme ORDER BY e.version DESC LIMIT 1;
 cur:=coalesce(latest.version,0);
 IF cur<>expected THEN RAISE EXCEPTION 'Criteria changed; reload before editing' USING ERRCODE='23514'; END IF;
 IF FOUND AND latest.allowed_roles=roles AND latest.sectors=secs AND latest.countries=ctry AND latest.size_bands=sizes AND latest.min_profile_fields=minf THEN
  RAISE EXCEPTION 'Nothing changed in the criteria' USING ERRCODE='23514';
 END IF;
 INSERT INTO customer_private.programme_eligibility_revision(programme_id,workspace_id,version,allowed_roles,sectors,countries,size_bands,min_profile_fields,reason,set_by)
 VALUES(programme,target,cur+1,roles,secs,ctry,sizes,minf,why,opened.actor);
 result:=jsonb_build_object('eligibility',customer_private.eligibility_json(programme,cur+1));
 PERFORM customer_private.terms_event(target,opened.actor,command,programme,'eligibility_set',programme);
 RETURN customer_private.terms_close(command,'eligibility',target,programme,opened.actor,sig,result);
END $$;

-- Minimum, maximum and waiting list in one change. The maximum is the existing capacity record.
CREATE FUNCTION customer.programme_places_set(command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target uuid;programme uuid;opened record;sig jsonb;cur integer;expected integer;mn integer;mx integer;wl boolean;why text;latest customer_private.programme_places_revision;
 cap integer;capv integer;moved integer;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' OR input-ARRAY['workspaceId','programmeId','expectedVersion','minimum','maximum','waitlist','reason']<>'{}'::jsonb
  OR NOT(input ?& ARRAY['workspaceId','programmeId','expectedVersion','minimum','maximum','waitlist','reason'])
  OR jsonb_typeof(input->'workspaceId')<>'string' OR jsonb_typeof(input->'programmeId')<>'string' OR jsonb_typeof(input->'expectedVersion')<>'number' OR (input->>'expectedVersion') !~ '^[0-9]{1,6}$'
  OR jsonb_typeof(input->'minimum')<>'number' OR (input->>'minimum') !~ '^[1-9][0-9]{0,4}$' OR jsonb_typeof(input->'maximum')<>'number' OR (input->>'maximum') !~ '^[1-9][0-9]{0,4}$'
  OR jsonb_typeof(input->'waitlist')<>'boolean' THEN RAISE EXCEPTION 'Invalid places' USING ERRCODE='23514'; END IF;
 target:=(input->>'workspaceId')::uuid;programme:=(input->>'programmeId')::uuid;expected:=(input->>'expectedVersion')::integer;
 mn:=(input->>'minimum')::integer;mx:=(input->>'maximum')::integer;wl:=(input->>'waitlist')::boolean;
 IF mx>10000 OR mn>mx THEN RAISE EXCEPTION 'The minimum cannot be more than the maximum' USING ERRCODE='23514'; END IF;
 sig:=jsonb_build_object('operation','places','input',input);
 opened:=customer_private.terms_open(command,'places',target,programme,true,sig);
 IF opened.replay IS NOT NULL THEN RETURN customer_private.terms_replayed(opened.replay,command,target,programme); END IF;
 why:=customer_private.coordination_text(input->'reason',11,300,true);
 SELECT * INTO latest FROM customer_private.programme_places_revision r WHERE r.programme_id=programme ORDER BY r.version DESC LIMIT 1;
 cur:=coalesce(latest.version,0);
 IF cur<>expected THEN RAISE EXCEPTION 'Places changed; reload before editing' USING ERRCODE='23514'; END IF;
 cap:=customer_private.terms_maximum(programme);
 IF FOUND AND latest.minimum_participants=mn AND latest.waitlist=wl AND cap IS NOT DISTINCT FROM mx THEN RAISE EXCEPTION 'Nothing changed in the places' USING ERRCODE='23514'; END IF;
 IF mx<customer_private.terms_taken(programme) THEN RAISE EXCEPTION 'Fewer places than the people already placed' USING ERRCODE='23514'; END IF;
 IF cap IS DISTINCT FROM mx THEN
  SELECT coalesce(max(c.version),0) INTO capv FROM customer_private.programme_capacity_revision c WHERE c.programme_id=programme;
  INSERT INTO customer_private.programme_capacity_revision(programme_id,workspace_id,version,capacity,reason,set_by) VALUES(programme,target,capv+1,mx,why,opened.actor);
 END IF;
 INSERT INTO customer_private.programme_places_revision(programme_id,workspace_id,version,minimum_participants,waitlist,reason,set_by) VALUES(programme,target,cur+1,mn,wl,why,opened.actor);
 PERFORM customer_private.terms_event(target,opened.actor,command,programme,'places_set',programme);
 moved:=customer_private.terms_reconcile(target,programme,opened.actor,command);
 result:=jsonb_build_object('version',cur+1,'minimum',mn,'maximum',mx,'waitlist',wl,'promoted',moved);
 RETURN customer_private.terms_close(command,'places',target,programme,opened.actor,sig,result);
END $$;

-- Fills free places from the waiting list in order. Needed when a registration ended outside this module.
CREATE FUNCTION customer.programme_places_refresh(command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target uuid;programme uuid;opened record;sig jsonb;moved integer;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' OR input-ARRAY['workspaceId','programmeId']<>'{}'::jsonb OR NOT(input ?& ARRAY['workspaceId','programmeId'])
  OR jsonb_typeof(input->'workspaceId')<>'string' OR jsonb_typeof(input->'programmeId')<>'string' THEN RAISE EXCEPTION 'Invalid places refresh' USING ERRCODE='23514'; END IF;
 target:=(input->>'workspaceId')::uuid;programme:=(input->>'programmeId')::uuid;
 sig:=jsonb_build_object('operation','refresh','input',input);
 opened:=customer_private.terms_open(command,'refresh',target,programme,true,sig);
 IF opened.replay IS NOT NULL THEN RETURN customer_private.terms_replayed(opened.replay,command,target,programme); END IF;
 moved:=customer_private.terms_reconcile(target,programme,opened.actor,command);
 RETURN customer_private.terms_close(command,'refresh',target,programme,opened.actor,sig,jsonb_build_object('promoted',moved));
END $$;

-- Gives a task to a current workspace member and says whether accepted participants can read its title and due date.
CREATE FUNCTION customer.programme_task_assign(command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target uuid;programme uuid;opened record;sig jsonb;tid uuid;expected integer;cur integer;who uuid;visible boolean;latest customer_private.programme_task_plan_revision;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' OR input-ARRAY['workspaceId','programmeId','taskId','expectedVersion','assigneeKey','participantVisible']<>'{}'::jsonb
  OR NOT(input ?& ARRAY['workspaceId','programmeId','taskId','expectedVersion','assigneeKey','participantVisible'])
  OR jsonb_typeof(input->'workspaceId')<>'string' OR jsonb_typeof(input->'programmeId')<>'string' OR jsonb_typeof(input->'taskId')<>'string'
  OR jsonb_typeof(input->'expectedVersion')<>'number' OR (input->>'expectedVersion') !~ '^[0-9]{1,6}$' OR jsonb_typeof(input->'assigneeKey') NOT IN ('string','null')
  OR jsonb_typeof(input->'participantVisible')<>'boolean' THEN RAISE EXCEPTION 'Invalid task owner' USING ERRCODE='23514'; END IF;
 target:=(input->>'workspaceId')::uuid;programme:=(input->>'programmeId')::uuid;tid:=(input->>'taskId')::uuid;expected:=(input->>'expectedVersion')::integer;visible:=(input->>'participantVisible')::boolean;
 sig:=jsonb_build_object('operation','assign','input',input);
 opened:=customer_private.terms_open(command,'assign',target,programme,true,sig);
 IF opened.replay IS NOT NULL THEN RETURN customer_private.terms_replayed(opened.replay,command,target,programme); END IF;
 IF NOT EXISTS(SELECT FROM customer_private.programme_task t WHERE t.id=tid AND t.workspace_id=target AND t.programme_id=programme) THEN RAISE EXCEPTION 'Task unavailable' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(input->'assigneeKey')='string' THEN
  SELECT d.principal_id INTO who FROM customer_private.terms_directory(target) d WHERE d.key=(input->>'assigneeKey')::uuid;
  IF who IS NULL THEN RAISE EXCEPTION 'Workspace member unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT * INTO latest FROM customer_private.programme_task_plan_revision x WHERE x.task_id=tid ORDER BY x.version DESC LIMIT 1;
 cur:=coalesce(latest.version,0);
 IF cur<>expected THEN RAISE EXCEPTION 'Task owner changed; reload before editing' USING ERRCODE='23514'; END IF;
 IF FOUND AND latest.assignee_principal IS NOT DISTINCT FROM who AND latest.participant_visible=visible THEN RAISE EXCEPTION 'Nothing changed for this task' USING ERRCODE='23514'; END IF;
 IF NOT FOUND AND who IS NULL AND NOT visible THEN RAISE EXCEPTION 'Nothing changed for this task' USING ERRCODE='23514'; END IF;
 INSERT INTO customer_private.programme_task_plan_revision(task_id,workspace_id,programme_id,version,assignee_principal,participant_visible,set_by) VALUES(tid,target,programme,cur+1,who,visible,opened.actor);
 result:=jsonb_build_object('taskId',tid,'planVersion',cur+1,'participantVisible',visible,'assigned',who IS NOT NULL);
 PERFORM customer_private.terms_event(target,opened.actor,command,programme,'task_assigned',tid);
 RETURN customer_private.terms_close(command,'assign',target,programme,opened.actor,sig,result);
END $$;

-- The assignee marks their own task done. It writes the next revision of the existing task record.
CREATE FUNCTION customer.programme_task_done(command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target uuid;programme uuid;opened record;sig jsonb;tid uuid;expected integer;cur customer_private.programme_task_revision;plan customer_private.programme_task_plan_revision;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' OR input-ARRAY['workspaceId','programmeId','taskId','expectedVersion']<>'{}'::jsonb OR NOT(input ?& ARRAY['workspaceId','programmeId','taskId','expectedVersion'])
  OR jsonb_typeof(input->'workspaceId')<>'string' OR jsonb_typeof(input->'programmeId')<>'string' OR jsonb_typeof(input->'taskId')<>'string'
  OR jsonb_typeof(input->'expectedVersion')<>'number' OR (input->>'expectedVersion') !~ '^[1-9][0-9]{0,5}$' THEN RAISE EXCEPTION 'Invalid task update' USING ERRCODE='23514'; END IF;
 target:=(input->>'workspaceId')::uuid;programme:=(input->>'programmeId')::uuid;tid:=(input->>'taskId')::uuid;expected:=(input->>'expectedVersion')::integer;
 sig:=jsonb_build_object('operation','task_done','input',input);
 opened:=customer_private.terms_open(command,'task_done',target,programme,false,sig);
 -- Any current member may finish a task given to them; the task still has to name them.
 IF NOT EXISTS(SELECT FROM customer.collaborative_workspaces() w WHERE w.id=target) THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 IF opened.replay IS NOT NULL THEN RETURN customer_private.terms_replayed(opened.replay,command,target,programme); END IF;
 IF NOT EXISTS(SELECT FROM customer_private.programme_task t WHERE t.id=tid AND t.workspace_id=target AND t.programme_id=programme) THEN RAISE EXCEPTION 'Task unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO plan FROM customer_private.programme_task_plan_revision x WHERE x.task_id=tid ORDER BY x.version DESC LIMIT 1;
 IF NOT FOUND OR plan.assignee_principal IS DISTINCT FROM opened.actor THEN RAISE EXCEPTION 'This task is not assigned to you' USING ERRCODE='42501'; END IF;
 SELECT * INTO cur FROM customer_private.programme_task_revision v WHERE v.task_id=tid ORDER BY v.version DESC LIMIT 1;
 IF cur.version<>expected THEN RAISE EXCEPTION 'Task changed; reload before finishing it' USING ERRCODE='23514'; END IF;
 IF cur.status NOT IN ('OPEN','IN_PROGRESS') THEN RAISE EXCEPTION 'This task is already finished' USING ERRCODE='23514'; END IF;
 INSERT INTO customer_private.programme_task_revision(task_id,workspace_id,programme_id,version,title,detail,status,due_on,assignee_label,changed_by)
 VALUES(tid,target,programme,cur.version+1,cur.title,cur.detail,'DONE',cur.due_on,cur.assignee_label,opened.actor);
 result:=jsonb_build_object('taskId',tid,'version',cur.version+1,'status','DONE');
 PERFORM customer_private.coordination_event(target,opened.actor,command,programme,'task_done',tid);
 RETURN customer_private.terms_close(command,'task_done',target,programme,opened.actor,sig,result);
END $$;

-- Organiser: plan versus actual for places, eligibility, terms acceptance and satisfaction. Every figure is computed
-- from this programme's own records; nothing is estimated or verified.
CREATE FUNCTION customer.programme_places_report(target uuid,programme uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;cap integer;rule customer_private.programme_places_revision;tv integer;ev integer;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_places:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 cap:=customer_private.terms_maximum(programme);
 SELECT * INTO rule FROM customer_private.programme_places_revision r WHERE r.programme_id=programme ORDER BY r.version DESC LIMIT 1;
 SELECT coalesce(max(t.version),0) INTO tv FROM customer_private.programme_terms_revision t WHERE t.programme_id=programme;
 SELECT coalesce(max(e.version),0) INTO ev FROM customer_private.programme_eligibility_revision e WHERE e.programme_id=programme;
 WITH regs AS(SELECT r.id,r.display_label FROM customer_private.programme_registration r
   WHERE r.workspace_id=target AND r.programme_id=programme AND customer_private.coordination_registration_state(r.id)='ACTIVE'),
  enr AS(SELECT DISTINCT ON (e.registration_id) e.registration_id,v.status,v.queue_no,v.reasons FROM customer_private.programme_enrolment e
   JOIN customer_private.programme_enrolment_revision v ON v.enrolment_id=e.id WHERE e.programme_id=programme ORDER BY e.registration_id,v.version DESC),
  acc AS(SELECT a.registration_id,max(a.terms_version) latest,bool_or(a.terms_version=tv) current FROM customer_private.programme_terms_acceptance a WHERE a.programme_id=programme GROUP BY a.registration_id),
  rows AS(SELECT g.id,g.display_label,coalesce(en.status,'NOT_APPLIED') st,en.queue_no,coalesce(en.reasons,ARRAY[]::text[]) reasons,a.latest accepted_version,coalesce(a.current,false) accepted_current,
   CASE WHEN en.status='WAITLISTED' THEN row_number() OVER (PARTITION BY en.status ORDER BY en.queue_no) END position
   FROM regs g LEFT JOIN enr en ON en.registration_id=g.id LEFT JOIN acc a ON a.registration_id=g.id),
  latest AS(SELECT DISTINCT ON (v.record_id) r.registration_id,r.kind,v.shared,v.retracted,v.rating,v.outcome_kind FROM customer_private.programme_participant_record r
   JOIN customer_private.programme_participant_record_revision v ON v.record_id=r.id JOIN regs g ON g.id=r.registration_id WHERE r.programme_id=programme ORDER BY v.record_id,v.version DESC),
  fb AS(SELECT registration_id,shared,rating FROM latest WHERE kind='FEEDBACK' AND NOT retracted),
  oc AS(SELECT registration_id,outcome_kind FROM latest WHERE kind='OUTCOME' AND shared AND NOT retracted),
  n AS(SELECT count(*)::integer registered,count(*) FILTER(WHERE st='NOT_APPLIED')::integer not_applied,count(*) FILTER(WHERE st='PLACED')::integer placed,
   count(*) FILTER(WHERE st='WAITLISTED')::integer waiting,count(*) FILTER(WHERE st='NOT_ELIGIBLE')::integer not_eligible,count(*) FILTER(WHERE st='CANCELLED')::integer cancelled,
   count(*) FILTER(WHERE accepted_current)::integer accepted_now,
   count(*) FILTER(WHERE st IN ('PLACED','WAITLISTED') AND NOT accepted_current AND tv>0)::integer pending FROM rows)
 SELECT jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.coordination_expiry(),'asOf',to_char(current_date,'YYYY-MM-DD'),'verified',false,'sendsMessages',false,
  'places',jsonb_build_object('version',coalesce(rule.version,0),'minimum',rule.minimum_participants,'maximum',cap,'waitlist',coalesce(rule.waitlist,false),
   'placed',n.placed,'free',CASE WHEN cap IS NULL THEN NULL ELSE greatest(cap-n.placed,0) END,
   'fillPermille',CASE WHEN cap IS NOT NULL THEN round(1000.0*n.placed/cap)::integer END,
   'minimumMet',CASE WHEN rule.minimum_participants IS NOT NULL THEN n.placed>=rule.minimum_participants END,
   'waiting',n.waiting,'promotable',CASE WHEN cap IS NULL THEN n.waiting ELSE least(n.waiting,greatest(cap-n.placed,0)) END,'provenance','ORGANISER_RECORDED'),
  'funnel',jsonb_build_object('registered',n.registered,'notApplied',n.not_applied,'placed',n.placed,'waitlisted',n.waiting,'notEligible',n.not_eligible,'cancelled',n.cancelled),
  'eligibility',jsonb_build_object('version',ev,'notEligibleByReason',coalesce((SELECT jsonb_object_agg(x.code,x.cnt) FROM (SELECT c code,count(*)::integer cnt FROM rows,unnest(rows.reasons) c WHERE rows.st='NOT_ELIGIBLE' GROUP BY c) x),'{}'::jsonb)),
  'terms',jsonb_build_object('version',tv,'acceptedCurrent',n.accepted_now,'pendingAcceptance',n.pending,
   'acceptanceRatePermille',CASE WHEN tv>0 AND n.registered>0 THEN round(1000.0*n.accepted_now/n.registered)::integer END,'provenance','PARTICIPANT_REPORTED'),
  'satisfaction',jsonb_build_object('responses',(SELECT count(*)::integer FROM fb),'ratingCount',(SELECT count(*)::integer FROM fb WHERE shared),
   'ratingSum',coalesce((SELECT sum(rating)::integer FROM fb WHERE shared),0),'notShared',(SELECT count(*)::integer FROM fb WHERE NOT shared),
   'responsesFromPlaced',(SELECT count(*)::integer FROM fb JOIN rows ON rows.id=fb.registration_id WHERE rows.st='PLACED'),'provenance','PARTICIPANT_REPORTED'),
  'outcomes',jsonb_build_object('shared',(SELECT count(*)::integer FROM oc),'participantsWithOutcome',(SELECT count(DISTINCT registration_id)::integer FROM oc),
   'byKind',coalesce((SELECT jsonb_object_agg(k.outcome_kind,k.cnt) FROM (SELECT outcome_kind,count(*)::integer cnt FROM oc GROUP BY outcome_kind) k),'{}'::jsonb),'provenance','PARTICIPANT_REPORTED'),
  'rosterTruncated',n.registered>500,
  'roster',coalesce((SELECT jsonb_agg(jsonb_build_object('registrationId',s.id,'label',s.display_label,'status',s.st,'position',s.position,'reasons',to_jsonb(s.reasons),
    'termsAcceptedVersion',s.accepted_version,'termsCurrent',s.accepted_current) ORDER BY s.display_label,s.id) FROM (SELECT * FROM rows ORDER BY display_label,id LIMIT 500) s),'[]'::jsonb))
 INTO result FROM n;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;

-- Participant: apply for a place (eligibility, terms and places checked together), accept newer terms, or give a place up.
CREATE FUNCTION customer.programme_enrolment_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reg customer_private.programme_registration;opened record;sig jsonb;actor uuid;enr customer_private.programme_enrolment;head customer_private.programme_enrolment_revision;
 crit customer_private.programme_eligibility_revision;rule customer_private.programme_places_revision;tv integer;asked integer;profile_ws uuid;d jsonb;reasons text[]:=ARRAY[]::text[];
 restricted boolean:=false;cap integer;st text;qno integer;moved integer:=0;result jsonb;rid uuid;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' OR operation IS NULL OR operation NOT IN ('apply','accept_terms','cancel') THEN RAISE EXCEPTION 'Invalid place request' USING ERRCODE='23514'; END IF;
 IF input->'acknowledged' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'registrationId')<>'string' THEN RAISE EXCEPTION 'Explicit acknowledgement required' USING ERRCODE='23514'; END IF;
 IF operation='apply' AND (input-ARRAY['registrationId','termsVersion','profileWorkspaceId','acknowledged']<>'{}'::jsonb OR NOT(input ?& ARRAY['registrationId','termsVersion','profileWorkspaceId','acknowledged'])
  OR jsonb_typeof(input->'termsVersion') NOT IN ('number','null') OR (jsonb_typeof(input->'termsVersion')='number' AND (input->>'termsVersion') !~ '^[1-9][0-9]{0,5}$')
  OR jsonb_typeof(input->'profileWorkspaceId') NOT IN ('string','null')) THEN RAISE EXCEPTION 'Invalid place request' USING ERRCODE='23514'; END IF;
 IF operation='accept_terms' AND (input-ARRAY['registrationId','termsVersion','acknowledged']<>'{}'::jsonb OR NOT(input ?& ARRAY['registrationId','termsVersion','acknowledged'])
  OR jsonb_typeof(input->'termsVersion')<>'number' OR (input->>'termsVersion') !~ '^[1-9][0-9]{0,5}$') THEN RAISE EXCEPTION 'Invalid place request' USING ERRCODE='23514'; END IF;
 IF operation='cancel' AND (input-ARRAY['registrationId','acknowledged']<>'{}'::jsonb OR NOT(input ?& ARRAY['registrationId','acknowledged'])) THEN RAISE EXCEPTION 'Invalid place request' USING ERRCODE='23514'; END IF;
 SELECT * INTO reg FROM customer_private.programme_registration r WHERE r.id=(input->>'registrationId')::uuid AND r.principal_id=customer.actor_id();
 IF NOT FOUND THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
 sig:=jsonb_build_object('operation',operation,'input',input);
 opened:=customer_private.terms_open(command,operation,reg.workspace_id,reg.programme_id,false,sig);
 actor:=opened.actor;
 IF reg.principal_id<>actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 IF opened.replay IS NOT NULL THEN RETURN customer_private.terms_replayed(opened.replay,command,reg.workspace_id,reg.programme_id); END IF;
 IF customer_private.coordination_registration_state(reg.id)<>'ACTIVE' THEN RAISE EXCEPTION 'Only an active registration can use places' USING ERRCODE='23514'; END IF;
 SELECT coalesce(max(t.version),0) INTO tv FROM customer_private.programme_terms_revision t WHERE t.programme_id=reg.programme_id;
 SELECT * INTO enr FROM customer_private.programme_enrolment e WHERE e.registration_id=reg.id;
 IF FOUND THEN SELECT * INTO head FROM customer_private.programme_enrolment_revision v WHERE v.enrolment_id=enr.id ORDER BY v.version DESC LIMIT 1; END IF;
 IF operation='apply' THEN
  -- Waiting people move up first, so a new applicant can never jump the queue.
  moved:=customer_private.terms_reconcile(reg.workspace_id,reg.programme_id,actor,command);
  IF head.status IN ('PLACED','WAITLISTED') THEN RAISE EXCEPTION 'You already have a place or are on the waiting list' USING ERRCODE='23514'; END IF;
  asked:=CASE WHEN jsonb_typeof(input->'termsVersion')='number' THEN (input->>'termsVersion')::integer END;
  IF tv>0 AND asked IS DISTINCT FROM tv THEN RAISE EXCEPTION 'The terms changed; review and accept the latest version' USING ERRCODE='23514'; END IF;
  IF tv=0 AND asked IS NOT NULL THEN RAISE EXCEPTION 'There are no terms to accept' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(input->'profileWorkspaceId')='string' THEN
   profile_ws:=(input->>'profileWorkspaceId')::uuid;
   IF customer_private.organisation_profile_role(profile_ws,actor) IS NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
  END IF;
  SELECT * INTO crit FROM customer_private.programme_eligibility_revision e WHERE e.programme_id=reg.programme_id ORDER BY e.version DESC LIMIT 1;
  restricted:=FOUND AND (cardinality(crit.allowed_roles)>0 OR cardinality(crit.sectors)>0 OR cardinality(crit.countries)>0 OR cardinality(crit.size_bands)>0 OR crit.min_profile_fields>0);
  IF restricted THEN
   IF profile_ws IS NOT NULL THEN SELECT p.details INTO d FROM customer_private.organisation_profile_revision p WHERE p.tenant_id=profile_ws ORDER BY p.version DESC LIMIT 1; END IF;
   reasons:=customer_private.terms_eligibility_reasons(crit,d);
  ELSE profile_ws:=NULL; END IF;
  IF enr.id IS NULL THEN
   INSERT INTO customer_private.programme_enrolment(workspace_id,programme_id,registration_id) VALUES(reg.workspace_id,reg.programme_id,reg.id) RETURNING * INTO enr;
  END IF;
  IF cardinality(reasons)>0 THEN
   INSERT INTO customer_private.programme_enrolment_revision(enrolment_id,workspace_id,programme_id,registration_id,version,status,eligibility_version,reasons,profile_workspace_id,cause,changed_by)
   VALUES(enr.id,reg.workspace_id,reg.programme_id,reg.id,coalesce(head.version,0)+1,'NOT_ELIGIBLE',crit.version,reasons,profile_ws,'APPLIED',actor);
   st:='NOT_ELIGIBLE';
  ELSE
   cap:=customer_private.terms_maximum(reg.programme_id);
   SELECT * INTO rule FROM customer_private.programme_places_revision r WHERE r.programme_id=reg.programme_id ORDER BY r.version DESC LIMIT 1;
   IF cap IS NULL OR customer_private.terms_taken(reg.programme_id)<cap THEN st:='PLACED';
   ELSIF rule.waitlist IS TRUE THEN
    st:='WAITLISTED';
    SELECT coalesce(max(v.queue_no),0)+1 INTO qno FROM customer_private.programme_enrolment_revision v WHERE v.programme_id=reg.programme_id;
   ELSE RAISE EXCEPTION 'This programme is full' USING ERRCODE='23514'; END IF;
   IF tv>0 AND NOT EXISTS(SELECT FROM customer_private.programme_terms_acceptance a WHERE a.registration_id=reg.id AND a.terms_version=tv) THEN
    INSERT INTO customer_private.programme_terms_acceptance(registration_id,workspace_id,programme_id,terms_version,accepted_by) VALUES(reg.id,reg.workspace_id,reg.programme_id,tv,actor);
   END IF;
   INSERT INTO customer_private.programme_enrolment_revision(enrolment_id,workspace_id,programme_id,registration_id,version,status,queue_no,eligibility_version,terms_version,reasons,profile_workspace_id,cause,changed_by)
   VALUES(enr.id,reg.workspace_id,reg.programme_id,reg.id,coalesce(head.version,0)+1,st,qno,CASE WHEN restricted THEN crit.version END,CASE WHEN tv>0 THEN tv END,ARRAY[]::text[],profile_ws,'APPLIED',actor);
  END IF;
  PERFORM customer_private.terms_event(reg.workspace_id,actor,command,reg.programme_id,'enrolment_applied',enr.id);
  result:=jsonb_build_object('registrationId',reg.id,'status',st,'position',customer_private.terms_queue_position(enr.id),'reasons',to_jsonb(reasons),'termsVersion',CASE WHEN tv>0 AND cardinality(reasons)=0 THEN tv END,'promoted',moved);
 ELSIF operation='accept_terms' THEN
  asked:=(input->>'termsVersion')::integer;
  IF enr.id IS NULL OR head.status NOT IN ('PLACED','WAITLISTED') THEN RAISE EXCEPTION 'Apply for a place first' USING ERRCODE='23514'; END IF;
  IF tv=0 OR asked<>tv THEN RAISE EXCEPTION 'The terms changed; review and accept the latest version' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT FROM customer_private.programme_terms_acceptance a WHERE a.registration_id=reg.id AND a.terms_version=tv) THEN
   INSERT INTO customer_private.programme_terms_acceptance(registration_id,workspace_id,programme_id,terms_version,accepted_by) VALUES(reg.id,reg.workspace_id,reg.programme_id,tv,actor);
   PERFORM customer_private.terms_event(reg.workspace_id,actor,command,reg.programme_id,'terms_accepted',reg.id);
  END IF;
  result:=jsonb_build_object('registrationId',reg.id,'status',head.status,'position',customer_private.terms_queue_position(enr.id),'termsVersion',tv);
 ELSE
  IF enr.id IS NULL OR head.status NOT IN ('PLACED','WAITLISTED') THEN RAISE EXCEPTION 'There is no place to give up' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.programme_enrolment_revision(enrolment_id,workspace_id,programme_id,registration_id,version,status,eligibility_version,terms_version,reasons,profile_workspace_id,cause,changed_by)
  VALUES(enr.id,reg.workspace_id,reg.programme_id,reg.id,head.version+1,'CANCELLED',head.eligibility_version,head.terms_version,ARRAY[]::text[],head.profile_workspace_id,'CANCELLED_BY_PARTICIPANT',actor);
  PERFORM customer_private.terms_event(reg.workspace_id,actor,command,reg.programme_id,'enrolment_cancelled',enr.id);
  moved:=customer_private.terms_reconcile(reg.workspace_id,reg.programme_id,actor,command);
  result:=jsonb_build_object('registrationId',reg.id,'status','CANCELLED','position',NULL,'promoted',moved);
 END IF;
 RETURN customer_private.terms_close(command,operation,reg.workspace_id,reg.programme_id,actor,sig,result);
END $$;

-- Participant: the terms, the criteria, their own standing and, once placed, the tasks the organiser chose to show.
CREATE FUNCTION customer.own_programme_place(registration uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 SELECT p.name INTO name FROM app.delivery_programme p WHERE p.tenant_id=reg.workspace_id AND p.id=reg.programme_id;
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
END $$;

-- In-app reminders for the signed-in person only. The date window is fixed: overdue is before today, due soon is today and the next three days.
CREATE FUNCTION customer.my_programme_reminders(as_of date DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();today date;assigned jsonb;shared jsonb;terms jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 today:=coalesce(as_of,current_date);
 IF today NOT BETWEEN DATE '2000-01-01' AND DATE '2100-01-01' THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('workspaceId',x.workspace_id,'programmeId',x.programme_id,'programmeName',x.programme_name,'taskId',x.id,'version',x.version,
  'title',x.title,'dueOn',to_char(x.due_on,'YYYY-MM-DD'),'state',x.state) ORDER BY x.due_on,x.programme_name,x.seq),'[]'::jsonb) INTO assigned
 FROM (SELECT t.id,t.workspace_id,t.programme_id,t.seq,p.name programme_name,v.version,v.title,v.due_on,CASE WHEN v.due_on<today THEN 'OVERDUE' ELSE 'DUE_SOON' END state
  FROM customer.collaborative_workspaces() w JOIN customer_private.programme_task t ON t.workspace_id=w.id
  JOIN app.delivery_programme p ON p.tenant_id=t.workspace_id AND p.id=t.programme_id
  JOIN LATERAL(SELECT * FROM customer_private.programme_task_plan_revision x WHERE x.task_id=t.id ORDER BY x.version DESC LIMIT 1) pl ON pl.assignee_principal=actor
  JOIN LATERAL(SELECT * FROM customer_private.programme_task_revision r WHERE r.task_id=t.id ORDER BY r.version DESC LIMIT 1) v ON v.status IN ('OPEN','IN_PROGRESS') AND v.due_on IS NOT NULL AND v.due_on<=today+3
  ORDER BY v.due_on,p.name,t.seq LIMIT 100) x;
 SELECT coalesce(jsonb_agg(jsonb_build_object('registrationId',x.registration_id,'programmeName',x.programme_name,'title',x.title,'dueOn',to_char(x.due_on,'YYYY-MM-DD'),'state',x.state) ORDER BY x.due_on,x.programme_name,x.seq),'[]'::jsonb) INTO shared
 FROM (SELECT g.id registration_id,t.seq,p.name programme_name,v.title,v.due_on,CASE WHEN v.due_on<today THEN 'OVERDUE' ELSE 'DUE_SOON' END state
  FROM customer_private.programme_registration g JOIN customer_private.programme_enrolment e ON e.registration_id=g.id
  JOIN app.delivery_programme p ON p.tenant_id=g.workspace_id AND p.id=g.programme_id
  JOIN customer_private.programme_task t ON t.workspace_id=g.workspace_id AND t.programme_id=g.programme_id
  JOIN LATERAL(SELECT * FROM customer_private.programme_task_plan_revision x WHERE x.task_id=t.id ORDER BY x.version DESC LIMIT 1) pl ON pl.participant_visible
  JOIN LATERAL(SELECT * FROM customer_private.programme_task_revision r WHERE r.task_id=t.id ORDER BY r.version DESC LIMIT 1) v ON v.status IN ('OPEN','IN_PROGRESS') AND v.due_on IS NOT NULL AND v.due_on<=today+3
  WHERE g.principal_id=actor AND customer_private.coordination_registration_state(g.id)='ACTIVE'
  AND (SELECT r.status FROM customer_private.programme_enrolment_revision r WHERE r.enrolment_id=e.id ORDER BY r.version DESC LIMIT 1)='PLACED'
  ORDER BY v.due_on,p.name,t.seq LIMIT 100) x;
 SELECT coalesce(jsonb_agg(jsonb_build_object('registrationId',x.registration_id,'programmeName',x.programme_name,'version',x.tv) ORDER BY x.programme_name,x.registration_id),'[]'::jsonb) INTO terms
 FROM (SELECT g.id registration_id,p.name programme_name,(SELECT max(t.version) FROM customer_private.programme_terms_revision t WHERE t.programme_id=g.programme_id) tv
  FROM customer_private.programme_registration g JOIN customer_private.programme_enrolment e ON e.registration_id=g.id
  JOIN app.delivery_programme p ON p.tenant_id=g.workspace_id AND p.id=g.programme_id
  WHERE g.principal_id=actor AND customer_private.coordination_registration_state(g.id)='ACTIVE'
  AND (SELECT r.status FROM customer_private.programme_enrolment_revision r WHERE r.enrolment_id=e.id ORDER BY r.version DESC LIMIT 1) IN ('PLACED','WAITLISTED')) x
 WHERE x.tv IS NOT NULL AND NOT EXISTS(SELECT FROM customer_private.programme_terms_acceptance a WHERE a.registration_id=x.registration_id AND a.terms_version=x.tv);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('asOf',to_char(today,'YYYY-MM-DD'),'windowDays',3,'expiresAt',customer_private.coordination_expiry(),'sendsMessages',false,
  'assignedToYou',assigned,'forParticipant',shared,'termsToAccept',terms);
END $$;

REVOKE ALL ON FUNCTION customer_private.terms_maximum(uuid),customer_private.terms_taken(uuid,uuid),customer_private.terms_enrolment_guard(),customer_private.terms_acceptance_guard(),customer_private.terms_capacity_guard(),
 customer_private.terms_directory(uuid),customer_private.terms_plan_guard(),customer_private.terms_string_array(jsonb,integer,integer,integer),
 customer_private.terms_eligibility_reasons(customer_private.programme_eligibility_revision,jsonb),customer_private.terms_event(uuid,uuid,uuid,uuid,text,uuid),
 customer_private.terms_open(uuid,text,uuid,uuid,boolean,jsonb),customer_private.terms_close(uuid,text,uuid,uuid,uuid,jsonb,jsonb),customer_private.terms_replayed(jsonb,uuid,uuid,uuid),
 customer_private.terms_json(uuid,integer),customer_private.eligibility_json(uuid,integer),customer_private.terms_queue_position(uuid),customer_private.terms_reconcile(uuid,uuid,uuid,uuid)
 FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.programme_terms_state(uuid,uuid),customer.programme_terms_publish(uuid,jsonb),customer.programme_eligibility_set(uuid,jsonb),customer.programme_places_set(uuid,jsonb),
 customer.programme_places_refresh(uuid,jsonb),customer.programme_task_assign(uuid,jsonb),customer.programme_task_done(uuid,jsonb),customer.programme_places_report(uuid,uuid),
 customer.programme_enrolment_command(uuid,text,jsonb),customer.own_programme_place(uuid),customer.my_programme_reminders(date) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.programme_terms_state(uuid,uuid),customer.programme_terms_publish(uuid,jsonb),customer.programme_eligibility_set(uuid,jsonb),customer.programme_places_set(uuid,jsonb),
 customer.programme_places_refresh(uuid,jsonb),customer.programme_task_assign(uuid,jsonb),customer.programme_task_done(uuid,jsonb),customer.programme_places_report(uuid,uuid),
 customer.programme_enrolment_command(uuid,text,jsonb),customer.own_programme_place(uuid),customer.my_programme_reminders(date) TO corridra_runtime;
