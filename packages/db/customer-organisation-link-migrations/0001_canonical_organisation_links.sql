-- Optional additive module: canonical organisation linking with evidence, deduplication and protected staff review.
-- Customer input never writes to app.organisation. A claim is a private, append-only request that a workspace's
-- organisation IS an existing catalogue organisation or a proposed new one. Only existing staff authority decides,
-- and a link is a row in an append-only ledger that is ended by a newer row, never rewritten.
CREATE TABLE customer_private.organisation_link_claim (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 profile_revision_id uuid NOT NULL,
 profile_version integer NOT NULL CHECK(profile_version BETWEEN 1 AND 2147483646),
 kind text NOT NULL CHECK(kind IN ('EXISTING','PROPOSED_NEW')),
 organisation_id uuid REFERENCES app.organisation(id),
 name_key text NOT NULL CHECK(name_key ~ '^[[:alnum:]]{1,200}$'),
 country_code text NOT NULL CHECK(country_code ~ '^[A-Z]{2}$'),
 host_key text CHECK(host_key IS NULL OR length(host_key) BETWEEN 3 AND 200),
 note text NOT NULL CHECK(note=btrim(note) AND length(note) BETWEEN 11 AND 1000 AND note LIKE 'Synthetic %' AND note !~ '[[:cntrl:]]'),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,profile_revision_id) REFERENCES customer_private.organisation_profile_revision(tenant_id,id),
 CHECK((kind='EXISTING')=(organisation_id IS NOT NULL))
);
CREATE INDEX organisation_link_claim_tenant ON customer_private.organisation_link_claim(tenant_id,created_at DESC);
CREATE INDEX organisation_link_claim_name ON customer_private.organisation_link_claim(name_key,country_code);
CREATE INDEX organisation_link_claim_host ON customer_private.organisation_link_claim(host_key) WHERE host_key IS NOT NULL;

-- Every state change of a claim is one appended row; the current state is the state of the last row.
CREATE TABLE customer_private.organisation_link_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 claim_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 1000),
 kind text NOT NULL CHECK(kind IN ('filed','evidence_added','evidence_requested','creation_approved','approved','rejected','withdrawn','link_ended')),
 state text NOT NULL CHECK(state IN ('pending','needs_evidence','creation_approved','approved','rejected','withdrawn','ended')),
 customer_actor uuid REFERENCES customer_private.principal(id),
 staff_actor uuid REFERENCES identity.principal(id),
 -- Text the customer is meant to read. Internal staff notes are kept apart and never returned to a customer.
 reason text CHECK(reason IS NULL OR (reason=btrim(reason) AND length(reason) BETWEEN 3 AND 1000 AND reason !~ '[[:cntrl:]]')),
 internal_note text CHECK(internal_note IS NULL OR (internal_note=btrim(internal_note) AND length(internal_note) BETWEEN 3 AND 1000 AND internal_note !~ '[[:cntrl:]]')),
 organisation_id uuid REFERENCES app.organisation(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(claim_id,seq),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,claim_id) REFERENCES customer_private.organisation_link_claim(tenant_id,id),
 CHECK((kind IN ('filed','evidence_added','withdrawn'))=(customer_actor IS NOT NULL)),
 CHECK((kind IN ('filed','evidence_added','withdrawn'))<>(staff_actor IS NOT NULL)),
 CHECK(kind IN ('filed','evidence_added','withdrawn') OR reason IS NOT NULL),
 CHECK(internal_note IS NULL OR staff_actor IS NOT NULL),
 CHECK((kind IN ('approved','link_ended'))=(organisation_id IS NOT NULL)),
 CHECK((kind,state) IN (('filed','pending'),('evidence_added','pending'),('evidence_added','creation_approved'),('evidence_requested','needs_evidence'),
  ('creation_approved','creation_approved'),('approved','approved'),('rejected','rejected'),('withdrawn','withdrawn'),('link_ended','ended')))
);
CREATE INDEX organisation_link_event_claim ON customer_private.organisation_link_event(claim_id,seq DESC);

-- Typed text statements only. No file, upload or document exists in this module.
CREATE TABLE customer_private.organisation_link_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 claim_id uuid NOT NULL,
 event_id uuid NOT NULL UNIQUE,
 position integer NOT NULL CHECK(position BETWEEN 1 AND 8),
 kind text NOT NULL CHECK(kind IN ('REGISTRATION_STATEMENT','WEBSITE_STATEMENT','TRADE_REFERENCE_STATEMENT','AUTHORISATION_STATEMENT')),
 statement text NOT NULL CHECK(statement=btrim(statement) AND length(statement) BETWEEN 11 AND 1000 AND statement LIKE 'Synthetic %' AND statement !~ '[[:cntrl:]]'),
 url text CHECK(url IS NULL OR (length(url)<=200 AND url ~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.(example|test|invalid)(/[A-Za-z0-9._~/-]*)?$')),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(claim_id,position),
 FOREIGN KEY(tenant_id,claim_id) REFERENCES customer_private.organisation_link_claim(tenant_id,id),
 FOREIGN KEY(tenant_id,event_id) REFERENCES customer_private.organisation_link_event(tenant_id,id)
);

-- The link ledger. A workspace has a numbered sequence of rows that must alternate linked, unlinked, linked, ...
-- so at most one approved link is active at a time and no earlier row is ever changed.
CREATE TABLE customer_private.organisation_link (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 100000),
 state text NOT NULL CHECK(state IN ('linked','unlinked')),
 claim_id uuid NOT NULL,
 organisation_id uuid NOT NULL REFERENCES app.organisation(id),
 -- True when staff linked this workspace to an organisation another workspace was already linked to.
 shared boolean NOT NULL DEFAULT false CHECK(state='linked' OR NOT shared),
 staff_actor uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,version),
 FOREIGN KEY(tenant_id,claim_id) REFERENCES customer_private.organisation_link_claim(tenant_id,id)
);
CREATE INDEX organisation_link_organisation ON customer_private.organisation_link(organisation_id,tenant_id,version DESC);

CREATE TABLE customer_private.organisation_link_request (
 actor_kind text NOT NULL CHECK(actor_kind IN ('customer','staff')),
 actor_id uuid NOT NULL,command_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('file','add_evidence','withdraw','decide')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_kind,actor_id,command_id)
);

CREATE FUNCTION customer_private.organisation_link_open_claim(p_target uuid) RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT c.id FROM customer_private.organisation_link_claim c
 WHERE c.tenant_id=p_target
 AND (SELECT e.state FROM customer_private.organisation_link_event e WHERE e.claim_id=c.id ORDER BY e.seq DESC LIMIT 1) IN ('pending','needs_evidence','creation_approved')
 ORDER BY c.created_at DESC,c.id LIMIT 1
$$;

