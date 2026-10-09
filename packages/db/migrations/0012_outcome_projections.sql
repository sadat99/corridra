CREATE TABLE app.outcome_event (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, id uuid NOT NULL UNIQUE REFERENCES app.domain_event(id), tenant_id uuid NOT NULL, opportunity_id uuid NOT NULL,
 entity_type text NOT NULL CHECK(entity_type IN ('opportunity','commercial_record','accounting_confirmation')), entity_id uuid NOT NULL, schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1), snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'), occurred_at timestamptz NOT NULL,
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES app.opportunity(tenant_id,id)
);
CREATE TABLE app.outcome_projection (
 tenant_id uuid NOT NULL, opportunity_id uuid NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL, projection_version integer NOT NULL DEFAULT 1 CHECK(projection_version=1), event_sequence bigint NOT NULL REFERENCES app.outcome_event(sequence), snapshot jsonb NOT NULL,
 PRIMARY KEY(tenant_id,entity_type,entity_id), FOREIGN KEY(tenant_id,opportunity_id) REFERENCES app.opportunity(tenant_id,id)
);
CREATE FUNCTION app.apply_outcome(e app.outcome_event) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF e.schema_version<>1 THEN RAISE EXCEPTION 'Unsupported outcome event version'; END IF;
 INSERT INTO app.outcome_projection(tenant_id,opportunity_id,entity_type,entity_id,event_sequence,snapshot)
 VALUES(e.tenant_id,e.opportunity_id,e.entity_type,e.entity_id,e.sequence,e.snapshot)
 ON CONFLICT(tenant_id,entity_type,entity_id) DO UPDATE SET event_sequence=excluded.event_sequence,snapshot=excluded.snapshot WHERE app.outcome_projection.event_sequence<excluded.event_sequence;
END $$;
CREATE FUNCTION app.capture_outcome() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE oid uuid; data jsonb; e app.outcome_event;
BEGIN
 IF NEW.aggregate_type='opportunity' THEN
  SELECT id,jsonb_build_object('missionId',mission_id,'meetingId',meeting_id,'targetId',target_id,'status',status,'version',version,'ownerId',owner_id,'dueAt',due_at,'attributionScope',attribution_scope) INTO oid,data FROM app.opportunity WHERE tenant_id=NEW.tenant_id AND id=NEW.aggregate_id::uuid;
 ELSIF NEW.aggregate_type='commercial_record' THEN
  SELECT opportunity_id,jsonb_strip_nulls(jsonb_build_object('kind',kind,'parentId',parent_id,'priorReceiptId',prior_receipt_id,'reverseOf',reverse_of,'sourceId',source_id,'evidenceId',evidence_id,'amountMinor',amount_minor::text,'currency',currency,'occurredAt',occurred_at)) INTO oid,data FROM app.commercial_record WHERE tenant_id=NEW.tenant_id AND id=NEW.aggregate_id::uuid;
 ELSIF NEW.aggregate_type='accounting_confirmation' THEN
  SELECT opportunity_id,jsonb_build_object('recordId',record_id,'sourceId',source_id,'occurredAt',occurred_at) INTO oid,data FROM app.accounting_confirmation WHERE tenant_id=NEW.tenant_id AND id=NEW.aggregate_id::uuid;
 ELSE RETURN NEW;
 END IF;
 IF oid IS NULL OR data IS NULL THEN RAISE EXCEPTION 'Outcome snapshot unavailable'; END IF;
 INSERT INTO app.outcome_event(id,tenant_id,opportunity_id,entity_type,entity_id,snapshot,occurred_at) VALUES(NEW.id,NEW.tenant_id,oid,NEW.aggregate_type,NEW.aggregate_id::uuid,data,NEW.occurred_at) RETURNING * INTO e;
 PERFORM app.apply_outcome(e); RETURN NEW;
