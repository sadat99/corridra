CREATE TABLE app.delivery_programme (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES app.tenant(id),name text NOT NULL CHECK(length(name) BETWEEN 3 AND 160),
 reporting_purpose text NOT NULL CHECK(length(reporting_purpose) BETWEEN 10 AND 500),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id)
);
CREATE TABLE app.delivery_import (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,programme_id uuid NOT NULL,format text NOT NULL CHECK(format IN ('CSV','XLSX')),
 file_hash text NOT NULL CHECK(file_hash ~ '^[a-f0-9]{64}$'),rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array' AND jsonb_array_length(rows) BETWEEN 1 AND 100 AND octet_length(rows::text)<=1048576),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day',created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TABLE app.delivery_participant (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,programme_id uuid NOT NULL,import_id uuid NOT NULL,reference text NOT NULL CHECK(reference ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'),
 brief_hash text NOT NULL CHECK(brief_hash ~ '^[a-f0-9]{64}$'),mission_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,programme_id,reference),UNIQUE(tenant_id,programme_id,mission_id),FOREIGN KEY(tenant_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id),
 FOREIGN KEY(tenant_id,import_id) REFERENCES app.delivery_import(tenant_id,id),FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id)
);
CREATE TABLE app.delivery_acceptance (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,import_id uuid NOT NULL,owner_id uuid NOT NULL REFERENCES identity.principal(id),input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,import_id),FOREIGN KEY(tenant_id,import_id) REFERENCES app.delivery_import(tenant_id,id)
);
CREATE TABLE app.delivery_publication (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,mission_id uuid NOT NULL,copy jsonb NOT NULL CHECK(jsonb_typeof(copy)='object' AND octet_length(copy::text)<64000),
 created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id)
);
CREATE TABLE app.delivery_link (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,programme_id uuid,publication_ids uuid[] NOT NULL CHECK(cardinality(publication_ids) BETWEEN 1 AND 1000),
 audience text NOT NULL CHECK(audience IN ('CLIENT_PROGRESS','INSTITUTION_REPORT')),reporting_purpose text NOT NULL CHECK(length(reporting_purpose) BETWEEN 10 AND 500),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),expires_at timestamptz NOT NULL,allow_export boolean NOT NULL,
 created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id),
 CHECK((audience='CLIENT_PROGRESS' AND programme_id IS NULL AND cardinality(publication_ids)=1 AND NOT allow_export) OR (audience='INSTITUTION_REPORT' AND programme_id IS NOT NULL)),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 days')
);
CREATE TABLE app.delivery_revocation (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,link_id uuid,publication_id uuid,reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,link_id) REFERENCES app.delivery_link(tenant_id,id),FOREIGN KEY(tenant_id,publication_id) REFERENCES app.delivery_publication(tenant_id,id),
 CHECK((link_id IS NULL)<>(publication_id IS NULL)),UNIQUE(tenant_id,link_id),UNIQUE(tenant_id,publication_id)
);
CREATE TABLE app.delivery_request (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,publication_id uuid NOT NULL,title text NOT NULL CHECK(length(title) BETWEEN 3 AND 160),
 instructions text NOT NULL CHECK(length(instructions) BETWEEN 10 AND 1000),owner_id uuid NOT NULL REFERENCES identity.principal(id),due_at timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,publication_id) REFERENCES app.delivery_publication(tenant_id,id)
);
CREATE TABLE app.delivery_response (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,request_id uuid NOT NULL,link_id uuid NOT NULL,body text NOT NULL CHECK(length(body) BETWEEN 3 AND 2000),
 source_kind text NOT NULL DEFAULT 'self_declaration' CHECK(source_kind='self_declaration'),claim_status text NOT NULL DEFAULT 'self_declared' CHECK(claim_status='self_declared'),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),UNIQUE(tenant_id,request_id),FOREIGN KEY(tenant_id,request_id) REFERENCES app.delivery_request(tenant_id,id),FOREIGN KEY(tenant_id,link_id) REFERENCES app.delivery_link(tenant_id,id)
);
CREATE TABLE app.delivery_request_close (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,request_id uuid NOT NULL,status text NOT NULL CHECK(status IN ('COMPLETED','CANCELLED')),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),UNIQUE(tenant_id,request_id),FOREIGN KEY(tenant_id,request_id) REFERENCES app.delivery_request(tenant_id,id)
);
CREATE TABLE app.delivery_export (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,link_id uuid NOT NULL,format text NOT NULL CHECK(format IN ('CSV','PDF')),reporting_purpose text NOT NULL CHECK(length(reporting_purpose) BETWEEN 10 AND 500),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<8388608),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,link_id) REFERENCES app.delivery_link(tenant_id,id)
);
CREATE TABLE app.delivery_export_artifact (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 8388608),
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,id) REFERENCES app.delivery_export(tenant_id,id),
 CHECK(content_hash=encode(sha256(content),'hex'))
);