-- Guards: a claim moves only along the allowed transitions and a workspace has one open claim at a time.
CREATE FUNCTION customer_private.organisation_link_event_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prev customer_private.organisation_link_event; claim customer_private.organisation_link_claim;
BEGIN
 SELECT * INTO claim FROM customer_private.organisation_link_claim c WHERE c.id=NEW.claim_id AND c.tenant_id=NEW.tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Company link request unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO prev FROM customer_private.organisation_link_event e WHERE e.claim_id=NEW.claim_id ORDER BY e.seq DESC LIMIT 1;
 IF NEW.seq<>coalesce(prev.seq,0)+1 THEN RAISE EXCEPTION 'Company link history must be appended in order' USING ERRCODE='23514'; END IF;
 IF NEW.kind='filed' THEN
  IF prev.id IS NOT NULL THEN RAISE EXCEPTION 'Company link request already filed' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT FROM customer_private.organisation_link_claim x WHERE x.tenant_id=NEW.tenant_id AND x.id<>NEW.claim_id
   AND (SELECT e.state FROM customer_private.organisation_link_event e WHERE e.claim_id=x.id ORDER BY e.seq DESC LIMIT 1) IN ('pending','needs_evidence','creation_approved')) THEN
   RAISE EXCEPTION 'A company link request is already open' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF prev.id IS NULL THEN RAISE EXCEPTION 'Company link request has no history' USING ERRCODE='23514'; END IF;
 IF NOT (
  (prev.state='pending' AND NEW.kind IN ('evidence_added','evidence_requested','creation_approved','approved','rejected','withdrawn'))
  OR (prev.state='needs_evidence' AND NEW.kind IN ('evidence_added','rejected','withdrawn'))
  OR (prev.state='creation_approved' AND NEW.kind IN ('evidence_added','approved','rejected','withdrawn'))
  OR (prev.state='approved' AND NEW.kind='link_ended')
 ) THEN RAISE EXCEPTION 'That change is not allowed for this company link request' USING ERRCODE='23514'; END IF;
 IF NEW.kind='creation_approved' AND claim.kind<>'PROPOSED_NEW' THEN RAISE EXCEPTION 'Only a proposed new organisation can be approved for creation' USING ERRCODE='23514'; END IF;
 IF NEW.kind='evidence_added' AND NEW.state<>(CASE WHEN prev.state='needs_evidence' THEN 'pending' ELSE prev.state END) THEN
  RAISE EXCEPTION 'Evidence keeps the request open' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION customer_private.organisation_link_ledger_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prev customer_private.organisation_link;
BEGIN
 SELECT * INTO prev FROM customer_private.organisation_link l WHERE l.tenant_id=NEW.tenant_id ORDER BY l.version DESC LIMIT 1;
 IF NEW.version<>coalesce(prev.version,0)+1 THEN RAISE EXCEPTION 'Link ledger must be appended in order' USING ERRCODE='23514'; END IF;
 IF NEW.state='linked' AND prev.id IS NOT NULL AND prev.state<>'unlinked' THEN
  RAISE EXCEPTION 'Only one active company link is allowed per workspace' USING ERRCODE='23514';
 END IF;
 IF NEW.state='unlinked' AND (prev.id IS NULL OR prev.state<>'linked' OR prev.claim_id<>NEW.claim_id OR prev.organisation_id<>NEW.organisation_id) THEN
  RAISE EXCEPTION 'Only the active company link can be ended' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER organisation_link_event_guard BEFORE INSERT ON customer_private.organisation_link_event FOR EACH ROW EXECUTE FUNCTION customer_private.organisation_link_event_guard();
CREATE TRIGGER organisation_link_ledger_guard BEFORE INSERT ON customer_private.organisation_link FOR EACH ROW EXECUTE FUNCTION customer_private.organisation_link_ledger_guard();
CREATE TRIGGER organisation_link_claim_immutable BEFORE UPDATE OR DELETE ON customer_private.organisation_link_claim FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER organisation_link_event_immutable BEFORE UPDATE OR DELETE ON customer_private.organisation_link_event FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER organisation_link_evidence_immutable BEFORE UPDATE OR DELETE ON customer_private.organisation_link_evidence FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER organisation_link_immutable BEFORE UPDATE OR DELETE ON customer_private.organisation_link FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER organisation_link_request_immutable BEFORE UPDATE OR DELETE ON customer_private.organisation_link_request FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.organisation_link_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.organisation_link_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.organisation_link_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.organisation_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.organisation_link_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.organisation_link_claim,customer_private.organisation_link_event,customer_private.organisation_link_evidence,customer_private.organisation_link,customer_private.organisation_link_request FROM PUBLIC,corridra_runtime,corridra_auth;

-- Normalisation used for deterministic matching: lower case, no leading "synthetic", no punctuation,
-- no common legal-form words, no spaces. Computed in the database so every caller agrees.
CREATE FUNCTION customer_private.organisation_link_name_key(p_name text) RETURNS text
 LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT regexp_replace(
  regexp_replace(
   regexp_replace(regexp_replace(lower(coalesce(p_name,'')),'^synthetic[[:space:]]+',''),'[^[:alnum:]]+',' ','g'),
   '\m(ltd|limited|llc|inc|incorporated|corp|corporation|co|company|gmbh|ag|sa|sl|srl|bv|nv|plc|pty|pvt|llp|oy|ab|spa)\M','','g'),
  '[^[:alnum:]]+','','g')
$$;
CREATE FUNCTION customer_private.organisation_link_host_key(p_url text) RETURNS text
 LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN p_url IS NULL THEN NULL ELSE regexp_replace(lower(substring(p_url from '^https://([^/]+)')),'^www\.','') END
$$;
-- The searchable catalogue: only organisations created from a current public-record identity. Never the raw table.
CREATE FUNCTION customer_private.organisation_link_public_organisation(p_organisation uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.organisation o JOIN app.public_identifier i ON i.organisation_id=o.id
 WHERE o.id=p_organisation AND o.synthetic AND i.synthetic AND i.valid_until>clock_timestamp())
