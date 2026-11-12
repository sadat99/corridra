-- Reply to supplier offer binding (ADR-081). A Corridra team member carries a published supplier reply into the existing "Record a
-- supplier offer" command; the database proves the recorded offer is exactly what the supplier stated, in the same transaction.
-- Additive only: one new append-only table and two new functions. No existing table, column, constraint, policy, trigger, grant or
-- function changes, and nothing is written unless the application calls the write function. Safe to stop: pausing reply review makes
-- the write function refuse. The binding holds ids, the version number and a digest only; no supplier words, terms or amounts.

DO $guard$ BEGIN
 IF to_regprocedure('app.actor_id()') IS NULL OR to_regprocedure('app.member_role(uuid)') IS NULL
 OR to_regprocedure('app.can_access(uuid,text,text)') IS NULL OR to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regprocedure('app.record_change()') IS NULL OR to_regprocedure('app.real_use_allowed(uuid)') IS NULL
 OR to_regprocedure('app.tenant_processing_purpose(uuid)') IS NULL OR to_regprocedure('app.buyer_link_access(uuid,uuid,boolean)') IS NULL
 OR to_regprocedure('app.research_target_access(uuid,uuid,boolean)') IS NULL OR to_regprocedure('app.reply_review_open()') IS NULL
 OR to_regprocedure('app.reply_review_status()') IS NULL OR to_regprocedure('app.guard_commercial_mission()') IS NULL
 OR to_regprocedure('app.recipient_detail_respond(text,uuid,jsonb)') IS NULL
 OR to_regclass('app.tenant') IS NULL OR to_regclass('app.mission') IS NULL OR to_regclass('app.mission_intake') IS NULL
 OR to_regclass('app.mission_requirements') IS NULL OR to_regclass('app.mission_route_assignment') IS NULL
 OR to_regclass('app.corridor_pack_version') IS NULL OR to_regclass('app.mission_rfq') IS NULL
 OR to_regclass('app.mission_quotation') IS NULL OR to_regclass('app.commercial_mission_command') IS NULL
 OR to_regclass('app.target_account') IS NULL OR to_regclass('app.source_record') IS NULL OR to_regclass('app.communication') IS NULL
 OR to_regclass('app.buyer_link') IS NULL OR to_regclass('app.recipient_disclosure') IS NULL
 OR to_regclass('app.recipient_detail_response') IS NULL OR to_regclass('app.recipient_reply_review') IS NULL
 OR pg_get_functiondef('app.guard_commercial_mission()'::regprocedure) NOT LIKE '%''spares'',''commissioning''%'
 OR pg_get_functiondef('app.recipient_detail_respond(text,uuid,jsonb)'::regprocedure) NOT LIKE '%''spares'',''commissioning''%'
 THEN RAISE EXCEPTION 'Reply quotation binding prerequisites are missing'; END IF;
END $guard$;

-- One row per supplier offer that was recorded from a published reply. Unique per offer and per reply: one reply becomes at most one
-- recorded offer. reply_version is deliberately not called version, because the event trigger reads a column of that name.
CREATE TABLE app.reply_quotation_binding (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,quotation_id uuid NOT NULL,response_id uuid NOT NULL,review_id uuid NOT NULL,
 reply_version integer NOT NULL CHECK(reply_version BETWEEN 0 AND 20),
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[0-9a-f]{64}$'),
 mission_id uuid NOT NULL,rfq_id uuid NOT NULL,target_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,quotation_id),UNIQUE(tenant_id,response_id),
 FOREIGN KEY(tenant_id,quotation_id) REFERENCES app.mission_quotation(tenant_id,id),
 FOREIGN KEY(tenant_id,response_id) REFERENCES app.recipient_detail_response(tenant_id,id),
 FOREIGN KEY(tenant_id,review_id) REFERENCES app.recipient_reply_review(tenant_id,id),
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id),
 FOREIGN KEY(tenant_id,rfq_id) REFERENCES app.mission_rfq(tenant_id,id),
 FOREIGN KEY(tenant_id,target_id) REFERENCES app.target_account(tenant_id,id)
);
ALTER TABLE app.reply_quotation_binding ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.reply_quotation_binding FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
-- The event holds the row id and version 1 only, never the digest or any term.
CREATE TRIGGER reply_quotation_binding_event AFTER INSERT ON app.reply_quotation_binding FOR EACH ROW EXECUTE FUNCTION app.record_change();
-- A binding is readable only by someone who can read both the offer and the reply: each subquery runs with the reader's own rights, so
-- the offer's target access and the reply's own read policy both apply.
CREATE POLICY read ON app.reply_quotation_binding FOR SELECT TO corridra_runtime
 USING(app.can_access(tenant_id,'INTERNAL','synthetic_validation')
  AND EXISTS(SELECT FROM app.mission_quotation q WHERE q.tenant_id=reply_quotation_binding.tenant_id AND q.id=reply_quotation_binding.quotation_id)
  AND EXISTS(SELECT FROM app.recipient_detail_response r WHERE r.tenant_id=reply_quotation_binding.tenant_id AND r.id=reply_quotation_binding.response_id));