-- A publisher's authorization is checked at every read, independently of their
-- now-ended login session. Logout does not revoke a reviewed link; loss of access does.
CREATE FUNCTION app.delivery_subject_access(t uuid,a uuid,c text,p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.membership m JOIN identity.principal pr ON pr.id=m.user_id JOIN identity."user" u ON u.id=pr.identity_id JOIN app.tenant tn ON tn.id=m.tenant_id
 WHERE m.tenant_id=t AND m.user_id=a AND m.role IN ('owner','admin') AND m.revoked_at IS NULL AND pr.disabled_at IS NULL AND u."twoFactorEnabled" AND tn.synthetic
 AND pr.operating_country=ANY(m.allowed_countries) AND p=ANY(m.allowed_purposes) AND c=ANY(m.allowed_classifications))
$$;
CREATE FUNCTION app.delivery_publication_valid(pid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.delivery_publication p JOIN app.mission_intake i ON i.tenant_id=p.tenant_id AND i.id=p.mission_id
 WHERE p.id=pid AND i.retention_until>now() AND app.delivery_subject_access(p.tenant_id,p.created_by,'INTERNAL','synthetic_validation')
 AND NOT EXISTS(SELECT FROM app.delivery_revocation WHERE tenant_id=p.tenant_id AND publication_id=p.id)
 AND NOT EXISTS(SELECT FROM jsonb_array_elements(p.copy->'meetings') j LEFT JOIN app.meeting mt ON mt.tenant_id=p.tenant_id AND mt.id=(j->>'id')::uuid LEFT JOIN app.communication c ON c.tenant_id=mt.tenant_id AND c.id=mt.message_id LEFT JOIN app.target_account ta ON ta.tenant_id=c.tenant_id AND ta.id=c.target_id LEFT JOIN app.relationship r ON r.tenant_id=ta.tenant_id AND r.id=ta.relationship_id
 WHERE mt.id IS NULL OR mt.mission_id<>p.mission_id OR NOT app.delivery_subject_access(p.tenant_id,p.created_by,r.classification,r.purpose))
 AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(p.copy->'opportunityIds') j LEFT JOIN app.opportunity o ON o.tenant_id=p.tenant_id AND o.id=j.value::uuid LEFT JOIN app.target_account ta ON ta.tenant_id=o.tenant_id AND ta.id=o.target_id LEFT JOIN app.relationship r ON r.tenant_id=ta.tenant_id AND r.id=ta.relationship_id
 WHERE o.id IS NULL OR o.mission_id<>p.mission_id OR NOT app.delivery_subject_access(p.tenant_id,p.created_by,r.classification,r.purpose)
 OR EXISTS(SELECT FROM app.commercial_record cr JOIN app.source_record s ON s.tenant_id=cr.tenant_id AND s.id=cr.source_id WHERE cr.tenant_id=o.tenant_id AND cr.opportunity_id=o.id AND (cr.retention_until<=now() OR s.retention_until<=now() OR NOT app.delivery_subject_access(p.tenant_id,p.created_by,s.classification,s.purpose)
 OR (cr.evidence_id IS NOT NULL AND NOT EXISTS(SELECT FROM app.evidence_object e JOIN app.evidence_state es ON es.tenant_id=e.tenant_id AND es.id=e.id WHERE e.tenant_id=cr.tenant_id AND e.id=cr.evidence_id AND e.retention_until>now() AND es.status IN ('UNDER_REVIEW','VERIFIED') AND (es.scan_status='CLEAN' OR (es.scan_status='BYPASSED' AND coalesce((SELECT (value->>'enabled')::boolean FROM app.config_version WHERE tenant_id=e.tenant_id AND key='evidence.scan_bypass' AND effective_from<=now() ORDER BY version DESC LIMIT 1),false))) AND app.delivery_subject_access(p.tenant_id,p.created_by,e.classification,e.purpose)))))
 OR EXISTS(SELECT FROM app.accounting_confirmation ac JOIN app.source_record s ON s.tenant_id=ac.tenant_id AND s.id=ac.source_id WHERE ac.tenant_id=o.tenant_id AND ac.opportunity_id=o.id AND (s.retention_until<=now() OR NOT app.delivery_subject_access(p.tenant_id,p.created_by,s.classification,s.purpose)))))