$$;
CREATE FUNCTION customer_private.organisation_link_head(p_claim uuid) RETURNS TABLE(seq integer,state text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT e.seq,e.state FROM customer_private.organisation_link_event e WHERE e.claim_id=p_claim ORDER BY e.seq DESC LIMIT 1
$$;

CREATE FUNCTION customer_private.organisation_link_append(p_event uuid,p_claim uuid,p_kind text,p_state text,p_customer uuid,p_staff uuid,p_reason text,p_note text,p_organisation uuid) RETURNS integer
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid; v_seq integer;
BEGIN
 SELECT c.tenant_id INTO v_tenant FROM customer_private.organisation_link_claim c WHERE c.id=p_claim;
 IF NOT FOUND THEN RAISE EXCEPTION 'Company link request unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.seq),0)+1 INTO v_seq FROM customer_private.organisation_link_event e WHERE e.claim_id=p_claim;
 INSERT INTO customer_private.organisation_link_event(id,tenant_id,claim_id,seq,kind,state,customer_actor,staff_actor,reason,internal_note,organisation_id)
 VALUES(p_event,v_tenant,p_claim,v_seq,p_kind,p_state,p_customer,p_staff,p_reason,p_note,p_organisation);
 RETURN v_seq;
END $$;

-- One domain event, audit and outbox chain per real change. The payload carries ids and versions only.
CREATE FUNCTION customer_private.organisation_link_domain_event(p_target uuid,p_initiator_kind text,p_initiator uuid,p_command uuid,p_kind text,p_claim uuid,p_seq integer,p_state text) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_executor uuid; v_actor uuid; v_eid uuid:=gen_random_uuid(); v_version integer;
BEGIN
 IF p_initiator IS NULL THEN RAISE EXCEPTION 'Access expired' USING ERRCODE='42501'; END IF;
 IF p_initiator_kind='customer' THEN
  IF customer.actor_id() IS DISTINCT FROM p_initiator THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
  SELECT c.executor_id INTO v_executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
  WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
  IF v_executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
  v_actor:=v_executor;
 ELSE
  IF app.actor_id() IS DISTINCT FROM p_initiator THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
  v_actor:=p_initiator;
 END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v_version FROM app.domain_event e
 WHERE e.tenant_id=p_target AND e.aggregate_type='customer_organisation_link' AND e.aggregate_id=p_target::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(v_eid,p_target,'customer.organisation_link.'||p_kind,1,'customer_organisation_link',p_target::text,v_version,v_actor,clock_timestamp(),p_command,p_command,
 jsonb_build_object('claimId',p_claim,'version',p_seq,'state',p_state,'synthetic',true,'initiator_kind',p_initiator_kind,'initiator_id',p_initiator));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),p_target,v_eid,v_actor,'customer.organisation_link.'||p_kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),p_target,v_eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(v_eid,p_target);
END $$;

-- Deterministic candidates for one claim, for staff only: catalogue organisations and other workspaces' open or
-- active claims that match on the normalised name and country, or on the website host. Never shown to a customer.
CREATE FUNCTION customer_private.organisation_link_candidates(p_claim uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c customer_private.organisation_link_claim; organisations jsonb; workspaces jsonb;
BEGIN
 SELECT * INTO c FROM customer_private.organisation_link_claim x WHERE x.id=p_claim;
 IF NOT FOUND THEN RETURN jsonb_build_object('organisations','[]'::jsonb,'workspaces','[]'::jsonb); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'country',m.country,'reasons',to_jsonb(m.reasons),'linkedWorkspaces',m.linked) ORDER BY cardinality(m.reasons) DESC,m.name,m.id),'[]'::jsonb)
 INTO organisations FROM (
  SELECT o.id,o.name,o.country,
   array_remove(ARRAY[
    CASE WHEN customer_private.organisation_link_name_key(o.name)=c.name_key AND o.country=c.country_code THEN 'name_country' END,
    CASE WHEN c.host_key IS NOT NULL AND EXISTS(SELECT FROM app.public_identifier i WHERE i.organisation_id=o.id AND i.valid_until>clock_timestamp() AND i.domain=c.host_key) THEN 'website_host' END,
    CASE WHEN c.organisation_id=o.id THEN 'chosen_by_customer' END],NULL) reasons,
   (SELECT count(*)::int FROM (SELECT DISTINCT ON (l.tenant_id) l.state,l.organisation_id,l.tenant_id FROM customer_private.organisation_link l ORDER BY l.tenant_id,l.version DESC) h
    WHERE h.state='linked' AND h.organisation_id=o.id AND h.tenant_id<>c.tenant_id) linked
  FROM app.organisation o WHERE o.synthetic
 ) m WHERE cardinality(m.reasons)>0;
 SELECT coalesce(jsonb_agg(jsonb_build_object('claimId',m.id,'workspaceId',m.tenant_id,'state',m.state,'legalName',m.legal_name,'country',m.country_code,'reasons',to_jsonb(m.reasons)) ORDER BY m.created_at,m.id),'[]'::jsonb)
 INTO workspaces FROM (
  SELECT x.id,x.tenant_id,x.created_at,x.country_code,head.state,r.details->>'legalName' legal_name,
   array_remove(ARRAY[
    CASE WHEN x.name_key=c.name_key AND x.country_code=c.country_code THEN 'name_country' END,
    CASE WHEN c.host_key IS NOT NULL AND x.host_key=c.host_key THEN 'website_host' END,
    CASE WHEN c.organisation_id IS NOT NULL AND x.organisation_id=c.organisation_id THEN 'same_organisation' END],NULL) reasons
  FROM customer_private.organisation_link_claim x
  JOIN customer_private.organisation_profile_revision r ON r.tenant_id=x.tenant_id AND r.id=x.profile_revision_id
  CROSS JOIN LATERAL customer_private.organisation_link_head(x.id) head
  WHERE x.tenant_id<>c.tenant_id
  AND (head.state IN ('pending','needs_evidence','creation_approved')
   OR (head.state='approved' AND EXISTS(SELECT FROM (SELECT DISTINCT ON (l.tenant_id) l.state,l.claim_id FROM customer_private.organisation_link l WHERE l.tenant_id=x.tenant_id ORDER BY l.tenant_id,l.version DESC) h WHERE h.state='linked' AND h.claim_id=x.id)))
 ) m WHERE cardinality(m.reasons)>0;
 RETURN jsonb_build_object('organisations',organisations,'workspaces',workspaces);
END $$;

-- The customer-safe state of a workspace's company link. No candidate, other workspace or staff note appears here.
CREATE FUNCTION customer_private.organisation_link_state(p_target uuid,p_writer boolean) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_open uuid; v_shown customer_private.organisation_link_claim; v_ledger customer_private.organisation_link;
 v_link_claim customer_private.organisation_link_claim; v_org app.organisation; v_profile integer; v_seq integer; v_state text;
 v_status text; v_claim jsonb:='null'::jsonb; v_link jsonb:='null'::jsonb; v_evidence jsonb; v_history jsonb; v_decision jsonb; v_evidence_count integer;
