-- ADR-079 slice A: one provenance rule for company linking, catalogue suppression and claim redaction readers,
-- combined search with a per-person rate limit, and the real evidence URL rule. Every replaced object is replaced once.
-- The first statement is a guard. It fingerprints the live text, settings and grants of every function replaced below,
-- the ledger trigger binding and the evidence URL constraint. Nothing is changed unless all of them match.
-- Function fingerprints cover the body, settings, security mode, volatility, argument types, defaults and grants.
-- They do not use pg_get_functiondef. The URL constraint fingerprint ignores quoting and cast layout.
DO $guard$
DECLARE spec record; v_url text;
 v_url_expected constant text :=
  -- constraint-expected-begin
  'ef0634ee70fc6bf4e367bc17a39ab5f6f69afed14060c4b21846bb1bf67dadc6'
  -- constraint-expected-end
 ;
BEGIN
 FOR spec IN
  SELECT v.signature,v.fingerprint,v.grantees,f.fp,f.grantees live_grantees
  FROM (VALUES
   -- fingerprint-begin
   ('customer_private.organisation_link_candidates(uuid)','56de8e772d582208ef012bc8263b525201a6db7fdb74dd11f04f58bc7315064e',''),
   ('customer_private.organisation_link_public_organisation(uuid)','2ff6b0a001031cbb1d242e63493a11058c042dd7c08f8b5ffe75c7aaabd1a844',''),
   ('customer_private.organisation_link_ledger_guard()','e77710d99d397df96320c199d1e60808210d1db40674bfc7905835a31bd9ed4f',''),
   ('customer_private.organisation_link_state(uuid,boolean)','2cabe4121a345db19a5baab26a9b71ab1419d929ad15a0f9f50ea6e4eb6fa5ba',''),
   ('app.customer_organisation_link_review(uuid)','1eaac61ee0c5a33c1851eed0a2aee28428e1cd2ad649b2be1407b8f9a417974b','corridra_runtime'),
   ('app.customer_organisation_link_queue(text,uuid,integer)','c0b1910b5f2bfb550196d70cf742c631898a6d9dc58303698db6c7881dea2224','corridra_runtime'),
   ('customer.organisation_link_command(uuid,text,jsonb)','d77f66577ef430dac322a87ae5d4b68e544c7c7a0a9dd91fa1489a8aa41467e7','corridra_runtime'),
   ('app.customer_organisation_link_decide(uuid,jsonb)','9413d9e413be071ee1cbb1a0493eec99b96e339fea892373547938a75a779560','corridra_runtime'),
   ('customer.organisation_link_search(uuid,text)','87dc608e7f12a70091ecaf6d5297dacab4f0064972b454a41b1b1fa09c727fde','corridra_runtime')
   -- fingerprint-end
  ) AS v(signature,fingerprint,grantees)
  LEFT JOIN LATERAL (
   -- fingerprint-query-begin
   SELECT encode(sha256(convert_to(concat_ws(E'\x1f',p.prosrc,coalesce(array_to_string(p.proconfig,E'\x1e'),''),p.prosecdef::text,p.provolatile::text,
     p.proisstrict::text,p.proretset::text,p.prokind::text,p.proparallel::text,p.proleakproof::text,array_to_string(p.proargtypes::regtype[],','),
     p.prorettype::regtype::text,l.lanname,coalesce(array_to_string(p.proargnames,','),''),p.pronargdefaults::text,coalesce(pg_get_expr(p.proargdefaults,0),'')),'UTF8')),'hex') fp,
    (SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'')
     FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner) grantees
   FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(v.signature)
   -- fingerprint-query-end
  ) f ON true
 LOOP
  IF spec.fp IS DISTINCT FROM spec.fingerprint OR spec.live_grantees IS DISTINCT FROM spec.grantees THEN
   RAISE EXCEPTION 'Real-use prerequisite function differs: %',split_part(spec.signature,'(',1);
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT FROM pg_trigger t WHERE t.tgrelid='customer_private.organisation_link'::regclass AND t.tgname='organisation_link_ledger_guard'
   AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=7 AND t.tgfoid=to_regprocedure('customer_private.organisation_link_ledger_guard()')) THEN
  RAISE EXCEPTION 'Real-use prerequisite trigger differs: organisation_link_ledger_guard';
 END IF;
 -- constraint-query-begin
 SELECT encode(sha256(convert_to(concat_ws(E'\x1f',c.contype::text,c.convalidated::text,
   (SELECT string_agg(a.attname,',' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)),
   regexp_replace(regexp_replace(regexp_replace(d.def,$q$'(?:[^']|'')*'$q$,'?','g'),'::text','','g'),'[[:space:]()]','','g'),
   (SELECT string_agg(m.lit[1],E'\x1e' ORDER BY m.n) FROM regexp_matches(d.def,$q$('(?:[^']|'')*')$q$,'g') WITH ORDINALITY AS m(lit,n))),'UTF8')),'hex')
  INTO v_url FROM pg_constraint c CROSS JOIN LATERAL (SELECT pg_get_constraintdef(c.oid) def) d
  WHERE c.conrelid='customer_private.organisation_link_evidence'::regclass AND c.conname='organisation_link_evidence_url_check';
 -- constraint-query-end
 IF v_url IS DISTINCT FROM v_url_expected THEN
  RAISE EXCEPTION 'Real-use prerequisite constraint differs: organisation_link_evidence.url';
 END IF;
END $guard$;

-- Suppression: a staff takedown of a catalogue organisation. The latest version decides. Empty until slice B writes it.
CREATE TABLE customer_private.organisation_suppression (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL REFERENCES app.organisation(id),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 100000),
 state text NOT NULL CHECK(state IN ('hidden','shown')),
 reason text NOT NULL CHECK(reason=btrim(reason) AND length(reason) BETWEEN 3 AND 1000 AND reason !~ '[[:cntrl:]]'),
 reference text NOT NULL CHECK(reference=btrim(reference) AND length(reference) BETWEEN 3 AND 120 AND reference !~ '[[:cntrl:]]'),
 staff_actor uuid NOT NULL REFERENCES identity.principal(id),
 command_id uuid NOT NULL,
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organisation_id,version),UNIQUE(staff_actor,command_id)
);
-- Redaction: one row hides the customer text of one closed claim. Empty until slice B writes it.
CREATE TABLE customer_private.organisation_link_redaction (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 claim_id uuid NOT NULL UNIQUE REFERENCES customer_private.organisation_link_claim(id),
 reason text NOT NULL CHECK(reason=btrim(reason) AND length(reason) BETWEEN 3 AND 1000 AND reason !~ '[[:cntrl:]]'),
 reference text NOT NULL CHECK(reference=btrim(reference) AND length(reference) BETWEEN 3 AND 120 AND reference !~ '[[:cntrl:]]'),
 staff_actor uuid NOT NULL REFERENCES identity.principal(id),
 command_id uuid NOT NULL,
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(staff_actor,command_id)
);
-- Search attempts: actor id and time only. No term, no result, no workspace and no foreign key, so erasure is never blocked.
CREATE TABLE customer_private.organisation_link_search_attempt (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX organisation_link_search_attempt_actor ON customer_private.organisation_link_search_attempt(actor_id,created_at);
CREATE FUNCTION customer_private.organisation_link_search_attempt_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.created_at > clock_timestamp()-interval '24 hours' THEN RAISE EXCEPTION 'A recent search attempt cannot be removed' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER organisation_suppression_immutable BEFORE UPDATE OR DELETE ON customer_private.organisation_suppression FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER organisation_link_redaction_immutable BEFORE UPDATE OR DELETE ON customer_private.organisation_link_redaction FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER organisation_link_search_attempt_no_update BEFORE UPDATE ON customer_private.organisation_link_search_attempt FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER organisation_link_search_attempt_young_delete BEFORE DELETE ON customer_private.organisation_link_search_attempt FOR EACH ROW EXECUTE FUNCTION customer_private.organisation_link_search_attempt_guard();
ALTER TABLE customer_private.organisation_suppression ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.organisation_link_redaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.organisation_link_search_attempt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.organisation_suppression,customer_private.organisation_link_redaction,customer_private.organisation_link_search_attempt FROM PUBLIC,corridra_runtime,corridra_auth;

-- The one provenance rule: both flags known and equal. A missing flag is never a match.
CREATE FUNCTION customer_private.organisation_link_same_context(p_row_synthetic boolean,p_anchor_synthetic boolean) RETURNS boolean
 LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p_row_synthetic IS NOT NULL AND p_anchor_synthetic IS NOT NULL AND p_row_synthetic=p_anchor_synthetic
$$;
CREATE FUNCTION customer_private.organisation_link_suppressed(p_organisation uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT s.state='hidden' FROM customer_private.organisation_suppression s WHERE s.organisation_id=p_organisation ORDER BY s.version DESC LIMIT 1),false)
$$;
CREATE FUNCTION customer_private.organisation_link_redacted(p_claim uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM customer_private.organisation_link_redaction r WHERE r.claim_id=p_claim)
$$;
REVOKE ALL ON FUNCTION customer_private.organisation_link_search_attempt_guard(),customer_private.organisation_link_same_context(boolean,boolean),
 customer_private.organisation_link_suppressed(uuid),customer_private.organisation_link_redacted(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;

-- Catalogue eligibility: same provenance as the caller, identifier still valid, not suppressed.
CREATE OR REPLACE FUNCTION customer_private.organisation_link_public_organisation(p_organisation uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT FROM app.organisation o JOIN app.public_identifier i ON i.organisation_id=o.id
 WHERE o.id=p_organisation AND customer_private.organisation_link_same_context(o.synthetic,customer_private.synthetic_context())
 AND i.synthetic=o.synthetic AND i.valid_until>clock_timestamp() AND NOT customer_private.organisation_link_suppressed(o.id))
$function$
;

-- Staff candidates. A claim of the other side or a redacted claim gets empty lists. Every other row passes the rule.
CREATE OR REPLACE FUNCTION customer_private.organisation_link_candidates(p_claim uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE c customer_private.organisation_link_claim; organisations jsonb; workspaces jsonb;
BEGIN
 SELECT * INTO c FROM customer_private.organisation_link_claim x WHERE x.id=p_claim;
 IF NOT FOUND OR NOT customer_private.organisation_link_same_context(app.tenant_is_synthetic(c.tenant_id),customer_private.synthetic_context())
  OR customer_private.organisation_link_redacted(c.id) THEN
  RETURN jsonb_build_object('organisations','[]'::jsonb,'workspaces','[]'::jsonb);
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'country',m.country,'reasons',to_jsonb(m.reasons),'linkedWorkspaces',m.linked) ORDER BY cardinality(m.reasons) DESC,m.name,m.id),'[]'::jsonb)
 INTO organisations FROM (
  SELECT o.id,o.name,o.country,
   array_remove(ARRAY[
    CASE WHEN customer_private.organisation_link_name_key(o.name)=c.name_key AND o.country=c.country_code THEN 'name_country' END,
    CASE WHEN c.host_key IS NOT NULL AND EXISTS(SELECT FROM app.public_identifier i WHERE i.organisation_id=o.id AND i.valid_until>clock_timestamp() AND i.domain=c.host_key) THEN 'website_host' END,
    CASE WHEN c.organisation_id=o.id THEN 'chosen_by_customer' END],NULL) reasons,
   (SELECT count(*)::int FROM (SELECT DISTINCT ON (l.tenant_id) l.state,l.organisation_id,l.tenant_id FROM customer_private.organisation_link l ORDER BY l.tenant_id,l.version DESC) h
    WHERE h.state='linked' AND h.organisation_id=o.id AND h.tenant_id<>c.tenant_id
    AND customer_private.organisation_link_same_context(app.tenant_is_synthetic(h.tenant_id),customer_private.synthetic_context())) linked
  FROM app.organisation o WHERE customer_private.organisation_link_same_context(o.synthetic,customer_private.synthetic_context())
   AND NOT customer_private.organisation_link_suppressed(o.id)
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
  AND customer_private.organisation_link_same_context(app.tenant_is_synthetic(x.tenant_id),customer_private.synthetic_context())
  AND NOT customer_private.organisation_link_redacted(x.id)
  AND (head.state IN ('pending','needs_evidence','creation_approved')
   OR (head.state='approved' AND EXISTS(SELECT FROM (SELECT DISTINCT ON (l.tenant_id) l.state,l.claim_id FROM customer_private.organisation_link l WHERE l.tenant_id=x.tenant_id ORDER BY l.tenant_id,l.version DESC) h WHERE h.state='linked' AND h.claim_id=x.id)))
 ) m WHERE cardinality(m.reasons)>0;
 RETURN jsonb_build_object('organisations',organisations,'workspaces',workspaces);
END $function$
;

-- Ledger backstop for every writer: a new link needs the same provenance as the row's own workspace and a visible organisation.
CREATE OR REPLACE FUNCTION customer_private.organisation_link_ledger_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE prev customer_private.organisation_link; o app.organisation;
BEGIN
 SELECT * INTO prev FROM customer_private.organisation_link l WHERE l.tenant_id=NEW.tenant_id ORDER BY l.version DESC LIMIT 1;
 IF NEW.version<>coalesce(prev.version,0)+1 THEN RAISE EXCEPTION 'Link ledger must be appended in order' USING ERRCODE='23514'; END IF;
 IF NEW.state='linked' AND prev.id IS NOT NULL AND prev.state<>'unlinked' THEN
  RAISE EXCEPTION 'Only one active company link is allowed per workspace' USING ERRCODE='23514';
 END IF;
 IF NEW.state='unlinked' AND (prev.id IS NULL OR prev.state<>'linked' OR prev.claim_id<>NEW.claim_id OR prev.organisation_id<>NEW.organisation_id) THEN
  RAISE EXCEPTION 'Only the active company link can be ended' USING ERRCODE='23514';
 END IF;
 -- The older checks above keep their order for direct writers. The new test comes last. A row for an organisation that does not
 -- exist gets this refusal (23514) before the foreign key can report its own (23503).
 IF NEW.state='linked' THEN
  SELECT * INTO o FROM app.organisation x WHERE x.id=NEW.organisation_id;
  IF NOT FOUND OR NOT customer_private.organisation_link_same_context(o.synthetic,app.tenant_is_synthetic(NEW.tenant_id))
   OR customer_private.organisation_link_suppressed(o.id) THEN
   RAISE EXCEPTION 'That organisation is not available for linking' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $function$
;

-- Customer link state. The workspace itself is the anchor, so an overview of many workspaces never mixes sides.
-- A cross-provenance link keeps its status but shows no organisation. Text of a redacted claim reads as hidden.
CREATE OR REPLACE FUNCTION customer_private.organisation_link_state(p_target uuid, p_writer boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_open uuid; v_shown customer_private.organisation_link_claim; v_ledger customer_private.organisation_link;
 v_link_claim customer_private.organisation_link_claim; v_org app.organisation; v_profile integer; v_seq integer; v_state text;
 v_status text; v_claim jsonb:='null'::jsonb; v_link jsonb:='null'::jsonb; v_evidence jsonb; v_history jsonb; v_decision jsonb; v_evidence_count integer;
 v_syn boolean:=app.tenant_is_synthetic(p_target); v_red boolean:=false; v_hidden constant text:='This text is hidden.';
BEGIN
 SELECT coalesce(max(r.version),0) INTO v_profile FROM customer_private.organisation_profile_revision r WHERE r.tenant_id=p_target;
 v_open:=customer_private.organisation_link_open_claim(p_target);
 SELECT * INTO v_ledger FROM customer_private.organisation_link l WHERE l.tenant_id=p_target ORDER BY l.version DESC LIMIT 1;
 IF FOUND AND v_ledger.state='linked' THEN
  SELECT * INTO v_link_claim FROM customer_private.organisation_link_claim c WHERE c.id=v_ledger.claim_id;
  SELECT * INTO v_org FROM app.organisation o WHERE o.id=v_ledger.organisation_id;
  v_link:=jsonb_build_object('organisation',CASE WHEN customer_private.organisation_link_same_context(v_org.synthetic,v_syn) THEN jsonb_build_object('name',v_org.name,'country',v_org.country) ELSE 'null'::jsonb END,
   'linkedAt',v_ledger.created_at,
   'reviewedProfileVersion',v_link_claim.profile_version,'profileChanged',v_profile>v_link_claim.profile_version,
   'label',CASE WHEN v_syn THEN 'Company link reviewed by Corridra staff from the evidence supplied (synthetic test)' ELSE 'Company link reviewed by Corridra staff from the evidence supplied' END)
   ||CASE WHEN p_writer THEN jsonb_build_object('reason',CASE WHEN customer_private.organisation_link_redacted(v_link_claim.id) THEN v_hidden
    ELSE (SELECT e.reason FROM customer_private.organisation_link_event e WHERE e.claim_id=v_link_claim.id AND e.kind='approved' ORDER BY e.seq DESC LIMIT 1) END) ELSE '{}'::jsonb END;
 END IF;
 IF v_open IS NOT NULL THEN
  SELECT * INTO v_shown FROM customer_private.organisation_link_claim c WHERE c.id=v_open;
 ELSE
  SELECT * INTO v_shown FROM customer_private.organisation_link_claim c WHERE c.tenant_id=p_target ORDER BY c.created_at DESC,c.id LIMIT 1;
  IF FOUND AND (SELECT h.state FROM customer_private.organisation_link_head(v_shown.id) h) IS DISTINCT FROM 'rejected' THEN v_shown:=NULL; END IF;
 END IF;
 IF v_shown.id IS NOT NULL THEN
  v_red:=customer_private.organisation_link_redacted(v_shown.id);
  SELECT h.seq,h.state INTO v_seq,v_state FROM customer_private.organisation_link_head(v_shown.id) h;
  SELECT count(*)::int INTO v_evidence_count FROM customer_private.organisation_link_evidence ev WHERE ev.claim_id=v_shown.id;
  v_claim:=jsonb_build_object('state',CASE WHEN v_state='creation_approved' THEN 'pending' ELSE v_state END,'awaitingCreation',v_state='creation_approved',
   'kind',v_shown.kind,'filedAt',v_shown.created_at,'profileVersion',v_shown.profile_version,'profileChanged',v_profile>v_shown.profile_version);
  IF p_writer THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',ev.id,'kind',ev.kind,'statement',CASE WHEN v_red THEN v_hidden ELSE ev.statement END,
    'url',CASE WHEN v_red AND ev.url IS NOT NULL THEN v_hidden ELSE ev.url END,'addedAt',ev.created_at) ORDER BY ev.position),'[]'::jsonb)
   INTO v_evidence FROM customer_private.organisation_link_evidence ev WHERE ev.claim_id=v_shown.id;
   SELECT coalesce(jsonb_agg(jsonb_build_object('seq',e.seq,'kind',e.kind,'state',e.state,'at',e.created_at,'by',CASE WHEN e.staff_actor IS NULL THEN 'customer' ELSE 'staff' END,
    'reason',CASE WHEN v_red AND e.reason IS NOT NULL THEN v_hidden ELSE e.reason END) ORDER BY e.seq),'[]'::jsonb) INTO v_history FROM customer_private.organisation_link_event e WHERE e.claim_id=v_shown.id;
   SELECT jsonb_build_object('kind',e.kind,'reason',CASE WHEN v_red AND e.reason IS NOT NULL THEN v_hidden ELSE e.reason END,'at',e.created_at) INTO v_decision FROM customer_private.organisation_link_event e
   WHERE e.claim_id=v_shown.id AND e.staff_actor IS NOT NULL ORDER BY e.seq DESC LIMIT 1;
   v_claim:=v_claim||jsonb_build_object('id',v_shown.id,'version',v_seq,'note',CASE WHEN v_red THEN v_hidden ELSE v_shown.note END,'evidenceCount',v_evidence_count,'evidence',v_evidence,'history',v_history,
    'decision',v_decision,
    'target',(SELECT jsonb_build_object('name',o.name,'country',o.country) FROM app.organisation o WHERE o.id=v_shown.organisation_id AND customer_private.organisation_link_same_context(o.synthetic,v_syn)),
    'canAddEvidence',v_state IN ('pending','needs_evidence','creation_approved') AND v_evidence_count<8,
    'canWithdraw',v_state IN ('pending','needs_evidence','creation_approved'))
    ||CASE WHEN v_red THEN jsonb_build_object('redacted',true) ELSE '{}'::jsonb END;
  END IF;
 END IF;
 v_status:=CASE WHEN v_open IS NOT NULL THEN CASE WHEN v_state='needs_evidence' THEN 'needs_evidence' ELSE 'pending' END
  WHEN v_link<>'null'::jsonb THEN 'approved' WHEN v_shown.id IS NOT NULL THEN 'rejected' ELSE 'none' END;
 RETURN jsonb_build_object('status',v_status,'currentProfileVersion',v_profile,'canFile',p_writer AND v_profile>=1 AND v_open IS NULL,'link',v_link,'claim',v_claim);
END $function$
;

-- Staff review. The claim must be of the session side. Names are shown by the rule. Text of a redacted claim reads as hidden.
-- The available decisions come from the ledger row, so a staff revoke stays possible for a link whose organisation is not shown.
CREATE OR REPLACE FUNCTION app.customer_organisation_link_review(p_claim uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_staff uuid:=customer_private.organisation_link_staff(); c customer_private.organisation_link_claim; r customer_private.organisation_profile_revision;
 v_seq integer; v_state text; v_profile integer; v_ledger customer_private.organisation_link; v_active jsonb:='null'::jsonb; v_evidence jsonb; v_history jsonb; v_chosen jsonb:='null'::jsonb;
 v_red boolean; v_hidden constant text:='This text is hidden.';
BEGIN
 IF p_claim IS NULL THEN RAISE EXCEPTION 'Company link request unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM customer_private.organisation_link_claim x WHERE x.id=p_claim AND customer_private.organisation_link_same_context(app.tenant_is_synthetic(x.tenant_id),customer_private.synthetic_context());
 IF NOT FOUND THEN RAISE EXCEPTION 'Company link request unavailable' USING ERRCODE='42501'; END IF;
 -- Wait behind an in-flight decision so the review is never half-recorded.
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_link:'||c.tenant_id::text,0));
 v_red:=customer_private.organisation_link_redacted(c.id);
 SELECT * INTO r FROM customer_private.organisation_profile_revision x WHERE x.id=c.profile_revision_id;
 SELECT h.seq,h.state INTO v_seq,v_state FROM customer_private.organisation_link_head(c.id) h;
 SELECT coalesce(max(x.version),0) INTO v_profile FROM customer_private.organisation_profile_revision x WHERE x.tenant_id=c.tenant_id;
 SELECT * INTO v_ledger FROM customer_private.organisation_link l WHERE l.tenant_id=c.tenant_id ORDER BY l.version DESC LIMIT 1;
 IF FOUND AND v_ledger.state='linked' THEN
  SELECT jsonb_build_object('claimId',v_ledger.claim_id,'organisation',jsonb_build_object('id',o.id,'name',o.name,'country',o.country),'linkedAt',v_ledger.created_at,'shared',v_ledger.shared)
  INTO v_active FROM app.organisation o WHERE o.id=v_ledger.organisation_id AND customer_private.organisation_link_same_context(o.synthetic,customer_private.synthetic_context());
  v_active:=coalesce(v_active,'null'::jsonb);
 END IF;
 IF c.organisation_id IS NOT NULL THEN
  SELECT jsonb_build_object('id',o.id,'name',o.name,'country',o.country) INTO v_chosen FROM app.organisation o WHERE o.id=c.organisation_id AND customer_private.organisation_link_same_context(o.synthetic,customer_private.synthetic_context());
  v_chosen:=coalesce(v_chosen,'null'::jsonb);
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',ev.id,'kind',ev.kind,'statement',CASE WHEN v_red THEN v_hidden ELSE ev.statement END,
  'url',CASE WHEN v_red AND ev.url IS NOT NULL THEN v_hidden ELSE ev.url END,'addedAt',ev.created_at) ORDER BY ev.position),'[]'::jsonb)
 INTO v_evidence FROM customer_private.organisation_link_evidence ev WHERE ev.claim_id=c.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('seq',e.seq,'kind',e.kind,'state',e.state,'at',e.created_at,'by',CASE WHEN e.staff_actor IS NULL THEN 'customer' ELSE 'staff' END,
  'byYou',e.staff_actor=v_staff,'reason',CASE WHEN v_red AND e.reason IS NOT NULL THEN v_hidden ELSE e.reason END,
  'internalNote',CASE WHEN v_red AND e.internal_note IS NOT NULL THEN v_hidden ELSE e.internal_note END) ORDER BY e.seq),'[]'::jsonb)
 INTO v_history FROM customer_private.organisation_link_event e WHERE e.claim_id=c.id;
 IF app.actor_id() IS DISTINCT FROM v_staff THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('claimId',c.id,'workspaceId',c.tenant_id,'workspaceName',(SELECT t.name FROM app.tenant t WHERE t.id=c.tenant_id),
  'expiresAt',clock_timestamp()+interval '60 seconds','kind',c.kind,'state',v_state,'version',v_seq,'filedAt',c.created_at,'note',CASE WHEN v_red THEN v_hidden ELSE c.note END,
  'profile',jsonb_build_object('version',c.profile_version,'currentVersion',v_profile,'legalName',CASE WHEN v_red THEN v_hidden ELSE r.details->>'legalName' END,'countryCode',r.details->>'countryCode',
   'website',CASE WHEN v_red THEN to_jsonb(v_hidden) ELSE r.details->'website' END,'summary',CASE WHEN v_red THEN v_hidden ELSE r.details->>'summary' END,
   'commercialRoles',r.details->'commercialRoles','sectors',r.details->'sectors','sizeBand',r.details->>'sizeBand'),
  'chosenOrganisation',v_chosen,'activeLink',v_active,'evidence',v_evidence,'history',v_history,
  'candidates',customer_private.organisation_link_candidates(c.id),
  'decisions',CASE v_state WHEN 'pending' THEN CASE WHEN c.kind='PROPOSED_NEW' THEN jsonb_build_array('approve','approve_creation','request_evidence','reject') ELSE jsonb_build_array('approve','request_evidence','reject') END
   WHEN 'needs_evidence' THEN jsonb_build_array('reject') WHEN 'creation_approved' THEN jsonb_build_array('approve','reject')
   WHEN 'approved' THEN CASE WHEN v_ledger.state='linked' AND v_ledger.claim_id=c.id THEN jsonb_build_array('revoke') ELSE '[]'::jsonb END ELSE '[]'::jsonb END,
  'redacted',v_red);