$$;
CREATE FUNCTION app.delivery_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE j jsonb;pid uuid;batch app.delivery_import;
BEGIN
 IF NEW.created_at<>now() THEN RAISE EXCEPTION 'Server creation time required' USING ERRCODE='23514'; END IF;
 IF NEW.created_by IS DISTINCT FROM app.actor_id() OR NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL','synthetic_validation'),false) OR coalesce(app.member_role(NEW.tenant_id),'') NOT IN ('owner','admin','operator') OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME IN ('delivery_publication','delivery_link','delivery_request') AND (app.member_role(NEW.tenant_id) NOT IN ('owner','admin') OR NOT app.fresh_mfa()) THEN RAISE EXCEPTION 'Sharing requires owner/admin and fresh MFA' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='delivery_publication' THEN
  IF EXISTS(SELECT FROM jsonb_each(NEW.copy) v WHERE v.key=ANY(ARRAY['title','company','objective','brief','nextAction','dueAt']) AND jsonb_typeof(v.value)<>'string') THEN RAISE EXCEPTION 'Publication copy must contain text' USING ERRCODE='23514'; END IF;
  IF NEW.copy IS NULL OR NOT NEW.copy ?& ARRAY['title','company','objective','brief','nextAction','dueAt','meetings','opportunityIds','includeFinancials'] OR NEW.copy-ARRAY['title','company','objective','brief','nextAction','dueAt','meetings','opportunityIds','includeFinancials']<>'{}'::jsonb OR length(NEW.copy->>'title') NOT BETWEEN 3 AND 160 OR length(NEW.copy->>'company') NOT BETWEEN 2 AND 160 OR length(NEW.copy->>'objective') NOT BETWEEN 3 AND 500 OR length(NEW.copy->>'brief') NOT BETWEEN 10 AND 2000 OR length(NEW.copy->>'nextAction') NOT BETWEEN 3 AND 300 OR jsonb_typeof(NEW.copy->'includeFinancials')<>'boolean' OR jsonb_typeof(NEW.copy->'meetings')<>'array' OR jsonb_typeof(NEW.copy->'opportunityIds')<>'array' OR jsonb_array_length(NEW.copy->'meetings')>50 OR jsonb_array_length(NEW.copy->'opportunityIds')>100 OR (NEW.copy->>'dueAt')::timestamptz IS NULL OR NOT EXISTS(SELECT FROM app.mission_intake WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id AND retention_until>now()) THEN RAISE EXCEPTION 'Invalid reviewed publication' USING ERRCODE='23514'; END IF;
  FOR j IN SELECT value FROM jsonb_array_elements(NEW.copy->'meetings') LOOP
   IF j-ARRAY['id','version','label']<>'{}'::jsonb OR length(j->>'label') NOT BETWEEN 3 AND 160 OR NOT EXISTS(SELECT FROM app.meeting WHERE tenant_id=NEW.tenant_id AND id=(j->>'id')::uuid AND mission_id=NEW.mission_id AND version=(j->>'version')::integer AND app.meeting_access(tenant_id,id)) THEN RAISE EXCEPTION 'Approve a current accessible meeting on this mission' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.copy->'opportunityIds') j WHERE NOT EXISTS(SELECT FROM app.opportunity WHERE tenant_id=NEW.tenant_id AND id=j.value::uuid AND mission_id=NEW.mission_id AND app.opportunity_access(tenant_id,id))) OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(NEW.copy->'opportunityIds'))<>jsonb_array_length(NEW.copy->'opportunityIds') OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(NEW.copy->'meetings'))<>jsonb_array_length(NEW.copy->'meetings') THEN RAISE EXCEPTION 'Approve distinct opportunities and meetings on this mission' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='delivery_link' THEN
  IF (SELECT coalesce(sum(octet_length(copy::text)),0) FROM app.delivery_publication WHERE tenant_id=NEW.tenant_id AND id=ANY(NEW.publication_ids))>3145728 OR (SELECT coalesce(sum(jsonb_array_length(copy->'meetings')),0) FROM app.delivery_publication WHERE tenant_id=NEW.tenant_id AND id=ANY(NEW.publication_ids))>1000 THEN RAISE EXCEPTION 'Reporting scope exceeds the complete report size limit' USING ERRCODE='23514'; END IF;
  IF cardinality(NEW.publication_ids)<>(SELECT count(DISTINCT p) FROM unnest(NEW.publication_ids) p) THEN RAISE EXCEPTION 'Duplicate publication scope' USING ERRCODE='23514'; END IF;
  IF (SELECT count(DISTINCT mission_id) FROM app.delivery_publication WHERE tenant_id=NEW.tenant_id AND id=ANY(NEW.publication_ids))<>cardinality(NEW.publication_ids) THEN RAISE EXCEPTION 'One publication per mission required' USING ERRCODE='23514'; END IF;
  FOREACH pid IN ARRAY NEW.publication_ids LOOP
   IF NOT EXISTS(SELECT FROM app.delivery_publication WHERE tenant_id=NEW.tenant_id AND id=pid) OR NOT app.delivery_publication_valid(pid) OR (NEW.programme_id IS NOT NULL AND NOT EXISTS(SELECT FROM app.delivery_participant dp JOIN app.delivery_publication p ON p.tenant_id=dp.tenant_id AND p.mission_id=dp.mission_id WHERE dp.tenant_id=NEW.tenant_id AND dp.programme_id=NEW.programme_id AND p.id=pid)) THEN RAISE EXCEPTION 'Publication outside approved programme scope' USING ERRCODE='23514'; END IF;
  END LOOP;
 ELSIF TG_TABLE_NAME='delivery_request' THEN
  IF NEW.due_at<=now() OR NOT app.delivery_publication_valid(NEW.publication_id) OR NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Active publication, owner and future deadline required' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='delivery_participant' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('delivery-programme:'||NEW.tenant_id::text||':'||NEW.programme_id::text,0));
  IF (SELECT count(*) FROM app.delivery_participant WHERE tenant_id=NEW.tenant_id AND programme_id=NEW.programme_id)>=1000 OR NOT EXISTS(SELECT FROM app.delivery_import i JOIN app.mission m ON m.tenant_id=i.tenant_id AND m.id=NEW.mission_id JOIN app.mission_intake mi ON mi.tenant_id=m.tenant_id AND mi.id=m.id WHERE i.tenant_id=NEW.tenant_id AND i.id=NEW.import_id AND i.programme_id=NEW.programme_id AND i.created_by=NEW.created_by AND i.expires_at>now() AND m.created_by=NEW.created_by AND EXISTS(SELECT FROM jsonb_array_elements(i.rows) r WHERE r->>'reference'=NEW.reference AND r->>'hash'=NEW.brief_hash AND r->'brief'=mi.brief AND r->>'status' IN ('READY','DUPLICATE_FILE'))) THEN RAISE EXCEPTION 'Participant must match its confirmed intake row' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='delivery_request_close' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('delivery-request:'||NEW.request_id::text,0));
  IF NEW.status='COMPLETED' AND NOT EXISTS(SELECT FROM app.delivery_response WHERE tenant_id=NEW.tenant_id AND request_id=NEW.request_id) THEN RAISE EXCEPTION 'A response is required before completion' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='delivery_import' THEN
  IF NEW.expires_at>now()+interval '1 day' OR NEW.expires_at<=now() OR EXISTS(SELECT FROM jsonb_array_elements(NEW.rows) r WHERE r->>'status' IS NULL OR r->>'status' NOT IN ('READY','DUPLICATE_FILE','DUPLICATE_EXISTING','EMPTY','ERROR') OR jsonb_typeof(r->'row')<>'number' OR jsonb_typeof(r->'errors')<>'array') THEN RAISE EXCEPTION 'Invalid bounded preview' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='delivery_acceptance' THEN
  IF NOT NEW.result ?& ARRAY['programmeId','importId','counts','rows'] OR jsonb_typeof(NEW.result->'rows')<>'array' THEN RAISE EXCEPTION 'Complete acceptance result required' USING ERRCODE='23514'; END IF;
  SELECT * INTO batch FROM app.delivery_import WHERE tenant_id=NEW.tenant_id AND id=NEW.import_id;
  IF batch.id IS NULL OR batch.created_by<>NEW.created_by OR batch.expires_at<=now() OR NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) OR EXISTS(SELECT FROM jsonb_array_elements(batch.rows) r WHERE r->>'status'='ERROR') OR jsonb_array_length(NEW.result->'rows')<>jsonb_array_length(batch.rows) OR EXISTS(SELECT FROM jsonb_array_elements(batch.rows) r WHERE r->>'status'<>'EMPTY' AND NOT EXISTS(SELECT FROM app.delivery_participant p JOIN app.mission_intake i ON i.tenant_id=p.tenant_id AND i.id=p.mission_id WHERE p.tenant_id=NEW.tenant_id AND p.programme_id=batch.programme_id AND p.reference=r->>'reference' AND p.brief_hash=r->>'hash' AND i.brief=r->'brief')) THEN RAISE EXCEPTION 'A complete, owned, error-free intake is required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION app.delivery_import_committed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM app.delivery_acceptance WHERE tenant_id=NEW.tenant_id AND import_id=NEW.import_id) THEN RAISE EXCEPTION 'Participant creation requires atomic intake confirmation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER confirmed_import AFTER INSERT ON app.delivery_participant DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.delivery_import_committed();