BEGIN
 SELECT coalesce(max(r.version),0) INTO v_profile FROM customer_private.organisation_profile_revision r WHERE r.tenant_id=p_target;
 v_open:=customer_private.organisation_link_open_claim(p_target);
 SELECT * INTO v_ledger FROM customer_private.organisation_link l WHERE l.tenant_id=p_target ORDER BY l.version DESC LIMIT 1;
 IF FOUND AND v_ledger.state='linked' THEN
  SELECT * INTO v_link_claim FROM customer_private.organisation_link_claim c WHERE c.id=v_ledger.claim_id;
  SELECT * INTO v_org FROM app.organisation o WHERE o.id=v_ledger.organisation_id;
  v_link:=jsonb_build_object('organisation',jsonb_build_object('name',v_org.name,'country',v_org.country),'linkedAt',v_ledger.created_at,
   'reviewedProfileVersion',v_link_claim.profile_version,'profileChanged',v_profile>v_link_claim.profile_version,
   'label','Company link reviewed by Corridra staff from the evidence supplied (synthetic test)')
   ||CASE WHEN p_writer THEN jsonb_build_object('reason',(SELECT e.reason FROM customer_private.organisation_link_event e WHERE e.claim_id=v_link_claim.id AND e.kind='approved' ORDER BY e.seq DESC LIMIT 1)) ELSE '{}'::jsonb END;
 END IF;
 IF v_open IS NOT NULL THEN
  SELECT * INTO v_shown FROM customer_private.organisation_link_claim c WHERE c.id=v_open;
 ELSE
  SELECT * INTO v_shown FROM customer_private.organisation_link_claim c WHERE c.tenant_id=p_target ORDER BY c.created_at DESC,c.id LIMIT 1;
  IF FOUND AND (SELECT h.state FROM customer_private.organisation_link_head(v_shown.id) h) IS DISTINCT FROM 'rejected' THEN v_shown:=NULL; END IF;
 END IF;
 IF v_shown.id IS NOT NULL THEN
  SELECT h.seq,h.state INTO v_seq,v_state FROM customer_private.organisation_link_head(v_shown.id) h;
  SELECT count(*)::int INTO v_evidence_count FROM customer_private.organisation_link_evidence ev WHERE ev.claim_id=v_shown.id;
  v_claim:=jsonb_build_object('state',CASE WHEN v_state='creation_approved' THEN 'pending' ELSE v_state END,'awaitingCreation',v_state='creation_approved',
   'kind',v_shown.kind,'filedAt',v_shown.created_at,'profileVersion',v_shown.profile_version,'profileChanged',v_profile>v_shown.profile_version);
  IF p_writer THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',ev.id,'kind',ev.kind,'statement',ev.statement,'url',ev.url,'addedAt',ev.created_at) ORDER BY ev.position),'[]'::jsonb)
   INTO v_evidence FROM customer_private.organisation_link_evidence ev WHERE ev.claim_id=v_shown.id;
   SELECT coalesce(jsonb_agg(jsonb_build_object('seq',e.seq,'kind',e.kind,'state',e.state,'at',e.created_at,'by',CASE WHEN e.staff_actor IS NULL THEN 'customer' ELSE 'staff' END,
    'reason',e.reason) ORDER BY e.seq),'[]'::jsonb) INTO v_history FROM customer_private.organisation_link_event e WHERE e.claim_id=v_shown.id;
   SELECT jsonb_build_object('kind',e.kind,'reason',e.reason,'at',e.created_at) INTO v_decision FROM customer_private.organisation_link_event e
   WHERE e.claim_id=v_shown.id AND e.staff_actor IS NOT NULL ORDER BY e.seq DESC LIMIT 1;
   v_claim:=v_claim||jsonb_build_object('id',v_shown.id,'version',v_seq,'note',v_shown.note,'evidenceCount',v_evidence_count,'evidence',v_evidence,'history',v_history,
    'decision',v_decision,
    'target',(SELECT jsonb_build_object('name',o.name,'country',o.country) FROM app.organisation o WHERE o.id=v_shown.organisation_id),
    'canAddEvidence',v_state IN ('pending','needs_evidence','creation_approved') AND v_evidence_count<8,
    'canWithdraw',v_state IN ('pending','needs_evidence','creation_approved'));
  END IF;
 END IF;
 v_status:=CASE WHEN v_open IS NOT NULL THEN CASE WHEN v_state='needs_evidence' THEN 'needs_evidence' ELSE 'pending' END
  WHEN v_link<>'null'::jsonb THEN 'approved' WHEN v_shown.id IS NOT NULL THEN 'rejected' ELSE 'none' END;
 RETURN jsonb_build_object('status',v_status,'currentProfileVersion',v_profile,'canFile',p_writer AND v_profile>=1 AND v_open IS NULL,'link',v_link,'claim',v_claim);
END $$;

CREATE FUNCTION customer_private.organisation_link_expiry() RETURNS timestamptz
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT least(clock_timestamp()+interval '60 seconds',(SELECT expires_at FROM customer_private.session_proof WHERE hash=current_setting('corridra.customer_proof_hash',true)))
$$;

CREATE FUNCTION customer.organisation_link_view(p_target uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer.actor_id(); v_access text; v_result jsonb;
BEGIN
 IF v_actor IS NULL OR p_target IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 v_access:=customer_private.organisation_profile_role(p_target,v_actor);
 IF v_access IS NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 -- Wait behind an in-flight write so a reader never sees a half-recorded change, then recheck access.
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_link:'||p_target::text,0));
 IF customer.actor_id() IS DISTINCT FROM v_actor OR customer_private.organisation_profile_role(p_target,v_actor) IS DISTINCT FROM v_access THEN
  RAISE EXCEPTION 'Company link access expired' USING ERRCODE='42501';
 END IF;
 v_result:=jsonb_build_object('workspaceId',p_target,'expiresAt',customer_private.organisation_link_expiry(),'canEdit',v_access='writer')
  ||customer_private.organisation_link_state(p_target,v_access='writer');
 IF customer.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Company link access expired' USING ERRCODE='42501'; END IF;
 RETURN v_result;
END $$;

-- Status of every workspace the caller can reach, for the workspace list. Status and the approved name only.
CREATE FUNCTION customer.organisation_link_overview() RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer.actor_id(); v_items jsonb;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('workspaceId',w.id,'status',s->>'status','organisationName',s->'link'->'organisation'->>'name') ORDER BY w.id),'[]'::jsonb)
 INTO v_items FROM customer.collaborative_workspaces() w CROSS JOIN LATERAL (SELECT customer_private.organisation_link_state(w.id,false) s) x;
 IF customer.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Company link access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('expiresAt',customer_private.organisation_link_expiry(),'workspaces',v_items);
END $$;