CREATE POLICY real_use_read ON app.reply_quotation_binding FOR SELECT TO corridra_runtime
 USING(app.real_use_allowed(tenant_id) AND app.can_access(tenant_id,'INTERNAL',app.tenant_processing_purpose(tenant_id))
  AND EXISTS(SELECT FROM app.mission_quotation q WHERE q.tenant_id=reply_quotation_binding.tenant_id AND q.id=reply_quotation_binding.quotation_id)
  AND EXISTS(SELECT FROM app.recipient_detail_response r WHERE r.tenant_id=reply_quotation_binding.tenant_id AND r.id=reply_quotation_binding.response_id));
REVOKE ALL ON app.reply_quotation_binding FROM PUBLIC,corridra_auth,corridra_runtime;
GRANT SELECT ON app.reply_quotation_binding TO corridra_runtime;

-- The one way to write a binding. The application calls it after it inserted the offer and before it writes the command record, in the
-- same transaction, so any refusal rolls the offer back. Every check is repeated here after the locks, so a direct call cannot skip a
-- step. Messages are fixed text: nothing the supplier typed and no digest is ever put in a message.
-- Lock order: the tenant commercial-missions lock (the offer insert's guard takes it) and then the reply lock, the same lock a review
-- decision and a correction take; the correction and review paths never take the tenant lock, so the order cannot invert. The link and
-- the reply are not row-locked here, because a correction locks the link row before it takes the reply lock.
CREATE FUNCTION app.bind_reply_quotation(quotation uuid,reply uuid,seen integer,digest text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;actor uuid:=app.actor_id();
 q app.mission_quotation;r app.recipient_detail_response;rv app.recipient_reply_review;d app.recipient_disclosure;f app.mission_rfq;
 n integer;body jsonb;stated timestamptz;said jsonb;target uuid;kind text;bound uuid;
BEGIN
 IF tenant IS NULL OR actor IS NULL OR app.member_role(tenant) IS NULL OR app.member_role(tenant) NOT IN ('owner','admin','operator')
  OR NOT app.can_access(tenant,'INTERNAL',app.tenant_processing_purpose(tenant))
  OR NOT EXISTS(SELECT FROM app.tenant t WHERE t.id=tenant AND (t.synthetic OR app.real_use_allowed(t.id)))
 THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 IF quotation IS NULL OR reply IS NULL OR seen IS NULL OR seen NOT BETWEEN 0 AND 20 OR digest IS NULL OR digest !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'Invalid reply binding' USING ERRCODE='23514'; END IF;
 IF NOT app.reply_review_open() THEN RAISE EXCEPTION 'Reply review is not open' USING ERRCODE='42501'; END IF;
 -- The offer must be the one this actor inserted in this transaction (now() is the transaction start), before its command record.
 SELECT * INTO q FROM app.mission_quotation x WHERE x.tenant_id=tenant AND x.id=quotation;
 IF q.id IS NULL OR q.created_by<>actor OR q.created_at<>now()
  OR EXISTS(SELECT FROM app.commercial_mission_command c WHERE c.tenant_id=tenant AND c.id=quotation)
 THEN RAISE EXCEPTION 'Offer must be recorded in this request' USING ERRCODE='23514'; END IF;
 IF NOT app.research_target_access(tenant,q.target_id) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('app.reply_review:'||tenant::text||':'||reply::text,0));
 SELECT * INTO r FROM app.recipient_detail_response x WHERE x.tenant_id=tenant AND x.id=reply AND x.retention_until>clock_timestamp()
  AND app.buyer_link_access(x.tenant_id,x.link_id);
 IF r.id IS NULL THEN RAISE EXCEPTION 'Reply not found' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM app.reply_quotation_binding b WHERE b.tenant_id=tenant AND (b.quotation_id=quotation OR b.response_id=reply))
 THEN RAISE EXCEPTION 'This reply is already recorded as an offer' USING ERRCODE='23514'; END IF;
 SELECT * INTO rv FROM app.recipient_reply_review x WHERE x.tenant_id=tenant AND x.response_id=reply AND x.decision='PUBLISH' ORDER BY x.created_at LIMIT 1;
 IF rv.id IS NULL THEN RAISE EXCEPTION 'This reply has not been published' USING ERRCODE='23514'; END IF;
 -- The reply, its one disclosure, the RFQ and the supplier it was sent to must be the offer's own RFQ, mission and supplier.
 SELECT * INTO d FROM app.recipient_disclosure x WHERE x.tenant_id=tenant AND x.link_id=r.link_id;
 SELECT * INTO f FROM app.mission_rfq x WHERE x.tenant_id=tenant AND x.id=d.rfq_id;
 SELECT c.target_id INTO target FROM app.buyer_link l JOIN app.communication c ON c.tenant_id=l.tenant_id AND c.id=l.message_id WHERE l.tenant_id=tenant AND l.id=r.link_id;
 IF d.id IS NULL OR d.role<>'SUPPLIER' OR NOT d.allow_quotation OR d.rfq_id IS DISTINCT FROM q.rfq_id OR f.id IS NULL
  OR f.mission_id<>q.mission_id OR NOT q.target_id=ANY(f.target_ids) OR target IS DISTINCT FROM q.target_id
 THEN RAISE EXCEPTION 'Offer does not match the published reply' USING ERRCODE='23514'; END IF;
 -- The latest version is the one the team read. The correction module is optional, so it is looked up by name.
 n:=0;body:=r.body;stated:=r.created_at;
 IF to_regclass('app.recipient_detail_response_revision') IS NOT NULL THEN
  EXECUTE 'SELECT x.version,x.body,x.created_at FROM app.recipient_detail_response_revision x WHERE x.tenant_id=$1 AND x.response_id=$2 ORDER BY x.version DESC LIMIT 1'
  INTO n,body,stated USING tenant,reply;
  IF n IS NULL THEN n:=0;body:=r.body;stated:=r.created_at; END IF;
 END IF;
 IF n<>seen OR encode(sha256(convert_to(body::text,'UTF8')),'hex')<>digest
 THEN RAISE EXCEPTION 'Reply version changed; reload before confirming' USING ERRCODE='23514'; END IF;
 IF n>0 AND stated>rv.created_at THEN RAISE EXCEPTION 'This reply changed after it was published' USING ERRCODE='23514'; END IF;
 said:=body->'quotation';
 IF jsonb_typeof(said) IS DISTINCT FROM 'object'
  OR q.currency IS DISTINCT FROM said->>'currency' OR q.terms IS DISTINCT FROM said->'terms'
  OR q.uncertainties IS DISTINCT FROM said->>'uncertainties' OR q.observed_at<>stated
 THEN RAISE EXCEPTION 'Offer does not match the published reply' USING ERRCODE='23514'; END IF;
 SELECT s.kind INTO kind FROM app.source_record s WHERE s.tenant_id=tenant AND s.id=q.source_id;
 IF kind IS DISTINCT FROM 'self_declaration' THEN RAISE EXCEPTION 'Offer source must be a self-declared source' USING ERRCODE='23514'; END IF;
 INSERT INTO app.reply_quotation_binding(tenant_id,quotation_id,response_id,review_id,reply_version,body_sha256,mission_id,rfq_id,target_id,created_by)
 VALUES(tenant,quotation,reply,rv.id,n,digest,q.mission_id,q.rfq_id,q.target_id,actor) RETURNING id INTO bound;
 RETURN jsonb_build_object('id',bound);
