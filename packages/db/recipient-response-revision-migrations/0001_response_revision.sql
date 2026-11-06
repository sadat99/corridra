-- Optional recipient response revision (CRUD gap G7, module 3). A recipient who answered through their private link may correct that
-- answer while the link is still valid. Overlay only: app.recipient_detail_response is never rewritten. Each correction is one
-- append-only, versioned row in app.recipient_detail_response_revision; the recipient's own view and the team's response list read the
-- latest. A correction can never widen what the link allows: it is checked by exactly the same rules as the first answer (the same
-- disclosure: role, quotation, meeting interest), it must restate the acknowledgement, its retention is the original's and is never
-- extended, and it is refused once the team has recorded any review decision on that reply, or the link is revoked or expired.
DO $guard$ BEGIN
 IF to_regclass('app.recipient_detail_response') IS NULL OR to_regclass('app.recipient_disclosure') IS NULL OR to_regclass('app.buyer_link') IS NULL
 OR to_regprocedure('app.recipient_detail_view(text)') IS NULL OR to_regprocedure('app.recipient_detail_respond(text,uuid,jsonb)') IS NULL
 OR to_regprocedure('app.buyer_link_access(uuid,uuid,boolean)') IS NULL OR to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regprocedure('app.record_capability_change()') IS NULL OR to_regprocedure('app.can_access(uuid,text,text)') IS NULL
 OR to_regprocedure('app.real_use_allowed(uuid)') IS NULL OR to_regprocedure('app.tenant_processing_purpose(uuid)') IS NULL
 THEN RAISE EXCEPTION 'Response revision prerequisites are missing'; END IF;
END $guard$;

CREATE TABLE app.recipient_detail_response_revision (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,response_id uuid NOT NULL,link_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 20),
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND length(body::text)<8000),
 source_kind text NOT NULL DEFAULT 'SELF_DECLARATION' CHECK(source_kind='SELF_DECLARATION'),
 retention_until timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,response_id,version),
 FOREIGN KEY(tenant_id,response_id) REFERENCES app.recipient_detail_response(tenant_id,id),
 FOREIGN KEY(tenant_id,link_id) REFERENCES app.buyer_link(tenant_id,id),
 CHECK(retention_until>created_at)
);
ALTER TABLE app.recipient_detail_response_revision ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.recipient_detail_response_revision FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
-- Versions run 1, 2, 3 in order for one reply, so two corrections can never share a version.
CREATE FUNCTION app.recipient_revision_order() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.version<>coalesce((SELECT max(version) FROM app.recipient_detail_response_revision WHERE tenant_id=NEW.tenant_id AND response_id=NEW.response_id),0)+1
 THEN RAISE EXCEPTION 'Response revision out of order' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.recipient_revision_order() FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER version_order BEFORE INSERT ON app.recipient_detail_response_revision FOR EACH ROW EXECUTE FUNCTION app.recipient_revision_order();
-- The same event the first answer writes (ids and status only, never the body).
CREATE TRIGGER event AFTER INSERT ON app.recipient_detail_response_revision FOR EACH ROW EXECUTE FUNCTION app.record_capability_change();
-- Readable by exactly the people who can read the reply it corrects, and only while the link and retention allow.
CREATE POLICY read ON app.recipient_detail_response_revision FOR SELECT TO corridra_runtime
 USING(app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND app.buyer_link_access(tenant_id,link_id) AND retention_until>now());
CREATE POLICY real_use_read ON app.recipient_detail_response_revision FOR SELECT TO corridra_runtime
 USING(app.real_use_allowed(tenant_id) AND app.can_access(tenant_id,'INTERNAL',app.tenant_processing_purpose(tenant_id)) AND app.buyer_link_access(tenant_id,link_id) AND retention_until>now());
REVOKE ALL ON app.recipient_detail_response_revision FROM PUBLIC,corridra_auth,corridra_runtime;
GRANT SELECT ON app.recipient_detail_response_revision TO corridra_runtime;