REVOKE ALL ON FUNCTION app.delivery_import_committed() FROM PUBLIC;
DO $$ DECLARE tbl text;BEGIN
 FOREACH tbl IN ARRAY ARRAY['delivery_programme','delivery_import','delivery_participant','delivery_acceptance','delivery_publication','delivery_link','delivery_revocation','delivery_request','delivery_response','delivery_request_close','delivery_export','delivery_export_artifact'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('CREATE POLICY read ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation''))',tbl);
  EXECUTE format('GRANT SELECT ON app.%I TO corridra_runtime',tbl);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',tbl);
  IF tbl NOT IN ('delivery_response','delivery_export','delivery_export_artifact') THEN
   EXECUTE format('GRANT INSERT ON app.%I TO corridra_runtime',tbl);
   EXECUTE format('CREATE POLICY add ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator'') AND created_by=app.actor_id())',tbl);
   EXECUTE format('CREATE TRIGGER guard BEFORE INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.delivery_guard()',tbl);
   EXECUTE format('CREATE TRIGGER event AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_change()',tbl);
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION app.delivery_subject_access(uuid,uuid,text,text),app.delivery_publication_valid(uuid),app.delivery_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.delivery_publication_valid(uuid),app.delivery_subject_access(uuid,uuid,text,text) TO corridra_runtime;
CREATE INDEX delivery_programme_participants ON app.delivery_participant(tenant_id,programme_id);
CREATE INDEX delivery_publication_mission ON app.delivery_publication(tenant_id,mission_id);

CREATE FUNCTION app.delivery_authorized(h text,audience text) RETURNS app.delivery_link LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app.delivery_link;pid uuid;
BEGIN
 SELECT * INTO l FROM app.delivery_link WHERE token_hash=h AND delivery_link.audience=delivery_authorized.audience AND expires_at>now();
 IF l.id IS NULL OR NOT app.delivery_subject_access(l.tenant_id,l.created_by,'INTERNAL','synthetic_validation') OR EXISTS(SELECT FROM app.delivery_revocation WHERE tenant_id=l.tenant_id AND link_id=l.id) THEN RAISE EXCEPTION 'Link unavailable or expired' USING ERRCODE='42501'; END IF;
 FOREACH pid IN ARRAY l.publication_ids LOOP IF NOT app.delivery_publication_valid(pid) THEN RAISE EXCEPTION 'Published scope unavailable' USING ERRCODE='42501'; END IF; END LOOP;
 RETURN l;
END $$;
CREATE FUNCTION app.delivery_mission_dto(p app.delivery_publication) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('publicationId',p.id,'title',p.copy->>'title','company',p.copy->>'company','objective',p.copy->>'objective','brief',p.copy->>'brief','nextAction',p.copy->>'nextAction','dueAt',p.copy->>'dueAt','reviewedAt',p.created_at,'status',m.status,'updatedAt',m.updated_at,
 'itinerary',coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('label',j->>'label','status',mt.status,'scheduleChanged',mt.version<>(j->>'version')::integer,'startsAt',CASE WHEN mt.version=(j->>'version')::integer THEN mt.starts_at END,'endsAt',CASE WHEN mt.version=(j->>'version')::integer THEN mt.ends_at END,'timezone',CASE WHEN mt.version=(j->>'version')::integer THEN mt.timezone END,'location',CASE WHEN mt.version=(j->>'version')::integer THEN mt.location END)) ORDER BY mt.starts_at,mt.id) FROM jsonb_array_elements(p.copy->'meetings') j JOIN app.meeting mt ON mt.tenant_id=p.tenant_id AND mt.id=(j->>'id')::uuid),'[]'::jsonb),
 'requests',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'instructions',r.instructions,'dueAt',r.due_at,'status',coalesce(c.status,CASE WHEN s.id IS NOT NULL THEN 'RESPONDED' ELSE 'OPEN' END),'response',s.body,'responseAt',s.created_at,'claimStatus',s.claim_status) ORDER BY r.created_at,r.id) FROM app.delivery_request r LEFT JOIN app.delivery_response s ON s.tenant_id=r.tenant_id AND s.request_id=r.id LEFT JOIN app.delivery_request_close c ON c.tenant_id=r.tenant_id AND c.request_id=r.id WHERE r.tenant_id=p.tenant_id AND r.publication_id=p.id),'[]'::jsonb),
 'outcomes',(SELECT jsonb_build_object('opportunities',count(*)::int,'qualified',count(*) FILTER(WHERE EXISTS(SELECT FROM app.outcome_event e WHERE e.tenant_id=o.tenant_id AND e.opportunity_id=o.id AND e.entity_type='opportunity' AND app.commercial_stage(e.snapshot->>'status')>=2))::int,'proposals',count(*) FILTER(WHERE EXISTS(SELECT FROM app.outcome_event e WHERE e.tenant_id=o.tenant_id AND e.opportunity_id=o.id AND e.entity_type='opportunity' AND app.commercial_stage(e.snapshot->>'status')>=3))::int,'contracts',count(*) FILTER(WHERE EXISTS(SELECT FROM app.outcome_event e WHERE e.tenant_id=o.tenant_id AND e.opportunity_id=o.id AND e.entity_type='opportunity' AND app.commercial_stage(e.snapshot->>'status')>=5))::int,'rfqs',(SELECT count(*)::int FROM app.commercial_record cr WHERE cr.tenant_id=p.tenant_id AND cr.opportunity_id=ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p.copy->'opportunityIds'))) AND cr.kind='RFQ'),'samples',(SELECT count(*)::int FROM app.commercial_record cr WHERE cr.tenant_id=p.tenant_id AND cr.opportunity_id=ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p.copy->'opportunityIds'))) AND cr.kind='SAMPLE'),'heldMeetings',(SELECT count(*)::int FROM jsonb_array_elements(p.copy->'meetings') j JOIN app.meeting mt ON mt.tenant_id=p.tenant_id AND mt.id=(j->>'id')::uuid WHERE mt.status='HELD')) FROM app.opportunity o WHERE o.tenant_id=p.tenant_id AND o.id=ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p.copy->'opportunityIds')))),
 'totals',CASE WHEN (p.copy->>'includeFinancials')::boolean THEN coalesce((SELECT jsonb_agg(jsonb_build_object('currency',currency,'contractMinor',contract_minor,'invoiceMinor',invoice_minor,'confirmedCashMinor',confirmed_cash_minor,'repeatCashMinor',repeat_cash_minor) ORDER BY currency) FROM app.commercial_totals(p.tenant_id,ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p.copy->'opportunityIds')))),'[]'::jsonb) ELSE '[]'::jsonb END)
 FROM app.mission m WHERE m.tenant_id=p.tenant_id AND m.id=p.mission_id