END $function$
;

-- Staff queue. The claim filter and the paging probe use the rule. A redacted claim shows a hidden legal name.
CREATE OR REPLACE FUNCTION app.customer_organisation_link_queue(p_scope text DEFAULT 'open'::text, p_after uuid DEFAULT NULL::uuid, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_staff uuid:=customer_private.organisation_link_staff(); v_items jsonb; v_next uuid; v_after_at timestamptz;
BEGIN
 IF p_scope IS NULL OR p_scope NOT IN ('open','closed') OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid queue request' USING ERRCODE='23514'; END IF;
 IF p_after IS NOT NULL THEN
  SELECT c.created_at INTO v_after_at FROM customer_private.organisation_link_claim c WHERE c.id=p_after
   AND customer_private.organisation_link_same_context(app.tenant_is_synthetic(c.tenant_id),customer_private.synthetic_context());
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid queue request' USING ERRCODE='23514'; END IF;
 END IF;
 WITH rows AS (
  SELECT c.id,c.tenant_id,c.kind,c.created_at,c.profile_version,head.seq,head.state,
   CASE WHEN customer_private.organisation_link_redacted(c.id) THEN 'This text is hidden.' ELSE r.details->>'legalName' END legal_name,
   r.details->>'countryCode' country,customer_private.organisation_link_redacted(c.id) redacted
  FROM customer_private.organisation_link_claim c
  JOIN customer_private.organisation_profile_revision r ON r.tenant_id=c.tenant_id AND r.id=c.profile_revision_id
  CROSS JOIN LATERAL customer_private.organisation_link_head(c.id) head
  WHERE customer_private.organisation_link_same_context(app.tenant_is_synthetic(c.tenant_id),customer_private.synthetic_context()) AND ((p_scope='open')=(head.state IN ('pending','needs_evidence','creation_approved')))
  AND (p_after IS NULL OR (c.created_at,c.id)>(v_after_at,p_after))
  ORDER BY c.created_at,c.id LIMIT p_page_size+1),
 shown AS (SELECT * FROM rows ORDER BY created_at,id LIMIT p_page_size)
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('claimId',s.id,'workspaceId',s.tenant_id,'workspaceName',(SELECT t.name FROM app.tenant t WHERE t.id=s.tenant_id),
  'kind',s.kind,'state',s.state,'version',s.seq,'filedAt',s.created_at,'legalName',s.legal_name,'country',s.country,'redacted',s.redacted,
  'evidenceCount',(SELECT count(*)::int FROM customer_private.organisation_link_evidence ev WHERE ev.claim_id=s.id),
  'candidateCount',(SELECT jsonb_array_length(x->'organisations')+jsonb_array_length(x->'workspaces') FROM (SELECT customer_private.organisation_link_candidates(s.id) x) y))
  ORDER BY s.created_at,s.id) FROM shown s),'[]'::jsonb),
  CASE WHEN (SELECT count(*) FROM rows)>p_page_size THEN (SELECT id FROM shown ORDER BY created_at DESC,id DESC LIMIT 1) ELSE NULL END
 INTO v_items,v_next;
 IF app.actor_id() IS DISTINCT FROM v_staff THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('scope',p_scope,'items',v_items,'nextAfter',v_next,'synthetic',customer_private.synthetic_context());