-- Search of the public catalogue by a workspace writer who has a profile. Name and country only, same country as
-- the profile, at most ten rows. It exposes no identifier, domain, address, tenant or claim.
CREATE FUNCTION customer.organisation_link_search(p_target uuid,p_term text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer.actor_id(); v_country text; v_pattern text; v_items jsonb;
BEGIN
 IF v_actor IS NULL OR p_target IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF customer_private.organisation_profile_role(p_target,v_actor) IS DISTINCT FROM 'writer' THEN RAISE EXCEPTION 'Workspace owner or admin required' USING ERRCODE='42501'; END IF;
 IF p_term IS NULL OR p_term<>btrim(p_term) OR length(p_term) NOT BETWEEN 3 AND 80 OR p_term ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE='23514'; END IF;
 SELECT r.details->>'countryCode' INTO v_country FROM customer_private.organisation_profile_revision r WHERE r.tenant_id=p_target ORDER BY r.version DESC LIMIT 1;
 IF v_country IS NULL THEN RAISE EXCEPTION 'Save the company profile before searching' USING ERRCODE='23514'; END IF;
 v_pattern:='%'||replace(replace(replace(lower(p_term),'\','\\'),'%','\%'),'_','\_')||'%';
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'country',m.country) ORDER BY m.name,m.id),'[]'::jsonb) INTO v_items FROM (
  SELECT o.id,o.name,o.country FROM app.organisation o
  WHERE o.synthetic AND o.country=v_country AND lower(o.name) LIKE v_pattern AND customer_private.organisation_link_public_organisation(o.id)
  ORDER BY o.name,o.id LIMIT 10) m;
 IF customer.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Company link access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',p_target,'expiresAt',customer_private.organisation_link_expiry(),'organisations',v_items);
END $$;

CREATE FUNCTION customer.organisation_link_command(p_command uuid,p_operation text,p_input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid; v_target uuid; v_prior customer_private.organisation_link_request; v_claim customer_private.organisation_link_claim;
 v_head customer_private.organisation_link_event; v_profile customer_private.organisation_link_event; v_rev customer_private.organisation_profile_revision;
 v_org app.organisation; v_active customer_private.organisation_link; v_seq integer; v_state text; v_event uuid:=gen_random_uuid(); v_kind text;
 v_count integer; v_name_key text; v_result jsonb; v_uuid constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF p_command IS NULL OR p_operation IS NULL OR p_operation NOT IN ('file','add_evidence','withdraw') OR p_input IS NULL OR jsonb_typeof(p_input)<>'object'
  OR jsonb_typeof(p_input->'workspaceId') IS DISTINCT FROM 'string' OR p_input->>'workspaceId' !~ v_uuid THEN
  RAISE EXCEPTION 'Invalid company link request' USING ERRCODE='23514';
 END IF;
 IF p_operation='file' THEN
  IF p_input-ARRAY['workspaceId','expectedProfileVersion','kind','organisationId','note']<>'{}'::jsonb
   OR NOT (p_input ?& ARRAY['workspaceId','expectedProfileVersion','kind','organisationId','note'])
   OR jsonb_typeof(p_input->'expectedProfileVersion')<>'number' OR (p_input->>'expectedProfileVersion') !~ '^[0-9]{1,10}$'
   OR jsonb_typeof(p_input->'kind')<>'string' OR p_input->>'kind' NOT IN ('EXISTING','PROPOSED_NEW')
   OR jsonb_typeof(p_input->'organisationId') NOT IN ('string','null') OR jsonb_typeof(p_input->'note')<>'string'
   OR (jsonb_typeof(p_input->'organisationId')='string' AND p_input->>'organisationId' !~ v_uuid)
   OR (p_input->>'kind'='EXISTING')<>(jsonb_typeof(p_input->'organisationId')='string')
   OR p_input->>'note'<>btrim(p_input->>'note') OR length(p_input->>'note') NOT BETWEEN 11 AND 1000 OR p_input->>'note' NOT LIKE 'Synthetic %' OR p_input->>'note' ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION 'Invalid company link request' USING ERRCODE='23514';
  END IF;
 ELSIF p_operation='add_evidence' THEN
  IF p_input-ARRAY['workspaceId','claimId','expectedVersion','evidenceKind','statement','url']<>'{}'::jsonb
   OR NOT (p_input ?& ARRAY['workspaceId','claimId','expectedVersion','evidenceKind','statement','url'])
   OR jsonb_typeof(p_input->'claimId')<>'string' OR p_input->>'claimId' !~ v_uuid
   OR jsonb_typeof(p_input->'expectedVersion')<>'number' OR (p_input->>'expectedVersion') !~ '^[0-9]{1,4}$'
   OR jsonb_typeof(p_input->'evidenceKind')<>'string' OR p_input->>'evidenceKind' NOT IN ('REGISTRATION_STATEMENT','WEBSITE_STATEMENT','TRADE_REFERENCE_STATEMENT','AUTHORISATION_STATEMENT')
   OR jsonb_typeof(p_input->'statement')<>'string' OR p_input->>'statement'<>btrim(p_input->>'statement') OR length(p_input->>'statement') NOT BETWEEN 11 AND 1000
   OR p_input->>'statement' NOT LIKE 'Synthetic %' OR p_input->>'statement' ~ '[[:cntrl:]]'
   OR jsonb_typeof(p_input->'url') NOT IN ('string','null')
   OR (jsonb_typeof(p_input->'url')='string' AND (length(p_input->>'url')>200 OR p_input->>'url' !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.(example|test|invalid)(/[A-Za-z0-9._~/-]*)?$')) THEN
   RAISE EXCEPTION 'Invalid company link request' USING ERRCODE='23514';
  END IF;
 ELSE
  IF p_input-ARRAY['workspaceId','claimId','expectedVersion']<>'{}'::jsonb OR NOT (p_input ?& ARRAY['workspaceId','claimId','expectedVersion'])
   OR jsonb_typeof(p_input->'claimId')<>'string' OR p_input->>'claimId' !~ v_uuid
   OR jsonb_typeof(p_input->'expectedVersion')<>'number' OR (p_input->>'expectedVersion') !~ '^[0-9]{1,4}$' THEN
   RAISE EXCEPTION 'Invalid company link request' USING ERRCODE='23514';
  END IF;
 END IF;
 v_target:=(p_input->>'workspaceId')::uuid;
 v_actor:=customer_private.lock_workspace_access(p_command,v_target);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_link:'||v_target::text,0));
 IF customer.actor_id() IS DISTINCT FROM v_actor OR customer_private.organisation_profile_role(v_target,v_actor) IS DISTINCT FROM 'writer' THEN
  RAISE EXCEPTION 'Workspace owner or admin required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_prior FROM customer_private.organisation_link_request q WHERE q.actor_kind='customer' AND q.actor_id=v_actor AND q.command_id=p_command;
 IF FOUND THEN
  IF v_prior.operation<>p_operation OR v_prior.request<>p_input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN v_prior.result||jsonb_build_object('expiresAt',customer_private.organisation_link_expiry());
 END IF;
 IF p_operation='file' THEN
  SELECT * INTO v_rev FROM customer_private.organisation_profile_revision r WHERE r.tenant_id=v_target ORDER BY r.version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Save the company profile before requesting a company link' USING ERRCODE='23514'; END IF;
  IF v_rev.version<>(p_input->>'expectedProfileVersion')::integer THEN RAISE EXCEPTION 'Profile changed; reload before requesting a link' USING ERRCODE='23514'; END IF;
  IF customer_private.organisation_link_open_claim(v_target) IS NOT NULL THEN RAISE EXCEPTION 'A company link request is already open' USING ERRCODE='23514'; END IF;
  v_name_key:=customer_private.organisation_link_name_key(v_rev.details->>'legalName');
  IF v_name_key !~ '^[[:alnum:]]{1,200}$' THEN RAISE EXCEPTION 'Invalid company link request' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_active FROM customer_private.organisation_link l WHERE l.tenant_id=v_target ORDER BY l.version DESC LIMIT 1;
  IF p_input->>'kind'='EXISTING' THEN
   SELECT * INTO v_org FROM app.organisation o WHERE o.id=(p_input->>'organisationId')::uuid;
   IF NOT FOUND OR NOT customer_private.organisation_link_public_organisation(v_org.id) OR v_org.country<>v_rev.details->>'countryCode' THEN
    RAISE EXCEPTION 'That organisation cannot be requested' USING ERRCODE='23514';
   END IF;
   IF v_active.state='linked' AND v_active.organisation_id=v_org.id THEN RAISE EXCEPTION 'This workspace is already linked to that organisation' USING ERRCODE='23514'; END IF;
  END IF;
  INSERT INTO customer_private.organisation_link_claim(tenant_id,profile_revision_id,profile_version,kind,organisation_id,name_key,country_code,host_key,note,created_by)
  VALUES(v_target,v_rev.id,v_rev.version,p_input->>'kind',(p_input->>'organisationId')::uuid,v_name_key,v_rev.details->>'countryCode',
   customer_private.organisation_link_host_key(v_rev.details->>'website'),p_input->>'note',v_actor) RETURNING * INTO v_claim;
  v_seq:=customer_private.organisation_link_append(v_event,v_claim.id,'filed','pending',v_actor,NULL,NULL,NULL,NULL);
  v_kind:='filed'; v_state:='pending';
 ELSE
  SELECT * INTO v_claim FROM customer_private.organisation_link_claim c WHERE c.id=(p_input->>'claimId')::uuid AND c.tenant_id=v_target;
  IF NOT FOUND THEN RAISE EXCEPTION 'Company link request unavailable' USING ERRCODE='42501'; END IF;
  SELECT h.seq,h.state INTO v_seq,v_state FROM customer_private.organisation_link_head(v_claim.id) h;
  IF v_state NOT IN ('pending','needs_evidence','creation_approved') THEN RAISE EXCEPTION 'This company link request is closed' USING ERRCODE='23514'; END IF;
  IF v_seq<>(p_input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Company link request changed; reload before saving' USING ERRCODE='23514'; END IF;
  IF p_operation='add_evidence' THEN
   SELECT count(*)::int INTO v_count FROM customer_private.organisation_link_evidence ev WHERE ev.claim_id=v_claim.id;
   IF v_count>=8 THEN RAISE EXCEPTION 'The evidence limit for this request is reached' USING ERRCODE='23514'; END IF;
   v_kind:='evidence_added'; v_state:=CASE WHEN v_state='needs_evidence' THEN 'pending' ELSE v_state END;
   v_seq:=customer_private.organisation_link_append(v_event,v_claim.id,v_kind,v_state,v_actor,NULL,NULL,NULL,NULL);
   INSERT INTO customer_private.organisation_link_evidence(tenant_id,claim_id,event_id,position,kind,statement,url,created_by)
   VALUES(v_target,v_claim.id,v_event,v_count+1,p_input->>'evidenceKind',p_input->>'statement',p_input->>'url',v_actor);
  ELSE
   v_kind:='withdrawn'; v_state:='withdrawn';
   v_seq:=customer_private.organisation_link_append(v_event,v_claim.id,v_kind,v_state,v_actor,NULL,NULL,NULL,NULL);
  END IF;
 END IF;
 PERFORM customer_private.organisation_link_domain_event(v_target,'customer',v_actor,p_command,v_kind,v_claim.id,v_seq,v_state);
 IF customer.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Company link access expired' USING ERRCODE='42501'; END IF;
 v_result:=jsonb_build_object('workspaceId',v_target,'commandId',p_command,'canEdit',true)||customer_private.organisation_link_state(v_target,true);
 INSERT INTO customer_private.organisation_link_request(actor_kind,actor_id,command_id,operation,request,result) VALUES('customer',v_actor,p_command,p_operation,p_input,v_result);
 RETURN v_result||jsonb_build_object('expiresAt',customer_private.organisation_link_expiry());
END $$;

-- Staff authority: the existing reviewer roles (owner, admin, reviewer) of the enabled intake tenant, with fresh MFA.
CREATE FUNCTION customer_private.organisation_link_staff() RETURNS uuid
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=app.actor_id(); v_tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid; v_role text;
BEGIN
 IF v_actor IS NULL OR v_tenant IS NULL THEN RAISE EXCEPTION 'Reviewer access required' USING ERRCODE='42501'; END IF;
 v_role:=app.member_role(v_tenant);
 IF v_role IS NULL OR v_role NOT IN ('owner','admin','reviewer') OR NOT app.fresh_mfa() OR NOT coalesce(app.can_access(v_tenant,'INTERNAL','synthetic_validation'),false)
  OR NOT EXISTS(SELECT FROM app.tenant t WHERE t.id=v_tenant AND t.synthetic)
  OR NOT EXISTS(SELECT FROM app.intake_destination d WHERE d.singleton AND d.enabled AND d.tenant_id=v_tenant) THEN
  RAISE EXCEPTION 'Reviewer access with a fresh authenticator check is required' USING ERRCODE='42501';
 END IF;
 RETURN v_actor;
END $$;

CREATE FUNCTION app.customer_organisation_link_queue(p_scope text DEFAULT 'open',p_after uuid DEFAULT NULL,p_page_size integer DEFAULT 20) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_staff uuid:=customer_private.organisation_link_staff(); v_items jsonb; v_next uuid; v_after_at timestamptz;
BEGIN
 IF p_scope IS NULL OR p_scope NOT IN ('open','closed') OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid queue request' USING ERRCODE='23514'; END IF;
 IF p_after IS NOT NULL THEN
  SELECT c.created_at INTO v_after_at FROM customer_private.organisation_link_claim c WHERE c.id=p_after;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid queue request' USING ERRCODE='23514'; END IF;
 END IF;
 WITH rows AS (
  SELECT c.id,c.tenant_id,c.kind,c.created_at,c.profile_version,head.seq,head.state,r.details->>'legalName' legal_name,r.details->>'countryCode' country
  FROM customer_private.organisation_link_claim c
  JOIN customer_private.organisation_profile_revision r ON r.tenant_id=c.tenant_id AND r.id=c.profile_revision_id
  CROSS JOIN LATERAL customer_private.organisation_link_head(c.id) head
  WHERE ((p_scope='open')=(head.state IN ('pending','needs_evidence','creation_approved')))
  AND (p_after IS NULL OR (c.created_at,c.id)>(v_after_at,p_after))
  ORDER BY c.created_at,c.id LIMIT p_page_size+1),
 shown AS (SELECT * FROM rows ORDER BY created_at,id LIMIT p_page_size)
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('claimId',s.id,'workspaceId',s.tenant_id,'workspaceName',(SELECT t.name FROM app.tenant t WHERE t.id=s.tenant_id),
  'kind',s.kind,'state',s.state,'version',s.seq,'filedAt',s.created_at,'legalName',s.legal_name,'country',s.country,
  'evidenceCount',(SELECT count(*)::int FROM customer_private.organisation_link_evidence ev WHERE ev.claim_id=s.id),
  'candidateCount',(SELECT jsonb_array_length(x->'organisations')+jsonb_array_length(x->'workspaces') FROM (SELECT customer_private.organisation_link_candidates(s.id) x) y))
  ORDER BY s.created_at,s.id) FROM shown s),'[]'::jsonb),
  CASE WHEN (SELECT count(*) FROM rows)>p_page_size THEN (SELECT id FROM shown ORDER BY created_at DESC,id DESC LIMIT 1) ELSE NULL END
 INTO v_items,v_next;
 IF app.actor_id() IS DISTINCT FROM v_staff THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('scope',p_scope,'items',v_items,'nextAfter',v_next,'synthetic',true);
END $$;

CREATE FUNCTION app.customer_organisation_link_review(p_claim uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_staff uuid:=customer_private.organisation_link_staff(); c customer_private.organisation_link_claim; r customer_private.organisation_profile_revision;
 v_seq integer; v_state text; v_profile integer; v_ledger customer_private.organisation_link; v_active jsonb:='null'::jsonb; v_evidence jsonb; v_history jsonb; v_chosen jsonb:='null'::jsonb;
BEGIN
 IF p_claim IS NULL THEN RAISE EXCEPTION 'Company link request unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM customer_private.organisation_link_claim x WHERE x.id=p_claim;
 IF NOT FOUND THEN RAISE EXCEPTION 'Company link request unavailable' USING ERRCODE='42501'; END IF;
 -- Wait behind an in-flight decision so the review is never half-recorded.
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_link:'||c.tenant_id::text,0));
 SELECT * INTO r FROM customer_private.organisation_profile_revision x WHERE x.id=c.profile_revision_id;
 SELECT h.seq,h.state INTO v_seq,v_state FROM customer_private.organisation_link_head(c.id) h;
 SELECT coalesce(max(x.version),0) INTO v_profile FROM customer_private.organisation_profile_revision x WHERE x.tenant_id=c.tenant_id;
 SELECT * INTO v_ledger FROM customer_private.organisation_link l WHERE l.tenant_id=c.tenant_id ORDER BY l.version DESC LIMIT 1;
 IF FOUND AND v_ledger.state='linked' THEN
  SELECT jsonb_build_object('claimId',v_ledger.claim_id,'organisation',jsonb_build_object('id',o.id,'name',o.name,'country',o.country),'linkedAt',v_ledger.created_at,'shared',v_ledger.shared)
  INTO v_active FROM app.organisation o WHERE o.id=v_ledger.organisation_id;
 END IF;
 IF c.organisation_id IS NOT NULL THEN
  SELECT jsonb_build_object('id',o.id,'name',o.name,'country',o.country) INTO v_chosen FROM app.organisation o WHERE o.id=c.organisation_id;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',ev.id,'kind',ev.kind,'statement',ev.statement,'url',ev.url,'addedAt',ev.created_at) ORDER BY ev.position),'[]'::jsonb)
 INTO v_evidence FROM customer_private.organisation_link_evidence ev WHERE ev.claim_id=c.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('seq',e.seq,'kind',e.kind,'state',e.state,'at',e.created_at,'by',CASE WHEN e.staff_actor IS NULL THEN 'customer' ELSE 'staff' END,
  'byYou',e.staff_actor=v_staff,'reason',e.reason,'internalNote',e.internal_note) ORDER BY e.seq),'[]'::jsonb)
 INTO v_history FROM customer_private.organisation_link_event e WHERE e.claim_id=c.id;
 IF app.actor_id() IS DISTINCT FROM v_staff THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('claimId',c.id,'workspaceId',c.tenant_id,'workspaceName',(SELECT t.name FROM app.tenant t WHERE t.id=c.tenant_id),
  'expiresAt',clock_timestamp()+interval '60 seconds','kind',c.kind,'state',v_state,'version',v_seq,'filedAt',c.created_at,'note',c.note,
  'profile',jsonb_build_object('version',c.profile_version,'currentVersion',v_profile,'legalName',r.details->>'legalName','countryCode',r.details->>'countryCode',
   'website',r.details->'website','summary',r.details->>'summary','commercialRoles',r.details->'commercialRoles','sectors',r.details->'sectors','sizeBand',r.details->>'sizeBand'),
  'chosenOrganisation',v_chosen,'activeLink',v_active,'evidence',v_evidence,'history',v_history,
  'candidates',customer_private.organisation_link_candidates(c.id),
  'decisions',CASE v_state WHEN 'pending' THEN CASE WHEN c.kind='PROPOSED_NEW' THEN jsonb_build_array('approve','approve_creation','request_evidence','reject') ELSE jsonb_build_array('approve','request_evidence','reject') END
   WHEN 'needs_evidence' THEN jsonb_build_array('reject') WHEN 'creation_approved' THEN jsonb_build_array('approve','reject')
   WHEN 'approved' THEN CASE WHEN v_active<>'null'::jsonb AND (v_active->>'claimId')::uuid=c.id THEN jsonb_build_array('revoke') ELSE '[]'::jsonb END ELSE '[]'::jsonb END);
END $$;

CREATE FUNCTION app.customer_organisation_link_decide(p_command uuid,p_input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_staff uuid:=customer_private.organisation_link_staff(); v_uuid constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
 c customer_private.organisation_link_claim; v_prior customer_private.organisation_link_request; v_decision text; v_seq integer; v_state text; v_org app.organisation;
 v_ledger customer_private.organisation_link; v_next_state text; v_kind text; v_event uuid:=gen_random_uuid(); v_old_event uuid; v_others integer; v_shared boolean:=false;
 v_version integer; v_result jsonb; v_reason text; v_note text; v_old_seq integer;
BEGIN
 IF p_command IS NULL OR p_input IS NULL OR jsonb_typeof(p_input)<>'object'
  OR p_input-ARRAY['claimId','expectedVersion','decision','reason','internalNote','organisationId','shareConfirmed']<>'{}'::jsonb
  OR NOT (p_input ?& ARRAY['claimId','expectedVersion','decision','reason','internalNote','organisationId','shareConfirmed'])
  OR jsonb_typeof(p_input->'claimId')<>'string' OR p_input->>'claimId' !~ v_uuid
  OR jsonb_typeof(p_input->'expectedVersion')<>'number' OR (p_input->>'expectedVersion') !~ '^[0-9]{1,4}$'
  OR jsonb_typeof(p_input->'decision')<>'string' OR p_input->>'decision' NOT IN ('approve','approve_creation','request_evidence','reject','revoke')
  OR jsonb_typeof(p_input->'reason')<>'string' OR p_input->>'reason'<>btrim(p_input->>'reason') OR length(p_input->>'reason') NOT BETWEEN 3 AND 1000 OR p_input->>'reason' ~ '[[:cntrl:]]'
  OR jsonb_typeof(p_input->'internalNote') NOT IN ('string','null')
  OR (jsonb_typeof(p_input->'internalNote')='string' AND (p_input->>'internalNote'<>btrim(p_input->>'internalNote') OR length(p_input->>'internalNote') NOT BETWEEN 3 AND 1000 OR p_input->>'internalNote' ~ '[[:cntrl:]]'))
  OR jsonb_typeof(p_input->'organisationId') NOT IN ('string','null')
  OR (jsonb_typeof(p_input->'organisationId')='string' AND p_input->>'organisationId' !~ v_uuid)
  OR (p_input->>'decision'='approve')<>(jsonb_typeof(p_input->'organisationId')='string')
  OR jsonb_typeof(p_input->'shareConfirmed')<>'boolean' THEN
  RAISE EXCEPTION 'Invalid company link decision' USING ERRCODE='23514';
 END IF;
 v_decision:=p_input->>'decision'; v_reason:=p_input->>'reason'; v_note:=p_input->>'internalNote';
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_link.command:'||v_staff::text||':'||p_command::text,0));
 SELECT * INTO c FROM customer_private.organisation_link_claim x WHERE x.id=(p_input->>'claimId')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Company link request unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_link:'||c.tenant_id::text,0));
 IF app.actor_id() IS DISTINCT FROM v_staff THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_prior FROM customer_private.organisation_link_request q WHERE q.actor_kind='staff' AND q.actor_id=v_staff AND q.command_id=p_command;
 IF FOUND THEN
  IF v_prior.operation<>'decide' OR v_prior.request<>p_input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN v_prior.result;
 END IF;
 SELECT h.seq,h.state INTO v_seq,v_state FROM customer_private.organisation_link_head(c.id) h;
 IF v_seq<>(p_input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Company link request changed; reload before deciding' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_ledger FROM customer_private.organisation_link l WHERE l.tenant_id=c.tenant_id ORDER BY l.version DESC LIMIT 1;
 IF v_decision='approve' THEN
  SELECT * INTO v_org FROM app.organisation o WHERE o.id=(p_input->>'organisationId')::uuid AND o.synthetic;
  IF NOT FOUND THEN RAISE EXCEPTION 'That organisation is not in the catalogue' USING ERRCODE='23514'; END IF;
  IF v_state NOT IN ('pending','creation_approved') THEN RAISE EXCEPTION 'That change is not allowed for this company link request' USING ERRCODE='23514'; END IF;
  -- Serialise decisions on one canonical organisation so two reviewers cannot both slip past the shared-link check.
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_link.organisation:'||v_org.id::text,0));
  IF v_ledger.state='linked' AND v_ledger.organisation_id=v_org.id THEN RAISE EXCEPTION 'This workspace is already linked to that organisation' USING ERRCODE='23514'; END IF;
  SELECT count(*)::int INTO v_others FROM (SELECT DISTINCT ON (l.tenant_id) l.state,l.organisation_id,l.tenant_id FROM customer_private.organisation_link l ORDER BY l.tenant_id,l.version DESC) h
  WHERE h.state='linked' AND h.organisation_id=v_org.id AND h.tenant_id<>c.tenant_id;
  IF v_others>0 AND NOT (p_input->>'shareConfirmed')::boolean THEN
   RAISE EXCEPTION 'Another workspace is already linked to this organisation; confirm a shared link or reject this request as conflicting' USING ERRCODE='23514';
  END IF;
  v_shared:=v_others>0;
  -- A newer approved link supersedes the old one: the old claim gets a closing row and the ledger an unlinked row.
  IF v_ledger.state='linked' THEN
   v_old_event:=gen_random_uuid();
   v_old_seq:=customer_private.organisation_link_append(v_old_event,v_ledger.claim_id,'link_ended','ended',NULL,v_staff,'Replaced by a newer company link decision',NULL,v_ledger.organisation_id);
   INSERT INTO customer_private.organisation_link(tenant_id,version,state,claim_id,organisation_id,shared,staff_actor)
   VALUES(c.tenant_id,v_ledger.version+1,'unlinked',v_ledger.claim_id,v_ledger.organisation_id,false,v_staff) RETURNING version INTO v_version;
   PERFORM customer_private.organisation_link_domain_event(c.tenant_id,'staff',v_staff,p_command,'link_ended',v_ledger.claim_id,v_old_seq,'ended');
  ELSE
   v_version:=coalesce(v_ledger.version,0);
  END IF;
  v_seq:=customer_private.organisation_link_append(v_event,c.id,'approved','approved',NULL,v_staff,v_reason,v_note,v_org.id);
  INSERT INTO customer_private.organisation_link(tenant_id,version,state,claim_id,organisation_id,shared,staff_actor)
  VALUES(c.tenant_id,v_version+1,'linked',c.id,v_org.id,v_shared,v_staff);
  v_kind:='approved'; v_next_state:='approved';
 ELSIF v_decision='revoke' THEN
  IF v_state<>'approved' OR v_ledger.state IS DISTINCT FROM 'linked' OR v_ledger.claim_id<>c.id THEN RAISE EXCEPTION 'There is no active company link to end' USING ERRCODE='23514'; END IF;
  v_seq:=customer_private.organisation_link_append(v_event,c.id,'link_ended','ended',NULL,v_staff,v_reason,v_note,v_ledger.organisation_id);
  INSERT INTO customer_private.organisation_link(tenant_id,version,state,claim_id,organisation_id,shared,staff_actor)
  VALUES(c.tenant_id,v_ledger.version+1,'unlinked',c.id,v_ledger.organisation_id,false,v_staff);
  v_kind:='link_ended'; v_next_state:='ended';
 ELSE
  v_kind:=CASE v_decision WHEN 'approve_creation' THEN 'creation_approved' WHEN 'request_evidence' THEN 'evidence_requested' ELSE 'rejected' END;
  v_next_state:=CASE v_decision WHEN 'approve_creation' THEN 'creation_approved' WHEN 'request_evidence' THEN 'needs_evidence' ELSE 'rejected' END;
  v_seq:=customer_private.organisation_link_append(v_event,c.id,v_kind,v_next_state,NULL,v_staff,v_reason,v_note,NULL);
 END IF;
 PERFORM customer_private.organisation_link_domain_event(c.tenant_id,'staff',v_staff,p_command,v_kind,c.id,v_seq,v_next_state);
 IF app.actor_id() IS DISTINCT FROM v_staff THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 v_result:=jsonb_build_object('claimId',c.id,'commandId',p_command,'decision',v_decision,'state',v_next_state,'version',v_seq,'shared',v_shared);
 INSERT INTO customer_private.organisation_link_request(actor_kind,actor_id,command_id,operation,request,result) VALUES('staff',v_staff,p_command,'decide',p_input,v_result);
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION customer_private.organisation_link_open_claim(uuid),customer_private.organisation_link_event_guard(),customer_private.organisation_link_ledger_guard(),
 customer_private.organisation_link_name_key(text),customer_private.organisation_link_host_key(text),customer_private.organisation_link_public_organisation(uuid),
 customer_private.organisation_link_head(uuid),customer_private.organisation_link_append(uuid,uuid,text,text,uuid,uuid,text,text,uuid),
 customer_private.organisation_link_domain_event(uuid,text,uuid,uuid,text,uuid,integer,text),customer_private.organisation_link_candidates(uuid),
 customer_private.organisation_link_state(uuid,boolean),customer_private.organisation_link_expiry(),customer_private.organisation_link_staff() FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.organisation_link_view(uuid),customer.organisation_link_overview(),customer.organisation_link_search(uuid,text),customer.organisation_link_command(uuid,text,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.organisation_link_view(uuid),customer.organisation_link_overview(),customer.organisation_link_search(uuid,text),customer.organisation_link_command(uuid,text,jsonb) TO corridra_runtime;
REVOKE ALL ON FUNCTION app.customer_organisation_link_queue(text,uuid,integer),app.customer_organisation_link_review(uuid),app.customer_organisation_link_decide(uuid,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.customer_organisation_link_queue(text,uuid,integer),app.customer_organisation_link_review(uuid),app.customer_organisation_link_decide(uuid,jsonb) TO corridra_runtime;