$$;
CREATE FUNCTION app.delivery_report(h text,audience text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app.delivery_link:=app.delivery_authorized(h,audience);missions jsonb;name text;totals jsonb;counterparties integer;companies integer;
BEGIN
 SELECT coalesce(jsonb_agg(app.delivery_mission_dto(p) ORDER BY p.copy->>'company',p.id),'[]'::jsonb) INTO missions FROM app.delivery_publication p WHERE p.tenant_id=l.tenant_id AND p.id=ANY(l.publication_ids);
 -- Institutions receive no private evidence instructions or client declarations.
 IF audience='INSTITUTION_REPORT' THEN SELECT jsonb_agg(value-'requests') INTO missions FROM jsonb_array_elements(missions); END IF;
 SELECT p.name INTO name FROM app.delivery_programme p WHERE p.tenant_id=l.tenant_id AND p.id=l.programme_id;
 SELECT count(DISTINCT lower(trim(p.copy->>'company')))::int INTO companies FROM app.delivery_publication p WHERE p.tenant_id=l.tenant_id AND p.id=ANY(l.publication_ids);
 SELECT count(DISTINCT coalesce((SELECT er.survivor_id FROM app.entity_resolution er JOIN app.entity_candidate ec ON ec.tenant_id=er.tenant_id AND ec.id=er.candidate_id WHERE er.tenant_id=l.tenant_id AND er.decision='MERGE' AND r.organisation_id IN(ec.left_id,ec.right_id) AND NOT EXISTS(SELECT FROM app.entity_resolution rev WHERE rev.tenant_id=er.tenant_id AND rev.reverse_of=er.id) LIMIT 1),r.organisation_id))::int INTO counterparties FROM app.delivery_publication p JOIN app.opportunity o ON o.tenant_id=p.tenant_id AND o.mission_id=p.mission_id JOIN app.target_account ta ON ta.tenant_id=o.tenant_id AND ta.id=o.target_id JOIN app.relationship r ON r.tenant_id=ta.tenant_id AND r.id=ta.relationship_id WHERE p.tenant_id=l.tenant_id AND p.id=ANY(l.publication_ids) AND o.id=ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p.copy->'opportunityIds'))) AND EXISTS(SELECT FROM app.outcome_event e WHERE e.tenant_id=o.tenant_id AND e.opportunity_id=o.id AND e.entity_type='opportunity' AND app.commercial_stage(e.snapshot->>'status')>=2);
 SELECT coalesce(jsonb_agg(jsonb_build_object('currency',currency,'contractMinor',contract_minor,'invoiceMinor',invoice_minor,'confirmedCashMinor',confirmed_cash_minor,'repeatCashMinor',repeat_cash_minor) ORDER BY currency),'[]'::jsonb) INTO totals FROM app.commercial_totals(l.tenant_id,ARRAY(SELECT DISTINCT j.value::uuid FROM app.delivery_publication p CROSS JOIN LATERAL jsonb_array_elements_text(p.copy->'opportunityIds') j WHERE p.tenant_id=l.tenant_id AND p.id=ANY(l.publication_ids) AND (p.copy->>'includeFinancials')::boolean));

 RETURN jsonb_build_object('schemaVersion',1,'scopeId',l.id,'audience',l.audience,'purpose',l.reporting_purpose,'programme',name,'generatedAt',now(),'expiresAt',l.expires_at,'allowExport',l.allow_export,'approvedParticipants',cardinality(l.publication_ids),'approvedCompanies',companies,'qualifiedCounterparties',counterparties,'totals',totals,'missions',missions,'attribution','Approved mission and opportunity scope only. Recorded activity does not establish Corridra caused an outcome. Contracts, invoices and confirmed cash are distinct; repeat cash is included in confirmed cash. Currencies are not combined. Client responses are self-declared.');