END $function$
;

-- Staff decision. Claim lookup, organisation lookup and the shared-link count all go through the rule.
CREATE OR REPLACE FUNCTION app.customer_organisation_link_decide(p_command uuid, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
 SELECT * INTO c FROM customer_private.organisation_link_claim x WHERE x.id=(p_input->>'claimId')::uuid AND customer_private.organisation_link_same_context(app.tenant_is_synthetic(x.tenant_id),customer_private.synthetic_context());
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
  SELECT * INTO v_org FROM app.organisation o WHERE o.id=(p_input->>'organisationId')::uuid AND customer_private.organisation_link_same_context(o.synthetic,customer_private.synthetic_context());
  IF NOT FOUND THEN RAISE EXCEPTION 'That organisation is not in the catalogue' USING ERRCODE='23514'; END IF;
  IF v_state NOT IN ('pending','creation_approved') THEN RAISE EXCEPTION 'That change is not allowed for this company link request' USING ERRCODE='23514'; END IF;
  -- Serialise decisions on one canonical organisation so two reviewers cannot both slip past the shared-link check.
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_link.organisation:'||v_org.id::text,0));
  IF v_ledger.state='linked' AND v_ledger.organisation_id=v_org.id THEN RAISE EXCEPTION 'This workspace is already linked to that organisation' USING ERRCODE='23514'; END IF;
  SELECT count(*)::int INTO v_others FROM (SELECT DISTINCT ON (l.tenant_id) l.state,l.organisation_id,l.tenant_id FROM customer_private.organisation_link l ORDER BY l.tenant_id,l.version DESC) h
  WHERE h.state='linked' AND h.organisation_id=v_org.id AND h.tenant_id<>c.tenant_id
  AND customer_private.organisation_link_same_context(app.tenant_is_synthetic(h.tenant_id),customer_private.synthetic_context());
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
END $function$
;

-- Customer command. Shape checks come first and need no context. The checks that depend on provenance (length, prefix, URL)
-- run after the role call has set the context. A receipt of a workspace with any redacted claim is never replayed from storage.
CREATE OR REPLACE FUNCTION customer.organisation_link_command(p_command uuid, p_operation text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
   OR p_input->>'note'<>btrim(p_input->>'note') OR length(p_input->>'note')>1000 OR p_input->>'note' ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION 'Invalid company link request' USING ERRCODE='23514';
  END IF;
 ELSIF p_operation='add_evidence' THEN
  IF p_input-ARRAY['workspaceId','claimId','expectedVersion','evidenceKind','statement','url']<>'{}'::jsonb
   OR NOT (p_input ?& ARRAY['workspaceId','claimId','expectedVersion','evidenceKind','statement','url'])
   OR jsonb_typeof(p_input->'claimId')<>'string' OR p_input->>'claimId' !~ v_uuid
   OR jsonb_typeof(p_input->'expectedVersion')<>'number' OR (p_input->>'expectedVersion') !~ '^[0-9]{1,4}$'
   OR jsonb_typeof(p_input->'evidenceKind')<>'string' OR p_input->>'evidenceKind' NOT IN ('REGISTRATION_STATEMENT','WEBSITE_STATEMENT','TRADE_REFERENCE_STATEMENT','AUTHORISATION_STATEMENT')
   OR jsonb_typeof(p_input->'statement')<>'string' OR p_input->>'statement'<>btrim(p_input->>'statement') OR length(p_input->>'statement')>1000
   OR p_input->>'statement' ~ '[[:cntrl:]]'
   OR jsonb_typeof(p_input->'url') NOT IN ('string','null')
   OR (jsonb_typeof(p_input->'url')='string' AND length(p_input->>'url')>200) THEN
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
 IF p_operation='file' THEN
  IF length(p_input->>'note')<(CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) OR (p_input->>'note' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context()) THEN
   RAISE EXCEPTION 'Invalid company link request' USING ERRCODE='23514';
  END IF;
 ELSIF p_operation='add_evidence' THEN
  IF length(p_input->>'statement')<(CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) OR (p_input->>'statement' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context())
   OR (jsonb_typeof(p_input->'url')='string' AND ((p_input->>'url' !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.(example|test|invalid)(/[A-Za-z0-9._~/-]*)?$' AND customer_private.synthetic_context())
    OR (p_input->>'url' !~ '^https://[^[:space:]@]+$' AND NOT customer_private.synthetic_context()))) THEN
   RAISE EXCEPTION 'Invalid company link request' USING ERRCODE='23514';
  END IF;
 END IF;
 SELECT * INTO v_prior FROM customer_private.organisation_link_request q WHERE q.actor_kind='customer' AND q.actor_id=v_actor AND q.command_id=p_command;
 IF FOUND THEN
  IF v_prior.operation<>p_operation OR v_prior.request<>p_input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  -- A stored result may hold text of a claim that was later redacted. Rebuild the current masked state instead.
  IF EXISTS(SELECT FROM customer_private.organisation_link_claim x JOIN customer_private.organisation_link_redaction d ON d.claim_id=x.id WHERE x.tenant_id=v_target) THEN
   RETURN jsonb_build_object('workspaceId',v_target,'commandId',p_command,'canEdit',true)||customer_private.organisation_link_state(v_target,true)||jsonb_build_object('expiresAt',customer_private.organisation_link_expiry());
  END IF;
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
END $function$
;

-- Customer search. The writer role check runs first and fixes the context. Then one lock per person serialises the rate limit.
-- A limited answer is the same body as a miss. Exact-lane rows fill the cap first, then the name lane, then the set is ordered by name and id.
CREATE OR REPLACE FUNCTION customer.organisation_link_search(p_target uuid, p_term text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_actor uuid:=customer.actor_id(); v_country text; v_details jsonb; v_pattern text; v_items jsonb:='[]'::jsonb;
 v_profile_key text; v_profile_host text; v_keys text[]; v_shapes text[]; v_hosts uuid[]; v_ids uuid[]:=ARRAY[]::uuid[]; v_row record;
 v_recent integer; v_day integer;
BEGIN
 IF v_actor IS NULL OR p_target IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF customer_private.organisation_profile_role(p_target,v_actor) IS DISTINCT FROM 'writer' THEN RAISE EXCEPTION 'Workspace owner or admin required' USING ERRCODE='42501'; END IF;
 IF p_term IS NULL OR p_term<>btrim(p_term) OR length(p_term) NOT BETWEEN 3 AND 80 OR p_term ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE='23514'; END IF;
 SELECT r.details INTO v_details FROM customer_private.organisation_profile_revision r WHERE r.tenant_id=p_target ORDER BY r.version DESC LIMIT 1;
 v_country:=v_details->>'countryCode';
 IF v_country IS NULL THEN RAISE EXCEPTION 'Save the company profile before searching' USING ERRCODE='23514'; END IF;
 v_pattern:='%'||replace(replace(replace(lower(p_term),'\','\\'),'%','\%'),'_','\_')||'%';
 -- One lock per person makes delete, count and insert one step, so two parallel searches at the cap cannot both pass.
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_link.search:'||v_actor::text,0));
 DELETE FROM customer_private.organisation_link_search_attempt a WHERE a.actor_id=v_actor AND a.created_at<clock_timestamp()-interval '24 hours';
 SELECT count(*) FILTER (WHERE a.created_at>clock_timestamp()-interval '10 minutes')::int,count(*)::int INTO v_recent,v_day
 FROM customer_private.organisation_link_search_attempt a WHERE a.actor_id=v_actor AND a.created_at>clock_timestamp()-interval '24 hours';
 IF v_recent<10 AND v_day<60 THEN
  INSERT INTO customer_private.organisation_link_search_attempt(actor_id) VALUES(v_actor);
  v_profile_key:=customer_private.organisation_link_name_key(v_details->>'legalName');
  v_profile_host:=customer_private.organisation_link_host_key(v_details->>'website');
  -- Each key is computed once. A key shorter than three letters never takes the exact lane.
  v_keys:=ARRAY(SELECT DISTINCT k FROM unnest(ARRAY[v_profile_key,customer_private.organisation_link_name_key(p_term)]) k WHERE length(k)>=3);
  -- A name key is the lowercase name with characters deleted (punctuation, legal-form words, a leading Synthetic), from the start,
  -- the middle or the end. So the key letters occur in order somewhere in the letters and digits of the name. The shape has no start
  -- anchor, because a deleted word may come first, and no end anchor, because a deleted word may come last. This cheap test keeps the
  -- costly key function off names that cannot match. It only ever drops names whose key cannot equal a searched key.
  v_shapes:=ARRAY(SELECT regexp_replace(k,'(.)','\1.*','g') FROM unnest(v_keys) k);
  v_hosts:=ARRAY(SELECT i.organisation_id FROM app.public_identifier i WHERE v_profile_host IS NOT NULL
   AND i.domain IN (v_profile_host,'www.'||v_profile_host) AND regexp_replace(i.domain,'^www\.','')=v_profile_host);
  -- Cheap tests first, in the order of the answer. The eligibility helper then runs only until ten rows have passed, so its cost does not
  -- grow with the catalogue. Each organisation has one rank, so it can appear once only. OFFSET 0 keeps the rank from being computed twice.
  FOR v_row IN
   SELECT o.id FROM app.organisation o
   CROSS JOIN LATERAL (SELECT CASE
     WHEN o.id=ANY(v_hosts) THEN 0
     WHEN cardinality(v_shapes)>0 AND regexp_replace(lower(o.name),'[^[:alnum:]]+','','g') ~ ANY(v_shapes)
      AND customer_private.organisation_link_name_key(o.name)=ANY(v_keys) THEN 0
     WHEN lower(o.name) LIKE v_pattern THEN 1 END AS rank OFFSET 0) r
   WHERE o.country=v_country AND r.rank IS NOT NULL
   ORDER BY r.rank,o.name,o.id
  LOOP
   IF customer_private.organisation_link_public_organisation(v_row.id) THEN
    v_ids:=v_ids||v_row.id;
    EXIT WHEN cardinality(v_ids)=10;
   END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'country',o.country) ORDER BY o.name,o.id),'[]'::jsonb) INTO v_items
  FROM app.organisation o WHERE o.id=ANY(v_ids);
 END IF;
 IF customer.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Company link access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',p_target,'expiresAt',customer_private.organisation_link_expiry(),'organisations',v_items);
END $function$
;

-- Evidence URL. A synthetic workspace keeps the exact old rule. A real workspace accepts any https address without spaces or @.
ALTER TABLE customer_private.organisation_link_evidence DROP CONSTRAINT organisation_link_evidence_url_check;
ALTER TABLE customer_private.organisation_link_evidence ADD CONSTRAINT organisation_link_evidence_url_check CHECK(url IS NULL OR CASE WHEN coalesce(app.tenant_is_synthetic(tenant_id),true)
 THEN length(url)<=200 AND url ~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.(example|test|invalid)(/[A-Za-z0-9._~/-]*)?$'
 ELSE length(url)<=200 AND url ~ '^https://[^[:space:]@]+$' END);