END $$;
CREATE TRIGGER commercial_outcome AFTER INSERT ON app.domain_event FOR EACH ROW EXECUTE FUNCTION app.capture_outcome();
CREATE TRIGGER outcome_immutable BEFORE UPDATE OR DELETE ON app.outcome_event FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE app.outcome_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.outcome_projection ENABLE ROW LEVEL SECURITY;
CREATE POLICY outcome_read ON app.outcome_event FOR SELECT TO corridra_runtime USING(tenant_id=(SELECT NULLIF(current_setting('corridra.tenant_id',true),'')::uuid) AND opportunity_id IN (SELECT id FROM app.opportunity));
CREATE POLICY projection_read ON app.outcome_projection FOR SELECT TO corridra_runtime USING(tenant_id=(SELECT NULLIF(current_setting('corridra.tenant_id',true),'')::uuid) AND opportunity_id IN (SELECT id FROM app.opportunity));
GRANT SELECT ON app.outcome_event,app.outcome_projection TO corridra_runtime;
CREATE INDEX outcome_tenant_sequence ON app.outcome_event(tenant_id,sequence);
CREATE INDEX projection_opportunity ON app.outcome_projection(tenant_id,opportunity_id,entity_type);
CREATE FUNCTION app.rebuild_outcomes(t uuid,cid uuid,h text,why text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e app.outcome_event; n integer:=0; old app.commercial_command;
BEGIN
 IF NOT app.commercial_enabled(t) OR app.member_role(t) NOT IN ('owner','admin') OR NOT app.fresh_mfa() THEN RAISE EXCEPTION 'Owner/admin with fresh MFA required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':commercial',0));
 IF h !~ '^[a-f0-9]{64}$' OR length(why) NOT BETWEEN 3 AND 500 OR cid IS NULL OR h IS NULL OR why IS NULL THEN RAISE EXCEPTION 'Valid rebuild command and reason required' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM app.commercial_command WHERE tenant_id=t AND id=cid;
 IF old.id IS NOT NULL THEN
  IF old.action<>'rebuild' OR old.input_hash<>h OR old.created_by IS DISTINCT FROM app.actor_id() THEN RAISE EXCEPTION 'Rebuild command key reused' USING ERRCODE='23505'; END IF;
  RETURN (old.result->>'events')::integer;
 END IF;
 DELETE FROM app.outcome_projection WHERE tenant_id=t;
 FOR e IN SELECT * FROM app.outcome_event WHERE tenant_id=t ORDER BY sequence LOOP
  PERFORM app.apply_outcome(e); n:=n+1;
 END LOOP;
 INSERT INTO app.commercial_command(id,tenant_id,action,input_hash,result,reason,created_by) VALUES(cid,t,'rebuild',h,jsonb_build_object('id',cid,'events',n),why,app.actor_id());
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION app.apply_outcome(app.outcome_event),app.capture_outcome(),app.rebuild_outcomes(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.rebuild_outcomes(uuid,uuid,text,text) TO corridra_runtime;

CREATE OR REPLACE FUNCTION app.guard_mission() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT pg_has_role(current_user,(SELECT relowner FROM pg_class WHERE oid='app.mission'::regclass),'MEMBER') OR NEW.status<>'DRAFT' OR NEW.version<>1 THEN RAISE EXCEPTION 'Ingress required' USING ERRCODE='42501'; END IF;
 ELSE
  IF app.actor_id() IS NULL OR app.member_role(NEW.tenant_id) NOT IN ('owner','admin','operator') THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF (NEW.id,NEW.tenant_id,NEW.created_by,NEW.created_at,NEW.classification,NEW.purpose) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.created_by,OLD.created_at,OLD.classification,OLD.purpose) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Mission identity/version mismatch' USING ERRCODE='23514'; END IF;
  IF NOT (NEW.status=OLD.status OR (OLD.status='DRAFT' AND NEW.status='QUALIFICATION') OR (OLD.status='QUALIFICATION' AND NEW.status='ACTIVE') OR (OLD.status='ACTIVE' AND NEW.status='TARGETING') OR (OLD.status='TARGETING' AND NEW.status='OUTREACH') OR (OLD.status='OUTREACH' AND NEW.status='MEETINGS') OR (OLD.status='MEETINGS' AND NEW.status='FOLLOW_UP') OR (OLD.status='FOLLOW_UP' AND NEW.status='COMMERCIAL_PIPELINE') OR (OLD.status='COMMERCIAL_PIPELINE' AND NEW.status='CLOSED') OR (OLD.status IN ('QUALIFICATION','ACTIVE','TARGETING','OUTREACH','MEETINGS','FOLLOW_UP','COMMERCIAL_PIPELINE') AND NEW.status='ON_HOLD' AND NEW.held_from=OLD.status) OR (OLD.status='ON_HOLD' AND NEW.status=OLD.held_from AND NEW.held_from IS NULL) OR (OLD.status IN ('DRAFT','QUALIFICATION','ACTIVE','TARGETING','OUTREACH','MEETINGS','FOLLOW_UP','COMMERCIAL_PIPELINE','ON_HOLD') AND NEW.status='CANCELLED')) THEN RAISE EXCEPTION 'Invalid mission transition' USING ERRCODE='23514'; END IF;
  IF NEW.status=OLD.status AND NEW.held_from IS DISTINCT FROM OLD.held_from THEN RAISE EXCEPTION 'Hold state mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'ON_HOLD' AND NEW.held_from IS NOT NULL THEN RAISE EXCEPTION 'Unexpected hold state' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Active operator owner required' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.status IN ('QUALIFICATION','ACTIVE','TARGETING','OUTREACH','MEETINGS','FOLLOW_UP','COMMERCIAL_PIPELINE') AND (NOT EXISTS(SELECT FROM app.commercial_intent WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND claim_id IS NOT NULL) OR NOT EXISTS(SELECT FROM app.target_profile WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id) OR NOT EXISTS(SELECT FROM app.mission_market WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND country_code IS NOT NULL)) THEN RAISE EXCEPTION 'Qualification records required' USING ERRCODE='23514'; END IF;
 IF NEW.status='OUTREACH' AND OLD.status='TARGETING' AND NOT EXISTS(SELECT FROM app.communication c JOIN app.target_account t ON t.tenant_id=c.tenant_id AND t.id=c.target_id WHERE c.tenant_id=NEW.tenant_id AND t.mission_id=NEW.id) THEN RAISE EXCEPTION 'Approved introduction required'; END IF;
 IF NEW.status='MEETINGS' AND OLD.status='OUTREACH' AND NOT EXISTS(SELECT FROM app.meeting WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND status IN ('ACCEPTED','SCHEDULED','HELD')) THEN RAISE EXCEPTION 'Accepted meeting required'; END IF;
 IF NEW.status='FOLLOW_UP' AND OLD.status='MEETINGS' AND NOT EXISTS(SELECT FROM app.meeting m JOIN app.follow_up f ON f.tenant_id=m.tenant_id AND f.meeting_id=m.id WHERE m.tenant_id=NEW.tenant_id AND m.mission_id=NEW.id AND m.status='HELD') THEN RAISE EXCEPTION 'Held meeting and owned follow-up required'; END IF;
 IF ((NEW.status='COMMERCIAL_PIPELINE' AND OLD.status='FOLLOW_UP') OR NEW.status='CLOSED') AND NOT app.commercial_enabled(NEW.tenant_id) THEN RAISE EXCEPTION 'Commercial commands are disabled' USING ERRCODE='23514'; END IF;
 IF NEW.status='COMMERCIAL_PIPELINE' AND OLD.status='FOLLOW_UP' AND NOT EXISTS(SELECT FROM app.opportunity WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND status<>'LEAD') THEN RAISE EXCEPTION 'Qualified opportunity required' USING ERRCODE='23514'; END IF;
 IF NEW.status='CLOSED' AND (NOT EXISTS(SELECT FROM app.opportunity WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id) OR EXISTS(SELECT FROM app.opportunity WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND status NOT IN ('LOST','CASH_COLLECTED','RECURRING_REVENUE')) OR EXISTS(SELECT FROM app.commercial_record r JOIN app.opportunity o ON o.tenant_id=r.tenant_id AND o.id=r.opportunity_id WHERE r.tenant_id=NEW.tenant_id AND o.mission_id=NEW.id AND r.kind='CASH_RECEIPT' AND r.reverse_of IS NULL AND NOT EXISTS(SELECT FROM app.accounting_confirmation a WHERE a.tenant_id=r.tenant_id AND a.record_id=r.id) AND NOT EXISTS(SELECT FROM app.commercial_record rv WHERE rv.tenant_id=r.tenant_id AND rv.reverse_of=r.id)) OR EXISTS(SELECT FROM app.follow_up f JOIN app.meeting mt ON mt.tenant_id=f.tenant_id AND mt.id=f.meeting_id WHERE f.tenant_id=NEW.tenant_id AND mt.mission_id=NEW.id AND f.status='OPEN')) THEN RAISE EXCEPTION 'Resolve commercial outcomes and meeting follow-ups before closing' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $$;