END $$;
CREATE FUNCTION app.delivery_external_event(l app.delivery_link,kind text,id uuid,payload jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE eid uuid:=gen_random_uuid();
BEGIN
 INSERT INTO app.domain_event VALUES(eid,l.tenant_id,kind,1,'delivery',id::text,1,l.created_by,now(),gen_random_uuid(),id,payload||jsonb_build_object('linkId',l.id,'audience',l.audience,'authority','approved_delivery_capability'));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),l.tenant_id,eid,l.created_by,kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),l.tenant_id,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,l.tenant_id);
END $$;
CREATE FUNCTION app.delivery_respond(h text,k uuid,rid uuid,b text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app.delivery_link:=app.delivery_authorized(h,'CLIENT_PROGRESS');r app.delivery_request;s app.delivery_response;
BEGIN
 IF k IS NULL OR b IS NULL OR length(b) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'Invalid response' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('delivery-request:'||rid::text,0));
 SELECT * INTO r FROM app.delivery_request WHERE tenant_id=l.tenant_id AND id=rid AND publication_id=ANY(l.publication_ids) FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM app.delivery_request_close WHERE tenant_id=l.tenant_id AND request_id=rid) THEN RAISE EXCEPTION 'Request closed' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM app.delivery_response WHERE id=k OR (tenant_id=l.tenant_id AND request_id=rid);
 IF s.id IS NOT NULL THEN
  IF s.id<>k OR s.link_id<>l.id OR s.request_id<>rid OR s.body<>b THEN RAISE EXCEPTION 'Response already recorded or retry changed' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('id',s.id,'claimStatus',s.claim_status);
 END IF;
 INSERT INTO app.delivery_response(id,tenant_id,request_id,link_id,body) VALUES(k,l.tenant_id,rid,l.id,b);
 PERFORM app.delivery_external_event(l,'delivery.response.recorded',k,jsonb_build_object('requestId',rid,'claimStatus','self_declared'));
 RETURN jsonb_build_object('id',k,'claimStatus','self_declared');
