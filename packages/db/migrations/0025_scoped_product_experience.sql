ALTER TABLE app.delivery_link ADD COLUMN include_delegation boolean NOT NULL DEFAULT false CHECK(NOT include_delegation OR audience='INSTITUTION_REPORT');
-- Purpose-scoped extensions to existing programmes, publications and recipient capabilities.
-- No customer/tenant identity mapping, automatic outreach or financial authority is added.
CREATE TABLE app.delivery_programme_context (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, programme_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 details jsonb NOT NULL CHECK(jsonb_typeof(details)='object' AND length(details::text)<6000),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,programme_id,version), FOREIGN KEY(tenant_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TABLE app.delivery_agenda (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, programme_id uuid NOT NULL, item_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 details jsonb NOT NULL CHECK(jsonb_typeof(details)='object' AND length(details::text)<16000),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,programme_id,item_id,version), FOREIGN KEY(tenant_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TABLE app.delivery_experience_publication (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, publication_id uuid NOT NULL, requirement_id uuid,
 target_ids uuid[] NOT NULL CHECK(cardinality(target_ids)<=30), target_snapshots jsonb NOT NULL CHECK(jsonb_typeof(target_snapshots)='array' AND jsonb_array_length(target_snapshots)<=30), quotation_ids uuid[] NOT NULL CHECK(cardinality(quotation_ids)<=30), agenda_item_ids uuid[] NOT NULL CHECK(cardinality(agenda_item_ids)<=100),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000), created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,publication_id), FOREIGN KEY(tenant_id,publication_id) REFERENCES app.delivery_publication(tenant_id,id), FOREIGN KEY(tenant_id,requirement_id) REFERENCES app.mission_requirements(tenant_id,id)
);
CREATE TABLE app.recipient_disclosure (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, link_id uuid NOT NULL, role text NOT NULL CHECK(role IN ('BUYER','SUPPLIER','DISTRIBUTOR','PARTNER')),
 shared_requirements text NOT NULL CHECK(length(shared_requirements) BETWEEN 3 AND 1000), uncertainty text NOT NULL CHECK(length(uncertainty) BETWEEN 3 AND 1000),
 rfq_id uuid, allow_quotation boolean NOT NULL, allow_meeting_interest boolean NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000), created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,link_id), FOREIGN KEY(tenant_id,link_id) REFERENCES app.buyer_link(tenant_id,id), FOREIGN KEY(tenant_id,rfq_id) REFERENCES app.mission_rfq(tenant_id,id),
 CHECK(NOT allow_quotation OR (role='SUPPLIER' AND rfq_id IS NOT NULL))
);
CREATE TABLE app.recipient_detail_response (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, link_id uuid NOT NULL, body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND length(body::text)<8000),
 source_kind text NOT NULL DEFAULT 'SELF_DECLARATION' CHECK(source_kind='SELF_DECLARATION'), retention_until timestamptz NOT NULL CHECK(retention_until>created_at),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,link_id), FOREIGN KEY(tenant_id,link_id) REFERENCES app.buyer_link(tenant_id,id)
);
CREATE TABLE app.delivery_participant_identity (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,participant_id uuid NOT NULL,organisation_id uuid NOT NULL REFERENCES app.organisation(id),source_id uuid NOT NULL,claim_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,participant_id),FOREIGN KEY(tenant_id,participant_id) REFERENCES app.delivery_participant(tenant_id,id),FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id),FOREIGN KEY(tenant_id,claim_id) REFERENCES app.claim(tenant_id,id)
);
CREATE FUNCTION app.experience_source_valid(t uuid,sid uuid,cid uuid,who uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.claim c JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id WHERE c.tenant_id=t AND c.id=cid AND s.id=sid AND s.retention_until>now() AND s.observed_at<=now() AND app.delivery_subject_access(t,who,c.classification,c.purpose) AND app.delivery_subject_access(t,who,s.classification,s.purpose))
$$;
CREATE FUNCTION app.experience_target_valid(t uuid,tid uuid,mid uuid,who uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.target_account a JOIN app.relationship r ON r.tenant_id=a.tenant_id AND r.id=a.relationship_id WHERE a.tenant_id=t AND a.id=tid AND a.mission_id=mid AND app.delivery_subject_access(t,who,a.classification,a.purpose) AND app.delivery_subject_access(t,who,r.classification,r.purpose) AND (r.visibility='TEAM' OR r.owner_id=who OR EXISTS(SELECT FROM app.membership WHERE tenant_id=t AND user_id=who AND role IN ('owner','admin') AND revoked_at IS NULL)))
$$;
CREATE FUNCTION app.experience_assessment_valid(t uuid,aid uuid,who uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT FROM app.assessment_claim ac JOIN app.claim c ON c.tenant_id=ac.tenant_id AND c.id=ac.claim_id JOIN app.organisation_attribute a ON a.tenant_id=ac.tenant_id AND a.id=ac.attribute_id WHERE ac.tenant_id=t AND ac.assessment_id=aid AND (a.valid_until<=now() OR NOT app.experience_source_valid(t,c.source_id,c.id,who)))
$$;
CREATE FUNCTION app.guard_delivery_experience() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.delivery_publication;req app.mission_requirements;q app.mission_quotation;c app.communication;mid uuid;tid uuid;aid uuid;d jsonb;
BEGIN
 IF NEW.created_at<>now() OR NEW.created_by IS DISTINCT FROM app.actor_id() OR NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL','synthetic_validation'),false) OR coalesce(app.member_role(NEW.tenant_id),'') NOT IN ('owner','admin','operator') OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Synthetic actor required' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME IN ('delivery_experience_publication','recipient_disclosure','delivery_participant_identity') AND (app.member_role(NEW.tenant_id) NOT IN ('owner','admin') OR NOT app.fresh_mfa()) THEN RAISE EXCEPTION 'Disclosure requires owner/admin and fresh MFA' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME IN ('delivery_programme_context','delivery_agenda') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':programme:'||NEW.programme_id::text,0));d:=NEW.details;
  IF EXISTS(SELECT FROM jsonb_each(d) j WHERE j.key=ANY(ARRAY['organiser','marketCode','purpose','startsAt','endsAt','timezone','ownerId','reason','label','state','nextAction','dueAt']) AND jsonb_typeof(j.value)<>'string') THEN RAISE EXCEPTION 'Typed delegation text required';END IF;
  IF NOT app.research_owner(NEW.tenant_id,(d->>'ownerId')::uuid) THEN RAISE EXCEPTION 'Active human owner required'; END IF;
  IF TG_TABLE_NAME='delivery_programme_context' THEN
   IF NEW.version<>coalesce((SELECT max(version) FROM app.delivery_programme_context WHERE tenant_id=NEW.tenant_id AND programme_id=NEW.programme_id),0)+1 OR d-ARRAY['organiser','marketCode','purpose','startsAt','endsAt','timezone','ownerId','reason']<>'{}'::jsonb OR NOT(d ?& ARRAY['organiser','marketCode','purpose','startsAt','endsAt','timezone','ownerId','reason']) OR length(d->>'organiser') NOT BETWEEN 3 AND 1000 OR length(d->>'purpose') NOT BETWEEN 3 AND 1000 OR length(d->>'reason') NOT BETWEEN 3 AND 1000 OR NOT EXISTS(SELECT FROM app.market_scope WHERE key=d->>'marketCode' AND kind IN ('COUNTRY','TRADE_BLOC')) OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=d->>'timezone') OR (d->>'endsAt')::timestamptz<=(d->>'startsAt')::timestamptz THEN RAISE EXCEPTION 'Invalid delegation context'; END IF;
  ELSE
   IF NEW.version<>coalesce((SELECT max(version) FROM app.delivery_agenda WHERE tenant_id=NEW.tenant_id AND programme_id=NEW.programme_id AND item_id=NEW.item_id),0)+1 OR d-ARRAY['label','missionIds','meetingIds','state','ownerId','nextAction','dueAt','reason','meetingVersions']<>'{}'::jsonb OR NOT(d ?& ARRAY['label','missionIds','meetingIds','state','ownerId','nextAction','dueAt','reason','meetingVersions']) OR length(d->>'label') NOT BETWEEN 3 AND 1000 OR length(d->>'nextAction') NOT BETWEEN 3 AND 1000 OR length(d->>'reason') NOT BETWEEN 3 AND 1000 OR (d->>'dueAt')::timestamptz IS NULL OR d->>'state' NOT IN ('PROPOSED','CONFIRMED','CANCELLED') OR jsonb_typeof(d->'missionIds')<>'array' OR jsonb_array_length(d->'missionIds') NOT BETWEEN 1 AND 100 OR jsonb_typeof(d->'meetingIds')<>'array' OR jsonb_array_length(d->'meetingIds')>100 THEN RAISE EXCEPTION 'Invalid delegation agenda'; END IF;
   IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(d->'missionIds'))<>jsonb_array_length(d->'missionIds') OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(d->'meetingIds'))<>jsonb_array_length(d->'meetingIds') THEN RAISE EXCEPTION 'Duplicate agenda scope'; END IF;
   FOR mid IN SELECT value::uuid FROM jsonb_array_elements_text(d->'missionIds') LOOP
    IF NOT EXISTS(SELECT FROM app.delivery_participant dp JOIN app.mission_intake i ON i.tenant_id=dp.tenant_id AND i.id=dp.mission_id WHERE dp.tenant_id=NEW.tenant_id AND dp.programme_id=NEW.programme_id AND dp.mission_id=mid AND i.retention_until>now()) THEN RAISE EXCEPTION 'Participant outside programme'; END IF;
   END LOOP;
   FOR mid IN SELECT value::uuid FROM jsonb_array_elements_text(d->'meetingIds') LOOP
    IF NOT EXISTS(SELECT FROM app.meeting m WHERE m.tenant_id=NEW.tenant_id AND m.id=mid AND m.mission_id=ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(d->'missionIds'))) AND app.meeting_access(NEW.tenant_id,m.id) AND (d->>'state'<>'CONFIRMED' OR m.status IN ('SCHEDULED','HELD'))) THEN RAISE EXCEPTION 'Actual participant meeting required'; END IF;
   END LOOP;
   IF jsonb_typeof(d->'meetingVersions')<>'array' OR jsonb_array_length(d->'meetingVersions')<>jsonb_array_length(d->'meetingIds') OR EXISTS(SELECT FROM jsonb_array_elements(d->'meetingVersions') v WHERE NOT EXISTS(SELECT FROM app.meeting m WHERE m.tenant_id=NEW.tenant_id AND m.id=(v->>'id')::uuid AND m.version=(v->>'version')::int AND d->'meetingIds' ? m.id::text)) THEN RAISE EXCEPTION 'Pinned actual meeting versions required'; END IF;
   IF d->>'state'='CONFIRMED' AND (SELECT count(DISTINCT ROW(m.starts_at,m.ends_at,m.location)) FROM app.meeting m WHERE m.tenant_id=NEW.tenant_id AND m.id=ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(d->'meetingIds'))))>1 THEN RAISE EXCEPTION 'A shared confirmed activity requires the same actual time and venue';END IF;
   IF d->>'state'='CONFIRMED' AND jsonb_array_length(d->'meetingIds')=0 THEN RAISE EXCEPTION 'Confirmation requires a scheduled meeting'; END IF;
   IF d->>'state'='CONFIRMED' AND EXISTS(SELECT FROM app.delivery_agenda a WHERE a.tenant_id=NEW.tenant_id AND a.programme_id=NEW.programme_id AND a.item_id<>NEW.item_id AND a.details->>'state'='CONFIRMED' AND a.version=(SELECT max(version) FROM app.delivery_agenda n WHERE n.tenant_id=a.tenant_id AND n.programme_id=a.programme_id AND n.item_id=a.item_id) AND EXISTS(SELECT FROM jsonb_array_elements_text(a.details->'meetingIds') priorMeeting WHERE d->'meetingIds' ? priorMeeting.value)) THEN RAISE EXCEPTION 'Meeting already attributed to another confirmed activity';END IF;
   IF d->>'state'='CONFIRMED' AND EXISTS(SELECT FROM jsonb_array_elements_text(d->'missionIds') m WHERE NOT EXISTS(SELECT FROM app.meeting mt WHERE mt.tenant_id=NEW.tenant_id AND mt.mission_id=m.value::uuid AND mt.id=ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(d->'meetingIds'))) AND mt.status IN ('SCHEDULED','HELD'))) THEN RAISE EXCEPTION 'Each confirmed participant needs an actual meeting'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='delivery_participant_identity' THEN
  IF NOT EXISTS(SELECT FROM app.delivery_participant dp JOIN app.mission_intake i ON i.tenant_id=dp.tenant_id AND i.id=dp.mission_id WHERE dp.tenant_id=NEW.tenant_id AND dp.id=NEW.participant_id AND i.retention_until>now()) OR NOT app.experience_source_valid(NEW.tenant_id,NEW.source_id,NEW.claim_id,NEW.created_by) OR NOT EXISTS(SELECT FROM app.organisation o JOIN app.organisation_source os ON os.organisation_id=o.id JOIN app.source_record s ON s.tenant_id=os.tenant_id AND s.id=os.source_id WHERE o.id=NEW.organisation_id AND o.synthetic AND os.tenant_id=NEW.tenant_id AND os.source_id=NEW.source_id AND s.classification='PUBLIC') THEN RAISE EXCEPTION 'Explicit source-backed participant organisation required';END IF;
 ELSIF TG_TABLE_NAME='delivery_experience_publication' THEN
  SELECT * INTO p FROM app.delivery_publication WHERE tenant_id=NEW.tenant_id AND id=NEW.publication_id;IF p.id IS NULL OR NOT app.delivery_publication_valid(p.id) OR p.created_by<>NEW.created_by THEN RAISE EXCEPTION 'Publish only your currently authorized scope'; END IF;
  IF cardinality(NEW.target_ids)<>(SELECT count(DISTINCT x) FROM unnest(NEW.target_ids)x) OR cardinality(NEW.quotation_ids)<>(SELECT count(DISTINCT x) FROM unnest(NEW.quotation_ids)x) OR cardinality(NEW.agenda_item_ids)<>(SELECT count(DISTINCT x) FROM unnest(NEW.agenda_item_ids)x) THEN RAISE EXCEPTION 'Duplicate disclosure scope'; END IF;
  IF NEW.requirement_id IS NOT NULL THEN SELECT * INTO req FROM app.mission_requirements WHERE tenant_id=NEW.tenant_id AND id=NEW.requirement_id AND mission_id=p.mission_id;IF req.id IS NULL OR NOT app.experience_source_valid(NEW.tenant_id,req.source_id,req.claim_id,NEW.created_by) THEN RAISE EXCEPTION 'Accessible mission requirement required'; END IF;END IF;
  FOREACH tid IN ARRAY NEW.target_ids LOOP IF NOT app.research_target_access(NEW.tenant_id,tid) OR NOT app.experience_target_valid(NEW.tenant_id,tid,p.mission_id,NEW.created_by) THEN RAISE EXCEPTION 'Target outside approved mission'; END IF;END LOOP;
  IF jsonb_array_length(NEW.target_snapshots)<>cardinality(NEW.target_ids) OR (SELECT count(DISTINCT v->>'id') FROM jsonb_array_elements(NEW.target_snapshots)v)<>cardinality(NEW.target_ids) THEN RAISE EXCEPTION 'Pinned target assessments required';END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(NEW.target_snapshots) LOOP IF NOT (d->>'id')::uuid=ANY(NEW.target_ids) OR d-ARRAY['id','assessmentId']<>'{}'::jsonb OR (d->>'assessmentId' IS NOT NULL AND NOT EXISTS(SELECT FROM app.match_assessment ma WHERE ma.tenant_id=NEW.tenant_id AND ma.id=(d->>'assessmentId')::uuid AND ma.target_id=(d->>'id')::uuid AND app.experience_assessment_valid(NEW.tenant_id,ma.id,NEW.created_by))) THEN RAISE EXCEPTION 'Invalid pinned assessment'; END IF;END LOOP;
  FOREACH tid IN ARRAY NEW.quotation_ids LOOP SELECT * INTO q FROM app.mission_quotation WHERE tenant_id=NEW.tenant_id AND id=tid AND mission_id=p.mission_id AND target_id=ANY(NEW.target_ids) AND requirement_id=NEW.requirement_id;IF q.id IS NULL OR NOT app.experience_source_valid(NEW.tenant_id,q.source_id,q.claim_id,NEW.created_by) THEN RAISE EXCEPTION 'Quotation outside participant scope'; END IF;END LOOP;
  FOREACH aid IN ARRAY NEW.agenda_item_ids LOOP IF NOT EXISTS(SELECT FROM app.delivery_agenda a JOIN app.delivery_participant dp ON dp.tenant_id=a.tenant_id AND dp.programme_id=a.programme_id AND dp.mission_id=p.mission_id WHERE a.tenant_id=NEW.tenant_id AND a.id=aid AND a.details->'missionIds' ? p.mission_id::text) THEN RAISE EXCEPTION 'Agenda outside participant scope'; END IF; END LOOP;
 ELSIF TG_TABLE_NAME='recipient_disclosure' THEN
  SELECT m.* INTO c FROM app.buyer_link l JOIN app.communication m ON m.tenant_id=l.tenant_id AND m.id=l.message_id WHERE l.tenant_id=NEW.tenant_id AND l.id=NEW.link_id;
  IF c.id IS NULL OR NOT app.buyer_link_access(NEW.tenant_id,NEW.link_id,true) OR NOT app.communication_allowed(c.id) THEN RAISE EXCEPTION 'Current authorized recipient required'; END IF;
  IF NEW.rfq_id IS NOT NULL AND NOT EXISTS(SELECT FROM app.mission_rfq r JOIN app.target_account t ON t.tenant_id=r.tenant_id AND t.mission_id=r.mission_id AND t.id=c.target_id WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.rfq_id AND c.target_id=ANY(r.target_ids) AND app.experience_source_valid(r.tenant_id,r.source_id,r.claim_id,NEW.created_by)) THEN RAISE EXCEPTION 'RFQ does not include this recipient'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['delivery_programme_context','delivery_agenda','delivery_experience_publication','recipient_disclosure','recipient_detail_response','delivery_participant_identity'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY read ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'')%s)',t,CASE WHEN t='recipient_detail_response' THEN ' AND app.buyer_link_access(tenant_id,link_id) AND retention_until>now()' WHEN t='recipient_disclosure' THEN ' AND app.buyer_link_access(tenant_id,link_id)' WHEN t='delivery_experience_publication' THEN ' AND NOT EXISTS(SELECT FROM unnest(target_ids) tid WHERE NOT app.research_target_access(tenant_id,tid))' WHEN t='delivery_agenda' THEN ' AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(details->''meetingIds'') mid WHERE NOT app.meeting_access(tenant_id,mid.value::uuid))' ELSE '' END);
  EXECUTE format('GRANT SELECT ON app.%I TO corridra_runtime',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',t);
  IF t<>'recipient_detail_response' THEN
   EXECUTE format('CREATE POLICY add ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND created_by=app.actor_id() AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator''))',t);
   EXECUTE format('GRANT INSERT ON app.%I TO corridra_runtime',t);
   EXECUTE format('CREATE TRIGGER guard BEFORE INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_delivery_experience()',t);
   EXECUTE format('CREATE TRIGGER event AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_change()',t);
  ELSE EXECUTE format('CREATE TRIGGER event AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_capability_change()',t); END IF;
 END LOOP;
END $$;
CREATE FUNCTION app.recipient_detail_view(h text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v jsonb:=app.buyer_view(h);l app.buyer_link;d app.recipient_disclosure; BEGIN
 IF v IS NULL THEN RETURN NULL; END IF;SELECT * INTO l FROM app.buyer_link WHERE token_hash=h;SELECT * INTO d FROM app.recipient_disclosure WHERE tenant_id=l.tenant_id AND link_id=l.id;
 IF d.id IS NULL THEN RETURN v||jsonb_build_object('role','BUYER'); END IF;
 IF d.rfq_id IS NOT NULL AND NOT EXISTS(SELECT FROM app.mission_rfq r WHERE r.tenant_id=d.tenant_id AND r.id=d.rfq_id AND app.experience_source_valid(r.tenant_id,r.source_id,r.claim_id,d.created_by)) THEN RETURN NULL; END IF;
 RETURN v||jsonb_build_object('role',d.role,'sharedRequirements',d.shared_requirements,'sharedUncertainty',d.uncertainty,'allowQuotation',d.allow_quotation,'allowMeetingInterest',d.allow_meeting_interest,'detailResponse',(SELECT jsonb_build_object('body',body,'sourceKind',source_kind,'createdAt',created_at) FROM app.recipient_detail_response WHERE tenant_id=l.tenant_id AND link_id=l.id AND retention_until>now()));
END $$;
CREATE FUNCTION app.recipient_detail_respond(h text,k uuid,b jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app.buyer_link;d app.recipient_disclosure;old app.recipient_detail_response;service uuid;expires timestamptz;j jsonb; BEGIN
 SELECT * INTO l FROM app.buyer_link WHERE token_hash=h FOR UPDATE;IF l.id IS NULL OR app.recipient_detail_view(h) IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO d FROM app.recipient_disclosure WHERE tenant_id=l.tenant_id AND link_id=l.id;IF d.id IS NULL THEN RAISE EXCEPTION 'Detailed response not enabled' USING ERRCODE='42501'; END IF;
 IF b IS NULL OR b-ARRAY['body','meetingInterest','quotation','acknowledged']<>'{}'::jsonb OR NOT(b ?& ARRAY['body','meetingInterest','quotation','acknowledged']) OR jsonb_typeof(b->'body')<>'string' OR length(b->>'body') NOT BETWEEN 3 AND 1000 OR jsonb_typeof(b->'meetingInterest')<>'boolean' OR b->'acknowledged' IS DISTINCT FROM 'true'::jsonb OR (b->>'meetingInterest')::boolean AND NOT d.allow_meeting_interest THEN RAISE EXCEPTION 'Invalid authorized response' USING ERRCODE='23514'; END IF;
 IF b->'quotation'<>'null'::jsonb THEN
  IF NOT d.allow_quotation OR d.role<>'SUPPLIER' OR d.rfq_id IS NULL OR jsonb_typeof(b->'quotation')<>'object' OR (b->'quotation')-ARRAY['currency','terms','uncertainties']<>'{}'::jsonb OR NOT(b->'quotation' ?& ARRAY['currency','terms','uncertainties']) OR NOT EXISTS(SELECT FROM app.currency WHERE code=b->'quotation'->>'currency') OR length(b->'quotation'->>'uncertainties') NOT BETWEEN 3 AND 1000 OR jsonb_typeof(b->'quotation'->'terms')<>'object' THEN RAISE EXCEPTION 'Quotation not enabled or invalid' USING ERRCODE='23514'; END IF;
  IF (b->'quotation'->'terms')-ARRAY['specification','quantity','moq','unit','unitPriceMinor','totalPriceMinor','toolingMinor','setupMinor','packagingMinor','leadTime','validUntil','incoterm','shipping','warranty','installation','training','spares','paymentTerms']<>'{}'::jsonb THEN RAISE EXCEPTION 'Unknown quotation terms' USING ERRCODE='23514'; END IF;
  FOR j IN SELECT jsonb_build_object('key',key,'value',value) FROM jsonb_each(b->'quotation'->'terms') LOOP
   IF jsonb_typeof(j->'value')<>'string' OR length(j->>'value')>1000 OR (j->>'key' LIKE '%Minor' AND j->>'value' !~ '^(0|[1-9][0-9]{0,17})$') OR (j->>'key' IN ('quantity','moq') AND j->>'value' !~ '^[1-9][0-9]{0,11}$') THEN RAISE EXCEPTION 'Invalid declared quotation term' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF b->'quotation'->'terms' ? 'validUntil' THEN PERFORM (b->'quotation'->'terms'->>'validUntil')::timestamptz;END IF;
  IF b->'quotation'->'terms' ? 'shipping' AND b->'quotation'->'terms'->>'shipping' NOT IN ('INCLUDED','EXCLUDED','NOT_SUPPLIED') THEN RAISE EXCEPTION 'Invalid shipping scope';END IF;
  IF b->'quotation'->'terms' ? 'incoterm' AND b->'quotation'->'terms'->>'incoterm' NOT IN ('EXW','FCA','CPT','CIP','DAP','DPU','DDP','FAS','FOB','CFR','CIF') THEN RAISE EXCEPTION 'Invalid Incoterm';END IF;
 END IF;
 SELECT * INTO old FROM app.recipient_detail_response WHERE tenant_id=l.tenant_id AND link_id=l.id;IF old.id IS NOT NULL THEN IF old.id<>k OR old.body<>b THEN RAISE EXCEPTION 'Response already recorded' USING ERRCODE='23514'; END IF;RETURN jsonb_build_object('recorded',true,'sourceKind','SELF_DECLARATION'); END IF;
 SELECT dest.service_id INTO service FROM app.intake_destination dest JOIN identity.principal p ON p.id=dest.service_id WHERE dest.tenant_id=l.tenant_id AND dest.enabled AND p.kind='service' AND p.disabled_at IS NULL;IF service IS NULL THEN RETURN NULL; END IF;
 SELECT s.retention_until INTO expires FROM app.communication c JOIN app.private_contact_data pc ON pc.tenant_id=c.tenant_id AND pc.id=c.contact_id JOIN app.source_record s ON s.tenant_id=pc.tenant_id AND s.id=pc.source_id WHERE c.tenant_id=l.tenant_id AND c.id=l.message_id;
 IF d.rfq_id IS NOT NULL THEN SELECT least(expires,s.retention_until) INTO expires FROM app.mission_rfq r JOIN app.source_record s ON s.tenant_id=r.tenant_id AND s.id=r.source_id WHERE r.tenant_id=d.tenant_id AND r.id=d.rfq_id;END IF;
 IF expires IS NULL OR expires<=now() THEN RETURN NULL;END IF;
 INSERT INTO app.recipient_detail_response(id,tenant_id,link_id,body,created_by,retention_until) VALUES(k,l.tenant_id,l.id,b,service,expires);
 RETURN jsonb_build_object('recorded',true,'sourceKind','SELF_DECLARATION');
END $$;
REVOKE ALL ON FUNCTION app.recipient_detail_view(text),app.recipient_detail_respond(text,uuid,jsonb),app.guard_delivery_experience(),app.experience_source_valid(uuid,uuid,uuid,uuid),app.experience_target_valid(uuid,uuid,uuid,uuid),app.experience_assessment_valid(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.recipient_detail_view(text),app.recipient_detail_respond(text,uuid,jsonb) TO corridra_runtime;
CREATE FUNCTION app.experience_publication_valid(e app.delivery_experience_publication) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.delivery_publication; req app.mission_requirements;q app.mission_quotation;tid uuid; BEGIN
 SELECT * INTO p FROM app.delivery_publication WHERE tenant_id=e.tenant_id AND id=e.publication_id;
 IF p.id IS NULL OR NOT app.delivery_publication_valid(p.id) OR NOT app.delivery_subject_access(e.tenant_id,e.created_by,'INTERNAL','synthetic_validation') THEN RETURN false;END IF;
 IF e.requirement_id IS NOT NULL THEN SELECT * INTO req FROM app.mission_requirements WHERE tenant_id=e.tenant_id AND id=e.requirement_id AND mission_id=p.mission_id;IF req.id IS NULL OR NOT app.experience_source_valid(e.tenant_id,req.source_id,req.claim_id,e.created_by) THEN RETURN false;END IF;END IF;
 FOREACH tid IN ARRAY e.target_ids LOOP IF NOT app.experience_target_valid(e.tenant_id,tid,p.mission_id,e.created_by) THEN RETURN false;END IF;END LOOP;
 IF EXISTS(SELECT FROM jsonb_array_elements(e.target_snapshots) v WHERE v->>'assessmentId' IS NOT NULL AND NOT app.experience_assessment_valid(e.tenant_id,(v->>'assessmentId')::uuid,e.created_by)) THEN RETURN false;END IF;
 FOREACH tid IN ARRAY e.quotation_ids LOOP SELECT * INTO q FROM app.mission_quotation WHERE tenant_id=e.tenant_id AND id=tid AND mission_id=p.mission_id AND target_id=ANY(e.target_ids) AND requirement_id=e.requirement_id;IF q.id IS NULL OR NOT app.experience_source_valid(e.tenant_id,q.source_id,q.claim_id,e.created_by) THEN RETURN false;END IF;END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION app.experience_agenda_dto(a app.delivery_agenda) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',a.id,'itemId',a.item_id,'version',a.version,'label',a.details->>'label','state',CASE WHEN a.details->>'state'='CONFIRMED' AND (EXISTS(SELECT FROM app.delivery_agenda n WHERE n.tenant_id=a.tenant_id AND n.programme_id=a.programme_id AND n.item_id=a.item_id AND n.version>a.version) OR EXISTS(SELECT FROM jsonb_array_elements(a.details->'meetingVersions') j JOIN app.meeting m ON m.tenant_id=a.tenant_id AND m.id=(j->>'id')::uuid WHERE m.version<>(j->>'version')::int OR m.status NOT IN ('SCHEDULED','HELD'))) THEN 'REVIEW_REQUIRED' ELSE a.details->>'state' END,'nextAction',a.details->>'nextAction','dueAt',a.details->>'dueAt','responsibility','Assigned programme operator','meetings',coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',m.id,'status',m.status,'scheduleChanged',m.version<>(j->>'version')::int,'startsAt',CASE WHEN m.version=(j->>'version')::int AND m.status IN ('SCHEDULED','HELD') THEN m.starts_at END,'endsAt',CASE WHEN m.version=(j->>'version')::int AND m.status IN ('SCHEDULED','HELD') THEN m.ends_at END,'timezone',CASE WHEN m.version=(j->>'version')::int THEN m.timezone END,'location',CASE WHEN m.version=(j->>'version')::int AND m.status IN ('SCHEDULED','HELD') THEN m.location END)) ORDER BY m.id) FROM jsonb_array_elements(a.details->'meetingVersions') j JOIN app.meeting m ON m.tenant_id=a.tenant_id AND m.id=(j->>'id')::uuid),'[]'::jsonb))