END $$;
REVOKE ALL ON FUNCTION app.bind_reply_quotation(uuid,uuid,integer,text) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.bind_reply_quotation(uuid,uuid,integer,text) TO corridra_runtime;

-- What the form needs to carry a published reply: the exact strings the supplier stated and the first reason it cannot be recorded.
-- SECURITY INVOKER, so it reads only what the caller's own policies allow. When the reply cannot be recorded it returns a reason code and
-- nothing else (no words, no terms, no ids). It never returns the link token, contact data, the review note or anything outside the
-- nineteen offer term names. The application checks the caller's authority before calling it.
CREATE FUNCTION app.reply_quotation_prefill(reply uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 r app.recipient_detail_response;rv app.recipient_reply_review;d app.recipient_disclosure;f app.mission_rfq;req app.mission_requirements;pack app.corridor_pack_version;
 n integer;body jsonb;stated timestamptz;said jsonb;target uuid;previous app.mission_quotation;
 names text[]:=ARRAY['specification','quantity','moq','unit','unitPriceMinor','totalPriceMinor','toolingMinor','setupMinor','packagingMinor','leadTime','validUntil','incoterm','shipping','warranty','installation','training','spares','commissioning','paymentTerms'];
 -- A value the offer command would trim or refuse is not carried: the command trims text and the database compares exactly.
 edge text:='^[[:space:]   -     　﻿]|[[:space:]   -     　﻿]$';
BEGIN
 IF tenant IS NULL OR reply IS NULL THEN RETURN jsonb_build_object('eligible',false,'reason','NOT_FOUND'); END IF;
 SELECT * INTO r FROM app.recipient_detail_response x WHERE x.tenant_id=tenant AND x.id=reply AND x.retention_until>clock_timestamp();
 IF r.id IS NULL THEN RETURN jsonb_build_object('eligible',false,'reason','NOT_FOUND'); END IF;
 IF EXISTS(SELECT FROM app.recipient_reply_review x WHERE x.tenant_id=tenant AND x.response_id=reply AND x.decision='REJECT')
 THEN RETURN jsonb_build_object('eligible',false,'reason','REJECTED'); END IF;
 SELECT * INTO rv FROM app.recipient_reply_review x WHERE x.tenant_id=tenant AND x.response_id=reply AND x.decision='PUBLISH' ORDER BY x.created_at LIMIT 1;
 IF rv.id IS NULL THEN
  IF EXISTS(SELECT FROM app.recipient_reply_review x WHERE x.tenant_id=tenant AND x.response_id=reply AND x.decision='ASK')
  THEN RETURN jsonb_build_object('eligible',false,'reason','ASKED_ONLY'); END IF;
  RETURN jsonb_build_object('eligible',false,'reason','NOT_PUBLISHED');
 END IF;
 IF EXISTS(SELECT FROM app.reply_quotation_binding b WHERE b.tenant_id=tenant AND b.response_id=reply)
 THEN RETURN jsonb_build_object('eligible',false,'reason','ALREADY_RECORDED'); END IF;
 n:=0;body:=r.body;stated:=r.created_at;
 IF to_regclass('app.recipient_detail_response_revision') IS NOT NULL THEN
  EXECUTE 'SELECT x.version,x.body,x.created_at FROM app.recipient_detail_response_revision x WHERE x.tenant_id=$1 AND x.response_id=$2 ORDER BY x.version DESC LIMIT 1'
  INTO n,body,stated USING tenant,reply;
  IF n IS NULL THEN n:=0;body:=r.body;stated:=r.created_at; END IF;
 END IF;
 said:=body->'quotation';
 SELECT * INTO d FROM app.recipient_disclosure x WHERE x.tenant_id=tenant AND x.link_id=r.link_id;
 SELECT * INTO f FROM app.mission_rfq x WHERE x.tenant_id=tenant AND x.id=d.rfq_id;
 SELECT c.target_id INTO target FROM app.buyer_link l JOIN app.communication c ON c.tenant_id=l.tenant_id AND c.id=l.message_id WHERE l.tenant_id=tenant AND l.id=r.link_id;
 IF jsonb_typeof(said) IS DISTINCT FROM 'object' OR d.id IS NULL OR d.role<>'SUPPLIER' OR NOT d.allow_quotation OR f.id IS NULL
  OR target IS NULL OR NOT target=ANY(f.target_ids)
 THEN RETURN jsonb_build_object('eligible',false,'reason','NO_QUOTATION'); END IF;
 IF NOT app.reply_review_status() THEN RETURN jsonb_build_object('eligible',false,'reason','REVIEW_CLOSED'); END IF;
 IF NOT EXISTS(SELECT FROM app.mission m JOIN app.mission_intake i ON i.tenant_id=m.tenant_id AND i.id=m.id WHERE m.tenant_id=tenant AND m.id=f.mission_id AND m.status NOT IN ('CLOSED','CANCELLED') AND i.retention_until>now())
 THEN RETURN jsonb_build_object('eligible',false,'reason','MISSION_CLOSED'); END IF;
 SELECT * INTO req FROM app.mission_requirements x WHERE x.tenant_id=tenant AND x.id=f.requirement_id AND x.mission_id=f.mission_id;
 IF req.id IS NULL OR req.version<>(SELECT max(x.version) FROM app.mission_requirements x WHERE x.tenant_id=tenant AND x.mission_id=f.mission_id)
  OR req.assignment_id IS DISTINCT FROM (SELECT x.id FROM app.mission_route_assignment x WHERE x.tenant_id=tenant AND x.mission_id=f.mission_id ORDER BY x.version DESC LIMIT 1)
 THEN RETURN jsonb_build_object('eligible',false,'reason','REQUIREMENT_SUPERSEDED'); END IF;
 SELECT p.* INTO pack FROM app.mission_route_assignment a JOIN app.corridor_pack_version p ON p.tenant_id=a.tenant_id AND p.id=a.pack_id WHERE a.tenant_id=tenant AND a.id=req.assignment_id;
 IF pack.id IS NULL OR jsonb_typeof(said->'currency') IS DISTINCT FROM 'string' OR NOT coalesce(pack.configuration->'currencies' ? (said->>'currency'),false)
 THEN RETURN jsonb_build_object('eligible',false,'reason','CURRENCY_NOT_ON_ROUTE'); END IF;
 IF jsonb_typeof(said->'terms') IS DISTINCT FROM 'object' OR jsonb_typeof(said->'uncertainties') IS DISTINCT FROM 'string'
  OR said->>'uncertainties' ~ edge OR length(said->>'uncertainties') NOT BETWEEN 3 AND 1000
  OR EXISTS(SELECT FROM jsonb_each(said->'terms') e WHERE e.key<>ALL(names) OR jsonb_typeof(e.value)<>'string'
   OR (e.key IN ('specification','leadTime','warranty','installation','training','spares','commissioning','paymentTerms') AND ((e.value#>>'{}') ~ edge OR length(e.value#>>'{}') NOT BETWEEN 3 AND 1000))
   OR (e.key='unit' AND ((e.value#>>'{}') ~ edge OR length(e.value#>>'{}') NOT BETWEEN 1 AND 80))
   OR (e.key IN ('unitPriceMinor','totalPriceMinor','toolingMinor','setupMinor','packagingMinor') AND (e.value#>>'{}') !~ '^(0|[1-9][0-9]{0,17})$')
   OR (e.key IN ('quantity','moq') AND (e.value#>>'{}') !~ '^[1-9][0-9]{0,11}$')
   OR (e.key='validUntil' AND (e.value#>>'{}') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$')
   OR (e.key='shipping' AND (e.value#>>'{}') NOT IN ('INCLUDED','EXCLUDED','NOT_SUPPLIED'))
   OR (e.key='incoterm' AND (e.value#>>'{}') NOT IN ('EXW','FCA','CPT','CIP','DAP','DPU','DDP','FAS','FOB','CFR','CIF')))
 THEN RETURN jsonb_build_object('eligible',false,'reason','TERM_NOT_RECORDABLE'); END IF;
 SELECT * INTO previous FROM app.mission_quotation x WHERE x.tenant_id=tenant AND x.rfq_id=f.id AND x.target_id=target ORDER BY x.revision DESC LIMIT 1;
 RETURN jsonb_build_object('eligible',true,'reason',NULL,'responseId',reply,'seen',n,
  'digest',encode(sha256(convert_to(body::text,'UTF8')),'hex'),'missionId',f.mission_id,'rfqId',f.id,'requirementId',f.requirement_id,'targetId',target,
  'currency',said->>'currency','terms',said->'terms','uncertainties',said->>'uncertainties',
  'observedAt',to_char(stated AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'sourceKind','SELF_DECLARATION',
  'revision',coalesce(previous.revision,0)+1,'previousId',previous.id);
END $$;
REVOKE ALL ON FUNCTION app.reply_quotation_prefill(uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.reply_quotation_prefill(uuid) TO corridra_runtime;