END $$;
CREATE FUNCTION app.delivery_export_prepare(h text,k uuid,f text,why text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app.delivery_link:=app.delivery_authorized(h,'INSTITUTION_REPORT');e app.delivery_export;
BEGIN
 IF NOT l.allow_export THEN RAISE EXCEPTION 'Exports not approved for this link' USING ERRCODE='42501'; END IF;
 IF k IS NULL OR f IS NULL OR f NOT IN ('CSV','PDF') OR why IS NULL OR why<>l.reporting_purpose THEN RAISE EXCEPTION 'Use the approved reporting purpose and format' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(k::text,0));
 SELECT * INTO e FROM app.delivery_export WHERE id=k;
 IF e.id IS NOT NULL THEN
  IF e.link_id<>l.id OR e.format<>f OR e.reporting_purpose<>why THEN RAISE EXCEPTION 'Export command reused' USING ERRCODE='23514'; END IF;
 ELSE
  INSERT INTO app.delivery_export(id,tenant_id,link_id,format,reporting_purpose,snapshot) VALUES(k,l.tenant_id,l.id,f,why,app.delivery_report(h,'INSTITUTION_REPORT')) RETURNING * INTO e;
 END IF;
 RETURN jsonb_build_object('snapshot',e.snapshot,'content',(SELECT encode(content,'base64') FROM app.delivery_export_artifact WHERE tenant_id=l.tenant_id AND id=k));