-- Whether the team has recorded any review decision on this reply. The review module is optional, so it is looked up by name.
CREATE FUNCTION app.recipient_response_reviewed(target uuid,reply uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE found boolean:=false;
BEGIN
 IF to_regclass('app.recipient_reply_review') IS NOT NULL THEN
  EXECUTE 'SELECT EXISTS(SELECT FROM app.recipient_reply_review WHERE tenant_id=$1 AND response_id=$2)' INTO found USING target,reply;
 END IF;
 RETURN found;
END $$;
REVOKE ALL ON FUNCTION app.recipient_response_reviewed(uuid,uuid) FROM PUBLIC,corridra_runtime,corridra_auth;

-- The rules for an answer body, exactly as app.recipient_detail_respond applies them to the first answer (a test compares the text).
CREATE FUNCTION app.recipient_detail_body_check(b jsonb,d app.recipient_disclosure) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j jsonb;
BEGIN
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
END $$;
REVOKE ALL ON FUNCTION app.recipient_detail_body_check(jsonb,app.recipient_disclosure) FROM PUBLIC,corridra_runtime,corridra_auth;

-- One correction through the private link. expected is the version the recipient saw (0 before any correction).
-- Idempotent by the command id k: the same command with the same body is a replay; a different body under it conflicts.
CREATE FUNCTION app.recipient_detail_revise(h text,k uuid,expected integer,b jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app.buyer_link;d app.recipient_disclosure;orig app.recipient_detail_response;prior app.recipient_detail_response_revision;service uuid;n integer;
BEGIN
 SELECT * INTO l FROM app.buyer_link WHERE token_hash=h FOR UPDATE;
 IF l.id IS NULL OR app.recipient_detail_view(h) IS NULL THEN RETURN NULL; END IF;
 IF k IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 19 THEN RAISE EXCEPTION 'Invalid response revision' USING ERRCODE='23514'; END IF;
 SELECT * INTO d FROM app.recipient_disclosure WHERE tenant_id=l.tenant_id AND link_id=l.id;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Detailed response not enabled' USING ERRCODE='42501'; END IF;
 PERFORM app.recipient_detail_body_check(b,d);
 SELECT * INTO orig FROM app.recipient_detail_response WHERE tenant_id=l.tenant_id AND link_id=l.id;
 IF orig.id IS NULL THEN RAISE EXCEPTION 'Respond before correcting' USING ERRCODE='23514'; END IF;
 IF orig.retention_until<=now() THEN RETURN NULL; END IF;
 -- The same lock a review decision takes, so a review and a correction cannot pass each other.
 PERFORM pg_advisory_xact_lock(hashtextextended('app.reply_review:'||l.tenant_id::text||':'||orig.id::text,0));
 SELECT * INTO prior FROM app.recipient_detail_response_revision WHERE tenant_id=l.tenant_id AND id=k;
 IF prior.id IS NOT NULL THEN
  IF prior.response_id<>orig.id OR prior.body<>b THEN RAISE EXCEPTION 'Response key reused' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('recorded',true,'version',prior.version,'sourceKind','SELF_DECLARATION');
 END IF;
 IF app.recipient_response_reviewed(l.tenant_id,orig.id) THEN RAISE EXCEPTION 'The team has already reviewed this response' USING ERRCODE='23514'; END IF;
 SELECT coalesce(max(version),0) INTO n FROM app.recipient_detail_response_revision WHERE tenant_id=l.tenant_id AND response_id=orig.id;
 IF n<>expected THEN RAISE EXCEPTION 'Response changed; reload before saving' USING ERRCODE='23514'; END IF;
 IF n>=20 THEN RAISE EXCEPTION 'Response revision limit reached' USING ERRCODE='23514'; END IF;
 SELECT dest.service_id INTO service FROM app.intake_destination dest JOIN identity.principal p ON p.id=dest.service_id WHERE dest.tenant_id=l.tenant_id AND dest.enabled AND p.kind='service' AND p.disabled_at IS NULL;
 IF service IS NULL THEN RETURN NULL; END IF;
 INSERT INTO app.recipient_detail_response_revision(id,tenant_id,response_id,link_id,version,body,retention_until,created_by)
 VALUES(k,l.tenant_id,orig.id,l.id,n+1,b,orig.retention_until,service);
 RETURN jsonb_build_object('recorded',true,'version',n+1,'sourceKind','SELF_DECLARATION');
END $$;
REVOKE ALL ON FUNCTION app.recipient_detail_revise(text,uuid,integer,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.recipient_detail_revise(text,uuid,integer,jsonb) TO corridra_runtime;

-- The recipient's own view shows the latest answer, how many corrections were made, and whether another is still possible.
DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.recipient_detail_view(text)'::regprocedure),'UTF8')),'hex')<>'bbc55f4830292cf86d2dc8bfdcea8e8c170b28b854cdfcca4b476a388f1732d1' THEN RAISE EXCEPTION 'Response revision prerequisite function differs: app.recipient_detail_view (%)',encode(sha256(convert_to(pg_get_functiondef('app.recipient_detail_view(text)'::regprocedure),'UTF8')),'hex');END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.recipient_detail_view(h text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v jsonb:=app.buyer_view(h);l app.buyer_link;d app.recipient_disclosure; BEGIN
 IF v IS NULL THEN RETURN NULL; END IF;SELECT * INTO l FROM app.buyer_link WHERE token_hash=h;SELECT * INTO d FROM app.recipient_disclosure WHERE tenant_id=l.tenant_id AND link_id=l.id;
 IF d.id IS NULL THEN RETURN v||jsonb_build_object('role','BUYER'); END IF;
 IF d.rfq_id IS NOT NULL AND NOT EXISTS(SELECT FROM app.mission_rfq r WHERE r.tenant_id=d.tenant_id AND r.id=d.rfq_id AND app.experience_source_valid(r.tenant_id,r.source_id,r.claim_id,d.created_by)) THEN RETURN NULL; END IF;
 RETURN v||jsonb_build_object('role',d.role,'sharedRequirements',d.shared_requirements,'sharedUncertainty',d.uncertainty,'allowQuotation',d.allow_quotation,'allowMeetingInterest',d.allow_meeting_interest,'detailResponse',(SELECT jsonb_build_object('body',coalesce(x.body,o.body),'sourceKind',o.source_kind,'createdAt',o.created_at,'version',coalesce(x.version,0),'revisedAt',x.created_at,'canRevise',coalesce(x.version,0)<20 AND NOT app.recipient_response_reviewed(o.tenant_id,o.id)) FROM app.recipient_detail_response o LEFT JOIN LATERAL(SELECT y.body,y.version,y.created_at FROM app.recipient_detail_response_revision y WHERE y.tenant_id=o.tenant_id AND y.response_id=o.id ORDER BY y.version DESC LIMIT 1) x ON true WHERE o.tenant_id=l.tenant_id AND o.link_id=l.id AND o.retention_until>now()));
END $$;