$$;
ALTER FUNCTION app.delivery_report(text,text) RENAME TO delivery_report_v1;
CREATE FUNCTION app.delivery_report(h text,audience text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app.delivery_link:=app.delivery_authorized(h,audience);result jsonb:=app.delivery_report_v1(h,audience);companies integer;held integer;item jsonb;e app.delivery_experience_publication;missions jsonb:='[]';extended jsonb;context jsonb;agenda jsonb; BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements(result->'missions') LOOP
  IF audience='CLIENT_PROGRESS' THEN
   SELECT * INTO e FROM app.delivery_experience_publication WHERE tenant_id=l.tenant_id AND publication_id=(item->>'publicationId')::uuid;
   IF e.id IS NOT NULL THEN
    IF NOT app.experience_publication_valid(e) THEN RAISE EXCEPTION 'Reviewed mission scope unavailable' USING ERRCODE='42501'; END IF;
    SELECT jsonb_build_object('schemaVersion',1,'requirements',(SELECT jsonb_build_object('version',r.version,'fields',r.fields,'sourceKind',s.kind,'claimStatus',c.status,'current',r.version=(SELECT max(version) FROM app.mission_requirements WHERE tenant_id=r.tenant_id AND mission_id=r.mission_id)) FROM app.mission_requirements r JOIN app.source_record s ON s.tenant_id=r.tenant_id AND s.id=r.source_id JOIN app.claim c ON c.tenant_id=r.tenant_id AND c.id=r.claim_id WHERE r.tenant_id=e.tenant_id AND r.id=e.requirement_id),
    'shortlist',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'company',o.name,'country',o.country,'fit',coalesce(a.fit,'RESEARCH'),'rationale',coalesce(a.rationale,'Not yet assessed'),'uncertainty',coalesce(a.uncertainty,'Evidence has not been assessed'),'gaps',coalesce(a.gaps,'Information not supplied'),'verification','Source-reported; no independent verification asserted')) FROM app.target_account t JOIN app.relationship rel ON rel.tenant_id=t.tenant_id AND rel.id=t.relationship_id JOIN app.organisation o ON o.id=rel.organisation_id LEFT JOIN app.match_assessment a ON a.tenant_id=t.tenant_id AND a.target_id=t.id AND a.id=(SELECT (v->>'assessmentId')::uuid FROM jsonb_array_elements(e.target_snapshots)v WHERE v->>'id'=t.id::text) WHERE t.tenant_id=e.tenant_id AND t.id=ANY(e.target_ids)),'[]'::jsonb),
    'quotations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',q.id,'targetId',q.target_id,'currency',q.currency,'terms',q.terms,'revision',q.revision,'uncertainties',q.uncertainties,'sourceKind',s.kind,'claimStatus',c.status,'superseded',EXISTS(SELECT FROM app.mission_quotation n WHERE n.tenant_id=q.tenant_id AND n.previous_id=q.id),'assignmentCurrent',EXISTS(SELECT FROM app.mission_requirements r JOIN app.mission_route_assignment a ON a.tenant_id=r.tenant_id AND a.id=r.assignment_id WHERE r.tenant_id=q.tenant_id AND r.id=q.requirement_id AND a.version=(SELECT max(version) FROM app.mission_route_assignment WHERE tenant_id=a.tenant_id AND mission_id=a.mission_id))) ORDER BY q.target_id,q.revision) FROM app.mission_quotation q JOIN app.source_record s ON s.tenant_id=q.tenant_id AND s.id=q.source_id JOIN app.claim c ON c.tenant_id=q.tenant_id AND c.id=q.claim_id WHERE q.tenant_id=e.tenant_id AND q.id=ANY(e.quotation_ids)),'[]'::jsonb),
    'agenda',coalesce((SELECT jsonb_agg(app.experience_agenda_dto(a) ORDER BY a.created_at) FROM app.delivery_agenda a WHERE a.tenant_id=e.tenant_id AND a.id=ANY(e.agenda_item_ids)),'[]'::jsonb),
    'documentAccess','Supporting documents use the operator-controlled collection and review process. No raw document access is granted by this view.') INTO extended;
    item:=item||jsonb_build_object('experience',extended);
   END IF;
  END IF;
  missions:=missions||jsonb_build_array(item);
 END LOOP;
 result:=jsonb_set(result,'{missions}',missions);
 IF audience='INSTITUTION_REPORT' THEN
  IF EXISTS(SELECT FROM app.delivery_participant_identity pi JOIN app.delivery_participant dp ON dp.tenant_id=pi.tenant_id AND dp.id=pi.participant_id JOIN app.delivery_publication p ON p.tenant_id=dp.tenant_id AND p.mission_id=dp.mission_id WHERE pi.tenant_id=l.tenant_id AND dp.programme_id=l.programme_id AND p.id=ANY(l.publication_ids) AND pi.created_at<=l.created_at AND NOT app.experience_source_valid(pi.tenant_id,pi.source_id,pi.claim_id,pi.created_by)) THEN RAISE EXCEPTION 'Participant attribution source unavailable' USING ERRCODE='42501';END IF;
  SELECT count(DISTINCT coalesce('organisation:'||pi.organisation_id::text,'declared:'||lower(trim(p.copy->>'company'))||':'||coalesce(i.brief#>>'{experience,companyCountry}','undeclared')))::int INTO companies FROM app.delivery_publication p JOIN app.mission_intake i ON i.tenant_id=p.tenant_id AND i.id=p.mission_id LEFT JOIN app.delivery_participant dp ON dp.tenant_id=p.tenant_id AND dp.mission_id=p.mission_id AND dp.programme_id=l.programme_id LEFT JOIN app.delivery_participant_identity pi ON pi.tenant_id=dp.tenant_id AND pi.participant_id=dp.id AND pi.created_at<=l.created_at WHERE p.tenant_id=l.tenant_id AND p.id=ANY(l.publication_ids);
  SELECT count(DISTINCT coalesce((SELECT a.item_id FROM app.delivery_agenda a WHERE a.tenant_id=l.tenant_id AND a.programme_id=l.programme_id AND a.details->>'state'='CONFIRMED' AND a.details->'meetingIds' ? m.id::text AND a.created_at<=l.created_at AND a.version=(SELECT max(version) FROM app.delivery_agenda n WHERE n.tenant_id=a.tenant_id AND n.programme_id=a.programme_id AND n.item_id=a.item_id AND n.created_at<=l.created_at) AND NOT EXISTS(SELECT FROM jsonb_array_elements(a.details->'meetingVersions') am WHERE NOT EXISTS(SELECT FROM app.delivery_publication ap CROSS JOIN LATERAL jsonb_array_elements(ap.copy->'meetings') pm WHERE ap.tenant_id=l.tenant_id AND ap.id=ANY(l.publication_ids) AND pm->>'id'=am->>'id' AND pm->>'version'=am->>'version')) AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(a.details->'missionIds') mid WHERE NOT EXISTS(SELECT FROM app.delivery_publication ap WHERE ap.tenant_id=l.tenant_id AND ap.id=ANY(l.publication_ids) AND ap.mission_id=mid.value::uuid)) ORDER BY a.created_at LIMIT 1),m.id))::int INTO held FROM app.delivery_publication p CROSS JOIN LATERAL jsonb_array_elements(p.copy->'meetings') j JOIN app.meeting m ON m.tenant_id=p.tenant_id AND m.id=(j->>'id')::uuid WHERE p.tenant_id=l.tenant_id AND p.id=ANY(l.publication_ids) AND m.status='HELD';
  result:=result||jsonb_build_object('approvedCompanies',companies,'heldMeetingsDistinct',held,'companyCountBasis','Explicit source-reported organisation IDs where assigned; otherwise supplied company name and declared company country. This is not independently verified legal identity.');
  IF l.include_delegation THEN
  SELECT details-ARRAY['ownerId','reason'] INTO context FROM app.delivery_programme_context WHERE tenant_id=l.tenant_id AND programme_id=l.programme_id AND created_at<=l.created_at ORDER BY version DESC LIMIT 1;
  SELECT coalesce(jsonb_agg(app.experience_agenda_dto(a) ORDER BY a.created_at),'[]'::jsonb) INTO agenda FROM app.delivery_agenda a WHERE a.tenant_id=l.tenant_id AND a.programme_id=l.programme_id AND a.created_at<=l.created_at AND a.version=(SELECT max(version) FROM app.delivery_agenda n WHERE n.tenant_id=a.tenant_id AND n.programme_id=a.programme_id AND n.item_id=a.item_id AND n.created_at<=l.created_at) AND NOT EXISTS(SELECT FROM jsonb_array_elements(a.details->'meetingVersions') am WHERE NOT EXISTS(SELECT FROM app.delivery_publication ap CROSS JOIN LATERAL jsonb_array_elements(ap.copy->'meetings') pm WHERE ap.tenant_id=l.tenant_id AND ap.id=ANY(l.publication_ids) AND pm->>'id'=am->>'id' AND pm->>'version'=am->>'version')) AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(a.details->'missionIds') mid WHERE NOT EXISTS(SELECT FROM app.delivery_publication p WHERE p.tenant_id=l.tenant_id AND p.id=ANY(l.publication_ids) AND p.mission_id=mid.value::uuid));
  result:=result||jsonb_build_object('delegation',jsonb_build_object('context',context,'agenda',agenda));
  END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.experience_publication_valid(app.delivery_experience_publication),app.experience_agenda_dto(app.delivery_agenda),app.delivery_report_v1(text,text),app.delivery_report(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.delivery_report_v1(text,text) FROM corridra_runtime;
GRANT EXECUTE ON FUNCTION app.delivery_report(text,text) TO corridra_runtime;
CREATE FUNCTION app.guard_intake_experience() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE e jsonb:=NEW.brief->'experience';r jsonb;j record; BEGIN
 IF e IS NULL THEN RETURN NEW;END IF;r:=e->'requirements';
 IF jsonb_typeof(e)<>'object' OR e-ARRAY['schemaVersion','companyCountry','marketCode','job','requirements','organiser','participants']<>'{}'::jsonb OR NOT(e ?& ARRAY['schemaVersion','companyCountry','marketCode','job','requirements']) OR e->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR NOT EXISTS(SELECT FROM app.country WHERE code=e->>'companyCountry') OR NOT EXISTS(SELECT FROM app.market_scope WHERE key=e->>'marketCode' AND (kind='COUNTRY' OR key='EU')) OR e->>'job' NOT IN ('buyers','customers','distributors','partners','sourcing','machinery_procurement','supplier_evaluation','meetings','factory_visits','trade_fairs','business_trips','market_validation','market_entry','export_market_access','delegations') OR jsonb_typeof(r)<>'object' OR NOT(r ?& ARRAY['objective','role','product']) OR r-ARRAY['objective','role','product','category','specifications','quantity','unit','targetMarkets','budgetMinor','currency','budgetBasis','moq','orderFrequency','materials','dimensions','technicalConstraints','certifications','oemOdm','delivery','leadTime','incoterm','requiredEvidence','travelDates','decisionCriteria','responsiblePersons','machinery']<>'{}'::jsonb OR length(r->>'objective') NOT BETWEEN 3 AND 1000 OR length(r->>'product') NOT BETWEEN 3 AND 1000 OR r->>'role' NOT IN ('EXPORTER','IMPORTER','BUYER','SUPPLIER','INSTITUTION','OPERATOR') THEN RAISE EXCEPTION 'Invalid structured short brief' USING ERRCODE='23514';END IF;
 FOR j IN SELECT key,value FROM jsonb_each(r) LOOP
  IF j.key='machinery' THEN IF jsonb_typeof(j.value)<>'object' OR j.value-ARRAY['application','capacity','configuration','inputOutput','utilities','integration','documentation','commissioning','training','acceptance','warrantySpares','support','installationReferences','transport','risks']<>'{}'::jsonb OR EXISTS(SELECT FROM jsonb_each(j.value) v WHERE jsonb_typeof(v.value)<>'string' OR length(v.value#>>'{}') NOT BETWEEN 3 AND 1000) THEN RAISE EXCEPTION 'Invalid technical brief' USING ERRCODE='23514';END IF;
  ELSIF j.key IN ('targetMarkets','certifications','requiredEvidence','decisionCriteria','responsiblePersons') THEN IF jsonb_typeof(j.value)<>'array' OR jsonb_array_length(j.value)>30 OR EXISTS(SELECT FROM jsonb_array_elements(j.value) v WHERE jsonb_typeof(v.value)<>'string' OR length(v.value#>>'{}') NOT BETWEEN 2 AND 1000) THEN RAISE EXCEPTION 'Invalid requirement list' USING ERRCODE='23514';END IF;
  ELSE IF jsonb_typeof(j.value)<>'string' OR length(j.value#>>'{}') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid requirement text' USING ERRCODE='23514';END IF;
  END IF;
 END LOOP;
 IF (r ? 'quantity' AND r->>'quantity' !~ '^[1-9][0-9]{0,11}$') OR (r ? 'moq' AND r->>'moq' !~ '^[1-9][0-9]{0,11}$') OR ((r ? 'quantity' OR r ? 'moq') AND NOT(r ? 'unit')) OR ((r ? 'budgetMinor' OR r ? 'currency' OR r ? 'budgetBasis') AND (NOT(r ?& ARRAY['budgetMinor','currency','budgetBasis']) OR r->>'budgetMinor' !~ '^(0|[1-9][0-9]{0,17})$' OR NOT EXISTS(SELECT FROM app.currency WHERE code=r->>'currency'))) THEN RAISE EXCEPTION 'Original amount, currency and unit basis required' USING ERRCODE='23514';END IF;
 IF (e ? 'organiser' AND (jsonb_typeof(e->'organiser')<>'string' OR length(e->>'organiser') NOT BETWEEN 3 AND 160)) OR (e ? 'participants' AND (jsonb_typeof(e->'participants')<>'string' OR length(e->>'participants') NOT BETWEEN 3 AND 1000)) THEN RAISE EXCEPTION 'Invalid delegation brief' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER structured_short_brief BEFORE INSERT ON app.mission_intake FOR EACH ROW EXECUTE FUNCTION app.guard_intake_experience();
REVOKE ALL ON FUNCTION app.guard_intake_experience() FROM PUBLIC;

-- Permit standard short unit symbols (kg, m, W) without changing any other commercial guard.
DO $$ DECLARE definition text:=pg_get_functiondef('app.guard_commercial_mission()'::regprocedure);expected text:='length(NEW.fields->>''unit'')<3';BEGIN
 IF strpos(definition,expected)=0 THEN RAISE EXCEPTION 'Reviewed unit guard baseline differs';END IF;
 EXECUTE replace(definition,expected,'length(NEW.fields->>''unit'')<1');
END $$;