END $$;
CREATE FUNCTION app.delivery_export_finish(h text,k uuid,bytes bytea) RETURNS bytea LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app.delivery_link:=app.delivery_authorized(h,'INSTITUTION_REPORT');e app.delivery_export;old app.delivery_export_artifact;hash text;
BEGIN
 IF NOT l.allow_export THEN RAISE EXCEPTION 'Exports not approved' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM app.delivery_export WHERE tenant_id=l.tenant_id AND id=k AND link_id=l.id FOR UPDATE;
 IF e.id IS NULL OR bytes IS NULL OR octet_length(bytes) NOT BETWEEN 1 AND 8388608 THEN RAISE EXCEPTION 'Prepared export required' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM app.delivery_export_artifact WHERE tenant_id=l.tenant_id AND id=k;
 IF old.id IS NOT NULL THEN RETURN old.content; END IF;
 hash:=encode(sha256(bytes),'hex');
 INSERT INTO app.delivery_export_artifact(id,tenant_id,content,content_hash) VALUES(k,l.tenant_id,bytes,hash);
 PERFORM app.delivery_external_event(l,'delivery.export.generated',k,jsonb_build_object('format',e.format,'reportingPurpose',e.reporting_purpose,'contentHash',hash,'schemaVersion',1));
 RETURN bytes;
END $$;
REVOKE ALL ON FUNCTION app.delivery_authorized(text,text),app.delivery_mission_dto(app.delivery_publication),app.delivery_report(text,text),app.delivery_external_event(app.delivery_link,text,uuid,jsonb),app.delivery_respond(text,uuid,uuid,text),app.delivery_export_prepare(text,uuid,text,text),app.delivery_export_finish(text,uuid,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.delivery_report(text,text),app.delivery_respond(text,uuid,uuid,text),app.delivery_export_prepare(text,uuid,text,text),app.delivery_export_finish(text,uuid,bytea) TO corridra_runtime;
