-- ADR056. Existing customer modules keep legacy behavior; real work uses real provenance.
CREATE FUNCTION customer_private.service_request_synthetic(request uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT t.synthetic FROM customer_private.service_request r JOIN app.tenant t ON t.id=r.tenant_id WHERE r.id=request $$;
CREATE FUNCTION app.organisation_is_synthetic(organisation uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT o.synthetic FROM app.organisation o WHERE o.id=$1 $$;
REVOKE ALL ON FUNCTION customer_private.service_request_synthetic(uuid),app.organisation_is_synthetic(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
ALTER TABLE app.public_identifier DROP CONSTRAINT public_identifier_synthetic_check;
ALTER TABLE app.public_identifier ADD CONSTRAINT public_identifier_synthetic_check CHECK(synthetic=app.organisation_is_synthetic(organisation_id));

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.assert_customer_delivery(app.customer_delivery_assignment)'::regprocedure),'UTF8')),'hex')<>'602e2ed6a265279d7f838971237f5e687a9260b49e6a43d5fc1c166f1d264eb3' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.assert_customer_delivery';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.assert_customer_delivery(disclosure app.customer_delivery_assignment)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF disclosure.created_by IS DISTINCT FROM app.actor_id() OR NOT coalesce(app.can_access(disclosure.tenant_id,'INTERNAL',app.tenant_processing_purpose(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid)),false)
 OR coalesce(app.member_role(disclosure.tenant_id),'') NOT IN ('owner','admin') OR NOT app.fresh_mfa()
 OR NOT EXISTS(SELECT FROM app.tenant WHERE id=disclosure.tenant_id AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Account delivery requires owner/admin and fresh MFA' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM identity.session s JOIN identity.assurance a ON a.session_id=s.id JOIN identity.principal p ON p.identity_id=s."userId"
 JOIN identity."user" u ON u.id=p.identity_id JOIN app.membership m ON m.user_id=p.id AND m.tenant_id=disclosure.tenant_id
 WHERE p.id=disclosure.created_by AND p.disabled_at IS NULL AND u."twoFactorEnabled" AND m.revoked_at IS NULL AND m.role IN ('owner','admin')
 AND p.operating_country=ANY(m.allowed_countries) AND current_setting('corridra.purpose',true)=ANY(m.allowed_purposes)
 AND encode(sha256(convert_to(s.token,'UTF8')),'hex')=current_setting('corridra.session_hash',true)
 AND s."expiresAt">clock_timestamp() AND s."createdAt">clock_timestamp()-interval '24 hours' AND a.verified_at>clock_timestamp()-interval '5 minutes'
 FOR SHARE OF s,a,p,u,m;
 IF NOT FOUND OR NOT app.customer_delivery_scope(disclosure.tenant_id,disclosure.request_id,disclosure.link_id,disclosure.created_by) THEN RAISE EXCEPTION 'Original request or reviewed report unavailable' USING ERRCODE='42501';END IF;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.assert_decision_disclosure(app.delivery_decision_publication)'::regprocedure),'UTF8')),'hex')<>'1f7f93047462f5bef194b4a72badb2a3b617ee10c85a4796cbcacf9a17f23fdd' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.assert_decision_disclosure';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.assert_decision_disclosure(disclosure app.delivery_decision_publication)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE decision uuid;
BEGIN
 IF disclosure.created_by IS DISTINCT FROM app.actor_id() OR NOT coalesce(app.can_access(disclosure.tenant_id,'INTERNAL',app.tenant_processing_purpose(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid)),false)
 OR coalesce(app.member_role(disclosure.tenant_id),'') NOT IN ('owner','admin') OR NOT app.fresh_mfa()
 OR NOT EXISTS(SELECT FROM app.tenant WHERE id=disclosure.tenant_id AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Decision disclosure requires owner/admin and fresh MFA' USING ERRCODE='42501'; END IF;
 -- Preserve the original authority, additionally enforcing its wall-clock
 -- limits after waits. Lock active actor/session/membership/assurance rows.
 PERFORM 1 FROM identity.session s JOIN identity.assurance a ON a.session_id=s.id JOIN identity.principal p ON p.identity_id=s."userId"
 JOIN identity."user" u ON u.id=p.identity_id JOIN app.membership m ON m.user_id=p.id AND m.tenant_id=disclosure.tenant_id
 WHERE p.id=disclosure.created_by AND p.disabled_at IS NULL AND u."twoFactorEnabled" AND m.revoked_at IS NULL AND m.role IN ('owner','admin')
 AND p.operating_country=ANY(m.allowed_countries) AND current_setting('corridra.purpose',true)=ANY(m.allowed_purposes)
 AND encode(sha256(convert_to(s.token,'UTF8')),'hex')=current_setting('corridra.session_hash',true)
 AND s."expiresAt">clock_timestamp() AND s."createdAt">clock_timestamp()-interval '24 hours' AND a.verified_at>clock_timestamp()-interval '5 minutes'
 FOR SHARE OF s,a,p,u,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Decision disclosure assurance expired' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM app.delivery_publication p WHERE p.tenant_id=disclosure.tenant_id AND p.id=disclosure.publication_id AND p.created_by=disclosure.created_by AND app.delivery_publication_valid(p.id)) THEN RAISE EXCEPTION 'Own active publication required' USING ERRCODE='42501'; END IF;
 FOREACH decision IN ARRAY disclosure.decision_ids LOOP
  IF NOT app.client_decision_valid(disclosure.tenant_id,disclosure.publication_id,decision,disclosure.created_by) THEN RAISE EXCEPTION 'Decision outside approved source scope' USING ERRCODE='42501'; END IF;
 END LOOP;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.commercial_enabled(uuid)'::regprocedure),'UTF8')),'hex')<>'1699a14fc159dca91ed0db5fed3dde0e4b1e3b83dff5d0f26a5736c563dad267' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.commercial_enabled';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.commercial_enabled(t uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT app.can_access(t,'INTERNAL',app.tenant_processing_purpose(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid)) AND EXISTS(SELECT FROM app.tenant WHERE id=t AND (synthetic OR app.real_use_allowed(id))) AND coalesce((SELECT (value->>'enabled')::boolean FROM app.config_version WHERE tenant_id=t AND key='opportunities.commands' AND effective_from<=now() ORDER BY version DESC LIMIT 1),false)
$function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.customer_delivery_options(uuid)'::regprocedure),'UTF8')),'hex')<>'a038e32e90f82800489c307ccdb1a80a514bbd9fc30bbef800684defcc25571a' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.customer_delivery_options';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.customer_delivery_options(selected_mission uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=app.actor_id();t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;req customer_private.owned_request;links jsonb;
BEGIN
 IF actor IS NULL OR NOT coalesce(app.can_access(t,'INTERNAL',app.tenant_processing_purpose(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid)),false) OR coalesce(app.member_role(t),'') NOT IN ('owner','admin') OR NOT EXISTS(SELECT FROM app.mission WHERE tenant_id=t AND id=selected_mission) THEN RAISE EXCEPTION 'Owner/admin mission review required' USING ERRCODE='42501';END IF;
 SELECT * INTO req FROM customer_private.owned_request WHERE mission_tenant_id=t AND mission_id=selected_mission;
 IF NOT FOUND THEN RETURN jsonb_build_object('missionId',selected_mission,'request',NULL,'links','[]'::jsonb,'synthetic',customer_private.synthetic_context());END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'title',p.copy->>'title','expiresAt',l.expires_at,'assignmentId',a.id) ORDER BY l.created_at DESC,l.id),'[]'::jsonb) INTO links
 FROM (SELECT link.* FROM app.delivery_link link JOIN app.delivery_publication pub ON pub.tenant_id=link.tenant_id AND pub.id=link.publication_ids[1] WHERE link.tenant_id=t AND link.created_by=actor AND link.audience='CLIENT_PROGRESS' AND pub.mission_id=selected_mission AND pub.created_by=actor ORDER BY link.created_at DESC,link.id LIMIT 1000) l
 JOIN app.delivery_publication p ON p.tenant_id=l.tenant_id AND p.id=l.publication_ids[1] AND p.mission_id=selected_mission AND p.created_by=actor
 LEFT JOIN app.customer_delivery_assignment a ON a.tenant_id=l.tenant_id AND a.link_id=l.id
 WHERE app.customer_delivery_scope(t,req.id,l.id,actor);
 IF app.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('missionId',selected_mission,'request',jsonb_build_object('id',req.id,'createdAt',req.created_at),'links',links,'synthetic',customer_private.synthetic_context());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.customer_organisation_link_decide(uuid,jsonb)'::regprocedure),'UTF8')),'hex')<>'5378a4b54f7b4645b0852111707ad04eada9f847a022c29c8d59092d3a3f782a' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.customer_organisation_link_decide';END IF;END $guard$;
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
 SELECT * INTO c FROM customer_private.organisation_link_claim x WHERE x.id=(p_input->>'claimId')::uuid AND app.tenant_is_synthetic(x.tenant_id)=customer_private.synthetic_context();
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
  SELECT * INTO v_org FROM app.organisation o WHERE o.id=(p_input->>'organisationId')::uuid AND o.synthetic=customer_private.synthetic_context();
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
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.customer_organisation_link_queue(text,uuid,integer)'::regprocedure),'UTF8')),'hex')<>'2e9aa5ae773e4b5fe71b7a3654981ed4872f481577284e5db8305ad64cd75bbb' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.customer_organisation_link_queue';END IF;END $guard$;
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
  SELECT c.created_at INTO v_after_at FROM customer_private.organisation_link_claim c WHERE c.id=p_after;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid queue request' USING ERRCODE='23514'; END IF;
 END IF;
 WITH rows AS (
  SELECT c.id,c.tenant_id,c.kind,c.created_at,c.profile_version,head.seq,head.state,r.details->>'legalName' legal_name,r.details->>'countryCode' country
  FROM customer_private.organisation_link_claim c
  JOIN customer_private.organisation_profile_revision r ON r.tenant_id=c.tenant_id AND r.id=c.profile_revision_id
  CROSS JOIN LATERAL customer_private.organisation_link_head(c.id) head
  WHERE app.tenant_is_synthetic(c.tenant_id)=customer_private.synthetic_context() AND ((p_scope='open')=(head.state IN ('pending','needs_evidence','creation_approved')))
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
 RETURN jsonb_build_object('scope',p_scope,'items',v_items,'nextAfter',v_next,'synthetic',customer_private.synthetic_context());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.delivery_authorized(text,text)'::regprocedure),'UTF8')),'hex')<>'8be75b6528b45240df3040bdf33c42007f50aeb701e5674c403dd2ba780e800f' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.delivery_authorized';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.delivery_authorized(h text, audience text)
 RETURNS app.delivery_link
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE l app.delivery_link;pid uuid;
BEGIN
 SELECT * INTO l FROM app.delivery_link WHERE token_hash=h AND delivery_link.audience=delivery_authorized.audience AND expires_at>now();
 IF l.id IS NULL OR NOT app.delivery_subject_access(l.tenant_id,l.created_by,'INTERNAL',app.tenant_processing_purpose(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid)) OR EXISTS(SELECT FROM app.delivery_revocation WHERE tenant_id=l.tenant_id AND link_id=l.id) THEN RAISE EXCEPTION 'Link unavailable or expired' USING ERRCODE='42501'; END IF;
 FOREACH pid IN ARRAY l.publication_ids LOOP IF NOT app.delivery_publication_valid(pid) THEN RAISE EXCEPTION 'Published scope unavailable' USING ERRCODE='42501'; END IF; END LOOP;
 RETURN l;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.delivery_guard()'::regprocedure),'UTF8')),'hex')<>'104655c5f9338661bc6feacd53351244adf2b96d46c09bd898a87c125827cecb' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.delivery_guard';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.delivery_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE j jsonb;pid uuid;batch app.delivery_import; customer_execution jsonb;
BEGIN
 IF NEW.created_at<>now() THEN RAISE EXCEPTION 'Server creation time required' USING ERRCODE='23514'; END IF;
 IF nullif(current_setting('corridra.customer_programme_execution',true),'') IS NOT NULL THEN
  customer_execution:=customer_private.programme_execution_context(TG_RELID,to_jsonb(NEW));
  IF customer_execution IS NULL THEN RAISE EXCEPTION 'Customer programme execution denied' USING ERRCODE='42501'; END IF;
 ELSE
 IF NEW.created_by IS DISTINCT FROM app.actor_id() OR NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL',app.tenant_processing_purpose(NEW.tenant_id)),false) OR coalesce(app.member_role(NEW.tenant_id),'') NOT IN ('owner','admin','operator') OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 END IF;
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
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.delivery_publication_valid(uuid)'::regprocedure),'UTF8')),'hex')<>'3cc9835aa8b4651bf46f236e4bda35f27337d8a302e989a49ad4911af5845bd8' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.delivery_publication_valid';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.delivery_publication_valid(pid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT FROM app.delivery_publication p JOIN app.mission_intake i ON i.tenant_id=p.tenant_id AND i.id=p.mission_id
 WHERE p.id=pid AND i.retention_until>now() AND app.delivery_subject_access(p.tenant_id,p.created_by,'INTERNAL',app.tenant_processing_purpose(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid))
 AND NOT EXISTS(SELECT FROM app.delivery_revocation WHERE tenant_id=p.tenant_id AND publication_id=p.id)
 AND NOT EXISTS(SELECT FROM jsonb_array_elements(p.copy->'meetings') j LEFT JOIN app.meeting mt ON mt.tenant_id=p.tenant_id AND mt.id=(j->>'id')::uuid LEFT JOIN app.communication c ON c.tenant_id=mt.tenant_id AND c.id=mt.message_id LEFT JOIN app.target_account ta ON ta.tenant_id=c.tenant_id AND ta.id=c.target_id LEFT JOIN app.relationship r ON r.tenant_id=ta.tenant_id AND r.id=ta.relationship_id
 WHERE mt.id IS NULL OR mt.mission_id<>p.mission_id OR NOT app.delivery_subject_access(p.tenant_id,p.created_by,r.classification,r.purpose))
 AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(p.copy->'opportunityIds') j LEFT JOIN app.opportunity o ON o.tenant_id=p.tenant_id AND o.id=j.value::uuid LEFT JOIN app.target_account ta ON ta.tenant_id=o.tenant_id AND ta.id=o.target_id LEFT JOIN app.relationship r ON r.tenant_id=ta.tenant_id AND r.id=ta.relationship_id
 WHERE o.id IS NULL OR o.mission_id<>p.mission_id OR NOT app.delivery_subject_access(p.tenant_id,p.created_by,r.classification,r.purpose)
 OR EXISTS(SELECT FROM app.commercial_record cr JOIN app.source_record s ON s.tenant_id=cr.tenant_id AND s.id=cr.source_id WHERE cr.tenant_id=o.tenant_id AND cr.opportunity_id=o.id AND (cr.retention_until<=now() OR s.retention_until<=now() OR NOT app.delivery_subject_access(p.tenant_id,p.created_by,s.classification,s.purpose)
 OR (cr.evidence_id IS NOT NULL AND NOT EXISTS(SELECT FROM app.evidence_object e JOIN app.evidence_state es ON es.tenant_id=e.tenant_id AND es.id=e.id WHERE e.tenant_id=cr.tenant_id AND e.id=cr.evidence_id AND e.retention_until>now() AND es.status IN ('UNDER_REVIEW','VERIFIED') AND (es.scan_status='CLEAN' OR (es.scan_status='BYPASSED' AND coalesce((SELECT (value->>'enabled')::boolean FROM app.config_version WHERE tenant_id=e.tenant_id AND key='evidence.scan_bypass' AND effective_from<=now() ORDER BY version DESC LIMIT 1),false))) AND app.delivery_subject_access(p.tenant_id,p.created_by,e.classification,e.purpose)))))
 OR EXISTS(SELECT FROM app.accounting_confirmation ac JOIN app.source_record s ON s.tenant_id=ac.tenant_id AND s.id=ac.source_id WHERE ac.tenant_id=o.tenant_id AND ac.opportunity_id=o.id AND (s.retention_until<=now() OR NOT app.delivery_subject_access(p.tenant_id,p.created_by,s.classification,s.purpose)))))
$function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.delivery_subject_access(uuid,uuid,text,text)'::regprocedure),'UTF8')),'hex')<>'df70024f4034bc8e247ce3ea89fbea264c23ed65eb6fc0bea484f246eec10b33' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.delivery_subject_access';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.delivery_subject_access(t uuid, a uuid, c text, p text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT FROM app.membership m JOIN identity.principal pr ON pr.id=m.user_id JOIN identity."user" u ON u.id=pr.identity_id JOIN app.tenant tn ON tn.id=m.tenant_id
 WHERE m.tenant_id=t AND m.user_id=a AND m.role IN ('owner','admin') AND m.revoked_at IS NULL AND pr.disabled_at IS NULL AND u."twoFactorEnabled" AND (tn.synthetic OR app.real_use_allowed(tn.id))
 AND pr.operating_country=ANY(m.allowed_countries) AND p=ANY(m.allowed_purposes) AND c=ANY(m.allowed_classifications))
$function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.experience_publication_valid(app.delivery_experience_publication)'::regprocedure),'UTF8')),'hex')<>'f55102bebbb8ba3fa3fa950a22413c46fc6254564526238cb55591ba15a340f1' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.experience_publication_valid';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.experience_publication_valid(e app.delivery_experience_publication)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE p app.delivery_publication; req app.mission_requirements;q app.mission_quotation;tid uuid; BEGIN
 SELECT * INTO p FROM app.delivery_publication WHERE tenant_id=e.tenant_id AND id=e.publication_id;
 IF p.id IS NULL OR NOT app.delivery_publication_valid(p.id) OR NOT app.delivery_subject_access(e.tenant_id,e.created_by,'INTERNAL',app.tenant_processing_purpose(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid)) THEN RETURN false;END IF;
 IF e.requirement_id IS NOT NULL THEN SELECT * INTO req FROM app.mission_requirements WHERE tenant_id=e.tenant_id AND id=e.requirement_id AND mission_id=p.mission_id;IF req.id IS NULL OR NOT app.experience_source_valid(e.tenant_id,req.source_id,req.claim_id,e.created_by) THEN RETURN false;END IF;END IF;
 FOREACH tid IN ARRAY e.target_ids LOOP IF NOT app.experience_target_valid(e.tenant_id,tid,p.mission_id,e.created_by) THEN RETURN false;END IF;END LOOP;
 IF EXISTS(SELECT FROM jsonb_array_elements(e.target_snapshots) v WHERE v->>'assessmentId' IS NOT NULL AND NOT app.experience_assessment_valid(e.tenant_id,(v->>'assessmentId')::uuid,e.created_by)) THEN RETURN false;END IF;
 FOREACH tid IN ARRAY e.quotation_ids LOOP SELECT * INTO q FROM app.mission_quotation WHERE tenant_id=e.tenant_id AND id=tid AND mission_id=p.mission_id AND target_id=ANY(e.target_ids) AND requirement_id=e.requirement_id;IF q.id IS NULL OR NOT app.experience_source_valid(e.tenant_id,q.source_id,q.claim_id,e.created_by) THEN RETURN false;END IF;END LOOP;
 RETURN true;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.guard_commercial_mission()'::regprocedure),'UTF8')),'hex')<>'5b99c533f426096b1a353002c4df7bb4025f3473009599b7e0ffc94677fc640e' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.guard_commercial_mission';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.guard_commercial_mission()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE req app.mission_requirements; pack app.corridor_pack_version; rfq app.mission_rfq; quote app.mission_quotation; a app.mission_assessment; v jsonb; k text; tid uuid; expected integer; template jsonb;
BEGIN
 IF NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL',app.tenant_processing_purpose(NEW.tenant_id)) AND app.member_role(NEW.tenant_id) IN ('owner','admin','operator') AND NEW.created_by=app.actor_id(),false) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Synthetic mission authority required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':commercial-missions',0));
 IF NOT EXISTS(SELECT FROM app.mission m JOIN app.mission_intake i ON i.tenant_id=m.tenant_id AND i.id=m.id WHERE m.tenant_id=NEW.tenant_id AND m.id=NEW.mission_id AND m.status NOT IN ('CLOSED','CANCELLED') AND i.retention_until>now()) THEN RAISE EXCEPTION 'Current mission required'; END IF;
 IF TG_TABLE_NAME NOT IN ('mission_schedule','commercial_mission_command') THEN
  IF NOT EXISTS(SELECT FROM app.claim c JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.claim_id AND s.id=NEW.source_id AND s.retention_until>now() AND s.observed_at<=now() AND s.ai_policy='DENY' AND s.classification IN ('PUBLIC','INTERNAL') AND app.can_access(s.tenant_id,s.classification,s.purpose) AND app.can_access(c.tenant_id,c.classification,c.purpose)) THEN RAISE EXCEPTION 'Current matching source and claim required'; END IF;
 END IF;
 IF TG_TABLE_NAME='mission_requirements' THEN
  SELECT p.* INTO pack FROM app.mission_route_assignment r JOIN app.corridor_pack_version p ON p.tenant_id=r.tenant_id AND p.id=r.pack_id WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.assignment_id AND r.mission_id=NEW.mission_id AND r.status='ASSIGNED' AND r.version=(SELECT max(version) FROM app.mission_route_assignment WHERE tenant_id=r.tenant_id AND mission_id=r.mission_id);
  IF pack.id IS NULL OR NOT pack.configuration->'requirements' ? NEW.definition_id::text THEN RAISE EXCEPTION 'Pinned requirement definition required'; END IF;
  SELECT d.schema INTO template FROM app.requirement_definition d JOIN app.mission_route_assignment r ON r.tenant_id=d.tenant_id AND r.id=NEW.assignment_id JOIN app.mission_type_definition t ON t.tenant_id=r.tenant_id AND t.id=r.mission_type_id WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.definition_id AND d.schema->>'typeKey'=t.key;
  IF template IS NULL OR template->>'schemaVersion'<>'1' THEN RAISE EXCEPTION 'Versioned mission requirement template required'; END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM app.mission_requirements WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id),0)+1 THEN RAISE EXCEPTION 'Sequential requirement version required'; END IF;
  IF NEW.reviewer_id IS NOT NULL AND (NEW.reviewer_id<>app.actor_id() OR app.member_role(NEW.tenant_id) NOT IN ('owner','admin') OR NOT app.fresh_mfa()) THEN RAISE EXCEPTION 'Reviewer must personally review with fresh MFA' USING ERRCODE='42501'; END IF;
  IF NOT NEW.fields ?& ARRAY['objective','role','product'] OR NEW.fields->>'role' NOT IN ('EXPORTER','IMPORTER','BUYER','SUPPLIER','INSTITUTION','OPERATOR') OR length(coalesce(NEW.fields->>'product',''))<3 OR length(coalesce(NEW.fields->>'objective',''))<3 THEN RAISE EXCEPTION 'Short requirement fields required'; END IF;
  FOR k,v IN SELECT * FROM jsonb_each(NEW.fields) LOOP
   IF k NOT IN ('objective','role','product','category','specifications','quantity','unit','targetMarkets','budgetMinor','currency','budgetBasis','moq','orderFrequency','materials','dimensions','technicalConstraints','certifications','oemOdm','delivery','leadTime','incoterm','requiredEvidence','travelDates','decisionCriteria','responsiblePersons','machinery') THEN RAISE EXCEPTION 'Unsupported requirement field'; END IF;
   IF k IN ('targetMarkets','certifications','requiredEvidence','decisionCriteria','responsiblePersons') THEN
    IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>30 OR EXISTS(SELECT FROM jsonb_array_elements(v) e WHERE jsonb_typeof(e)<>'string' OR length(e#>>'{}') NOT BETWEEN 2 AND 1000) THEN RAISE EXCEPTION 'Bounded requirement lists required'; END IF;
   ELSIF k='machinery' THEN
    IF jsonb_typeof(v)<>'object' OR EXISTS(SELECT FROM jsonb_each(v) e WHERE e.key NOT IN ('application','capacity','configuration','inputOutput','utilities','integration','documentation','commissioning','training','acceptance','warrantySpares','support','installationReferences','transport','risks') OR jsonb_typeof(e.value)<>'string' OR length(e.value#>>'{}') NOT BETWEEN 3 AND 1000) THEN RAISE EXCEPTION 'Typed machinery requirements required'; END IF;
   ELSIF jsonb_typeof(v)<>'string' OR length(v#>>'{}') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Bounded declared requirement text required'; END IF;
   IF k IN ('quantity','moq') AND v#>>'{}' !~ '^[1-9][0-9]{0,11}$' THEN RAISE EXCEPTION 'Exact positive requirement quantity required'; END IF;
  END LOOP;
  IF NEW.fields ?| ARRAY['budgetMinor','currency','budgetBasis'] AND (NOT NEW.fields ?& ARRAY['budgetMinor','currency','budgetBasis'] OR NEW.fields->>'budgetMinor' !~ '^(0|[1-9][0-9]{0,17})$' OR length(NEW.fields->>'budgetBasis')<3 OR NOT pack.configuration->'currencies' ? (NEW.fields->>'currency')) THEN RAISE EXCEPTION 'Supported exact budget and quantity basis required'; END IF;
  IF NEW.fields ?| ARRAY['quantity','moq'] AND (NOT NEW.fields ? 'unit' OR length(NEW.fields->>'unit')<1) THEN RAISE EXCEPTION 'Quantity unit required'; END IF;
 ELSE
  IF TG_TABLE_NAME NOT IN ('mission_schedule','commercial_mission_command') THEN
   SELECT * INTO req FROM app.mission_requirements WHERE tenant_id=NEW.tenant_id AND id=NEW.requirement_id AND mission_id=NEW.mission_id;
   IF req.id IS NULL OR req.version<>(SELECT max(version) FROM app.mission_requirements WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id) THEN RAISE EXCEPTION 'Current requirement version required'; END IF;
   SELECT p.* INTO pack FROM app.mission_route_assignment r JOIN app.corridor_pack_version p ON p.tenant_id=r.tenant_id AND p.id=r.pack_id WHERE r.tenant_id=req.tenant_id AND r.id=req.assignment_id;
   IF req.assignment_id<>(SELECT id FROM app.mission_route_assignment WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id ORDER BY version DESC LIMIT 1) THEN RAISE EXCEPTION 'Requirements need review after route reclassification'; END IF;
  END IF;
  IF TG_TABLE_NAME IN ('mission_assessment','mission_quotation','mission_selection') THEN
   IF NOT EXISTS(SELECT FROM app.target_account WHERE tenant_id=NEW.tenant_id AND id=NEW.target_id AND mission_id=NEW.mission_id AND app.research_target_access(NEW.tenant_id,NEW.target_id,true)) THEN RAISE EXCEPTION 'Matching accessible mission target required' USING ERRCODE='42501'; END IF;
  END IF;
  IF TG_TABLE_NAME='mission_assessment' THEN
   IF NOT pack.configuration->'assessments' ? NEW.definition_id::text OR NEW.version<>coalesce((SELECT max(version) FROM app.mission_assessment WHERE tenant_id=NEW.tenant_id AND target_id=NEW.target_id),0)+1 THEN RAISE EXCEPTION 'Pinned assessment and sequential version required'; END IF;
   SELECT d.schema INTO template FROM app.assessment_definition d JOIN app.mission_route_assignment r ON r.tenant_id=d.tenant_id AND r.id=req.assignment_id JOIN app.mission_type_definition t ON t.tenant_id=r.tenant_id AND t.id=r.mission_type_id WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.definition_id AND d.schema->>'typeKey'=t.key;
   IF template IS NULL OR template->>'schemaVersion'<>'1' OR EXISTS(SELECT FROM jsonb_array_elements_text(template->'criteria') c WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(NEW.results) r WHERE r->>'criterion'=c)) THEN RAISE EXCEPTION 'Complete configured assessment criteria required'; END IF;
   IF EXISTS(SELECT FROM jsonb_array_elements_text(template->'machineryFields') f WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(NEW.technical_results) r WHERE r->>'field'=f)) THEN RAISE EXCEPTION 'Record each configured machinery field, including unknowns'; END IF;
   FOR v IN SELECT * FROM jsonb_array_elements(NEW.technical_results) LOOP
    IF jsonb_typeof(v)<>'object' OR NOT v ?& ARRAY['field','result','basis'] OR (SELECT count(*) FROM jsonb_object_keys(v))<>3 OR NOT template->'machineryFields' ? (v->>'field') OR v->>'result' NOT IN ('FIT','GAP','UNKNOWN','UNSUITABLE') OR length(coalesce(v->>'basis','')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Typed machinery observation required'; END IF;
   END LOOP;
   FOR v IN SELECT * FROM jsonb_array_elements(NEW.results) LOOP
    IF jsonb_typeof(v)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(v))<>4 OR NOT v ?& ARRAY['criterion','result','requirement','basis'] OR v->>'criterion' NOT IN ('commercial_relevance','buyer_fit','supplier_fit','distributor_capability','machinery_fit','visit_suitability','evidence_completeness') OR v->>'result' NOT IN ('FIT','GAP','UNKNOWN','UNSUITABLE') OR length(coalesce(v->>'requirement',''))<3 OR length(coalesce(v->>'basis',''))<3 THEN RAISE EXCEPTION 'Typed evidence-aware assessment required'; END IF;
   END LOOP;
  ELSIF TG_TABLE_NAME='mission_rfq' THEN
   FOREACH tid IN ARRAY NEW.target_ids LOOP
    IF NOT EXISTS(SELECT FROM app.target_account WHERE tenant_id=NEW.tenant_id AND id=tid AND mission_id=NEW.mission_id AND app.research_target_access(NEW.tenant_id,tid,true)) THEN RAISE EXCEPTION 'Matching RFQ target required' USING ERRCODE='42501'; END IF;
   END LOOP;
  ELSIF TG_TABLE_NAME='mission_quotation' THEN
   SELECT * INTO rfq FROM app.mission_rfq WHERE tenant_id=NEW.tenant_id AND id=NEW.rfq_id AND mission_id=NEW.mission_id AND requirement_id=NEW.requirement_id;
   IF rfq.id IS NULL OR NOT NEW.target_id=ANY(rfq.target_ids) THEN RAISE EXCEPTION 'Original RFQ supplier association required'; END IF;
   IF NOT pack.configuration->'currencies' ? NEW.currency THEN RAISE EXCEPTION 'Unsupported route currency'; END IF;
   expected:=coalesce((SELECT max(revision) FROM app.mission_quotation WHERE tenant_id=NEW.tenant_id AND rfq_id=NEW.rfq_id AND target_id=NEW.target_id),0)+1;
   IF NEW.revision<>expected OR (NEW.revision=1 AND NEW.previous_id IS NOT NULL) OR (NEW.revision>1 AND NOT EXISTS(SELECT FROM app.mission_quotation WHERE tenant_id=NEW.tenant_id AND id=NEW.previous_id AND rfq_id=NEW.rfq_id AND target_id=NEW.target_id AND revision=NEW.revision-1)) THEN RAISE EXCEPTION 'Quotation revision history required'; END IF;
   FOR k,v IN SELECT * FROM jsonb_each(NEW.terms) LOOP
    IF k NOT IN ('specification','quantity','moq','unit','unitPriceMinor','totalPriceMinor','toolingMinor','setupMinor','packagingMinor','leadTime','validUntil','incoterm','shipping','warranty','installation','training','spares','paymentTerms') OR jsonb_typeof(v)<>'string' OR length(v#>>'{}')>1000 THEN RAISE EXCEPTION 'Unsupported quotation term'; END IF;
    IF k IN ('unitPriceMinor','totalPriceMinor','toolingMinor','setupMinor','packagingMinor') AND v#>>'{}' !~ '^(0|[1-9][0-9]{0,17})$' THEN RAISE EXCEPTION 'Exact nonnegative minor units required'; END IF;
    IF k IN ('quantity','moq') AND v#>>'{}' !~ '^[1-9][0-9]{0,11}$' THEN RAISE EXCEPTION 'Exact positive quantity required'; END IF;
   END LOOP;
   IF NEW.terms ? 'shipping' AND NEW.terms->>'shipping' NOT IN ('INCLUDED','EXCLUDED','NOT_SUPPLIED') THEN RAISE EXCEPTION 'Explicit shipping scope required'; END IF;
   IF NEW.terms ? 'incoterm' AND NEW.terms->>'incoterm' NOT IN ('EXW','FCA','CPT','CIP','DAP','DPU','DDP','FAS','FOB','CFR','CIF') THEN RAISE EXCEPTION 'Supported Incoterm required'; END IF;
   IF NEW.terms ? 'validUntil' THEN PERFORM (NEW.terms->>'validUntil')::timestamptz; END IF;
  ELSIF TG_TABLE_NAME='mission_selection' THEN
   SELECT * INTO a FROM app.mission_assessment WHERE tenant_id=NEW.tenant_id AND id=NEW.assessment_id AND target_id=NEW.target_id AND requirement_id=NEW.requirement_id;
   IF a.id IS NULL OR a.version<>(SELECT max(version) FROM app.mission_assessment WHERE tenant_id=NEW.tenant_id AND target_id=NEW.target_id) THEN RAISE EXCEPTION 'Current matching assessment required'; END IF;
   IF NEW.quotation_id IS NOT NULL THEN
    SELECT * INTO quote FROM app.mission_quotation WHERE tenant_id=NEW.tenant_id AND id=NEW.quotation_id AND target_id=NEW.target_id AND requirement_id=NEW.requirement_id;
    IF quote.id IS NULL OR EXISTS(SELECT FROM app.mission_quotation WHERE tenant_id=NEW.tenant_id AND previous_id=quote.id) THEN RAISE EXCEPTION 'Latest matching supplier offer required'; END IF;
   END IF;
   IF NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Active decision owner required'; END IF;
  ELSIF TG_TABLE_NAME='mission_schedule' THEN
   IF NEW.version<>coalesce((SELECT max(version) FROM app.mission_schedule WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id),0)+1 THEN RAISE EXCEPTION 'Sequential schedule version required'; END IF;
   FOR v IN SELECT * FROM jsonb_array_elements(NEW.entries) LOOP
    IF v->>'kind' NOT IN ('DESTINATION','EVENT','CANDIDATE','APPOINTMENT','AVAILABILITY','CONSTRAINT','LOGISTICS') OR length(coalesce(v->>'label',''))<3 OR length(coalesce(v->>'note',''))<3 OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=v->>'timezone') THEN RAISE EXCEPTION 'Typed schedule entry required'; END IF;
    IF v->>'kind'='APPOINTMENT' OR v ? 'meetingId' THEN
     IF NOT EXISTS(SELECT FROM app.meeting WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id AND id=(v->>'meetingId')::uuid AND status IN ('SCHEDULED','HELD')) OR v ?| ARRAY['startsAt','endsAt','location'] THEN RAISE EXCEPTION 'Appointment uses actual meeting schedule only'; END IF;
    END IF;
    IF v ? 'sourceId' AND NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=(v->>'sourceId')::uuid AND retention_until>now() AND app.can_access(tenant_id,classification,purpose)) THEN RAISE EXCEPTION 'Current schedule source required'; END IF;
   END LOOP;
  END IF;
 END IF;
 RETURN NEW;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.guard_corridor_configuration()'::regprocedure),'UTF8')),'hex')<>'9c105fddf5c4aae499587a91410d8a47ff13c5fa808ed3053078eb53c2059914' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.guard_corridor_configuration';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.guard_corridor_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE c app.corridor_definition; p app.corridor_pack_version; k text; v jsonb;
BEGIN
 IF NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL',app.tenant_processing_purpose(NEW.tenant_id)) AND app.member_role(NEW.tenant_id) IN ('owner','admin') AND app.fresh_mfa() AND NEW.created_by=app.actor_id(),false) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Synthetic configuration authority with fresh MFA required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':corridor',0));
 IF TG_TABLE_NAME='corridor_route' THEN
  SELECT * INTO c FROM app.corridor_definition WHERE tenant_id=NEW.tenant_id AND id=NEW.corridor_id;
  IF c.id IS NULL OR ARRAY[least(NEW.origin_market,NEW.destination_market),greatest(NEW.origin_market,NEW.destination_market)]<>ARRAY[c.market_a,c.market_b] THEN RAISE EXCEPTION 'Route endpoints must belong to corridor'; END IF;
 ELSIF TG_TABLE_NAME='corridor_pack_version' THEN
  IF NEW.version<>coalesce((SELECT max(version) FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id),0)+1 THEN RAISE EXCEPTION 'Sequential pack version required'; END IF;
  IF EXISTS(SELECT FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id AND effective_from>=NEW.effective_from) THEN RAISE EXCEPTION 'Pack effective date must increase'; END IF;
  IF NOT (NEW.configuration ?& ARRAY['missionTypes','requiredCapabilities','languages','currencies','timeZones','localities','clusters','requirements','assessments','sourceCategories','channels','jurisdictionPolicyRefs','evidenceTypes','reviewRequired','operatorCapabilities','coverage','aiPolicyRef','pricingRef']) OR (SELECT count(*) FROM jsonb_object_keys(NEW.configuration))<>18 OR NEW.configuration->'reviewRequired'<>'true'::jsonb THEN RAISE EXCEPTION 'Invalid or elevated pack configuration'; END IF;
  FOR k,v IN SELECT * FROM jsonb_each(NEW.configuration) LOOP
   IF k NOT IN ('reviewRequired','aiPolicyRef','pricingRef') THEN
    IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>50 THEN RAISE EXCEPTION 'Bounded configuration arrays required'; END IF;
    IF EXISTS(SELECT FROM jsonb_array_elements(v) x WHERE jsonb_typeof(x)<>'string') THEN RAISE EXCEPTION 'Configuration strings required'; END IF;
   END IF;
  END LOOP;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'currencies') x WHERE NOT EXISTS(SELECT FROM app.currency WHERE code=x)) OR EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'channels') x WHERE x NOT IN ('SYNTHETIC','MANUAL')) THEN RAISE EXCEPTION 'Unsupported currency or channel'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'timeZones') x WHERE NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=x)) OR EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'languages') x WHERE x !~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$') THEN RAISE EXCEPTION 'Valid timezone and locale required'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'requirements') x WHERE NOT EXISTS(SELECT FROM app.requirement_definition WHERE tenant_id=NEW.tenant_id AND id::text=x)) OR EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'assessments') x WHERE NOT EXISTS(SELECT FROM app.assessment_definition WHERE tenant_id=NEW.tenant_id AND id::text=x)) THEN RAISE EXCEPTION 'Exact same-tenant definition versions required'; END IF;
  IF NEW.configuration->'aiPolicyRef'<>'null'::jsonb AND NOT EXISTS(SELECT FROM app.ai_model_policy WHERE tenant_id=NEW.tenant_id AND id::text=NEW.configuration->>'aiPolicyRef' AND effective_from<=now() AND (configuration->>'effectiveUntil')::timestamptz>now() AND version=(SELECT max(version) FROM app.ai_model_policy next_policy WHERE next_policy.tenant_id=NEW.tenant_id AND next_policy.key=app.ai_model_policy.key AND next_policy.effective_from<=now())) THEN RAISE EXCEPTION 'Current same-tenant reviewed AI policy required'; END IF;
  IF NEW.configuration->'pricingRef'<>'null'::jsonb THEN RAISE EXCEPTION 'Pricing activation belongs to a later reviewed service'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'jurisdictionPolicyRefs') x WHERE NOT EXISTS(SELECT FROM app.communication_policy WHERE tenant_id=NEW.tenant_id AND id::text=x AND effective_from<=now() AND valid_until>now())) THEN RAISE EXCEPTION 'Current same-tenant communication policy required'; END IF;
 ELSIF TG_TABLE_NAME='mission_route_assignment' THEN
  IF NEW.version<>coalesce((SELECT max(version) FROM app.mission_route_assignment WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id),0)+1 THEN RAISE EXCEPTION 'Sequential assignment version required'; END IF;
  IF NEW.status='ASSIGNED' THEN
   SELECT * INTO p FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND id=NEW.pack_id;
   IF p.id IS NULL OR p.status NOT IN ('TESTING','LIMITED','ACTIVE') OR p.effective_from>now() OR p.version<>(SELECT max(version) FROM app.corridor_pack_version WHERE tenant_id=p.tenant_id AND route_id=p.route_id AND effective_from<=now()) OR NOT EXISTS(SELECT FROM app.mission_type_definition WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_type_id AND p.configuration->'missionTypes' ? key) THEN RAISE EXCEPTION 'Current available pack and mission type required'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.guard_delivery_experience()'::regprocedure),'UTF8')),'hex')<>'41aa647d6fe0b0ae988c0ee3685e2cfb388336c2f227e636da7451522c02ef43' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.guard_delivery_experience';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.guard_delivery_experience()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE p app.delivery_publication;req app.mission_requirements;q app.mission_quotation;c app.communication;mid uuid;tid uuid;aid uuid;d jsonb;
BEGIN
 IF nullif(current_setting('corridra.customer_context_execution',true),'') IS NOT NULL THEN
  IF customer_private.context_execution_context(TG_RELID,to_jsonb(NEW)) IS NULL THEN RAISE EXCEPTION 'Customer context execution denied' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.created_at<>now() OR NEW.created_by IS DISTINCT FROM app.actor_id() OR NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL',app.tenant_processing_purpose(NEW.tenant_id)),false) OR coalesce(app.member_role(NEW.tenant_id),'') NOT IN ('owner','admin','operator') OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Synthetic actor required' USING ERRCODE='42501'; END IF;
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
  IF NOT EXISTS(SELECT FROM app.delivery_participant dp JOIN app.mission_intake i ON i.tenant_id=dp.tenant_id AND i.id=dp.mission_id WHERE dp.tenant_id=NEW.tenant_id AND dp.id=NEW.participant_id AND i.retention_until>now()) OR NOT app.experience_source_valid(NEW.tenant_id,NEW.source_id,NEW.claim_id,NEW.created_by) OR NOT EXISTS(SELECT FROM app.organisation o JOIN app.organisation_source os ON os.organisation_id=o.id JOIN app.source_record s ON s.tenant_id=os.tenant_id AND s.id=os.source_id WHERE o.id=NEW.organisation_id AND (o.synthetic OR NOT customer_private.synthetic_context()) AND os.tenant_id=NEW.tenant_id AND os.source_id=NEW.source_id AND s.classification='PUBLIC') THEN RAISE EXCEPTION 'Explicit source-backed participant organisation required';END IF;
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
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.guard_operations_control()'::regprocedure),'UTF8')),'hex')<>'ef507fc91fe8753f641d97308ead3f510112199832b3c4f55aea4e4d457687f6' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.guard_operations_control';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.guard_operations_control()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE p app.corridor_pack_version; s app.source_record; q app.configuration_proposal; d app.service_document; e app.mission_effort; k text; r app.route_readiness;
BEGIN
 IF NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL',app.tenant_processing_purpose(NEW.tenant_id)) AND app.member_role(NEW.tenant_id) IN ('owner','admin') AND app.fresh_mfa() AND NEW.created_by=app.actor_id(),false) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Scoped synthetic administration with fresh MFA required' USING ERRCODE='42501'; END IF;
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
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.guard_research_record()'::regprocedure),'UTF8')),'hex')<>'166cd41be9ac3c8199321b06869fc5942eadc05774f10ddb9e51ff16986ffc45' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.guard_research_record';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.guard_research_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE src record; parent record;
BEGIN
 IF NEW.created_by<>app.actor_id() OR NEW.purpose<>app.tenant_processing_purpose(NEW.tenant_id) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Synthetic authenticated provenance required'; END IF;
 IF TG_TABLE_NAME IN ('organisation_source','private_contact_data','private_note') THEN
  SELECT * INTO src FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.source_id;
  IF NOT FOUND OR src.purpose<>NEW.purpose OR src.retention_until<=now() OR src.observed_at>now() OR src.ai_policy<>'DENY' OR src.classification NOT IN ('PUBLIC','INTERNAL') THEN RAISE EXCEPTION 'Current source required'; END IF;
  IF TG_TABLE_NAME='organisation_source' AND (src.classification<>'PUBLIC' OR src.kind<>'public_record') THEN RAISE EXCEPTION 'Public identity source required'; END IF;
  IF TG_TABLE_NAME='private_contact_data' AND (to_jsonb(NEW)->>'valid_until')::timestamptz>src.retention_until THEN RAISE EXCEPTION 'Contact validity exceeds source retention'; END IF;
 ELSIF TG_TABLE_NAME='organisation_attribute' THEN
  SELECT c.classification,c.purpose,s.retention_until,s.observed_at,s.ai_policy INTO src FROM app.claim c JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.claim_id;
  IF NOT FOUND OR src.classification<>NEW.classification OR src.purpose<>NEW.purpose OR src.retention_until<=now() OR src.observed_at>now() OR src.ai_policy<>'DENY' OR NEW.valid_until>src.retention_until THEN RAISE EXCEPTION 'Claim provenance required'; END IF;
 ELSIF TG_TABLE_NAME='target_account' THEN
  PERFORM 1 FROM app.mission WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id AND status IN ('ACTIVE','TARGETING') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active mission required'; END IF;
 ELSIF TG_TABLE_NAME='target_contact' THEN
  IF NOT EXISTS(SELECT FROM app.private_contact_data c JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.contact_id AND c.valid_until>now() AND s.retention_until>now()) THEN RAISE EXCEPTION 'Current contact source required'; END IF;
 ELSIF TG_TABLE_NAME='match_assessment' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':assessment:'||NEW.target_id::text,0));
  PERFORM 1 FROM app.target_account t JOIN app.mission m ON m.tenant_id=t.tenant_id AND m.id=t.mission_id WHERE t.tenant_id=NEW.tenant_id AND t.id=NEW.target_id AND m.status IN ('ACTIVE','TARGETING') FOR SHARE OF m;
  IF NOT FOUND OR NEW.version<>(SELECT COALESCE(max(version),0)+1 FROM app.match_assessment WHERE tenant_id=NEW.tenant_id AND target_id=NEW.target_id) THEN RAISE EXCEPTION 'Invalid assessment version'; END IF;
 ELSIF TG_TABLE_NAME='assessment_claim' THEN
  IF NOT EXISTS(SELECT FROM app.match_assessment a JOIN app.target_account t ON t.tenant_id=a.tenant_id AND t.id=a.target_id JOIN app.relationship r ON r.tenant_id=t.tenant_id AND r.id=t.relationship_id JOIN app.organisation_attribute oa ON oa.tenant_id=r.tenant_id AND app.research_canonical(r.tenant_id,oa.organisation_id)=app.research_canonical(r.tenant_id,r.organisation_id) JOIN app.claim c ON c.tenant_id=oa.tenant_id AND c.id=oa.claim_id JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.assessment_id AND c.id=NEW.claim_id AND oa.id=NEW.attribute_id AND oa.valid_until>now() AND s.retention_until>now()) THEN RAISE EXCEPTION 'Current attributable target evidence required'; END IF;
 END IF;
 RETURN NEW;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.guard_service_foundation()'::regprocedure),'UTF8')),'hex')<>'32d75cca0c902284209f0f10b4b118cde9711f85bff7dec395f26ab4d5d32005' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.guard_service_foundation';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.guard_service_foundation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE original app.service_ledger; rule app.reward_rule_version; task app.contribution; src app.source_record;
BEGIN
 IF NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL',app.tenant_processing_purpose(NEW.tenant_id)) AND NEW.created_by=app.actor_id(),false) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Synthetic tenant actor required' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='contribution' THEN
  IF NOT coalesce(app.member_role(NEW.tenant_id) IN ('owner','admin','operator'),false) THEN RAISE EXCEPTION 'Contribution operator required' USING ERRCODE='42501'; END IF;
 ELSE
  IF NOT coalesce(app.member_role(NEW.tenant_id) IN ('owner','admin') AND app.fresh_mfa(),false) THEN RAISE EXCEPTION 'Accounting/configuration authority and fresh MFA required' USING ERRCODE='42501'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':service-economics',0));
 IF TG_TABLE_NAME<>'reward_rule_version' THEN
  SELECT * INTO src FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.source_id AND app.can_access(tenant_id,classification,purpose) AND retention_until>now() AND observed_at<=now();
  IF src.id IS NULL THEN RAISE EXCEPTION 'Current accessible source required'; END IF;
 END IF;
 IF TG_TABLE_NAME='data_rights_policy' THEN
  IF NEW.version<>coalesce((SELECT max(version) FROM app.data_rights_policy WHERE tenant_id=NEW.tenant_id AND source_id=NEW.source_id),0)+1 OR EXISTS(SELECT FROM app.data_rights_policy WHERE tenant_id=NEW.tenant_id AND source_id=NEW.source_id AND effective_from>=NEW.effective_from) THEN RAISE EXCEPTION 'Sequential effective policy version required'; END IF;
  IF NEW.retention_until>src.retention_until OR NEW.retention_until<=now() OR NEW.data_classification<>src.classification OR NEW.data_purpose<>src.purpose OR cardinality(NEW.jurisdictions)=0 OR cardinality(NEW.processing_locations)=0 OR EXISTS(SELECT FROM unnest(NEW.jurisdictions||NEW.subject_locations||NEW.processing_locations) c WHERE NOT EXISTS(SELECT FROM app.country WHERE code=c)) THEN RAISE EXCEPTION 'Policy cannot expand source rights'; END IF;
  IF NEW.ai_permission<>'DENY' AND src.ai_policy='DENY' THEN RAISE EXCEPTION 'Source AI denial cannot be overridden'; END IF;
 ELSIF TG_TABLE_NAME='reward_rule_version' THEN
  IF NEW.version<>coalesce((SELECT max(version) FROM app.reward_rule_version WHERE tenant_id=NEW.tenant_id AND key=NEW.key),0)+1 OR EXISTS(SELECT FROM app.reward_rule_version WHERE tenant_id=NEW.tenant_id AND key=NEW.key AND tstzrange(effective_from,effective_until,'[)') && tstzrange(NEW.effective_from,NEW.effective_until,'[)')) THEN RAISE EXCEPTION 'Nonoverlapping sequential reward rule required'; END IF;
 ELSIF TG_TABLE_NAME='contribution' THEN
  IF NOT EXISTS(SELECT FROM app.mission WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id) OR (NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.contributor_id) AND NOT app.network_contribution_valid(NEW.tenant_id,NEW.mission_id,NEW.contributor_id,NEW.source_id,NEW.task_key)) THEN RAISE EXCEPTION 'Scoped mission and active contributor required'; END IF;
 ELSIF TG_TABLE_NAME='service_ledger' THEN
  IF NOT EXISTS(SELECT FROM app.mission WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id) THEN RAISE EXCEPTION 'Accessible mission required'; END IF;
  IF NEW.reverse_of IS NOT NULL THEN
   SELECT * INTO original FROM app.service_ledger WHERE tenant_id=NEW.tenant_id AND id=NEW.reverse_of;
   IF original.id IS NULL OR original.reverse_of IS NOT NULL OR (NEW.mission_id,NEW.kind,NEW.currency,NEW.contribution_id,NEW.rule_id,NEW.amount_minor) IS DISTINCT FROM (original.mission_id,original.kind,original.currency,original.contribution_id,original.rule_id,-original.amount_minor) OR NEW.occurred_at<original.occurred_at OR EXISTS(SELECT FROM app.reward_reconciliation WHERE tenant_id=NEW.tenant_id AND ledger_id=original.id AND status='MANUALLY_RECONCILED') THEN RAISE EXCEPTION 'Exact unreconciled compensation required'; END IF;
  ELSIF NEW.kind='CONTRIBUTOR_REWARD' THEN
   SELECT * INTO rule FROM app.reward_rule_version WHERE tenant_id=NEW.tenant_id AND id=NEW.rule_id;
   SELECT * INTO task FROM app.contribution WHERE tenant_id=NEW.tenant_id AND id=NEW.contribution_id;
   IF rule.id IS NULL OR task.id IS NULL OR task.mission_id<>NEW.mission_id OR NEW.created_by IN (task.created_by,task.contributor_id) OR NEW.amount_minor<>rule.amount_minor OR NEW.currency<>rule.currency OR task.created_at<rule.effective_from OR task.created_at>=rule.effective_until THEN RAISE EXCEPTION 'Independent review and exact effective reward required'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='reward_reconciliation' THEN
  SELECT * INTO original FROM app.service_ledger WHERE tenant_id=NEW.tenant_id AND id=NEW.ledger_id AND kind='CONTRIBUTOR_REWARD' AND reverse_of IS NULL;
  SELECT * INTO task FROM app.contribution WHERE tenant_id=NEW.tenant_id AND id=original.contribution_id;
  IF original.id IS NULL OR NEW.created_by IN (original.created_by,task.contributor_id,task.created_by) OR NEW.version<>coalesce((SELECT max(version) FROM app.reward_reconciliation WHERE tenant_id=NEW.tenant_id AND ledger_id=NEW.ledger_id),0)+1 OR EXISTS(SELECT FROM app.reward_reconciliation WHERE tenant_id=NEW.tenant_id AND ledger_id=NEW.ledger_id AND status IN ('MANUALLY_RECONCILED','CANCELLED')) OR EXISTS(SELECT FROM app.service_ledger WHERE tenant_id=NEW.tenant_id AND reverse_of=original.id) THEN RAISE EXCEPTION 'Independent reconciler and open reward required'; END IF;
 END IF;
 RETURN NEW;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.import_mission_brief(uuid,uuid,uuid,jsonb)'::regprocedure),'UTF8')),'hex')<>'6bcc5181fb32e6c31d0187c2b3128b56d1a1af752d0d485b8b0d392afbd64b37' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.import_mission_brief';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.import_mission_brief(t uuid, k uuid, o uuid, b jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE a uuid:=app.actor_id();h text;old app.mission_ingress_command;mid uuid:=gen_random_uuid();
BEGIN
 IF a IS NULL OR NOT coalesce(app.can_access(t,'INTERNAL',app.tenant_processing_purpose(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid)),false) OR coalesce(app.member_role(t),'') NOT IN ('owner','admin','operator') OR NOT EXISTS(SELECT FROM app.tenant WHERE id=t AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 IF k IS NULL OR o IS NULL OR NOT EXISTS(SELECT FROM app.mission_owners(t) WHERE user_id=o) THEN RAISE EXCEPTION 'Active operator owner required' USING ERRCODE='23514'; END IF;
 IF b IS NULL OR jsonb_typeof(b)<>'object' OR NOT (b ?& ARRAY['objective','market','attendance','startDate','endDate','timezone','offer','website','outcomes','notes','name','company','email','acknowledged']) OR length(b::text)>16000 OR b->'acknowledged' IS DISTINCT FROM 'true'::jsonb OR EXISTS(SELECT FROM jsonb_each(b) v WHERE v.key=ANY(ARRAY['objective','market','attendance','startDate','endDate','timezone','offer','website','notes','name','company','email']) AND jsonb_typeof(v.value)<>'string') OR jsonb_typeof(b->'outcomes')<>'array' THEN RAISE EXCEPTION 'Invalid intake structure' USING ERRCODE='23514'; END IF;
 IF length(b->>'offer') NOT BETWEEN 10 AND 2000 OR length(b->>'market') NOT BETWEEN 2 AND 120 OR length(b->>'name') NOT BETWEEN 2 AND 120 OR length(b->>'company') NOT BETWEEN 2 AND 160 OR length(b->>'email')>254 OR b->>'email' !~ '^[^[:space:]@]+@example[.]invalid$' OR length(b->>'notes')>1000 OR length(b->>'website')>2000 OR (b->>'website'<>'' AND b->>'website' !~ '^https?://[^[:space:]]+$') OR b->>'attendance' NOT IN ('Yes','No','Not decided') OR b->>'objective' NOT IN ('Sell in a new market','Find customers or distributors','Source suppliers','Make an upcoming business trip more productive','Run a multi-company mission','Something else') OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=b->>'timezone') OR jsonb_array_length(b->'outcomes') NOT BETWEEN 1 AND 7 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(b->'outcomes'))<>jsonb_array_length(b->'outcomes') OR EXISTS(SELECT FROM jsonb_array_elements(b->'outcomes') o WHERE jsonb_typeof(o.value)<>'string' OR o.value#>>'{}' NOT IN ('Relevant meetings','Buyers / customers','Distributor conversations','Supplier visits','Market validation','Local commercial intelligence','Something else')) THEN RAISE EXCEPTION 'Invalid intake values' USING ERRCODE='23514'; END IF;
 IF b->>'attendance'='Yes' THEN
  IF b->>'startDate' !~ '^\d{4}-\d{2}-\d{2}$' OR b->>'endDate' !~ '^\d{4}-\d{2}-\d{2}$' OR (b->>'endDate')::date<(b->>'startDate')::date OR to_char((b->>'startDate')::date,'YYYY-MM-DD')<>b->>'startDate' OR to_char((b->>'endDate')::date,'YYYY-MM-DD')<>b->>'endDate' THEN RAISE EXCEPTION 'Invalid visit window' USING ERRCODE='23514'; END IF;
 ELSIF b->>'startDate'<>'' OR b->>'endDate'<>'' THEN RAISE EXCEPTION 'Unexpected visit dates' USING ERRCODE='23514'; END IF;
 h:=encode(sha256(convert_to(jsonb_build_object('brief',b,'ownerId',o)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(k::text,0));
 SELECT * INTO old FROM app.mission_ingress_command WHERE id=k;
 IF old.id IS NOT NULL THEN
  IF old.tenant_id<>t OR old.actor_id<>a OR old.input_hash<>h THEN RAISE EXCEPTION 'Import command reused' USING ERRCODE='23514'; END IF;
  RETURN old.mission_id;
 END IF;
 INSERT INTO app.mission(id,tenant_id,owner_id,next_action,due_at,reason,created_by) VALUES(mid,t,o,'Review programme participant brief',now()+interval '1 day','Explicitly confirmed synthetic programme intake',a);
 INSERT INTO app.mission_intake(id,tenant_id,request_key,payload_hash,receipt_hash,brief,notice_version) VALUES(mid,t,k,h,encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex'),b,'synthetic-intake-2026-10-05-v1');
 INSERT INTO app.mission_objective(tenant_id,mission_id,objective,outcomes) VALUES(t,mid,b->>'objective',b->'outcomes');
 INSERT INTO app.mission_participant(tenant_id,mission_id,name,company,email) VALUES(t,mid,b->>'name',b->>'company',b->>'email');
 INSERT INTO app.mission_market(tenant_id,mission_id,original_text) VALUES(t,mid,b->>'market');
 INSERT INTO app.mission_window(tenant_id,mission_id,attendance,start_date,end_date,timezone) VALUES(t,mid,b->>'attendance',NULLIF(b->>'startDate','')::date,NULLIF(b->>'endDate','')::date,b->>'timezone');
 INSERT INTO app.commercial_intent(tenant_id,mission_id,original_text) VALUES(t,mid,b->>'offer');
 INSERT INTO app.mission_ingress_command(id,tenant_id,actor_id,input_hash,mission_id) VALUES(k,t,a,h,mid);
 RETURN mid;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.ingest_public_organisation(uuid,uuid,text,text,text,text,text,text)'::regprocedure),'UTF8')),'hex')<>'ef82cbaf2c26dd9ab161f150f357ba78bf1d82bd3e687668cbef364c4cf17133' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.ingest_public_organisation';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.ingest_public_organisation(target uuid, sid uuid, company text, cc text, host text, addr text, itype text, ident text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE src record; oid uuid:=gen_random_uuid();
BEGIN
 IF app.member_role(target) IS NULL OR app.member_role(target) NOT IN ('owner','admin','operator') OR NOT EXISTS(SELECT FROM app.tenant WHERE id=target AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Synthetic operator required' USING ERRCODE='42501'; END IF;
 SELECT * INTO src FROM app.source_record WHERE tenant_id=target AND id=sid AND classification='PUBLIC' AND kind='public_record' AND app.can_access(target,classification,purpose) AND retention_until>now() AND observed_at<=now() AND ai_policy='DENY';
 IF NOT FOUND OR (src.locator !~ '^https://([a-z0-9-]+\.)*example\.invalid(/[^[:space:]]*)?$' AND customer_private.synthetic_context()) OR (src.locator !~ '^https://[^[:space:]@]+$' AND NOT customer_private.synthetic_context()) OR length(company) NOT BETWEEN 1 AND 160 OR (cc IS NULL OR NOT EXISTS(SELECT FROM app.country WHERE code=cc)) THEN RAISE EXCEPTION 'Current synthetic public-record source required'; END IF;
 INSERT INTO app.organisation(id,name,country,synthetic) VALUES(oid,company,cc,customer_private.synthetic_context());
 INSERT INTO app.public_identifier(organisation_id,identifier_type,identifier,domain,address,source_locator,observed_at,valid_until,synthetic) VALUES(oid,itype,ident,host,addr,src.locator,src.observed_at,src.retention_until,customer_private.synthetic_context());
 INSERT INTO app.organisation_source(tenant_id,organisation_id,source_id,purpose,created_by) VALUES(target,oid,sid,src.purpose,app.actor_id());
 RETURN oid;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.mission_owners(uuid)'::regprocedure),'UTF8')),'hex')<>'c069916eeacfca9c8e126f1908509ad6284d18e70be82a7949d39b21ac6566ca' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.mission_owners';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.mission_owners(t uuid)
 RETURNS TABLE(user_id uuid, role text, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT m.user_id,m.role,u.name FROM app.membership m JOIN identity.principal p ON p.id=m.user_id JOIN identity."user" u ON u.id=p.identity_id
 WHERE m.tenant_id=t AND app.can_access(t,'INTERNAL',app.tenant_processing_purpose(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid)) AND m.role IN ('owner','admin','operator') AND m.revoked_at IS NULL AND p.disabled_at IS NULL
$function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.publish_company_fact(uuid,uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'b13b6bf85d60df0e147d5a3c321efa24d4710c19a883c2ae67cce6c6df0829b7' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.publish_company_fact';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.publish_company_fact(target uuid, aid uuid, fid uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v record; result uuid:=gen_random_uuid();
BEGIN
 IF app.member_role(target) IS NULL OR app.member_role(target) NOT IN ('owner','admin','reviewer') OR NOT app.fresh_mfa() OR NOT EXISTS(SELECT FROM app.tenant WHERE id=target AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Authorized reviewer with fresh MFA required' USING ERRCODE='42501'; END IF;
 SELECT a.organisation_id,a.kind,c.statement,s.locator,s.observed_at,least(s.retention_until,a.valid_until,e.retention_until,r.valid_until) valid_until,r.method,r.scope,r.reviewer_id,es.scan_status INTO v
 FROM app.organisation_attribute a JOIN app.claim c ON c.tenant_id=a.tenant_id AND c.id=a.claim_id
 JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id JOIN app.evidence_object e ON e.tenant_id=c.tenant_id AND e.claim_id=c.id
 JOIN app.verification r ON r.tenant_id=e.tenant_id AND r.evidence_id=e.id JOIN app.canonical_fact f ON f.tenant_id=r.tenant_id AND f.verification_id=r.id
 JOIN app.evidence_state es ON es.tenant_id=e.tenant_id AND es.id=e.id
 WHERE a.tenant_id=target AND a.id=aid AND f.id=fid AND app.can_access(target,a.classification,a.purpose) AND a.classification='PUBLIC' AND s.kind='public_record' AND s.ai_policy='DENY'
 AND s.locator ~ '^https://([a-z0-9-]+\.)*example\.invalid(/[^[:space:]]*)?$' AND es.status='VERIFIED' AND r.decision='VERIFIED' AND r.reviewer_id<>e.created_by AND r.reviewer_id=app.actor_id();
 IF NOT FOUND OR v.valid_until<=now() THEN RAISE EXCEPTION 'Independent current public verification required'; END IF;
 INSERT INTO app.public_company_fact(id,organisation_id,kind,statement,source_locator,observed_at,valid_until,method,scope,scan_status,reviewer_id,origin_fact_id) VALUES(result,v.organisation_id,v.kind,v.statement,v.locator,v.observed_at,v.valid_until,v.method,v.scope,v.scan_status,v.reviewer_id,fid);
 RETURN result;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.research_canonical(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'36511a2b70bc11a4719267a3c1c43ea41250fd59b104a8011a527a7ddfd04fd7' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.research_canonical';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.research_canonical(target uuid, oid uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN app.can_access(target,'INTERNAL',app.tenant_processing_purpose(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid)) THEN COALESCE((SELECT r.survivor_id FROM app.entity_resolution r JOIN app.entity_candidate c ON c.tenant_id=r.tenant_id AND c.id=r.candidate_id WHERE r.tenant_id=target AND r.decision='MERGE' AND oid IN(c.left_id,c.right_id) AND NOT EXISTS(SELECT FROM app.entity_resolution u WHERE u.tenant_id=target AND u.reverse_of=r.id) LIMIT 1),oid) ELSE oid END
$function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.research_owner(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'8abb038b697654ac6f345566d852b4075e1e43a36d0d0fef05bd54b96d2c4847' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.research_owner';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.research_owner(target uuid, who uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT app.member_role(target) IS NOT NULL AND EXISTS(SELECT FROM app.membership m JOIN identity.principal p ON p.id=m.user_id WHERE m.tenant_id=target AND m.user_id=who AND m.revoked_at IS NULL AND m.role IN ('owner','admin','operator') AND p.disabled_at IS NULL AND p.operating_country=ANY(m.allowed_countries) AND app.tenant_processing_purpose(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid)=ANY(m.allowed_purposes) AND 'INTERNAL'=ANY(m.allowed_classifications))
$function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.scan_bypass_allowed(uuid)'::regprocedure),'UTF8')),'hex')<>'6f2a610f875c55957e57108f7117d0ee7cba6c042edc7bbe534ffdfd966cdaaf' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.scan_bypass_allowed';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.scan_bypass_allowed(tid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE((SELECT (t.synthetic OR app.real_use_allowed(t.id)) AND COALESCE((SELECT (c.value->>'enabled')::boolean FROM app.config_version c WHERE c.tenant_id=tid AND c.key='evidence.scan_bypass' AND c.effective_from<=now() ORDER BY c.version DESC LIMIT 1),false) FROM app.tenant t WHERE t.id=tid),false)
$function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.service_catalogue_staff_command(uuid,jsonb)'::regprocedure),'UTF8')),'hex')<>'532c16968bbfbb3c59a3d3e7f175406970a92b7e9650e376bd10de7188ba9149' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.service_catalogue_staff_command';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.service_catalogue_staff_command(command uuid, input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.service_staff_actor(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid; prior customer_private.service_request_staff_command;
 head integer; key text; v customer_private.service_catalogue_version; executor uuid; eid uuid:=gen_random_uuid(); result jsonb;
BEGIN
 IF command IS NULL OR NOT customer_private.service_input_shape(input,ARRAY['serviceKey','expectedVersion','title','summary','included','excluded','regions','quoteBasis','active'],ARRAY[]::text[])
  OR jsonb_typeof(input->'serviceKey') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number'
  OR jsonb_typeof(input->'title') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'summary') IS DISTINCT FROM 'string'
  OR jsonb_typeof(input->'included') IS DISTINCT FROM 'array' OR jsonb_typeof(input->'excluded') IS DISTINCT FROM 'array' OR jsonb_typeof(input->'regions') IS DISTINCT FROM 'array'
  OR jsonb_typeof(input->'quoteBasis') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'active') IS DISTINCT FROM 'boolean'
  OR EXISTS(SELECT FROM jsonb_array_elements(input->'included') x WHERE jsonb_typeof(x)<>'string')
  OR EXISTS(SELECT FROM jsonb_array_elements(input->'excluded') x WHERE jsonb_typeof(x)<>'string')
  OR EXISTS(SELECT FROM jsonb_array_elements(input->'regions') x WHERE jsonb_typeof(x)<>'string') THEN
  RAISE EXCEPTION 'Invalid service entry' USING ERRCODE='23514'; END IF;
 key:=input->>'serviceKey';
 IF EXISTS(SELECT FROM customer_private.service_catalogue_version WHERE service_key=key AND synthetic IS DISTINCT FROM customer_private.synthetic_context()) THEN RAISE EXCEPTION 'Catalogue provenance differs' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_staff.command:'||actor::text||':'||command::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_catalogue:'||key,0));
 SELECT * INTO prior FROM customer_private.service_request_staff_command p WHERE p.actor_id=actor AND p.command_id=command;
 IF FOUND THEN
  IF prior.operation<>'catalogue' OR prior.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result;
 END IF;
 SELECT coalesce(max(x.version),0) INTO head FROM customer_private.service_catalogue_version x WHERE x.service_key=key;
 IF head<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'The service changed; reload and try again' USING ERRCODE='23514'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO customer_private.service_catalogue_version(service_key,version,title,summary,included,excluded,regions,quote_basis,active,source,created_by,staff_tenant_id)
 VALUES(key,head+1,input->>'title',input->>'summary',
  ARRAY(SELECT x.value FROM jsonb_array_elements_text(input->'included') WITH ORDINALITY x(value,ord) ORDER BY x.ord),
  ARRAY(SELECT x.value FROM jsonb_array_elements_text(input->'excluded') WITH ORDINALITY x(value,ord) ORDER BY x.ord),
  ARRAY(SELECT x.value FROM jsonb_array_elements_text(input->'regions') WITH ORDINALITY x(value,ord) ORDER BY x.ord),
  input->>'quoteBasis',(input->>'active')::boolean,'STAFF',actor,t) RETURNING * INTO v;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,t,'customer.service_catalogue.revised',1,'customer_service_catalogue',key,v.version,actor,clock_timestamp(),command,command,
 jsonb_build_object('serviceKey',key,'version',v.version,'active',v.active,'synthetic',customer_private.synthetic_context(),'initiator_kind','staff','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),t,eid,actor,'customer.service_catalogue.revised');
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),t,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,t);
 result:=jsonb_build_object('serviceKey',key,'version',v.version,'active',v.active,'commandId',command,'synthetic',customer_private.synthetic_context());
 INSERT INTO customer_private.service_request_staff_command(actor_id,command_id,operation,request,result) VALUES(actor,command,'catalogue',input,result);
 RETURN result;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.service_catalogue_staff_list()'::regprocedure),'UTF8')),'hex')<>'a41d507aa7029ec5974f803cd8e1b2074ebbf2d1686a21aa7f5269b2c13a2810' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.service_catalogue_staff_list';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.service_catalogue_staff_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.service_staff_actor();
BEGIN
 RETURN jsonb_build_object('services',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',v.service_key,'version',v.version,'title',v.title,'summary',v.summary,
  'included',to_jsonb(v.included),'excluded',to_jsonb(v.excluded),'regions',to_jsonb(v.regions),'quoteBasis',v.quote_basis,'active',v.active,'source',v.source) ORDER BY v.title,v.service_key),'[]'::jsonb)
  FROM customer_private.service_catalogue_version v WHERE v.synthetic=customer_private.synthetic_context() AND v.version=(SELECT max(x.version) FROM customer_private.service_catalogue_version x WHERE x.service_key=v.service_key)),'synthetic',customer_private.synthetic_context());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.service_request_staff_command(uuid,text,jsonb)'::regprocedure),'UTF8')),'hex')<>'56c6696adb07dca3a48061016099f17a78e667d9ce4c54b6b605c5a1934d2d42' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.service_request_staff_command';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.service_request_staff_command(command uuid, operation text, input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.service_staff_actor(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 prior customer_private.service_request_staff_command; r customer_private.service_request; claim customer_private.service_request_claim; status text; last_seq integer;
 req uuid; q uuid; qv integer; component jsonb; position integer:=0; kind text; note text; internal text; result jsonb; currency text; valid timestamptz;
 has_tax boolean:=false; has_fee boolean:=false;
BEGIN
 IF command IS NULL OR input IS NULL OR operation IS NULL OR operation NOT IN ('quote','answer','start','update','deliver','close','note')
  OR jsonb_typeof(input->'requestId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'expectedSeq') IS DISTINCT FROM 'number' THEN
  RAISE EXCEPTION 'Invalid staff service request command' USING ERRCODE='23514'; END IF;
 IF operation='quote' THEN
  IF NOT customer_private.service_input_shape(input,ARRAY['requestId','expectedSeq','currency','components','scope','exclusions','assumptions','deliveryTerms','paymentTerms','validUntil'],ARRAY[]::text[])
   OR jsonb_typeof(input->'currency') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'components') IS DISTINCT FROM 'array'
   OR jsonb_typeof(input->'scope') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'exclusions') IS DISTINCT FROM 'array'
   OR jsonb_typeof(input->'assumptions') IS DISTINCT FROM 'array' OR jsonb_typeof(input->'deliveryTerms') IS DISTINCT FROM 'string'
   OR jsonb_typeof(input->'paymentTerms') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'validUntil') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Invalid quote' USING ERRCODE='23514'; END IF;
 ELSIF operation='note' THEN
  IF NOT customer_private.service_input_shape(input,ARRAY['requestId','expectedSeq','internalNote'],ARRAY[]::text[]) OR jsonb_typeof(input->'internalNote') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Invalid staff note' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT customer_private.service_input_shape(input,ARRAY['requestId','expectedSeq','customerNote'],ARRAY[]::text[]) OR jsonb_typeof(input->'customerNote') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Invalid customer note' USING ERRCODE='23514'; END IF;
 END IF;
 req:=(input->>'requestId')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_staff.command:'||actor::text||':'||command::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_request:'||req::text,0));
 SELECT * INTO prior FROM customer_private.service_request_staff_command p WHERE p.actor_id=actor AND p.command_id=command;
 IF FOUND THEN
  IF prior.operation<>operation OR prior.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result;
 END IF;
 SELECT * INTO r FROM customer_private.service_request x WHERE x.id=req AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND w.synthetic=app.tenant_is_synthetic(t));
 IF NOT FOUND THEN RAISE EXCEPTION 'Service request unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO claim FROM customer_private.service_request_claim x WHERE x.request_id=req;
 IF FOUND AND claim.staff_tenant_id<>t THEN RAISE EXCEPTION 'Another team handles this request' USING ERRCODE='42501'; END IF;
 PERFORM customer_private.service_request_settle(req);
 SELECT e.status_after,e.seq INTO status,last_seq FROM customer_private.service_request_event e WHERE e.request_id=req ORDER BY e.seq DESC LIMIT 1;
 IF last_seq<>(input->>'expectedSeq')::integer THEN RAISE EXCEPTION 'The request changed; reload and try again' USING ERRCODE='23514'; END IF;
 IF NOT FOUND OR claim.request_id IS NULL THEN
  INSERT INTO customer_private.service_request_claim(request_id,staff_tenant_id,claimed_by) VALUES(req,t,actor) ON CONFLICT DO NOTHING;
 END IF;
 IF operation='quote' THEN
  IF status NOT IN ('requested','quoted','expired') THEN RAISE EXCEPTION 'A quote cannot be prepared at this stage' USING ERRCODE='23514'; END IF;
  currency:=input->>'currency';
  IF NOT EXISTS(SELECT FROM app.currency c WHERE c.code=currency) THEN RAISE EXCEPTION 'Choose a supported currency' USING ERRCODE='23514'; END IF;
  IF input->>'validUntil' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' THEN RAISE EXCEPTION 'Validity must be an exact UTC time' USING ERRCODE='23514'; END IF;
  valid:=(input->>'validUntil')::timestamptz;
  IF jsonb_array_length(input->'components') NOT BETWEEN 1 AND 12 OR jsonb_array_length(input->'exclusions') NOT BETWEEN 1 AND 12 OR jsonb_array_length(input->'assumptions') NOT BETWEEN 1 AND 12
   OR EXISTS(SELECT FROM jsonb_array_elements(input->'exclusions') x WHERE jsonb_typeof(x)<>'string')
   OR EXISTS(SELECT FROM jsonb_array_elements(input->'assumptions') x WHERE jsonb_typeof(x)<>'string') THEN
   RAISE EXCEPTION 'A quote needs priced components, at least one exclusion and at least one assumption' USING ERRCODE='23514'; END IF;
  IF valid<=clock_timestamp() OR valid>clock_timestamp()+interval '90 days' THEN RAISE EXCEPTION 'Validity must be in the future and within 90 days' USING ERRCODE='23514'; END IF;
  SELECT coalesce(max(x.version),0)+1 INTO qv FROM customer_private.service_quote x WHERE x.request_id=req;
  q:=gen_random_uuid();
  INSERT INTO customer_private.service_quote(id,request_id,version,currency,scope,exclusions,assumptions,delivery_terms,payment_terms,valid_until,prepared_by,staff_tenant_id)
  VALUES(q,req,qv,currency,input->>'scope',
   ARRAY(SELECT x.value FROM jsonb_array_elements_text(input->'exclusions') WITH ORDINALITY x(value,ord) ORDER BY x.ord),
   ARRAY(SELECT x.value FROM jsonb_array_elements_text(input->'assumptions') WITH ORDINALITY x(value,ord) ORDER BY x.ord),
   input->>'deliveryTerms',input->>'paymentTerms',valid,actor,t);
  FOR component IN SELECT value FROM jsonb_array_elements(input->'components') LOOP
   position:=position+1;
   IF NOT customer_private.service_input_shape(component,ARRAY['kind','label','treatment','amountMinor'],ARRAY[]::text[])
    OR jsonb_typeof(component->'kind') IS DISTINCT FROM 'string' OR jsonb_typeof(component->'label') IS DISTINCT FROM 'string'
    OR jsonb_typeof(component->'treatment') IS DISTINCT FROM 'string' OR jsonb_typeof(component->'amountMinor') NOT IN ('string','null')
    OR (jsonb_typeof(component->'amountMinor')='string' AND component->>'amountMinor' !~ '^(0|[1-9][0-9]{0,10})$') THEN
    RAISE EXCEPTION 'Each component needs a kind, label, treatment and an exact whole-number amount' USING ERRCODE='23514'; END IF;
   INSERT INTO customer_private.service_quote_component(quote_id,position,kind,label,treatment,amount_minor)
   VALUES(q,position,component->>'kind',component->>'label',component->>'treatment',(component->>'amountMinor')::bigint);
   IF component->>'kind'='tax' THEN has_tax:=true; END IF;
   IF component->>'kind'='service_fee' AND component->>'treatment'='included' THEN has_fee:=true; END IF;
  END LOOP;
  IF NOT has_fee OR NOT has_tax THEN RAISE EXCEPTION 'A quote needs a priced service fee and a stated tax line' USING ERRCODE='23514'; END IF;
  PERFORM customer_private.service_request_record(req,'quoted','staff',NULL,actor,t,NULL,NULL,q,NULL,NULL,command);
 ELSIF operation='note' THEN
  internal:=input->>'internalNote';
  PERFORM customer_private.service_request_record(req,'internal_note','staff',NULL,actor,t,NULL,internal,NULL,NULL,NULL,command);
 ELSE
  note:=input->>'customerNote';
  kind:=CASE operation WHEN 'answer' THEN 'answer' WHEN 'start' THEN 'started' WHEN 'update' THEN 'update' WHEN 'deliver' THEN 'delivered' ELSE 'closed' END;
  PERFORM customer_private.service_request_record(req,kind,'staff',NULL,actor,t,note,NULL,NULL,NULL,NULL,command);
 END IF;
 IF app.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 result:=customer_private.service_request_summary(req)||jsonb_build_object('commandId',command,'operation',operation,'synthetic',customer_private.synthetic_context());
 INSERT INTO customer_private.service_request_staff_command(actor_id,command_id,operation,request,result) VALUES(actor,command,operation,input,result);
 RETURN result;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.service_request_staff_list(uuid,integer)'::regprocedure),'UTF8')),'hex')<>'4d0b032c6489ff285dee696466c40bb5a3f0de704ac506b25d53b128ba932d65' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.service_request_staff_list';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.service_request_staff_list(after_id uuid DEFAULT NULL::uuid, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.service_staff_actor(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid; items jsonb; next_id uuid; cursor_row customer_private.service_request;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 IF after_id IS NOT NULL THEN
  SELECT * INTO cursor_row FROM customer_private.service_request WHERE id=after_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 END IF;
 WITH mine AS(SELECT r.id,r.created_at FROM customer_private.service_request r JOIN app.tenant w ON w.id=r.tenant_id AND w.synthetic=app.tenant_is_synthetic(t)
  LEFT JOIN customer_private.service_request_claim c ON c.request_id=r.id WHERE (c.request_id IS NULL OR c.staff_tenant_id=t)
  AND (after_id IS NULL OR (r.created_at,r.id)<(cursor_row.created_at,cursor_row.id)) ORDER BY r.created_at DESC,r.id DESC LIMIT page_size+1),
 visible AS(SELECT * FROM mine ORDER BY created_at DESC,id DESC LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(customer_private.service_request_summary(v.id)||jsonb_build_object('workspaceName',(SELECT w.name FROM app.tenant w JOIN customer_private.service_request x ON x.tenant_id=w.id WHERE x.id=v.id),
   'claimed',EXISTS(SELECT FROM customer_private.service_request_claim c WHERE c.request_id=v.id)) ORDER BY v.created_at DESC,v.id DESC) FROM visible v),'[]'::jsonb),
 CASE WHEN (SELECT count(*) FROM mine)>page_size THEN (SELECT id FROM visible ORDER BY created_at ASC,id ASC LIMIT 1) ELSE NULL END INTO items,next_id;
 IF app.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('requests',items,'nextAfter',next_id,'synthetic',customer_private.synthetic_context());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.service_request_staff_view(uuid)'::regprocedure),'UTF8')),'hex')<>'cd282a0512f3ee7c7b77e3a5b86c63a58e61288d3ded6fb1d2cad6a02eeebedf' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.service_request_staff_view';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.service_request_staff_view(request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.service_staff_actor(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 r customer_private.service_request; c customer_private.service_catalogue_version; claim customer_private.service_request_claim; n customer_private.service_request_need;
 intent customer_private.service_order_intent; quotes jsonb; events jsonb; last_seq integer; needs jsonb;
BEGIN
 IF request_id IS NULL THEN RAISE EXCEPTION 'Service request unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_request:'||request_id::text,0));
 SELECT * INTO r FROM customer_private.service_request x WHERE x.id=request_id AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND w.synthetic=app.tenant_is_synthetic(t));
 IF NOT FOUND THEN RAISE EXCEPTION 'Service request unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO claim FROM customer_private.service_request_claim x WHERE x.request_id=r.id;
 IF FOUND AND claim.staff_tenant_id<>t THEN RAISE EXCEPTION 'Another team handles this request' USING ERRCODE='42501'; END IF;
 PERFORM customer_private.service_request_settle(r.id);
 SELECT * INTO c FROM customer_private.service_catalogue_version v WHERE v.service_key=r.service_key AND v.version=r.service_version;
 SELECT * INTO n FROM customer_private.service_request_need x WHERE x.request_id=r.id ORDER BY version DESC LIMIT 1;
 SELECT * INTO intent FROM customer_private.service_order_intent x WHERE x.request_id=r.id;
 SELECT coalesce(jsonb_agg(customer_private.service_quote_json(q.id) ORDER BY q.version),'[]'::jsonb) INTO quotes FROM customer_private.service_quote q WHERE q.request_id=r.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('seq',e.seq,'at',e.created_at,'kind',e.kind,'status',e.status_after,'actorKind',e.actor_kind,
  'customerNote',e.customer_note,'internalNote',e.internal_note,'quoteVersion',(SELECT x.version FROM customer_private.service_quote x WHERE x.id=e.quote_id)) ORDER BY e.seq),'[]'::jsonb),max(e.seq) INTO events,last_seq
 FROM customer_private.service_request_event e WHERE e.request_id=r.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('version',x.version,'text',x.need,'preferredFrom',x.preferred_from,'preferredTo',x.preferred_to,'region',x.region,'at',x.created_at) ORDER BY x.version),'[]'::jsonb) INTO needs
 FROM customer_private.service_request_need x WHERE x.request_id=r.id;
 IF app.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('request',customer_private.service_request_summary(r.id)||jsonb_build_object('workspaceName',(SELECT w.name FROM app.tenant w WHERE w.id=r.tenant_id),
  'claimedByThisTeam',claim.request_id IS NOT NULL,'serviceVersion',r.service_version),
 'service',jsonb_build_object('title',c.title,'included',to_jsonb(c.included),'excluded',to_jsonb(c.excluded),'regions',to_jsonb(c.regions),'quoteBasis',c.quote_basis),
 'need',jsonb_build_object('version',n.version,'text',n.need,'preferredFrom',n.preferred_from,'preferredTo',n.preferred_to,'region',n.region),'needs',needs,
 'quotes',quotes,'orderIntent',CASE WHEN intent.id IS NULL THEN NULL ELSE jsonb_build_object('id',intent.id,'quoteVersion',intent.quote_version,'currency',intent.currency,
  'fixedTotalMinor',intent.fixed_total_minor::text,'estimatedTotalMinor',intent.estimated_total_minor::text,'acceptedAt',intent.created_at,'paymentTaken',false,'billing',intent.billing) END,
 'events',events,'lastSeq',last_seq,'synthetic',customer_private.synthetic_context());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.assigned_missions(uuid,integer)'::regprocedure),'UTF8')),'hex')<>'e80165683dd9348dba7d90ba61d96e78ca988cd37087d98394928841adae9cca' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.assigned_missions';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.assigned_missions(after_id uuid DEFAULT NULL::uuid, page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.request_actor();entry record;items jsonb:='[]'::jsonb;checked jsonb:='[]'::jsonb;last_id uuid;more boolean;
BEGIN
 IF page_size IS NULL OR page_size<1 OR page_size>25 THEN RAISE EXCEPTION 'Invalid assignment page' USING ERRCODE='22023';END IF;
 FOR entry IN SELECT a.id FROM app.customer_delivery_assignment a JOIN customer_private.owned_request r ON r.id=a.request_id AND r.principal_id=actor WHERE after_id IS NULL OR a.id>after_id ORDER BY a.id LIMIT page_size LOOP
  items:=items||jsonb_build_array(customer_private.assignment_summary(entry.id,actor));last_id:=entry.id;
 END LOOP;
 SELECT EXISTS(SELECT FROM app.customer_delivery_assignment a JOIN customer_private.owned_request r ON r.id=a.request_id AND r.principal_id=actor WHERE last_id IS NOT NULL AND a.id>last_id) INTO more;
 IF customer_private.request_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(items) LOOP checked:=checked||jsonb_build_array(customer_private.assignment_summary((entry.value->>'id')::uuid,actor));END LOOP;
 IF checked IS DISTINCT FROM items OR EXISTS(SELECT FROM jsonb_array_elements(items) item WHERE (item->>'available')::boolean AND (item->>'expiresAt')::timestamptz<=clock_timestamp()) THEN RAISE EXCEPTION 'Assigned mission availability changed' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('assignments',items,'nextAfter',CASE WHEN more THEN last_id END,'synthetic',customer_private.synthetic_context());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.company_portfolio(uuid,integer)'::regprocedure),'UTF8')),'hex')<>'dfad23ed712b754cc4dc25d0e8a3c6d737b8a1a4b8c0d185b7c249a8a8714458' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.company_portfolio';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.company_portfolio(after_id uuid DEFAULT NULL::uuid, page_size integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.saved_mission_actor();saved customer_private.saved_mission;
 document jsonb;mission jsonb;target jsonb;identity_key text;organisation uuid;items jsonb:='[]'::jsonb;
 checked jsonb:='[]'::jsonb;entry jsonb;next_id uuid;last_id uuid;expiry timestamptz;minimum_expiry timestamptz;
 processed integer:=0;unavailable integer:=0;publication app.delivery_publication;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Invalid portfolio page size' USING ERRCODE='23514'; END IF;
 FOR saved IN SELECT * FROM customer_private.saved_mission WHERE principal_id=actor AND removed_at IS NULL
 AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_size FOR SHARE LOOP
  processed:=processed+1;last_id:=saved.id;
  BEGIN
   document:=customer.saved_mission_action(saved.id)->'report';
  EXCEPTION WHEN insufficient_privilege THEN
   IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
   unavailable:=unavailable+1;CONTINUE;
  END;
  expiry:=(document->>'expiresAt')::timestamptz;
  IF expiry IS NULL OR expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Commercial scope expired' USING ERRCODE='42501'; END IF;
  minimum_expiry:=least(minimum_expiry,expiry);
  checked:=checked||jsonb_build_array(jsonb_build_object('id',saved.id,'report',document));
  FOR mission IN SELECT value FROM jsonb_array_elements(document->'missions') LOOP
   SELECT * INTO publication FROM app.delivery_publication WHERE id=(mission->>'publicationId')::uuid AND tenant_id=saved.link_tenant_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Approved mission unavailable' USING ERRCODE='42501'; END IF;
   FOR target IN SELECT value FROM jsonb_array_elements(coalesce(mission->'experience'->'shortlist','[]'::jsonb)) LOOP
    SELECT r.organisation_id INTO organisation FROM app.target_account t JOIN app.relationship r ON r.tenant_id=t.tenant_id AND r.id=t.relationship_id
    WHERE t.tenant_id=saved.link_tenant_id AND t.mission_id=publication.mission_id AND t.id=(target->>'id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Approved company unavailable' USING ERRCODE='42501'; END IF;
    -- Tenant and customer remain independent privacy boundaries. No raw global ID.
    identity_key:=encode(sha256(convert_to(actor::text||':'||saved.link_tenant_id::text||':'||organisation::text,'UTF8')),'hex');
    items:=items||jsonb_build_array(jsonb_build_object('id',identity_key,'context',jsonb_build_object(
      'resourceId',saved.id,'targetId',target->>'id','missionTitle',mission->>'title','objective',mission->>'objective',
      'company',target->>'company','country',target->>'country','fit',target->>'fit','rationale',target->>'rationale',
      'uncertainty',target->>'uncertainty','gaps',target->>'gaps','verification',target->>'verification','expiresAt',document->>'expiresAt')));
   END LOOP;
  END LOOP;
 END LOOP;
 -- A lock wait or scope change during canonical identity resolution must not
 -- return an earlier approved snapshot. Original V2 disclosure checks run again.
 FOR entry IN SELECT value FROM jsonb_array_elements(checked) LOOP
  IF (customer.saved_mission_action((entry->>'id')::uuid)->'report') IS DISTINCT FROM entry->'report' THEN
   RAISE EXCEPTION 'Approved company scope changed; reload' USING ERRCODE='42501';
  END IF;
 END LOOP;
 IF customer.actor_id() IS DISTINCT FROM actor OR minimum_expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'contexts',g.contexts) ORDER BY g.id),'[]'::jsonb) INTO items
 FROM (SELECT value->>'id' id,jsonb_agg(value->'context' ORDER BY value->'context'->>'resourceId',value->'context'->>'targetId') contexts FROM jsonb_array_elements(items) GROUP BY value->>'id') g;
 IF EXISTS(SELECT FROM customer_private.saved_mission WHERE principal_id=actor AND removed_at IS NULL AND id>last_id) THEN next_id:=last_id; END IF;
 RETURN jsonb_build_object('companies',items,'nextAfter',next_id,'scopesRead',processed,'unavailableScopes',unavailable,'expiresAt',minimum_expiry,'synthetic',customer_private.synthetic_context());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.create_programme(uuid,uuid,text,text)'::regprocedure),'UTF8')),'hex')<>'3db59453d63fa368eb4d84391b331ae605d6ee4aff546053b32329c49fbc0523' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.create_programme';END IF;END $guard$;
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
  IF (SELECT count(*) FROM customer_private.programme_creation WHERE workspace_id=target)>=100 THEN
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
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.organisation_link_command(uuid,text,jsonb)'::regprocedure),'UTF8')),'hex')<>'ebf05c7cd9dc73677a175ce3a4cb67623c68cae63b468a59e9ab0a4296ca58f8' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.organisation_link_command';END IF;END $guard$;
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
   OR p_input->>'note'<>btrim(p_input->>'note') OR length(p_input->>'note') NOT BETWEEN (CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND 1000 OR (p_input->>'note' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context()) OR p_input->>'note' ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION 'Invalid company link request' USING ERRCODE='23514';
  END IF;
 ELSIF p_operation='add_evidence' THEN
  IF p_input-ARRAY['workspaceId','claimId','expectedVersion','evidenceKind','statement','url']<>'{}'::jsonb
   OR NOT (p_input ?& ARRAY['workspaceId','claimId','expectedVersion','evidenceKind','statement','url'])
   OR jsonb_typeof(p_input->'claimId')<>'string' OR p_input->>'claimId' !~ v_uuid
   OR jsonb_typeof(p_input->'expectedVersion')<>'number' OR (p_input->>'expectedVersion') !~ '^[0-9]{1,4}$'
   OR jsonb_typeof(p_input->'evidenceKind')<>'string' OR p_input->>'evidenceKind' NOT IN ('REGISTRATION_STATEMENT','WEBSITE_STATEMENT','TRADE_REFERENCE_STATEMENT','AUTHORISATION_STATEMENT')
   OR jsonb_typeof(p_input->'statement')<>'string' OR p_input->>'statement'<>btrim(p_input->>'statement') OR length(p_input->>'statement') NOT BETWEEN (CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND 1000
   OR (p_input->>'statement' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context()) OR p_input->>'statement' ~ '[[:cntrl:]]'
   OR jsonb_typeof(p_input->'url') NOT IN ('string','null')
   OR (jsonb_typeof(p_input->'url')='string' AND (length(p_input->>'url')>200 OR (p_input->>'url' !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.(example|test|invalid)(/[A-Za-z0-9._~/-]*)?$' AND customer_private.synthetic_context()) OR (p_input->>'url' !~ '^https://[^[:space:]@]+$' AND NOT customer_private.synthetic_context()))) THEN
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
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.own_programme_registrations(uuid,integer)'::regprocedure),'UTF8')),'hex')<>'8e2c59f18951fc2649cd0cd76e94d32f4b44c865a8673a06480131ec4a395012' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.own_programme_registrations';END IF;END $guard$;
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
 JOIN app.delivery_programme p ON p.tenant_id=r.workspace_id AND p.id=r.programme_id
 JOIN app.tenant t ON t.id=r.workspace_id AND (t.synthetic OR customer_private.real_session())
 LEFT JOIN LATERAL(SELECT CASE WHEN withdrawn THEN 'WITHDRAWN' ELSE 'REVOKED' END status FROM customer_private.programme_participant_revocation WHERE registration_id=r.id) v ON true;
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'id')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.programme_registration WHERE principal_id=actor AND id>next_id) THEN next_id:=NULL; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrations',items,'nextAfter',next_id,'synthetic',customer_private.synthetic_context());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_context_command(uuid,uuid,uuid,integer,jsonb,boolean)'::regprocedure),'UTF8')),'hex')<>'5f923f10e865101834257cde86912a08b52101ac714062ad5bb08e0a5e2bc377' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.programme_context_command';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_context_command(command uuid, target uuid, programme uuid, expected integer, input jsonb, share boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.participant_scope(command,target,programme,true);prior customer_private.programme_context_command;
 row app.delivery_programme_context;head integer;executor uuid;nonce text;expiry timestamptz;proof text:=current_setting('corridra.customer_proof_hash',true);payload jsonb;
BEGIN
 IF command IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR share IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid context command' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['organiser','marketCode','purpose','startsAt','endsAt','timezone','reason']<>'{}'::jsonb OR NOT(input ?& ARRAY['organiser','marketCode','purpose','startsAt','endsAt','timezone','reason'])
 OR EXISTS(SELECT FROM jsonb_each(input) j WHERE jsonb_typeof(j.value)<>'string' OR j.value #>> '{}' ~ '[[:cntrl:]]')
 OR length(input->>'organiser') NOT BETWEEN (CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND 1000 OR (input->>'organiser' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context())
 OR length(input->>'purpose') NOT BETWEEN (CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND 1000 OR (input->>'purpose' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context())
 OR length(input->>'reason') NOT BETWEEN 3 AND 1000
 OR NOT EXISTS(SELECT FROM app.market_scope WHERE key=input->>'marketCode' AND kind IN ('COUNTRY','TRADE_BLOC'))
 OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=input->>'timezone')
 OR NOT isfinite((input->>'startsAt')::timestamptz) OR NOT isfinite((input->>'endsAt')::timestamptz)
 OR (input->>'endsAt')::timestamptz<=(input->>'startsAt')::timestamptz THEN RAISE EXCEPTION 'Invalid synthetic programme details' USING ERRCODE='23514'; END IF;
 -- Same workspace access lock as revocation, then the existing staff programme lock.
 PERFORM pg_advisory_xact_lock(hashtextextended(target::text||':programme:'||programme::text,0));
 IF customer_private.participant_scope(command,target,programme,true) IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Context authority expired' USING ERRCODE='42501'; END IF;
 payload:=jsonb_build_object('workspaceId',target,'programmeId',programme,'expectedVersion',expected,'details',input,'shared',share);
 SELECT coalesce(max(version),0) INTO head FROM app.delivery_programme_context WHERE tenant_id=target AND programme_id=programme;
 SELECT * INTO prior FROM customer_private.programme_context_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.input IS DISTINCT FROM payload OR NOT EXISTS(SELECT FROM app.delivery_programme_context WHERE id=prior.context_id AND version=head) THEN RAISE EXCEPTION 'Context command changed or superseded' USING ERRCODE='23514'; END IF;
  RETURN customer.programme_context_view(target,programme,NULL)||jsonb_build_object('commandId',command);
 END IF;
 IF expected<>head THEN RAISE EXCEPTION 'Programme details changed;reload before saving' USING ERRCODE='23514'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL FOR SHARE OF p;
 SELECT expires_at INTO expiry FROM customer_private.session_proof WHERE hash=proof AND expires_at>clock_timestamp();
 IF executor IS NULL OR expiry IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Context execution unavailable' USING ERRCODE='42501'; END IF;
 row.id:=gen_random_uuid();row.tenant_id:=target;row.programme_id:=programme;row.version:=head+1;
 row.details:=input||jsonb_build_object('ownerKind','CUSTOMER','ownerId',actor);row.created_by:=executor;row.created_at:=now();
 nonce:=encode(sha256(convert_to(gen_random_uuid()::text||proof,'UTF8')),'hex');
 INSERT INTO customer_private.context_execution_grant VALUES(nonce,proof,actor,target,executor,'app.delivery_programme_context'::regclass,encode(sha256(convert_to(to_jsonb(row)::text,'UTF8')),'hex'),pg_backend_pid(),txid_current(),command,least(expiry,clock_timestamp()+interval '15 seconds'));
 PERFORM set_config('corridra.customer_context_execution',nonce,true),set_config('corridra.correlation_id',command::text,true),set_config('corridra.causation_id',command::text,true);
 INSERT INTO app.delivery_programme_context SELECT (row).*;
 PERFORM set_config('corridra.customer_context_execution','',true);
 DELETE FROM customer_private.context_execution_grant WHERE nonce_hash=nonce;
 INSERT INTO customer_private.programme_context_command VALUES(actor,command,target,programme,row.id,payload,share,clock_timestamp());
 IF customer_private.participant_scope(command,target,programme,true) IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Context authority expired' USING ERRCODE='42501'; END IF;
 RETURN customer.programme_context_view(target,programme,NULL)||jsonb_build_object('commandId',command);
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_context_view(uuid,uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'a95b8eed9b859b69bf76dbe951f53022ea5885b15001f2059055cd8925c893e3' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.programme_context_view';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_context_view(target uuid, programme uuid, registration uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer.actor_id();r customer_private.programme_registration;row app.delivery_programme_context;binding customer_private.programme_context_command;result jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF registration IS NOT NULL THEN
  SELECT * INTO r FROM customer_private.programme_registration WHERE id=registration AND principal_id=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
  target:=r.workspace_id;programme:=r.programme_id;
  PERFORM customer_private.participant_scope(gen_random_uuid(),target,programme,false);
  IF EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=registration) OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
 ELSE
  PERFORM customer_private.participant_scope(gen_random_uuid(),target,programme,true);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target::text||':programme:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Context access expired after programme wait' USING ERRCODE='42501'; END IF;
 SELECT * INTO row FROM app.delivery_programme_context WHERE tenant_id=target AND programme_id=programme ORDER BY version DESC LIMIT 1;
 SELECT * INTO binding FROM customer_private.programme_context_command WHERE context_id=row.id;
 -- Never fall back to an earlier share or expose unbound historical staff details.
 result:=jsonb_build_object('programmeId',programme,'synthetic',customer_private.synthetic_context(),'expiresAt',least(clock_timestamp()+interval '60 seconds',(SELECT expires_at FROM customer_private.session_proof WHERE hash=current_setting('corridra.customer_proof_hash',true))),
 'context',CASE WHEN binding.context_id IS NOT NULL AND (registration IS NULL OR binding.shared) THEN jsonb_build_object('version',row.version,'organiser',row.details->'organiser','marketCode',row.details->'marketCode','purpose',row.details->'purpose','startsAt',row.details->'startsAt','endsAt',row.details->'endsAt','timezone',row.details->'timezone','updatedAt',row.created_at) ELSE NULL END);
 IF registration IS NULL THEN result:=result||jsonb_build_object('workspaceId',target,'currentVersion',coalesce(row.version,0),'shared',coalesce(binding.shared,false),'reason',CASE WHEN binding.context_id IS NOT NULL THEN row.details->'reason' END); ELSE result:=result||jsonb_build_object('registrationId',registration); END IF;
 IF customer.actor_id() IS DISTINCT FROM actor OR (registration IS NOT NULL AND EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=registration)) THEN RAISE EXCEPTION 'Context access expired' USING ERRCODE='42501'; END IF;
 RETURN result;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_mission_choices(uuid,uuid,integer)'::regprocedure),'UTF8')),'hex')<>'52d38c4b7285c6b9cd580d19ca8dc74b068f18a4cb8cfbb109c8e177e57ce8eb' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.programme_mission_choices';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_mission_choices(registration uuid, after_id uuid DEFAULT NULL::uuid, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.request_actor();reg customer_private.programme_registration;r customer_private.owned_request;
 detail jsonb;items jsonb:='[]'::jsonb;next_id uuid;expiry timestamptz:=clock_timestamp()+interval '60 seconds';retained timestamptz;work uuid;command uuid:=gen_random_uuid();selected uuid[];
BEGIN
 SELECT * INTO reg FROM customer_private.programme_registration WHERE id=registration AND principal_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Programme registration unavailable' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid objective page size' USING ERRCODE='23514'; END IF;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT id FROM customer_private.owned_request o WHERE o.principal_id=actor AND (after_id IS NULL OR o.id>after_id) AND NOT EXISTS(SELECT FROM customer_private.request_revocation WHERE request_id=o.id) ORDER BY id LIMIT page_size) page;
 FOR work IN SELECT workspace_id FROM (SELECT reg.workspace_id AS workspace_id UNION SELECT o.workspace_id FROM customer_private.owned_request o WHERE o.id=ANY(selected)) w ORDER BY workspace_id LOOP PERFORM customer_private.lock_workspace_access(command,work);END LOOP;
 PERFORM customer_private.participant_scope(command,reg.workspace_id,reg.programme_id,false);
 IF EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=registration) THEN RAISE EXCEPTION 'Programme registration unavailable' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid objective page size' USING ERRCODE='23514'; END IF;
 FOR r IN SELECT * FROM customer_private.owned_request o WHERE o.principal_id=actor AND o.id=ANY(selected) ORDER BY o.id LOOP
  detail:=customer.private_request_detail(r.id);next_id:=r.id;
  IF detail->'available'='true'::jsonb THEN
   SELECT retention_until INTO retained FROM app.mission_intake WHERE tenant_id=r.mission_tenant_id AND id=r.mission_id;
   expiry:=least(expiry,retained);
   items:=items||jsonb_build_array(jsonb_build_object('id',r.id,'available',true,'label',concat_ws(' · ',detail->'original'->>'company',detail->'original'->>'objective',detail->'original'->>'market')));
  ELSE items:=items||jsonb_build_array(jsonb_build_object('id',r.id,'available',false,'label','Original request unavailable')); END IF;
 END LOOP;
 IF NOT EXISTS(SELECT FROM customer_private.owned_request o WHERE o.principal_id=actor AND o.id>next_id AND NOT EXISTS(SELECT FROM customer_private.request_revocation WHERE request_id=o.id)) THEN next_id:=NULL; END IF;
 IF EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=registration) OR customer.actor_id() IS DISTINCT FROM actor OR expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Private source expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrationId',registration,'requests',items,'nextAfter',next_id,'viewExpiresAt',expiry,'synthetic',customer_private.synthetic_context());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_mission_command(uuid,text,jsonb)'::regprocedure),'UTF8')),'hex')<>'4946db2f3f5479cefeccc111a5a0a4efc11bfa6c2f65251ee1f53b8264ee926a' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.programme_mission_command';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_mission_command(command uuid, operation text, input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer.actor_id();context jsonb;link customer_private.programme_mission_link;head customer_private.programme_mission_revision;
 prior customer_private.programme_mission_command;registration uuid;request uuid;fingerprint text;result jsonb;changed boolean:=false;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR operation IS NULL OR operation NOT IN ('share','withdraw') OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid objective command' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR input->>'expectedVersion' !~ '^(0|[1-9][0-9]{0,9})$' OR (input->>'expectedVersion')::bigint>2147483646 THEN RAISE EXCEPTION 'Current objective version required' USING ERRCODE='23514'; END IF;
 IF operation='share' THEN
  IF input-ARRAY['registrationId','requestId','summary','consented','expectedVersion']<>'{}'::jsonb OR input->'consented' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'summary') IS DISTINCT FROM 'string'
   OR length(input->>'summary') NOT BETWEEN (CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND 500 OR (input->>'summary' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context()) OR input->>'summary'<>btrim(input->>'summary') OR input->>'summary' ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION 'Explicit fictional objective sharing consent required' USING ERRCODE='23514';
  END IF;
  registration:=(input->>'registrationId')::uuid;request:=(input->>'requestId')::uuid;
 ELSE
  IF input-ARRAY['linkId','reason','acknowledged','expectedVersion']<>'{}'::jsonb OR input->'acknowledged' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR length(input->>'reason') NOT BETWEEN 10 AND 500 THEN
   RAISE EXCEPTION 'Explicit objective withdrawal required' USING ERRCODE='23514';
  END IF;
  SELECT * INTO link FROM customer_private.programme_mission_link WHERE id=(input->>'linkId')::uuid AND principal_id=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objective link unavailable' USING ERRCODE='42501'; END IF;
  registration:=link.registration_id;request:=link.request_id;
 END IF;
 IF registration IS NULL OR request IS NULL THEN RAISE EXCEPTION 'Objective references required' USING ERRCODE='23514'; END IF;
 context:=customer_private.programme_mission_scope(command,registration,request,operation='share');
 fingerprint:=encode(sha256(convert_to(input::text,'UTF8')),'hex');
 SELECT * INTO prior FROM customer_private.programme_mission_command q WHERE q.actor_id=actor AND q.command_id=command;
 IF FOUND AND (prior.operation<>operation OR prior.input_hash<>fingerprint) THEN RAISE EXCEPTION 'Objective command conflicts' USING ERRCODE='23514'; END IF;
 SELECT * INTO link FROM customer_private.programme_mission_link WHERE registration_id=registration AND request_id=request AND principal_id=actor;
 IF link.id IS NULL THEN
  IF (SELECT count(*) FROM customer_private.programme_mission_link WHERE registration_id=registration)>=100 THEN RAISE EXCEPTION 'Programme objective limit reached' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.programme_mission_link(registration_id,request_id,principal_id) VALUES(registration,request,actor) RETURNING * INTO link;
 END IF;
 SELECT * INTO head FROM customer_private.programme_mission_revision WHERE link_id=link.id ORDER BY version DESC LIMIT 1;
 IF prior.command_id IS NOT NULL THEN
  IF prior.link_id<>link.id OR head.version IS DISTINCT FROM (prior.result->>'version')::integer OR head.status IS DISTINCT FROM prior.result->>'status' THEN RAISE EXCEPTION 'Objective command was superseded' USING ERRCODE='23514'; END IF;
  PERFORM customer_private.programme_mission_scope(command,registration,request,operation='share');
  RETURN prior.result;
 END IF;
 IF (input->>'expectedVersion')::integer<>coalesce(head.version,0) THEN RAISE EXCEPTION 'Objective version conflict' USING ERRCODE='23514'; END IF;
 IF head.id IS NULL OR (operation='share' AND (head.status<>'SHARED' OR head.summary IS DISTINCT FROM input->>'summary')) OR (operation='withdraw' AND head.status<>'WITHDRAWN') THEN
  INSERT INTO customer_private.programme_mission_revision(link_id,version,status,summary,reason,created_by)
  VALUES(link.id,coalesce(head.version,0)+1,CASE WHEN operation='share' THEN 'SHARED' ELSE 'WITHDRAWN' END,
   CASE WHEN operation='share' THEN input->>'summary' END,CASE WHEN operation='withdraw' THEN input->>'reason' END,actor) RETURNING * INTO head;
  changed:=true;
 END IF;
 IF changed THEN PERFORM customer_private.workspace_access_event((context->>'workspace')::uuid,actor,command,'customer.programme.objective.'||operation,
  jsonb_build_object('programme_id',context->>'programme','objective_link_id',link.id)); END IF;
 PERFORM customer_private.programme_mission_scope(command,registration,request,operation='share');
 result:=jsonb_build_object('id',link.id,'registrationId',registration,'version',head.version,'status',head.status,'synthetic',customer_private.synthetic_context(),'changed',changed)||CASE WHEN operation='share' THEN jsonb_build_object('requestId',request) ELSE '{}'::jsonb END;
 INSERT INTO customer_private.programme_mission_command(actor_id,command_id,link_id,operation,input_hash,result) VALUES(actor,command,link.id,operation,fingerprint,result);
 RETURN result;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_mission_summaries(uuid,boolean,uuid,integer)'::regprocedure),'UTF8')),'hex')<>'a7739bda7101d3e84c51a3871c4797b7229efc42b6eda7df611eaab2a5f296ee' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.programme_mission_summaries';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_mission_summaries(registration uuid, manage boolean DEFAULT false, after_id uuid DEFAULT NULL::uuid, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer.actor_id();reg customer_private.programme_registration;l customer_private.programme_mission_link;head customer_private.programme_mission_revision;
 items jsonb:='[]'::jsonb;item jsonb;next_id uuid;retained timestamptz;expiry timestamptz:=clock_timestamp()+interval '60 seconds';active boolean;own_source boolean:=false;details jsonb;n integer;work uuid;command uuid:=gen_random_uuid();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF manage IS NULL THEN RAISE EXCEPTION 'Explicit objective view required' USING ERRCODE='23514'; END IF;
 IF NOT manage AND EXISTS(SELECT FROM customer_private.request_admission WHERE principal_id=actor AND disabled_at IS NULL) THEN PERFORM customer_private.request_actor();own_source:=true; END IF;
 SELECT * INTO reg FROM customer_private.programme_registration WHERE id=registration;
 IF NOT FOUND OR (NOT manage AND reg.principal_id<>actor) THEN RAISE EXCEPTION 'Programme registration unavailable' USING ERRCODE='42501'; END IF;
 FOR work IN SELECT workspace_id FROM (SELECT reg.workspace_id AS workspace_id UNION SELECT r.workspace_id FROM customer_private.programme_mission_link b JOIN customer_private.owned_request r ON r.id=b.request_id WHERE b.registration_id=registration) w ORDER BY workspace_id LOOP PERFORM customer_private.lock_workspace_access(command,work);END LOOP;
 PERFORM customer_private.participant_scope(command,reg.workspace_id,reg.programme_id,manage);
 active:=NOT EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=registration);
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid objective page size' USING ERRCODE='23514'; END IF;
 IF active OR NOT manage THEN
  FOR l IN SELECT * FROM customer_private.programme_mission_link WHERE registration_id=registration AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_size LOOP
   next_id:=l.id;SELECT * INTO head FROM customer_private.programme_mission_revision WHERE link_id=l.id ORDER BY version DESC LIMIT 1;
   retained:=CASE WHEN manage OR own_source THEN customer_private.programme_mission_source(l.id) END;
   IF NOT manage AND retained IS NOT NULL THEN details:=customer.private_request_detail(l.request_id);IF details->'available' IS DISTINCT FROM 'true'::jsonb THEN retained:=NULL;END IF;END IF;
   item:=jsonb_build_object('id',l.id,'version',head.version,'status',CASE WHEN NOT active OR retained IS NULL THEN 'UNAVAILABLE' ELSE head.status END);
   IF retained IS NOT NULL THEN
    expiry:=least(expiry,retained);
    IF NOT manage THEN item:=item||jsonb_build_object('requestId',l.request_id); END IF;
    IF active AND head.status='SHARED' THEN item:=item||jsonb_build_object('summary',head.summary,'claimStatus','Self-declared','sharedAt',head.created_at); END IF;
   END IF;
   -- A late source revocation/expiry never exposes the previously projected text.
   IF customer_private.programme_mission_source(l.id) IS NULL THEN item:=jsonb_build_object('id',l.id,'version',head.version,'status','UNAVAILABLE'); END IF;
   items:=items||jsonb_build_array(item);
  END LOOP;
  IF NOT EXISTS(SELECT FROM customer_private.programme_mission_link WHERE registration_id=registration AND id>next_id) THEN next_id:=NULL; END IF;
 END IF;
 FOR n IN 0..jsonb_array_length(items)-1 LOOP
  item:=items->n;
  IF customer_private.programme_mission_source((item->>'id')::uuid) IS NULL THEN items:=jsonb_set(items,ARRAY[n::text],jsonb_build_object('id',item->>'id','version',(item->>'version')::integer,'status','UNAVAILABLE')); END IF;
 END LOOP;
 IF customer.actor_id() IS DISTINCT FROM actor OR expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Participant source access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrationId',registration,'active',active,'objectives',items,'nextAfter',next_id,'viewExpiresAt',expiry,'synthetic',customer_private.synthetic_context());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_participant_command(uuid,text,jsonb)'::regprocedure),'UTF8')),'hex')<>'4a220493f8808297a42ca46b31e1727ffa49970d624f16c817d25dd519a8b77c' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.programme_participant_command';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_participant_command(command uuid, operation text, input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid;target uuid;programme uuid;invitation customer_private.programme_invitation;
 registration customer_private.programme_registration;prior customer_private.programme_participant_command;
 request jsonb;result jsonb;resource uuid;kind text;changed boolean:=false;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' OR operation IS NULL OR operation NOT IN ('invite','accept','revoke','withdraw') THEN
  RAISE EXCEPTION 'Invalid participant command' USING ERRCODE='23514';
 END IF;
 IF operation<>'accept' AND input->'acknowledged' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Explicit acknowledgement required' USING ERRCODE='23514'; END IF;
 IF operation='invite' THEN
  IF input-ARRAY['workspaceId','programmeId','label','tokenHash','acknowledged']<>'{}'::jsonb OR input->>'tokenHash' IS NULL OR input->>'tokenHash' !~ '^[a-f0-9]{64}$'
   OR jsonb_typeof(input->'label') IS DISTINCT FROM 'string' OR length(input->>'label') NOT BETWEEN (CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND 120
   OR (input->>'label' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context()) OR input->>'label'<>btrim(input->>'label') OR input->>'label' ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION 'Invalid synthetic invitation' USING ERRCODE='23514';
  END IF;
  target:=(input->>'workspaceId')::uuid;programme:=(input->>'programmeId')::uuid;request:=input-'tokenHash';
 ELSIF operation='accept' THEN
  IF input-ARRAY['tokenHash','programmeId','displayLabel','consented']<>'{}'::jsonb OR input->>'tokenHash' IS NULL OR input->>'tokenHash' !~ '^[a-f0-9]{64}$'
   OR input->'consented' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'displayLabel') IS DISTINCT FROM 'string'
   OR length(input->>'displayLabel') NOT BETWEEN (CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND 120 OR (input->>'displayLabel' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context())
   OR input->>'displayLabel'<>btrim(input->>'displayLabel') OR input->>'displayLabel' ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION 'Explicit synthetic registration consent required' USING ERRCODE='23514';
  END IF;
  SELECT * INTO invitation FROM customer_private.programme_invitation WHERE token_hash=input->>'tokenHash';
  IF NOT FOUND OR invitation.programme_id IS DISTINCT FROM (input->>'programmeId')::uuid THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
  target:=invitation.workspace_id;programme:=invitation.programme_id;request:=input;
 ELSIF operation='withdraw' THEN
  IF input-ARRAY['registrationId','reason','acknowledged']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid withdrawal' USING ERRCODE='23514'; END IF;
  SELECT * INTO registration FROM customer_private.programme_registration WHERE id=(input->>'registrationId')::uuid AND principal_id=customer.actor_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
  target:=registration.workspace_id;programme:=registration.programme_id;resource:=registration.id;kind:='registration';request:=input;
 ELSE
  IF input-ARRAY['workspaceId','programmeId','kind','targetId','reason','acknowledged']<>'{}'::jsonb OR input->>'kind' IS NULL OR input->>'kind' NOT IN ('invitation','registration') THEN
   RAISE EXCEPTION 'Invalid revocation' USING ERRCODE='23514';
  END IF;
  target:=(input->>'workspaceId')::uuid;programme:=(input->>'programmeId')::uuid;resource:=(input->>'targetId')::uuid;kind:=input->>'kind';request:=input;
 END IF;
 actor:=customer_private.participant_scope(command,target,programme,operation IN ('invite','revoke'));
 IF operation IN ('revoke','withdraw') AND (jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR length(input->>'reason') NOT BETWEEN 10 AND 500) THEN
  RAISE EXCEPTION 'Revocation reason required' USING ERRCODE='23514';
 END IF;
 SELECT * INTO prior FROM customer_private.programme_participant_command q WHERE q.actor_id=actor AND q.command_id=command;
 IF FOUND AND (prior.operation<>operation OR prior.request<>request) THEN RAISE EXCEPTION 'Participant command conflicts' USING ERRCODE='23514'; END IF;
 IF operation='accept' THEN
  IF NOT customer_private.participant_invitation_active(invitation.id) THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO registration FROM customer_private.programme_registration r WHERE r.invitation_id=invitation.id;
  IF FOUND AND registration.principal_id<>actor THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
  IF NOT FOUND THEN SELECT * INTO registration FROM customer_private.programme_registration r WHERE r.programme_id=programme AND r.principal_id=actor; END IF;
  IF FOUND THEN
   IF registration.principal_id<>actor OR EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=registration.id) THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
   IF registration.display_label<>input->>'displayLabel' THEN RAISE EXCEPTION 'Registration conflicts' USING ERRCODE='23514'; END IF;
  ELSE
   INSERT INTO customer_private.programme_registration(workspace_id,programme_id,invitation_id,principal_id,display_label)
   VALUES(target,programme,invitation.id,actor,input->>'displayLabel') RETURNING * INTO registration;changed:=true;
  END IF;
  resource:=registration.id;result:=jsonb_build_object('id',resource,'programmeId',programme,'status','REGISTERED','synthetic',customer_private.synthetic_context());
 ELSIF FOUND THEN
  -- Rechecks above always precede retry receipts;issuance never recovers a secret.
  IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
  RETURN CASE WHEN operation='invite' THEN prior.result||jsonb_build_object('issued',false) ELSE prior.result END;
 ELSIF operation='invite' THEN
  IF (SELECT count(*) FROM customer_private.programme_invitation WHERE programme_id=programme)>=1000 THEN RAISE EXCEPTION 'Programme invitation limit reached' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.programme_invitation(workspace_id,programme_id,created_by,label,token_hash,expires_at)
  VALUES(target,programme,actor,input->>'label',input->>'tokenHash',clock_timestamp()+interval '7 days'-interval '1 second') RETURNING * INTO invitation;
  resource:=invitation.id;changed:=true;result:=jsonb_build_object('id',resource,'programmeId',programme,'expiresAt',invitation.expires_at,'issued',true,'synthetic',customer_private.synthetic_context());
 ELSE
  IF kind='invitation' AND NOT EXISTS(SELECT FROM customer_private.programme_invitation WHERE id=resource AND workspace_id=target AND programme_id=programme) OR
   kind='registration' AND NOT EXISTS(SELECT FROM customer_private.programme_registration WHERE id=resource AND workspace_id=target AND programme_id=programme AND (operation<>'withdraw' OR principal_id=actor)) THEN
   RAISE EXCEPTION 'Programme access record unavailable' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE (kind='invitation' AND invitation_id=resource) OR (kind='registration' AND registration_id=resource)) THEN
   INSERT INTO customer_private.programme_participant_revocation(workspace_id,programme_id,invitation_id,registration_id,created_by,reason,withdrawn)
   VALUES(target,programme,CASE WHEN kind='invitation' THEN resource END,CASE WHEN kind='registration' THEN resource END,actor,input->>'reason',operation='withdraw');changed:=true;
  END IF;
  result:=jsonb_build_object('id',resource,'programmeId',programme,'status',CASE WHEN kind='invitation' THEN 'REVOKED' ELSE (SELECT CASE WHEN withdrawn THEN 'WITHDRAWN' ELSE 'REVOKED' END FROM customer_private.programme_participant_revocation WHERE registration_id=resource) END,'synthetic',customer_private.synthetic_context());
 END IF;
 IF changed THEN
  PERFORM customer_private.workspace_access_event(target,actor,command,'customer.programme.'||operation,
   jsonb_build_object('programme_id',programme,'resource_id',resource));
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor OR (operation='accept' AND NOT customer_private.participant_invitation_active(invitation.id)) THEN
  RAISE EXCEPTION 'Participant access expired' USING ERRCODE='42501';
 END IF;
 IF prior.command_id IS NULL THEN
  INSERT INTO customer_private.programme_participant_command(actor_id,command_id,workspace_id,programme_id,operation,request,result)
  VALUES(actor,command,target,programme,operation,request,result);
 END IF;
 RETURN result;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_participant_preview(text)'::regprocedure),'UTF8')),'hex')<>'e89bf2001d5b67f6003552b63f3ed5fd40681ba82da1efc18d3ce2ad18d5c927' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.programme_participant_preview';END IF;END $guard$;
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
 INTO result FROM app.delivery_programme p WHERE p.tenant_id=i.workspace_id AND p.id=i.programme_id;
 IF customer.actor_id() IS DISTINCT FROM actor OR NOT customer_private.participant_invitation_active(i.id) THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 RETURN result;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_participants(uuid,uuid,uuid,uuid,integer)'::regprocedure),'UTF8')),'hex')<>'112623b3f866bde8181c53ae4fe31af18605e4dc326cdebf0afe960b85f31c0d' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.programme_participants';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_participants(target uuid, programme uuid, invitation_after uuid DEFAULT NULL::uuid, registration_after uuid DEFAULT NULL::uuid, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);invitations jsonb;registrations jsonb;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid participant page size' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'label',i.label,'expiresAt',i.expires_at,'status',CASE
 WHEN EXISTS(SELECT FROM customer_private.programme_registration WHERE invitation_id=i.id) THEN 'USED'
 WHEN NOT customer_private.participant_invitation_active(i.id) THEN 'UNAVAILABLE' ELSE 'ISSUED' END) ORDER BY i.id),'[]'::jsonb) INTO invitations
 FROM (SELECT * FROM customer_private.programme_invitation WHERE workspace_id=target AND programme_id=programme AND (invitation_after IS NULL OR id>invitation_after) ORDER BY id LIMIT page_size) i;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'displayLabel',r.display_label,'consentedAt',r.consented_at,'status',
 coalesce((SELECT CASE WHEN v.withdrawn THEN 'WITHDRAWN' ELSE 'REVOKED' END FROM customer_private.programme_participant_revocation v WHERE v.registration_id=r.id),'REGISTERED')) ORDER BY r.id),'[]'::jsonb) INTO registrations
 FROM (SELECT * FROM customer_private.programme_registration WHERE workspace_id=target AND programme_id=programme AND (registration_after IS NULL OR id>registration_after) ORDER BY id LIMIT page_size) r;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('programmeId',programme,'workspaceId',target,'invitations',invitations,'registrations',registrations,'synthetic',customer_private.synthetic_context(),
 'nextInvitationAfter',CASE WHEN jsonb_array_length(invitations)=page_size AND EXISTS(SELECT FROM customer_private.programme_invitation WHERE programme_id=programme AND id>(invitations->(page_size-1)->>'id')::uuid) THEN invitations->(page_size-1)->>'id' END,
 'nextRegistrationAfter',CASE WHEN jsonb_array_length(registrations)=page_size AND EXISTS(SELECT FROM customer_private.programme_registration WHERE programme_id=programme AND id>(registrations->(page_size-1)->>'id')::uuid) THEN registrations->(page_size-1)->>'id' END);
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programmes(uuid,uuid,integer)'::regprocedure),'UTF8')),'hex')<>'d985bf8bee31f8bf80505f5edb8665268391c0551b63bf75df76c771da456f87' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.programmes';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programmes(target uuid, after_id uuid DEFAULT NULL::uuid, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.programme_actor(gen_random_uuid(),target);items jsonb;next_id uuid;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'workspaceId',p.tenant_id,'name',p.name,'reportingPurpose',p.reporting_purpose,'createdAt',p.created_at,'synthetic',customer_private.synthetic_context()) ORDER BY p.id),'[]'::jsonb) INTO items
 FROM (SELECT d.* FROM app.delivery_programme d JOIN customer_private.programme_creation c ON c.workspace_id=d.tenant_id AND c.programme_id=d.id
 WHERE d.tenant_id=target AND (after_id IS NULL OR d.id>after_id) ORDER BY d.id LIMIT page_size) p;
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'id')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.programme_creation WHERE workspace_id=target AND programme_id>next_id) THEN next_id:=NULL; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('programmes',items,'workspaceId',target,'nextAfter',next_id,'synthetic',customer_private.synthetic_context());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.saved_mission_decisions(uuid)'::regprocedure),'UTF8')),'hex')<>'9a6287e5841fa7a6afa19919e3bb75fccf032d7fe2c83d5265e6f63d8bf247da' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.saved_mission_decisions';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.saved_mission_decisions(resource uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.saved_mission_actor();saved customer_private.saved_mission;document jsonb;mission jsonb;
 approval app.delivery_decision_publication;decision app.mission_selection;company jsonb;items jsonb:='[]'::jsonb;sid uuid;expiry timestamptz;
BEGIN
 document:=customer.saved_mission_action(resource)->'report';mission:=document->'missions'->0;
 SELECT * INTO saved FROM customer_private.saved_mission WHERE id=resource AND principal_id=actor AND removed_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('delivery-decision:'||saved.link_tenant_id::text||':'||(mission->>'publicationId'),0));
 SELECT * INTO approval FROM app.delivery_decision_publication WHERE tenant_id=saved.link_tenant_id AND publication_id=(mission->>'publicationId')::uuid ORDER BY version DESC LIMIT 1;
 IF NOT FOUND THEN
  IF customer.actor_id() IS DISTINCT FROM actor OR (customer.saved_mission_action(resource)->'report') IS DISTINCT FROM document THEN RAISE EXCEPTION 'Customer access expired or changed' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('resourceId',resource,'state','NOT_APPROVED','decisions','[]'::jsonb,'synthetic',customer_private.synthetic_context());
 END IF;
 expiry:=(document->>'expiresAt')::timestamptz;
 FOREACH sid IN ARRAY approval.decision_ids LOOP
  IF NOT app.client_decision_valid(approval.tenant_id,approval.publication_id,sid,approval.created_by) THEN
   IF customer.actor_id() IS DISTINCT FROM actor OR (customer.saved_mission_action(resource)->'report') IS DISTINCT FROM document THEN RAISE EXCEPTION 'Customer access expired or changed' USING ERRCODE='42501'; END IF;
   RETURN jsonb_build_object('resourceId',resource,'state','SOURCE_UNAVAILABLE','decisions','[]'::jsonb,'synthetic',customer_private.synthetic_context());
  END IF;
  SELECT * INTO decision FROM app.mission_selection WHERE tenant_id=approval.tenant_id AND id=sid;
  SELECT value INTO company FROM jsonb_array_elements(mission->'experience'->'shortlist') WHERE value->>'id'=decision.target_id::text;
  IF company IS NULL THEN RAISE EXCEPTION 'Decision company outside approved report' USING ERRCODE='42501'; END IF;
  SELECT least(expiry,min(retention_until)) INTO expiry FROM app.source_record WHERE tenant_id=approval.tenant_id AND id=ANY(ARRAY[decision.source_id,
   (SELECT source_id FROM app.mission_requirements WHERE tenant_id=decision.tenant_id AND id=decision.requirement_id),
   (SELECT source_id FROM app.mission_assessment WHERE tenant_id=decision.tenant_id AND id=decision.assessment_id),
   (SELECT source_id FROM app.mission_quotation WHERE tenant_id=decision.tenant_id AND id=decision.quotation_id)]);
  items:=items||jsonb_build_array(jsonb_build_object('id',decision.id,'targetId',decision.target_id,'company',company->>'company',
   'decision',decision.decision,'rationale',decision.rationale,'nextAction',decision.next_action,'dueAt',decision.due_at,
   'requirementCurrent',mission->'experience'->'requirements'->'current','quotationId',decision.quotation_id,
   'sourceKind',(SELECT kind FROM app.source_record WHERE tenant_id=decision.tenant_id AND id=decision.source_id),
   'claimStatus',(SELECT status FROM app.claim WHERE tenant_id=decision.tenant_id AND id=decision.claim_id)));
 END LOOP;
 -- Original report and each newly disclosed source must remain authorised.
 IF customer.actor_id() IS DISTINCT FROM actor OR expiry<=clock_timestamp() OR (customer.saved_mission_action(resource)->'report') IS DISTINCT FROM document THEN RAISE EXCEPTION 'Decision access expired or changed' USING ERRCODE='42501'; END IF;
 FOREACH sid IN ARRAY approval.decision_ids LOOP IF NOT app.client_decision_valid(approval.tenant_id,approval.publication_id,sid,approval.created_by) THEN RAISE EXCEPTION 'Decision source expired' USING ERRCODE='42501'; END IF;END LOOP;
 RETURN jsonb_build_object('resourceId',resource,'state','APPROVED','version',approval.version,'decisions',items,'expiresAt',expiry,'synthetic',customer_private.synthetic_context());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.saved_missions(uuid,integer)'::regprocedure),'UTF8')),'hex')<>'16fd6738990231aa7b959e3652833419f7767ab3ddd50eff56842d72d5e66188' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.saved_missions';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.saved_missions(after_id uuid DEFAULT NULL::uuid, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.saved_mission_actor();items jsonb;next_id uuid;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(customer_private.saved_mission_summary(s.id,actor) ORDER BY s.id),'[]'::jsonb) INTO items
 FROM (SELECT id FROM customer_private.saved_mission WHERE principal_id=actor AND removed_at IS NULL AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_size) s;
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'id')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.saved_mission WHERE principal_id=actor AND removed_at IS NULL AND id>next_id) THEN next_id:=NULL; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('missions',items,'nextAfter',next_id,'synthetic',customer_private.synthetic_context());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.service_catalogue()'::regprocedure),'UTF8')),'hex')<>'c86eec9c78d0a1e0e05da85903586abf09acb655230b27ab26f79db641269e69' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.service_catalogue';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.service_catalogue()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE items jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',v.service_key,'version',v.version,'title',v.title,'summary',v.summary,'included',to_jsonb(v.included),
  'excluded',to_jsonb(v.excluded),'regions',to_jsonb(v.regions),'quoteBasis',v.quote_basis,'synthetic',customer_private.synthetic_context()) ORDER BY v.title,v.service_key),'[]'::jsonb) INTO items
 FROM customer_private.service_catalogue_version v WHERE v.active AND v.synthetic=customer_private.synthetic_context()
 AND v.version=(SELECT max(x.version) FROM customer_private.service_catalogue_version x WHERE x.service_key=v.service_key);
 RETURN jsonb_build_object('services',items,'synthetic',customer_private.synthetic_context(),'expiresAt',customer_private.organisation_profile_expiry());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.service_request_command(uuid,text,jsonb)'::regprocedure),'UTF8')),'hex')<>'90431c7419609a525844b162f2e516155403cd2d292f7082bd1dcb144b6f790b' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.service_request_command';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.service_request_command(command uuid, operation text, input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid; target uuid; prior customer_private.service_request_command; r customer_private.service_request; cat customer_private.service_catalogue_version;
 n customer_private.service_request_need; q customer_private.service_quote; status text; place_label text; req uuid; intent uuid; result jsonb; current_digest text;
 from_date date; to_date date; new_version integer; fixed bigint; estimated bigint; note text; open_count integer;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR operation IS NULL OR operation NOT IN ('create','revise','question','accept','decline','withdraw')
  OR jsonb_typeof(input->'workspaceId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid service request command' USING ERRCODE='23514'; END IF;
 IF operation='create' THEN
  IF NOT customer_private.service_input_shape(input,ARRAY['workspaceId','contextKind','contextRef','serviceKey','need','preferredFrom','preferredTo','region'],ARRAY[]::text[])
   OR jsonb_typeof(input->'contextKind') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'contextRef') IS DISTINCT FROM 'string'
   OR jsonb_typeof(input->'serviceKey') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'need') IS DISTINCT FROM 'string'
   OR jsonb_typeof(input->'region') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'preferredFrom') NOT IN ('string','null')
   OR jsonb_typeof(input->'preferredTo') NOT IN ('string','null') OR input->>'contextKind' NOT IN ('request','programme','company') THEN
   RAISE EXCEPTION 'Invalid service request' USING ERRCODE='23514'; END IF;
 ELSIF operation='revise' THEN
  IF NOT customer_private.service_input_shape(input,ARRAY['workspaceId','requestId','expectedNeedVersion','need','preferredFrom','preferredTo','region'],ARRAY[]::text[])
   OR jsonb_typeof(input->'requestId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'expectedNeedVersion') IS DISTINCT FROM 'number'
   OR jsonb_typeof(input->'need') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'region') IS DISTINCT FROM 'string'
   OR jsonb_typeof(input->'preferredFrom') NOT IN ('string','null') OR jsonb_typeof(input->'preferredTo') NOT IN ('string','null') THEN
   RAISE EXCEPTION 'Invalid service request change' USING ERRCODE='23514'; END IF;
 ELSIF operation='question' THEN
  IF NOT customer_private.service_input_shape(input,ARRAY['workspaceId','requestId','note'],ARRAY[]::text[])
   OR jsonb_typeof(input->'requestId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Invalid question' USING ERRCODE='23514'; END IF;
 ELSIF operation='accept' THEN
  IF NOT customer_private.service_input_shape(input,ARRAY['workspaceId','requestId','quoteVersion','quoteDigest','acknowledged'],ARRAY[]::text[])
   OR jsonb_typeof(input->'requestId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'quoteVersion') IS DISTINCT FROM 'number'
   OR jsonb_typeof(input->'quoteDigest') IS DISTINCT FROM 'string' OR input->'acknowledged' IS DISTINCT FROM 'true'::jsonb THEN
   RAISE EXCEPTION 'The quote must be reviewed and acknowledged to accept it' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT customer_private.service_input_shape(input,ARRAY['workspaceId','requestId','note'],ARRAY[]::text[])
   OR jsonb_typeof(input->'requestId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'note') NOT IN ('string','null') THEN
   RAISE EXCEPTION 'Invalid service request change' USING ERRCODE='23514'; END IF;
 END IF;
 target:=(input->>'workspaceId')::uuid;
 actor:=customer_private.lock_workspace_access(command,target);
 IF customer_private.service_request_role(target,actor) IS DISTINCT FROM 'writer' THEN RAISE EXCEPTION 'Workspace owner or admin required' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM customer_private.service_request_command p WHERE p.actor_id=actor AND p.command_id=command;
 IF FOUND THEN
  IF prior.operation<>operation OR prior.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result;
 END IF;
 IF operation='create' THEN
  IF input->>'preferredFrom' !~ '^\d{4}-\d{2}-\d{2}$' AND jsonb_typeof(input->'preferredFrom')='string'
   OR input->>'preferredTo' !~ '^\d{4}-\d{2}-\d{2}$' AND jsonb_typeof(input->'preferredTo')='string' THEN
   RAISE EXCEPTION 'Dates must look like 2026-11-30' USING ERRCODE='23514'; END IF;
  from_date:=(input->>'preferredFrom')::date;to_date:=(input->>'preferredTo')::date;
  IF (from_date IS NOT NULL AND (from_date<current_date-1 OR from_date>current_date+730)) OR (to_date IS NOT NULL AND (from_date IS NULL OR to_date<from_date OR to_date>current_date+760)) THEN
   RAISE EXCEPTION 'Preferred dates are not usable' USING ERRCODE='23514'; END IF;
  SELECT * INTO cat FROM customer_private.service_catalogue_version v WHERE v.synthetic=customer_private.synthetic_context() AND v.service_key=input->>'serviceKey' AND v.active
   AND v.version=(SELECT max(x.version) FROM customer_private.service_catalogue_version x WHERE x.service_key=v.service_key);
  IF NOT FOUND THEN RAISE EXCEPTION 'That service is not offered' USING ERRCODE='23514'; END IF;
  IF NOT (input->>'region')=ANY(cat.regions) THEN RAISE EXCEPTION 'That service is not offered in this region' USING ERRCODE='23514'; END IF;
  IF NOT customer_private.service_synthetic_ok(input->>'need',1000) THEN RAISE EXCEPTION 'Describe the need with invented text that starts with Synthetic' USING ERRCODE='23514'; END IF;
  place_label:=customer_private.service_request_context(target,actor,input->>'contextKind',input->>'contextRef');
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_request.open:'||target::text||':'||(input->>'contextKind')||':'||(input->>'contextRef')||':'||(input->>'serviceKey'),0));
  IF EXISTS(SELECT FROM customer_private.service_request x WHERE x.tenant_id=target AND x.context_kind=input->>'contextKind' AND x.context_ref=input->>'contextRef'
   AND x.service_key=input->>'serviceKey' AND customer_private.service_request_status_now(x.id) NOT IN ('declined','withdrawn','closed')) THEN
   RAISE EXCEPTION 'There is already an open request for this service here' USING ERRCODE='23505'; END IF;
  SELECT count(*) INTO open_count FROM customer_private.service_request x WHERE x.tenant_id=target AND customer_private.service_request_status_now(x.id) NOT IN ('declined','withdrawn','closed');
  IF open_count>=50 THEN RAISE EXCEPTION 'Too many open requests in this workspace' USING ERRCODE='23514'; END IF;
  req:=gen_random_uuid();
  INSERT INTO customer_private.service_request(id,tenant_id,created_by,context_kind,context_ref,context_label,service_key,service_version)
  VALUES(req,target,actor,input->>'contextKind',input->>'contextRef',place_label,cat.service_key,cat.version);
  INSERT INTO customer_private.service_request_need(request_id,version,need,preferred_from,preferred_to,region,created_by)
  VALUES(req,1,input->>'need',from_date,to_date,input->>'region',actor);
  PERFORM customer_private.service_request_record(req,'requested','customer',actor,NULL,NULL,NULL,NULL,NULL,NULL,1,command);
 ELSE
  req:=(input->>'requestId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_request:'||req::text,0));
  SELECT * INTO r FROM customer_private.service_request x WHERE x.id=req AND x.tenant_id=target;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service request unavailable' USING ERRCODE='42501'; END IF;
  IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
  PERFORM customer_private.service_request_settle(req);
  SELECT e.status_after INTO status FROM customer_private.service_request_event e WHERE e.request_id=req ORDER BY e.seq DESC LIMIT 1;
  note:=input->>'note';
  IF operation='revise' THEN
   IF status<>'requested' THEN RAISE EXCEPTION 'This request can no longer be edited' USING ERRCODE='23514'; END IF;
   SELECT * INTO n FROM customer_private.service_request_need x WHERE x.request_id=req ORDER BY version DESC LIMIT 1;
   IF n.version<>(input->>'expectedNeedVersion')::integer THEN RAISE EXCEPTION 'Request changed; reload and try again' USING ERRCODE='23514'; END IF;
   IF input->>'preferredFrom' !~ '^\d{4}-\d{2}-\d{2}$' AND jsonb_typeof(input->'preferredFrom')='string'
    OR input->>'preferredTo' !~ '^\d{4}-\d{2}-\d{2}$' AND jsonb_typeof(input->'preferredTo')='string' THEN
    RAISE EXCEPTION 'Dates must look like 2026-11-30' USING ERRCODE='23514'; END IF;
   from_date:=(input->>'preferredFrom')::date;to_date:=(input->>'preferredTo')::date;
   IF (from_date IS NOT NULL AND (from_date<current_date-1 OR from_date>current_date+730)) OR (to_date IS NOT NULL AND (from_date IS NULL OR to_date<from_date OR to_date>current_date+760)) THEN
    RAISE EXCEPTION 'Preferred dates are not usable' USING ERRCODE='23514'; END IF;
   SELECT * INTO cat FROM customer_private.service_catalogue_version v WHERE v.synthetic=customer_private.synthetic_context() AND v.service_key=r.service_key AND v.version=r.service_version;
   IF NOT (input->>'region')=ANY(cat.regions) THEN RAISE EXCEPTION 'That service is not offered in this region' USING ERRCODE='23514'; END IF;
   IF NOT customer_private.service_synthetic_ok(input->>'need',1000) THEN RAISE EXCEPTION 'Describe the need with invented text that starts with Synthetic' USING ERRCODE='23514'; END IF;
   IF n.need=input->>'need' AND n.preferred_from IS NOT DISTINCT FROM from_date AND n.preferred_to IS NOT DISTINCT FROM to_date AND n.region=input->>'region' THEN
    RAISE EXCEPTION 'Nothing has changed' USING ERRCODE='23514'; END IF;
   new_version:=n.version+1;
   INSERT INTO customer_private.service_request_need(request_id,version,need,preferred_from,preferred_to,region,created_by)
   VALUES(req,new_version,input->>'need',from_date,to_date,input->>'region',actor);
   PERFORM customer_private.service_request_record(req,'revised','customer',actor,NULL,NULL,NULL,NULL,NULL,NULL,new_version,command);
  ELSIF operation='question' THEN
   PERFORM customer_private.service_request_record(req,'question','customer',actor,NULL,NULL,note,NULL,NULL,NULL,NULL,command);
  ELSIF operation='accept' THEN
   IF status='expired' THEN RAISE EXCEPTION 'This quote has expired; ask for a new one' USING ERRCODE='23514'; END IF;
   IF status<>'quoted' THEN RAISE EXCEPTION 'There is no open quote to accept' USING ERRCODE='23514'; END IF;
   SELECT * INTO q FROM customer_private.service_quote x WHERE x.request_id=req ORDER BY version DESC LIMIT 1;
   current_digest:=customer_private.service_quote_digest(q.id);
   IF q.version<>(input->>'quoteVersion')::integer OR current_digest<>input->>'quoteDigest' THEN RAISE EXCEPTION 'The quote changed; reload and review it again' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT FROM customer_private.service_quote_view v WHERE v.quote_id=q.id AND v.principal_id=actor AND v.digest=current_digest) THEN
    RAISE EXCEPTION 'Review the whole quote before accepting it' USING ERRCODE='23514'; END IF;
   SELECT t.fixed,t.estimated INTO fixed,estimated FROM customer_private.service_quote_totals(q.id) t;
   intent:=gen_random_uuid();
   INSERT INTO customer_private.service_order_intent(id,request_id,quote_id,quote_version,currency,fixed_total_minor,estimated_total_minor,quote_digest,accepted_by)
   VALUES(intent,req,q.id,q.version,q.currency,fixed,estimated,current_digest,actor);
   PERFORM customer_private.service_request_record(req,'accepted','customer',actor,NULL,NULL,NULL,NULL,q.id,intent,NULL,command);
  ELSIF operation='decline' THEN
   IF note IS NOT NULL AND NOT customer_private.service_synthetic_ok(note,1000) THEN RAISE EXCEPTION 'Use invented text that starts with Synthetic' USING ERRCODE='23514'; END IF;
   PERFORM customer_private.service_request_record(req,'declined','customer',actor,NULL,NULL,note,NULL,NULL,NULL,NULL,command);
  ELSE
   IF note IS NOT NULL AND NOT customer_private.service_synthetic_ok(note,1000) THEN RAISE EXCEPTION 'Use invented text that starts with Synthetic' USING ERRCODE='23514'; END IF;
   PERFORM customer_private.service_request_record(req,'withdrawn','customer',actor,NULL,NULL,note,NULL,NULL,NULL,NULL,command);
  END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 result:=customer_private.service_request_summary(req)||jsonb_build_object('commandId',command,'operation',operation,'synthetic',customer_private.synthetic_context());
 INSERT INTO customer_private.service_request_command(actor_id,command_id,operation,request,result) VALUES(actor,command,operation,input,result);
 RETURN result;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.service_request_list(uuid,text,text,uuid,integer)'::regprocedure),'UTF8')),'hex')<>'96009287f0cc3da291066d6b3171e2fcf81205dd399da9ceff9d562ad2d38b59' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.service_request_list';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.service_request_list(target uuid, kind_filter text DEFAULT NULL::text, ref_filter text DEFAULT NULL::text, after_id uuid DEFAULT NULL::uuid, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer.actor_id(); access text; items jsonb; next_id uuid; cursor_row customer_private.service_request;
BEGIN
 IF actor IS NULL OR target IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 OR (kind_filter IS NULL) <> (ref_filter IS NULL)
  OR (kind_filter IS NOT NULL AND kind_filter NOT IN ('request','programme','company')) THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 access:=customer_private.service_request_role(target,actor);
 IF access IS NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 IF after_id IS NOT NULL THEN
  SELECT * INTO cursor_row FROM customer_private.service_request WHERE id=after_id AND tenant_id=target;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 END IF;
 WITH page AS(SELECT r.id,r.created_at FROM customer_private.service_request r WHERE r.tenant_id=target
  AND (kind_filter IS NULL OR (r.context_kind=kind_filter AND r.context_ref=ref_filter))
  AND (after_id IS NULL OR (r.created_at,r.id)<(cursor_row.created_at,cursor_row.id)) ORDER BY r.created_at DESC,r.id DESC LIMIT page_size+1),
 visible AS(SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(customer_private.service_request_summary(v.id) ORDER BY v.created_at DESC,v.id DESC) FROM visible v),'[]'::jsonb),
 CASE WHEN (SELECT count(*) FROM page)>page_size THEN (SELECT id FROM visible ORDER BY created_at ASC,id ASC LIMIT 1) ELSE NULL END INTO items,next_id;
 IF customer.actor_id() IS DISTINCT FROM actor OR customer_private.service_request_role(target,actor) IS DISTINCT FROM access THEN RAISE EXCEPTION 'Access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'canRequest',access='writer','requests',items,'nextAfter',next_id,'synthetic',customer_private.synthetic_context(),
 'expiresAt',customer_private.organisation_profile_expiry());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.service_request_view(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'cb0d219428dab97460846e7ac8d41de1c61954c304145a1e5e7eaa52d0e96961' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.service_request_view';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.service_request_view(target uuid, request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer.actor_id(); access text; r customer_private.service_request; c customer_private.service_catalogue_version; n customer_private.service_request_need;
 q customer_private.service_quote; intent customer_private.service_order_intent; status text; quote_json jsonb; timeline jsonb; actions jsonb:='[]'::jsonb; summary jsonb;
BEGIN
 IF actor IS NULL OR target IS NULL OR request_id IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 access:=customer_private.service_request_role(target,actor);
 IF access IS NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_request:'||request_id::text,0));
 SELECT * INTO r FROM customer_private.service_request WHERE id=request_id AND tenant_id=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'Service request unavailable' USING ERRCODE='42501'; END IF;
 IF customer.actor_id() IS DISTINCT FROM actor OR customer_private.service_request_role(target,actor) IS DISTINCT FROM access THEN RAISE EXCEPTION 'Access expired' USING ERRCODE='42501'; END IF;
 PERFORM customer_private.service_request_settle(request_id);
 SELECT * INTO c FROM customer_private.service_catalogue_version WHERE service_key=r.service_key AND version=r.service_version;
 SELECT * INTO n FROM customer_private.service_request_need WHERE service_request_need.request_id=r.id ORDER BY version DESC LIMIT 1;
 SELECT e.status_after INTO status FROM customer_private.service_request_event e WHERE e.request_id=r.id ORDER BY e.seq DESC LIMIT 1;
 SELECT * INTO q FROM customer_private.service_quote WHERE service_quote.request_id=r.id ORDER BY version DESC LIMIT 1;
 IF FOUND THEN
  quote_json:=customer_private.service_quote_json(q.id);
  -- The person who may accept is shown the full quote first; that showing is recorded.
  IF access='writer' THEN
   INSERT INTO customer_private.service_quote_view(quote_id,principal_id,digest) VALUES(q.id,actor,quote_json->>'digest') ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 SELECT * INTO intent FROM customer_private.service_order_intent WHERE service_order_intent.request_id=r.id;
 -- Internal staff notes are never selected here.
 SELECT coalesce(jsonb_agg(jsonb_build_object('seq',e.seq,'at',e.created_at,'kind',e.kind,'status',e.status_after,
  'by',CASE e.actor_kind WHEN 'staff' THEN 'Corridra team' WHEN 'system' THEN 'Automatic' WHEN 'customer' THEN CASE WHEN e.customer_actor=actor THEN 'You' ELSE 'A teammate' END END,
  'note',e.customer_note,'quoteVersion',(SELECT x.version FROM customer_private.service_quote x WHERE x.id=e.quote_id)) ORDER BY e.seq),'[]'::jsonb) INTO timeline
 FROM customer_private.service_request_event e WHERE e.request_id=r.id AND e.kind<>'internal_note';
 IF access='writer' THEN
  actions:=CASE status WHEN 'requested' THEN '["revise","question","withdraw"]'::jsonb
   WHEN 'quoted' THEN '["accept","decline","question"]'::jsonb
   WHEN 'expired' THEN '["decline","question"]'::jsonb
   WHEN 'accepted' THEN '["question"]'::jsonb WHEN 'in_progress' THEN '["question"]'::jsonb WHEN 'delivered' THEN '["question"]'::jsonb
   ELSE '[]'::jsonb END;
 END IF;
 summary:=customer_private.service_request_summary(r.id);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'canAct',access='writer','request',summary||jsonb_build_object('serviceVersion',r.service_version),
 'service',jsonb_build_object('title',c.title,'summary',c.summary,'included',to_jsonb(c.included),'excluded',to_jsonb(c.excluded),'regions',to_jsonb(c.regions),'quoteBasis',c.quote_basis),
 'need',jsonb_build_object('version',n.version,'text',n.need,'preferredFrom',n.preferred_from,'preferredTo',n.preferred_to,'region',n.region,'updatedAt',n.created_at),
 'quote',quote_json,
 'orderIntent',CASE WHEN intent.id IS NULL THEN NULL ELSE jsonb_build_object('id',intent.id,'quoteVersion',intent.quote_version,'currency',intent.currency,
  'fixedTotalMinor',intent.fixed_total_minor::text,'estimatedTotalMinor',intent.estimated_total_minor::text,'acceptedAt',intent.created_at,
  'orderStatus',intent.order_status,'paymentTaken',false,'billing',intent.billing,
  'statement','Accepted by customer. No payment taken. Billing not enabled.') END,
 'timeline',timeline,'actions',actions,'synthetic',customer_private.synthetic_context(),'expiresAt',customer_private.organisation_profile_expiry());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.workspace_access_command(uuid,text,jsonb)'::regprocedure),'UTF8')),'hex')<>'e8ba237bb44e7d2a4ba6d39b43320a86ec3a813960b09f704bfe507e27f545d7' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.workspace_access_command';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.workspace_access_command(command uuid, operation text, input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid; target uuid; invitation customer_private.workspace_invitation%ROWTYPE;
 previous customer_private.workspace_access_request%ROWTYPE; accepted customer_private.workspace_invitation_acceptance%ROWTYPE;
 member customer_private.workspace_member%ROWTYPE; request jsonb; result jsonb; kind text; changed boolean:=false; resource uuid;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF input IS NULL OR jsonb_typeof(input)<>'object' OR operation IS NULL OR operation NOT IN ('invite','accept','revoke') THEN
  RAISE EXCEPTION 'Invalid access command' USING ERRCODE='23514';
 END IF;
 IF operation='invite' THEN
  IF input-ARRAY['workspaceId','label','tokenHash']<>'{}'::jsonb OR jsonb_typeof(input->'label') IS DISTINCT FROM 'string'
   OR jsonb_typeof(input->'workspaceId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'tokenHash') IS DISTINCT FROM 'string'
   OR input->>'tokenHash' !~ '^[a-f0-9]{64}$' OR length(input->>'label') NOT BETWEEN (CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND 120
   OR input->>'label'<>btrim(input->>'label') OR (input->>'label' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context()) OR input->>'label' ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION 'Invalid invitation' USING ERRCODE='23514';
  END IF;
  target:=(input->>'workspaceId')::uuid; request:=input-'tokenHash';
 ELSIF operation='accept' THEN
  IF input-ARRAY['tokenHash']<>'{}'::jsonb OR jsonb_typeof(input->'tokenHash') IS DISTINCT FROM 'string' OR input->>'tokenHash' !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'Invalid invitation' USING ERRCODE='23514';
  END IF;
  SELECT * INTO invitation FROM customer_private.workspace_invitation i WHERE i.token_hash=input->>'tokenHash';
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
  target:=invitation.tenant_id;request:=input;
 ELSE
  IF input-ARRAY['workspaceId','kind','targetId']<>'{}'::jsonb OR jsonb_typeof(input->'workspaceId') IS DISTINCT FROM 'string'
   OR jsonb_typeof(input->'targetId') IS DISTINCT FROM 'string' OR input->>'kind' IS NULL OR input->>'kind' NOT IN ('invitation','membership') THEN
   RAISE EXCEPTION 'Invalid revocation' USING ERRCODE='23514';
  END IF;
  target:=(input->>'workspaceId')::uuid;resource:=(input->>'targetId')::uuid;request:=input;
 END IF;
 actor:=customer_private.lock_workspace_access(command,target);
 IF operation<>'accept' AND NOT EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=target AND m.principal_id=actor AND m.role='owner') THEN
  RAISE EXCEPTION 'Workspace owner required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO previous FROM customer_private.workspace_access_request q WHERE q.actor_id=actor AND q.command_id=command;
 IF FOUND THEN
  IF previous.operation<>operation OR previous.request<>request THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  IF operation='accept' AND EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=(previous.result->>'memberId')::uuid) THEN
   RAISE EXCEPTION 'Membership revoked' USING ERRCODE='42501';
  END IF;
  RETURN previous.result||jsonb_build_object('issued',false);
 END IF;
 IF operation='invite' THEN
  INSERT INTO customer_private.workspace_invitation(tenant_id,created_by,label,token_hash)
  VALUES(target,actor,input->>'label',input->>'tokenHash') RETURNING * INTO invitation;
  result:=jsonb_build_object('workspaceId',target,'invitationId',invitation.id,'expiresAt',invitation.expires_at,'issued',true);
  kind:='customer.workspace.invitation.issued';changed:=true;
 ELSIF operation='accept' THEN
  IF EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=target AND m.principal_id=actor) THEN
   RAISE EXCEPTION 'Existing owner access does not need an invitation' USING ERRCODE='23514';
  END IF;
  SELECT * INTO accepted FROM customer_private.workspace_invitation_acceptance a WHERE a.invitation_id=invitation.id;
  IF FOUND THEN
   IF accepted.principal_id<>actor OR EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=accepted.member_id) THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
   END IF;
   result:=jsonb_build_object('workspaceId',target,'memberId',accepted.member_id,'invitationId',invitation.id);
  ELSE
   IF invitation.expires_at<=clock_timestamp() OR EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.invitation_id=invitation.id) THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
   END IF;
   SELECT * INTO member FROM customer_private.workspace_member m WHERE m.tenant_id=target AND m.principal_id=actor
   AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=m.id);
   IF NOT FOUND THEN
    INSERT INTO customer_private.workspace_member(tenant_id,principal_id,source_invitation_id) VALUES(target,actor,invitation.id) RETURNING * INTO member;
   END IF;
   INSERT INTO customer_private.workspace_invitation_acceptance(invitation_id,tenant_id,principal_id,member_id) VALUES(invitation.id,target,actor,member.id);
   result:=jsonb_build_object('workspaceId',target,'memberId',member.id,'invitationId',invitation.id);
   kind:='customer.workspace.invitation.accepted';changed:=true;
  END IF;
 ELSE
  IF input->>'kind'='invitation' THEN
   SELECT * INTO invitation FROM customer_private.workspace_invitation i WHERE i.id=resource AND i.tenant_id=target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
   IF EXISTS(SELECT FROM customer_private.workspace_invitation_acceptance a WHERE a.invitation_id=resource) THEN
    RAISE EXCEPTION 'Revoke the accepted membership instead' USING ERRCODE='23514';
   END IF;
   IF NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.invitation_id=resource) THEN
    INSERT INTO customer_private.workspace_access_revocation(tenant_id,invitation_id,actor_id) VALUES(target,resource,actor);changed:=true;
   END IF;
   result:=jsonb_build_object('workspaceId',target,'invitationId',resource,'status','cancelled');kind:='customer.workspace.invitation.cancelled';
  ELSE
   IF NOT EXISTS(SELECT FROM customer_private.workspace_member m WHERE m.id=resource AND m.tenant_id=target) THEN
    RAISE EXCEPTION 'Membership unavailable' USING ERRCODE='42501';
   END IF;
   IF NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=resource) THEN
    INSERT INTO customer_private.workspace_access_revocation(tenant_id,member_id,actor_id) VALUES(target,resource,actor);changed:=true;
   END IF;
   result:=jsonb_build_object('workspaceId',target,'memberId',resource,'status','revoked');kind:='customer.workspace.member.revoked';
  END IF;
 END IF;
 IF changed THEN PERFORM customer_private.workspace_access_event(target,actor,command,kind,result-'issued'); END IF;
 INSERT INTO customer_private.workspace_access_request(actor_id,command_id,operation,request,result) VALUES(actor,command,operation,request,result-'issued');
 RETURN result;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.workspace_access_list(uuid,uuid,uuid,integer)'::regprocedure),'UTF8')),'hex')<>'f98a6647762eda09a8ca9fd9c2c802549c999f50057898b22f29ae11ccf5d0d5' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.workspace_access_list';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.workspace_access_list(target uuid, invitation_after uuid DEFAULT NULL::uuid, member_after uuid DEFAULT NULL::uuid, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer.actor_id(); invites jsonb; members jsonb; next_invite uuid; next_member uuid;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT FROM customer.membership m JOIN app.tenant t ON t.id=m.tenant_id WHERE m.tenant_id=target AND m.principal_id=actor AND m.role='owner' AND (t.synthetic OR customer_private.real_session())) THEN
  RAISE EXCEPTION 'Workspace owner required' USING ERRCODE='42501';
 END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514'; END IF;
 WITH page AS(SELECT i.* FROM customer_private.workspace_invitation i WHERE i.tenant_id=target AND (invitation_after IS NULL OR i.id>invitation_after) ORDER BY i.id LIMIT page_size+1),
 visible AS(SELECT * FROM page ORDER BY id LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'label',i.label,'expiresAt',i.expires_at,
 'memberId',(SELECT a.member_id FROM customer_private.workspace_invitation_acceptance a WHERE a.invitation_id=i.id),
 'status',CASE WHEN EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.invitation_id=i.id) THEN 'cancelled'
 WHEN EXISTS(SELECT FROM customer_private.workspace_invitation_acceptance a WHERE a.invitation_id=i.id) THEN 'accepted'
 WHEN i.expires_at<=clock_timestamp() THEN 'expired' ELSE 'pending' END) ORDER BY i.id) FROM visible i),'[]'::jsonb),
 CASE WHEN (SELECT count(*) FROM page)>page_size THEN (SELECT id FROM visible ORDER BY id DESC LIMIT 1) ELSE NULL END INTO invites,next_invite;
 WITH page AS(SELECT m.* FROM customer_private.workspace_member m WHERE m.tenant_id=target AND (member_after IS NULL OR m.id>member_after) ORDER BY m.id LIMIT page_size+1),
 visible AS(SELECT * FROM page ORDER BY id LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'label',i.label,'role',customer_private.workspace_member_role_now(m.id),'roleVersion',(SELECT coalesce(max(r.version),0) FROM customer_private.workspace_member_role r WHERE r.member_id=m.id),'createdAt',m.created_at,
 'status',CASE WHEN EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=m.id) THEN 'revoked'
 WHEN EXISTS(SELECT FROM customer_private.principal p WHERE p.id=m.principal_id AND p.disabled_at IS NOT NULL) THEN 'account-disabled' ELSE 'active' END) ORDER BY m.id)
 FROM visible m JOIN customer_private.workspace_invitation i ON i.id=m.source_invitation_id),'[]'::jsonb),
 CASE WHEN (SELECT count(*) FROM page)>page_size THEN (SELECT id FROM visible ORDER BY id DESC LIMIT 1) ELSE NULL END INTO members,next_member;
 RETURN jsonb_build_object('workspaceId',target,'ownerProtected',true,'invitations',invites,'memberships',members,'nextInvitationAfter',next_invite,'nextMemberAfter',next_member);
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.coordination_event(uuid,uuid,uuid,uuid,text,uuid)'::regprocedure),'UTF8')),'hex')<>'cfc23bdbc3a65ad0ccdacf554a161e4ae525a119a004ead0c9b207b1ff3dd4b7' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.coordination_event';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.coordination_event(target uuid, actor uuid, command uuid, programme uuid, kind text, reference uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE executor uuid;eid uuid:=gen_random_uuid();v integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v FROM app.domain_event e WHERE e.tenant_id=target AND e.aggregate_type='customer_programme_coordination' AND e.aggregate_id=programme::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.programme_coordination.'||kind,1,'customer_programme_coordination',programme::text,v,executor,clock_timestamp(),command,command,
 jsonb_build_object('referenceId',reference,'kind',kind,'synthetic',customer_private.synthetic_context(),'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.programme_coordination.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.coordination_text(jsonb,integer,integer,boolean)'::regprocedure),'UTF8')),'hex')<>'d56db433285dda435abcf1b4586e02e2a8ce200108efa39db49e168891bbec81' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.coordination_text';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.coordination_text(v jsonb, min_length integer, max_length integer, required boolean)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF v IS NULL OR jsonb_typeof(v)='null' THEN
  IF required THEN RAISE EXCEPTION 'Text required' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 IF jsonb_typeof(v)<>'string' OR (v#>>'{}')<>btrim(v#>>'{}') OR length(v#>>'{}') NOT BETWEEN (CASE WHEN min_length=11 AND NOT customer_private.synthetic_context() THEN 2 ELSE min_length END) AND max_length
  OR ((v#>>'{}') NOT LIKE 'Synthetic %' AND customer_private.synthetic_context()) OR (v#>>'{}') ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' THEN
  RAISE EXCEPTION 'Invalid synthetic text' USING ERRCODE='23514';
 END IF;
 RETURN v#>>'{}';
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.mission_draft_event(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure),'UTF8')),'hex')<>'20f83dcd50c31ff1a14ab75062a66bdb81ab9db92ac339f897414e592b0f23b6' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.mission_draft_event';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.mission_draft_event(target uuid, actor uuid, command uuid, kind text, draft uuid, revision_version integer, detail jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE executor uuid;eid uuid:=gen_random_uuid();v integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v FROM app.domain_event e WHERE e.tenant_id=target AND e.aggregate_type='customer_mission_draft' AND e.aggregate_id=draft::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,kind,1,'customer_mission_draft',draft::text,v,executor,clock_timestamp(),command,command,
 detail||jsonb_build_object('draftId',draft,'version',revision_version,'synthetic',customer_private.synthetic_context(),'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.mission_draft_valid(jsonb,uuid)'::regprocedure),'UTF8')),'hex')<>'f0a38fb09c7c49bfe99fbca76b7535aff2c30447836c7f636bca120ce519d917' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.mission_draft_valid';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.mission_draft_valid(d jsonb, target uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE keys text[]:=ARRAY['title','family','objective','market','attendance','startDate','endDate','timezone','offer','website','outcomes','notes','requirements','contactName','contactEmail','profileVersion','sourcingContext','companyName'];
 outs text[];labels text[];item jsonb;
BEGIN
 IF d IS NULL OR jsonb_typeof(d)<>'object' OR d-keys<>'{}'::jsonb OR NOT(d ?& keys) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'title')<>'string' OR d->>'title'<>btrim(d->>'title') OR length(d->>'title') NOT BETWEEN (CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND 120 OR (d->>'title' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context()) OR d->>'title' ~ '[[:cntrl:]]' THEN RETURN false; END IF;
 IF jsonb_typeof(d->'family')<>'string' OR d->>'family' NOT IN ('BUYERS_PARTNERS','SUPPLIERS_PRODUCTS','DELEGATION','OTHER') THEN RETURN false; END IF;
 IF jsonb_typeof(d->'objective') NOT IN ('string','null') OR (jsonb_typeof(d->'objective')='string' AND d->>'objective' NOT IN ('Sell in a new market','Find customers or distributors','Source suppliers','Make an upcoming business trip more productive','Run a multi-company mission','Something else')) THEN RETURN false; END IF;
 -- The objective must belong to the chosen product family; "Something else" and a business trip fit any family.
 IF jsonb_typeof(d->'objective')='string' AND d->>'objective' NOT IN ('Something else','Make an upcoming business trip more productive') AND NOT(
  (d->>'family'='BUYERS_PARTNERS' AND d->>'objective' IN ('Sell in a new market','Find customers or distributors'))
  OR (d->>'family'='SUPPLIERS_PRODUCTS' AND d->>'objective'='Source suppliers')
  OR (d->>'family'='DELEGATION' AND d->>'objective'='Run a multi-company mission')) THEN RETURN false; END IF;
 -- Sourcing context applies to Product 2 only, so a buyer or delegation draft never carries machinery detail.
 IF jsonb_typeof(d->'sourcingContext') NOT IN ('string','null') OR (jsonb_typeof(d->'sourcingContext')='string' AND (d->>'family'<>'SUPPLIERS_PRODUCTS' OR d->>'sourcingContext' NOT IN ('MACHINERY','FINISHED_PRODUCTS','MATERIALS_COMPONENTS','OEM_CUSTOM','OTHER_PROCUREMENT'))) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'companyName')<>'string' OR d->>'companyName'<>btrim(d->>'companyName') OR length(d->>'companyName')>160 OR d->>'companyName' ~ '[[:cntrl:]]' OR (d->>'companyName'<>'' AND (length(d->>'companyName')<11 OR (d->>'companyName' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context()))) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'market')<>'string' OR length(d->>'market')>120 OR d->>'market'<>btrim(d->>'market') OR d->>'market' ~ '[[:cntrl:]]' THEN RETURN false; END IF;
 IF jsonb_typeof(d->'attendance')<>'string' OR d->>'attendance' NOT IN ('Yes','No','Not decided') THEN RETURN false; END IF;
 IF jsonb_typeof(d->'startDate')<>'string' OR jsonb_typeof(d->'endDate')<>'string' THEN RETURN false; END IF;
 BEGIN
  IF d->>'startDate'<>'' AND (d->>'startDate' !~ '^\d{4}-\d{2}-\d{2}$' OR to_char((d->>'startDate')::date,'YYYY-MM-DD')<>d->>'startDate') THEN RETURN false; END IF;
  IF d->>'endDate'<>'' AND (d->>'endDate' !~ '^\d{4}-\d{2}-\d{2}$' OR to_char((d->>'endDate')::date,'YYYY-MM-DD')<>d->>'endDate') THEN RETURN false; END IF;
 EXCEPTION WHEN others THEN RETURN false;
 END;
 IF d->>'startDate'<>'' AND d->>'endDate'<>'' AND d->>'endDate'<d->>'startDate' THEN RETURN false; END IF;
 IF jsonb_typeof(d->'timezone')<>'string' OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=d->>'timezone') THEN RETURN false; END IF;
 IF jsonb_typeof(d->'offer')<>'string' OR length(d->>'offer')>2000 OR d->>'offer'<>btrim(d->>'offer') OR d->>'offer' ~ '[[:cntrl:]]' OR (d->>'offer'<>'' AND (length(d->>'offer')<11 OR (d->>'offer' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context()))) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'notes')<>'string' OR length(d->>'notes')>1000 OR d->>'notes'<>btrim(d->>'notes') OR d->>'notes' ~ '[[:cntrl:]]' OR (d->>'notes'<>'' AND (length(d->>'notes')<11 OR (d->>'notes' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context()))) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'website')<>'string' OR (d->>'website'<>'' AND (length(d->>'website')>200 OR (d->>'website' !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.(example|test|invalid)(/[A-Za-z0-9._~/-]*)?$' AND customer_private.synthetic_context()) OR (d->>'website' !~ '^https://[^[:space:]@]+$' AND NOT customer_private.synthetic_context()))) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'outcomes')<>'array' OR jsonb_array_length(d->'outcomes')>7 OR EXISTS(SELECT FROM jsonb_array_elements(d->'outcomes') v WHERE jsonb_typeof(v)<>'string') THEN RETURN false; END IF;
 SELECT coalesce(array_agg(value),ARRAY[]::text[]) INTO outs FROM jsonb_array_elements_text(d->'outcomes');
 IF EXISTS(SELECT FROM unnest(outs) o WHERE o NOT IN ('Relevant meetings','Buyers / customers','Distributor conversations','Supplier visits','Market validation','Local commercial intelligence','Something else')) OR (SELECT count(DISTINCT o) FROM unnest(outs) o)<>cardinality(outs) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'requirements')<>'array' OR jsonb_array_length(d->'requirements')>20 THEN RETURN false; END IF;
 labels:=ARRAY[]::text[];
 FOR item IN SELECT value FROM jsonb_array_elements(d->'requirements') LOOP
  IF jsonb_typeof(item)<>'object' OR item-ARRAY['label','value']<>'{}'::jsonb OR NOT(item ?& ARRAY['label','value']) OR jsonb_typeof(item->'label')<>'string' OR jsonb_typeof(item->'value')<>'string' THEN RETURN false; END IF;
  IF item->>'label'<>btrim(item->>'label') OR length(item->>'label') NOT BETWEEN 2 AND 60 OR item->>'label' ~ '[[:cntrl:]]' THEN RETURN false; END IF;
  IF item->>'value'<>btrim(item->>'value') OR length(item->>'value') NOT BETWEEN (CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND 300 OR (item->>'value' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context()) OR item->>'value' ~ '[[:cntrl:]]' THEN RETURN false; END IF;
  labels:=labels||lower(item->>'label');
 END LOOP;
 IF (SELECT count(DISTINCT l) FROM unnest(labels) l)<>cardinality(labels) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'contactName')<>'string' OR d->>'contactName'<>btrim(d->>'contactName') OR length(d->>'contactName')>120 OR d->>'contactName' ~ '[[:cntrl:]]' OR (d->>'contactName'<>'' AND length(d->>'contactName')<2) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'contactEmail')<>'string' OR (d->>'contactEmail'<>'' AND (length(d->>'contactEmail')>254 OR (d->>'contactEmail' !~ '^[a-z0-9._+-]+@example\.invalid$' AND customer_private.synthetic_context()) OR (d->>'contactEmail' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND NOT customer_private.synthetic_context()))) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'profileVersion') NOT IN ('number','null') THEN RETURN false; END IF;
 IF jsonb_typeof(d->'profileVersion')='number' THEN
  IF d->>'profileVersion' !~ '^[1-9][0-9]{0,8}$' OR NOT EXISTS(SELECT FROM customer_private.organisation_profile_revision r WHERE r.tenant_id=target AND r.version=(d->>'profileVersion')::integer) THEN RETURN false; END IF;
 END IF;
 RETURN true;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.organisation_link_domain_event(uuid,text,uuid,uuid,text,uuid,integer,text)'::regprocedure),'UTF8')),'hex')<>'c971bad1b44f91e3f47038088a467532c7ad8aaaaa6721a48d80a72ca7255771' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.organisation_link_domain_event';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.organisation_link_domain_event(p_target uuid, p_initiator_kind text, p_initiator uuid, p_command uuid, p_kind text, p_claim uuid, p_seq integer, p_state text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
 jsonb_build_object('claimId',p_claim,'version',p_seq,'state',p_state,'synthetic',customer_private.synthetic_context(),'initiator_kind',p_initiator_kind,'initiator_id',p_initiator));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),p_target,v_eid,v_actor,'customer.organisation_link.'||p_kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),p_target,v_eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(v_eid,p_target);
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.organisation_link_name_key(text)'::regprocedure),'UTF8')),'hex')<>'42596eda03377fad76c59c3e88821c70fd99ae33dd53174d52e3b05af3398d8e' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.organisation_link_name_key';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.organisation_link_name_key(p_name text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT regexp_replace(
  regexp_replace(
   regexp_replace(regexp_replace(lower(coalesce(p_name,'')),CASE WHEN customer_private.synthetic_context() THEN '^synthetic[[:space:]]+' ELSE '^$' END,''),'[^[:alnum:]]+',' ','g'),
   '\m(ltd|limited|llc|inc|incorporated|corp|corporation|co|company|gmbh|ag|sa|sl|srl|bv|nv|plc|pty|pvt|llp|oy|ab|spa)\M','','g'),
  '[^[:alnum:]]+','','g')
$function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.organisation_link_public_organisation(uuid)'::regprocedure),'UTF8')),'hex')<>'204ddcf94c79d66749acf5fcf34fa95ccfd8d284acb861386065396ec7dcba81' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.organisation_link_public_organisation';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.organisation_link_public_organisation(p_organisation uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT FROM app.organisation o JOIN app.public_identifier i ON i.organisation_id=o.id
 WHERE o.id=p_organisation AND (o.synthetic=customer_private.synthetic_context()) AND i.synthetic=o.synthetic AND i.valid_until>clock_timestamp())
$function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.organisation_link_staff()'::regprocedure),'UTF8')),'hex')<>'c59aa9de94c49bc1ae0b02fe452f9cde916a618cdd85779153c9cb76202b5045' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.organisation_link_staff';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.organisation_link_staff()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_actor uuid:=app.actor_id(); v_tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid; v_role text;
BEGIN
 IF v_actor IS NULL OR v_tenant IS NULL THEN RAISE EXCEPTION 'Reviewer access required' USING ERRCODE='42501'; END IF;
 v_role:=app.member_role(v_tenant);
 IF v_role IS NULL OR v_role NOT IN ('owner','admin','reviewer') OR NOT app.fresh_mfa() OR NOT coalesce(app.can_access(v_tenant,'INTERNAL',app.tenant_processing_purpose(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid)),false)
  OR NOT EXISTS(SELECT FROM app.tenant t WHERE t.id=v_tenant AND (t.synthetic OR app.real_use_allowed(t.id)))
  OR NOT (EXISTS(SELECT FROM app.intake_destination d WHERE d.singleton AND d.enabled AND d.tenant_id=v_tenant) OR EXISTS(SELECT FROM customer_private.real_use_configuration d WHERE d.enabled AND d.intake_tenant_id=v_tenant)) THEN
  RAISE EXCEPTION 'Reviewer access with a fresh authenticator check is required' USING ERRCODE='42501';
 END IF;
 RETURN v_actor;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.organisation_link_state(uuid,boolean)'::regprocedure),'UTF8')),'hex')<>'04b3bb9850c6336b0c2b0db3ed1456d93db9d02c9e4837f7fd555b7f5cfb209e' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.organisation_link_state';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.organisation_link_state(p_target uuid, p_writer boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
   'label',CASE WHEN customer_private.synthetic_context() THEN 'Company link reviewed by Corridra staff from the evidence supplied (synthetic test)' ELSE 'Company link reviewed by Corridra staff from the evidence supplied' END)
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
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.organisation_profile_event(uuid,uuid,uuid,uuid,integer)'::regprocedure),'UTF8')),'hex')<>'844420439e3457951a9de60343087e163251cd0bd408b4300433069b02f3b723' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.organisation_profile_event';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.organisation_profile_event(target uuid, actor uuid, command uuid, revision uuid, revision_version integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE executor uuid;eid uuid:=gen_random_uuid();
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.organisation_profile.revised',1,'customer_organisation_profile',target::text,revision_version,executor,clock_timestamp(),command,command,
 jsonb_build_object('revisionId',revision,'version',revision_version,'synthetic',customer_private.synthetic_context(),'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.organisation_profile.revised');
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.organisation_profile_valid(jsonb)'::regprocedure),'UTF8')),'hex')<>'b71d392acf75641c55a296bc422cca08c612dadeccd37d34117d329249cb4792' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.organisation_profile_valid';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.organisation_profile_valid(d jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE roles text[];sectors text[];
BEGIN
 IF d IS NULL OR jsonb_typeof(d)<>'object' OR d-ARRAY['legalName','countryCode','website','commercialRoles','sectors','sizeBand','summary']<>'{}'::jsonb
  OR NOT(d ?& ARRAY['legalName','countryCode','website','commercialRoles','sectors','sizeBand','summary']) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'legalName')<>'string' OR jsonb_typeof(d->'countryCode')<>'string' OR jsonb_typeof(d->'sizeBand')<>'string' OR jsonb_typeof(d->'summary')<>'string'
  OR jsonb_typeof(d->'commercialRoles')<>'array' OR jsonb_typeof(d->'sectors')<>'array' OR jsonb_typeof(d->'website') NOT IN ('string','null') THEN RETURN false; END IF;
 IF d->>'legalName'<>btrim(d->>'legalName') OR length(d->>'legalName') NOT BETWEEN (CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND 200 OR (d->>'legalName' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context()) OR d->>'legalName' ~ '[[:cntrl:]]' THEN RETURN false; END IF;
 IF d->>'summary'<>btrim(d->>'summary') OR length(d->>'summary') NOT BETWEEN (CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND 1000 OR (d->>'summary' NOT LIKE 'Synthetic %' AND customer_private.synthetic_context()) OR d->>'summary' ~ '[[:cntrl:]]' THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT FROM app.market_scope WHERE key=d->>'countryCode' AND kind='COUNTRY') THEN RETURN false; END IF;
 IF d->>'sizeBand' NOT IN ('1-10','11-50','51-200','201-1000','1000+') THEN RETURN false; END IF;
 IF jsonb_typeof(d->'website')='string' AND (length(d->>'website')>200 OR (d->>'website' !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.(example|test|invalid)(/[A-Za-z0-9._~/-]*)?$' AND customer_private.synthetic_context()) OR (d->>'website' !~ '^https://[^[:space:]@]+$' AND NOT customer_private.synthetic_context())) THEN RETURN false; END IF;
 IF jsonb_array_length(d->'commercialRoles') NOT BETWEEN 1 AND 6 OR EXISTS(SELECT FROM jsonb_array_elements(d->'commercialRoles') v WHERE jsonb_typeof(v)<>'string') THEN RETURN false; END IF;
 SELECT array_agg(value) INTO roles FROM jsonb_array_elements_text(d->'commercialRoles');
 IF EXISTS(SELECT FROM unnest(roles) r WHERE r NOT IN ('BUYER','SELLER','SUPPLIER','MANUFACTURER','DISTRIBUTOR','ORGANISER')) OR (SELECT count(DISTINCT r) FROM unnest(roles) r)<>cardinality(roles) THEN RETURN false; END IF;
 IF jsonb_array_length(d->'sectors')>10 OR EXISTS(SELECT FROM jsonb_array_elements(d->'sectors') v WHERE jsonb_typeof(v)<>'string') THEN RETURN false; END IF;
 SELECT coalesce(array_agg(value),ARRAY[]::text[]) INTO sectors FROM jsonb_array_elements_text(d->'sectors');
 IF EXISTS(SELECT FROM unnest(sectors) s WHERE s<>btrim(s) OR length(s) NOT BETWEEN 2 AND 60 OR s ~ '[[:cntrl:]]') OR (SELECT count(DISTINCT lower(s)) FROM unnest(sectors) s)<>cardinality(sectors) THEN RETURN false; END IF;
 RETURN true;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.pricing_event(uuid,uuid,uuid,text,uuid,text,jsonb)'::regprocedure),'UTF8')),'hex')<>'8826d093cd92bb99dcf6b45ad5035d9713ceeb041a6d6faadebe0dbc306856d3' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.pricing_event';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.pricing_event(target uuid, actor uuid, command uuid, family text, aggregate uuid, kind text, detail jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE executor uuid;eid uuid:=gen_random_uuid();v integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 IF family NOT IN ('programme_pricing','programme_series','programme_export') THEN RAISE EXCEPTION 'Unknown event family' USING ERRCODE='23514'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v FROM app.domain_event e WHERE e.tenant_id=target AND e.aggregate_type='customer_'||family AND e.aggregate_id=aggregate::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.'||family||'.'||kind,1,'customer_'||family,aggregate::text,v,executor,clock_timestamp(),command,command,
 detail||jsonb_build_object('kind',kind,'synthetic',customer_private.synthetic_context(),'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.'||family||'.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.programme_ledger_event(uuid,uuid,uuid,uuid,uuid,text,integer)'::regprocedure),'UTF8')),'hex')<>'b9d8aac43a9dd2dd553b45c3c5f4183395ae532549ace3b70e56fd57e020f837' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.programme_ledger_event';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.programme_ledger_event(target uuid, actor uuid, command uuid, programme uuid, entry uuid, entry_kind text, entry_seq integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE executor uuid;eid uuid:=gen_random_uuid();v integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v FROM app.domain_event e WHERE e.tenant_id=target AND e.aggregate_type='customer_programme_ledger' AND e.aggregate_id=programme::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.programme_ledger.recorded',1,'customer_programme_ledger',programme::text,v,executor,clock_timestamp(),command,command,
 jsonb_build_object('entryId',entry,'seq',entry_seq,'kind',entry_kind,'synthetic',customer_private.synthetic_context(),'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.programme_ledger.recorded');
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.programme_mission_source(uuid)'::regprocedure),'UTF8')),'hex')<>'5e6096f1fbe5275aeac53ffc40134681ed066b0206b8bba9c1d0445ba1c9082a' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.programme_mission_source';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.programme_mission_source(selected uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE retained timestamptz;
BEGIN
 -- Explicit stored consent is checked by the caller. No creator proof is minted.
 -- Only availability is inspected;original receipt progress/source is never returned.
 SELECT i.retention_until INTO retained FROM customer_private.programme_mission_link l
 JOIN customer_private.owned_request r ON r.id=l.request_id AND r.principal_id=l.principal_id
 JOIN customer_private.principal p ON p.id=r.principal_id AND p.disabled_at IS NULL
 JOIN customer_private.request_admission a ON a.principal_id=p.id AND a.disabled_at IS NULL
 JOIN customer_private.configuration c ON c.issuer=p.issuer AND c.synthetic
 JOIN app.mission_intake i ON i.tenant_id=r.mission_tenant_id AND i.id=r.mission_id AND i.receipt_hash=r.receipt_hash AND i.request_key=r.request_key
 JOIN app.tenant t ON t.id=i.tenant_id AND (t.synthetic OR customer_private.real_session())
 WHERE l.id=selected AND i.retention_until>clock_timestamp()
 AND NOT EXISTS(SELECT FROM customer_private.request_revocation WHERE request_id=r.id)
 AND app.mission_receipt(r.receipt_hash) IS NOT NULL;
 IF retained IS NULL OR retained<=clock_timestamp() THEN RETURN NULL; END IF;
 RETURN retained;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.service_list_ok(text[],integer,integer,integer,boolean,boolean)'::regprocedure),'UTF8')),'hex')<>'bf314c43b3a5ffc9a31f8836022a61e42d50bb0e75d83809c3a31572e1ae12fb' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.service_list_ok';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.service_list_ok(a text[], max_items integer, min_len integer, max_len integer, synthetic boolean, plain boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT a IS NOT NULL AND array_ndims(a)=1 AND cardinality(a) BETWEEN 1 AND max_items
 AND NOT EXISTS(SELECT FROM unnest(a) e WHERE e IS NULL
  OR (synthetic AND NOT customer_private.service_synthetic_ok(e,max_len))
  OR (NOT synthetic AND plain AND NOT customer_private.service_plain_ok(e,min_len,max_len))
  OR (NOT synthetic AND NOT plain AND NOT customer_private.service_text_ok(e,min_len,max_len)))
 AND (SELECT count(DISTINCT lower(e)) FROM unnest(a) e)=cardinality(a)
$function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.service_quote_json(uuid)'::regprocedure),'UTF8')),'hex')<>'100f0057f3615d028621f88b4e83f137d6d0bffcfdf9d515155145dc1a64be88' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.service_quote_json';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.service_quote_json(quote uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('id',q.id,'version',q.version,'currency',q.currency,'scope',q.scope,
  'components',(SELECT coalesce(jsonb_agg(jsonb_build_object('position',c.position,'kind',c.kind,'label',c.label,'treatment',c.treatment,'amountMinor',c.amount_minor::text) ORDER BY c.position),'[]'::jsonb)
   FROM customer_private.service_quote_component c WHERE c.quote_id=q.id),
  'fixedTotalMinor',t.fixed::text,'estimatedTotalMinor',t.estimated::text,
  'exclusions',to_jsonb(q.exclusions),'assumptions',to_jsonb(q.assumptions),'deliveryTerms',q.delivery_terms,'paymentTerms',q.payment_terms,
  'validUntil',to_char(q.valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'preparedAt',to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'expired',q.valid_until<=clock_timestamp(),'digest',customer_private.service_quote_digest(q.id),'synthetic',customer_private.synthetic_context(),
  'billing','billing_not_enabled','paymentTaken',false)
 FROM customer_private.service_quote q CROSS JOIN LATERAL customer_private.service_quote_totals(q.id) t WHERE q.id=quote
$function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.service_request_emit(uuid,integer,text,text,text,uuid,integer,uuid)'::regprocedure),'UTF8')),'hex')<>'38a360083103be5c575ed6c252a79a9269bf9909a6312339e3b0744630580dfb' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.service_request_emit';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.service_request_emit(req uuid, seq integer, kind text, status text, actor_kind text, initiator uuid, quote_version integer, command uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE executor uuid; eid uuid:=gen_random_uuid(); target uuid; event_actor uuid;
BEGIN
 SELECT tenant_id INTO target FROM customer_private.service_request WHERE id=req;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF target IS NULL OR executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 -- A staff change is attributed to the staff person; customer and system changes to the service executor.
 event_actor:=CASE WHEN actor_kind='staff' THEN initiator ELSE executor END;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.service_request.'||kind,1,'customer_service_request',req::text,seq,event_actor,clock_timestamp(),command,command,
 jsonb_strip_nulls(jsonb_build_object('requestId',req,'seq',seq,'status',status,'quoteVersion',quote_version,'synthetic',customer_private.synthetic_context(),'initiator_kind',actor_kind,'initiator_id',initiator)));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,event_actor,'customer.service_request.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.service_staff_actor()'::regprocedure),'UTF8')),'hex')<>'2d3cf1d9890d57084b43a3f832efadd1f8f12aed0263e8f475bf5da7639919ff' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.service_staff_actor';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.service_staff_actor()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=app.actor_id(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT coalesce(app.can_access(t,'INTERNAL',app.tenant_processing_purpose(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid)),false)
  OR coalesce(app.member_role(t),'') NOT IN ('owner','admin') OR NOT app.fresh_mfa()
  OR NOT EXISTS(SELECT FROM app.tenant WHERE id=t AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Service requests need an owner or admin with a fresh authenticator check' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM identity.session s JOIN identity.assurance a ON a.session_id=s.id JOIN identity.principal p ON p.identity_id=s."userId"
 JOIN identity."user" u ON u.id=p.identity_id JOIN app.membership m ON m.user_id=p.id AND m.tenant_id=t
 WHERE p.id=actor AND p.disabled_at IS NULL AND u."twoFactorEnabled" AND m.revoked_at IS NULL AND m.role IN ('owner','admin')
 AND p.operating_country=ANY(m.allowed_countries) AND current_setting('corridra.purpose',true)=ANY(m.allowed_purposes)
 AND encode(sha256(convert_to(s.token,'UTF8')),'hex')=current_setting('corridra.session_hash',true)
 AND s."expiresAt">clock_timestamp() AND s."createdAt">clock_timestamp()-interval '24 hours' AND a.verified_at>clock_timestamp()-interval '5 minutes'
 FOR SHARE OF s,a,p,u,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff assurance expired' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.service_synthetic_ok(text,integer)'::regprocedure),'UTF8')),'hex')<>'a30f60f92276ca9f0b77099f837840c473859735a73cbec7a7e8addaac902c05' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.service_synthetic_ok';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.service_synthetic_ok(t text, max_len integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT customer_private.service_text_ok(t,CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END,max_len) AND (t LIKE 'Synthetic %' OR NOT customer_private.synthetic_context())
$function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.template_event(uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure),'UTF8')),'hex')<>'1afd1ac62e3e23fb37490cd8440c968dee932a95cfb8cdd1d042f94d2e6504dc' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.template_event';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.template_event(target uuid, actor uuid, command uuid, aggregate uuid, kind text, detail jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE executor uuid;eid uuid:=gen_random_uuid();v integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v FROM app.domain_event e WHERE e.tenant_id=target AND e.aggregate_type='customer_programme_template' AND e.aggregate_id=aggregate::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.programme_template.'||kind,1,'customer_programme_template',aggregate::text,v,executor,clock_timestamp(),command,command,
 detail||jsonb_build_object('kind',kind,'synthetic',customer_private.synthetic_context(),'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.programme_template.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.terms_event(uuid,uuid,uuid,uuid,text,uuid)'::regprocedure),'UTF8')),'hex')<>'485597971857dbf915d63d9058fe4a2932a85c716372d66a6647b10028ce6df1' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.terms_event';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.terms_event(target uuid, actor uuid, command uuid, programme uuid, kind text, reference uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE executor uuid;eid uuid:=gen_random_uuid();v integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v FROM app.domain_event e WHERE e.tenant_id=target AND e.aggregate_type='customer_programme_terms' AND e.aggregate_id=programme::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.programme_terms.'||kind,1,'customer_programme_terms',programme::text,v,executor,clock_timestamp(),command,command,
 jsonb_build_object('referenceId',reference,'kind',kind,'synthetic',customer_private.synthetic_context(),'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.programme_terms.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.workspace_access_event(uuid,uuid,uuid,text,jsonb)'::regprocedure),'UTF8')),'hex')<>'b0fb36a8f8ba47dff1176e23a298fd32efd2e7a8ee7dd01d11d33bbbf70de84c' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.workspace_access_event';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.workspace_access_event(target uuid, actor uuid, command uuid, kind text, payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE executor uuid; eid uuid:=gen_random_uuid(); version integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO version FROM app.domain_event e
 WHERE e.tenant_id=target AND e.aggregate_type='customer_workspace_access' AND e.aggregate_id=target::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,kind,1,'customer_workspace_access',target::text,version,executor,clock_timestamp(),command,command,
 payload||jsonb_build_object('synthetic',customer_private.synthetic_context(),'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $function$
;

ALTER TABLE customer_private.organisation_link_claim DROP CONSTRAINT organisation_link_claim_note_check;
ALTER TABLE customer_private.organisation_link_claim ADD CONSTRAINT organisation_link_claim_note_check CHECK (((note = btrim(note)) AND ((length(note) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(note) <= 1000)) AND ((note ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (note !~ '[[:cntrl:]]'::text)));

ALTER TABLE customer_private.organisation_link_evidence DROP CONSTRAINT organisation_link_evidence_statement_check;
ALTER TABLE customer_private.organisation_link_evidence ADD CONSTRAINT organisation_link_evidence_statement_check CHECK (((statement = btrim(statement)) AND ((length(statement) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(statement) <= 1000)) AND ((statement ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (statement !~ '[[:cntrl:]]'::text)));

ALTER TABLE customer_private.pricing_template_revision DROP CONSTRAINT pricing_template_revision_description_check;
ALTER TABLE customer_private.pricing_template_revision ADD CONSTRAINT pricing_template_revision_description_check CHECK (((description = btrim(description)) AND ((length(description) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(description) <= 500)) AND ((description ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (description !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'::text)));

ALTER TABLE customer_private.pricing_template_revision DROP CONSTRAINT pricing_template_revision_name_check;
ALTER TABLE customer_private.pricing_template_revision ADD CONSTRAINT pricing_template_revision_name_check CHECK (((name = btrim(name)) AND ((length(name) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(name) <= 120)) AND ((name ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (name !~ '[[:cntrl:]]'::text)));

ALTER TABLE customer_private.programme_capacity_revision DROP CONSTRAINT programme_capacity_revision_reason_check;
ALTER TABLE customer_private.programme_capacity_revision ADD CONSTRAINT programme_capacity_revision_reason_check CHECK (((reason = btrim(reason)) AND ((length(reason) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(reason) <= 300)) AND ((reason ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (reason !~ '[[:cntrl:]]'::text)));

ALTER TABLE customer_private.programme_eligibility_revision DROP CONSTRAINT programme_eligibility_revision_reason_check;
ALTER TABLE customer_private.programme_eligibility_revision ADD CONSTRAINT programme_eligibility_revision_reason_check CHECK (((reason = btrim(reason)) AND ((length(reason) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(reason) <= 300)) AND ((reason ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (reason !~ '[[:cntrl:]]'::text)));

ALTER TABLE customer_private.programme_invitation DROP CONSTRAINT programme_invitation_label_check;
ALTER TABLE customer_private.programme_invitation ADD CONSTRAINT programme_invitation_label_check CHECK ((((label ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND ((length(label) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(label) <= 120)) AND (label = btrim(label)) AND (label !~ '[[:cntrl:]]'::text)));

ALTER TABLE customer_private.programme_ledger_entry DROP CONSTRAINT programme_ledger_entry_description_check;
ALTER TABLE customer_private.programme_ledger_entry ADD CONSTRAINT programme_ledger_entry_description_check CHECK (((description = btrim(description)) AND ((length(description) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(description) <= 300)) AND ((description ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (description !~ '[[:cntrl:]]'::text)));

ALTER TABLE customer_private.programme_mission_revision DROP CONSTRAINT programme_mission_revision_check;
ALTER TABLE customer_private.programme_mission_revision ADD CONSTRAINT programme_mission_revision_check CHECK ((((status = 'SHARED'::text) AND (summary IS NOT NULL) AND (summary !~ '[[:cntrl:]]'::text) AND ((summary ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND ((length(summary) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(summary) <= 500)) AND (summary = btrim(summary)) AND (reason IS NULL)) OR ((status = 'WITHDRAWN'::text) AND (summary IS NULL) AND (reason IS NOT NULL) AND ((length(reason) >= 10) AND (length(reason) <= 500)))));

ALTER TABLE customer_private.programme_participant_record_revision DROP CONSTRAINT programme_participant_record_revision_note_check;
ALTER TABLE customer_private.programme_participant_record_revision ADD CONSTRAINT programme_participant_record_revision_note_check CHECK (((note = btrim(note)) AND ((length(note) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(note) <= 500)) AND ((note ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (note !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'::text)));

ALTER TABLE customer_private.programme_places_revision DROP CONSTRAINT programme_places_revision_reason_check;
ALTER TABLE customer_private.programme_places_revision ADD CONSTRAINT programme_places_revision_reason_check CHECK (((reason = btrim(reason)) AND ((length(reason) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(reason) <= 300)) AND ((reason ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (reason !~ '[[:cntrl:]]'::text)));

ALTER TABLE customer_private.programme_registration DROP CONSTRAINT programme_registration_display_label_check;
ALTER TABLE customer_private.programme_registration ADD CONSTRAINT programme_registration_display_label_check CHECK ((((display_label ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND ((length(display_label) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(display_label) <= 120)) AND (display_label = btrim(display_label)) AND (display_label !~ '[[:cntrl:]]'::text)));

ALTER TABLE customer_private.programme_series_revision DROP CONSTRAINT programme_series_revision_description_check;
ALTER TABLE customer_private.programme_series_revision ADD CONSTRAINT programme_series_revision_description_check CHECK (((description = btrim(description)) AND ((length(description) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(description) <= 500)) AND ((description ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (description !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'::text)));

ALTER TABLE customer_private.programme_series_revision DROP CONSTRAINT programme_series_revision_name_check;
ALTER TABLE customer_private.programme_series_revision ADD CONSTRAINT programme_series_revision_name_check CHECK (((name = btrim(name)) AND ((length(name) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(name) <= 120)) AND ((name ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (name !~ '[[:cntrl:]]'::text)));

ALTER TABLE customer_private.programme_task_revision DROP CONSTRAINT programme_task_revision_assignee_label_check;
ALTER TABLE customer_private.programme_task_revision ADD CONSTRAINT programme_task_revision_assignee_label_check CHECK (((assignee_label = btrim(assignee_label)) AND ((length(assignee_label) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(assignee_label) <= 120)) AND ((assignee_label ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (assignee_label !~ '[[:cntrl:]]'::text)));

ALTER TABLE customer_private.programme_task_revision DROP CONSTRAINT programme_task_revision_detail_check;
ALTER TABLE customer_private.programme_task_revision ADD CONSTRAINT programme_task_revision_detail_check CHECK (((detail = btrim(detail)) AND ((length(detail) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(detail) <= 1000)) AND ((detail ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (detail !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'::text)));

ALTER TABLE customer_private.programme_task_revision DROP CONSTRAINT programme_task_revision_title_check;
ALTER TABLE customer_private.programme_task_revision ADD CONSTRAINT programme_task_revision_title_check CHECK (((title = btrim(title)) AND ((length(title) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(title) <= 160)) AND ((title ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (title !~ '[[:cntrl:]]'::text)));

ALTER TABLE customer_private.programme_template_revision DROP CONSTRAINT programme_template_revision_description_check;
ALTER TABLE customer_private.programme_template_revision ADD CONSTRAINT programme_template_revision_description_check CHECK (((description = btrim(description)) AND ((length(description) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(description) <= 500)) AND ((description ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (description !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'::text)));

ALTER TABLE customer_private.programme_template_revision DROP CONSTRAINT programme_template_revision_name_check;
ALTER TABLE customer_private.programme_template_revision ADD CONSTRAINT programme_template_revision_name_check CHECK (((name = btrim(name)) AND ((length(name) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(name) <= 120)) AND ((name ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (name !~ '[[:cntrl:]]'::text)));

ALTER TABLE customer_private.programme_terms_revision DROP CONSTRAINT programme_terms_revision_cancellation_terms_check;
ALTER TABLE customer_private.programme_terms_revision ADD CONSTRAINT programme_terms_revision_cancellation_terms_check CHECK (((cancellation_terms = btrim(cancellation_terms)) AND ((length(cancellation_terms) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(cancellation_terms) <= 1000)) AND ((cancellation_terms ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (cancellation_terms !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'::text)));

ALTER TABLE customer_private.programme_terms_revision DROP CONSTRAINT programme_terms_revision_change_terms_check;
ALTER TABLE customer_private.programme_terms_revision ADD CONSTRAINT programme_terms_revision_change_terms_check CHECK (((change_terms = btrim(change_terms)) AND ((length(change_terms) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(change_terms) <= 1000)) AND ((change_terms ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (change_terms !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'::text)));

ALTER TABLE customer_private.programme_terms_revision DROP CONSTRAINT programme_terms_revision_excluded_check;
ALTER TABLE customer_private.programme_terms_revision ADD CONSTRAINT programme_terms_revision_excluded_check CHECK (((excluded = btrim(excluded)) AND ((length(excluded) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(excluded) <= 1000)) AND ((excluded ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (excluded !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'::text)));

ALTER TABLE customer_private.programme_terms_revision DROP CONSTRAINT programme_terms_revision_fee_note_check;
ALTER TABLE customer_private.programme_terms_revision ADD CONSTRAINT programme_terms_revision_fee_note_check CHECK (((fee_note = btrim(fee_note)) AND ((length(fee_note) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(fee_note) <= 500)) AND ((fee_note ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (fee_note !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'::text)));

ALTER TABLE customer_private.programme_terms_revision DROP CONSTRAINT programme_terms_revision_included_check;
ALTER TABLE customer_private.programme_terms_revision ADD CONSTRAINT programme_terms_revision_included_check CHECK (((included = btrim(included)) AND ((length(included) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(included) <= 1000)) AND ((included ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (included !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'::text)));

ALTER TABLE customer_private.programme_terms_revision DROP CONSTRAINT programme_terms_revision_reason_check;
ALTER TABLE customer_private.programme_terms_revision ADD CONSTRAINT programme_terms_revision_reason_check CHECK (((reason = btrim(reason)) AND ((length(reason) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(reason) <= 300)) AND ((reason ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (reason !~ '[[:cntrl:]]'::text)));

ALTER TABLE customer_private.service_catalogue_version DROP CONSTRAINT service_catalogue_version_synthetic_check;
ALTER TABLE customer_private.service_catalogue_version ADD CONSTRAINT service_catalogue_version_synthetic_check CHECK (synthetic OR source='SEED' OR app.real_use_allowed(staff_tenant_id));

ALTER TABLE customer_private.service_quote DROP CONSTRAINT service_quote_synthetic_check;
ALTER TABLE customer_private.service_quote ADD CONSTRAINT service_quote_synthetic_check CHECK (synthetic=customer_private.service_request_synthetic(request_id));

ALTER TABLE customer_private.workspace_invitation DROP CONSTRAINT workspace_invitation_label_check;
ALTER TABLE customer_private.workspace_invitation ADD CONSTRAINT workspace_invitation_label_check CHECK (((label = btrim(label)) AND ((length(label) >= CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND (length(label) <= 120)) AND ((label ~~ 'Synthetic %'::text OR NOT customer_private.synthetic_context())) AND (label !~ '[[:cntrl:]]'::text)));

ALTER TABLE customer_private.service_catalogue_version ALTER COLUMN synthetic SET DEFAULT customer_private.synthetic_context();

ALTER TABLE customer_private.service_quote ALTER COLUMN synthetic SET DEFAULT customer_private.synthetic_context();

INSERT INTO customer_private.service_catalogue_version(service_key,version,title,summary,included,excluded,regions,quote_basis,active,synthetic,source) VALUES
('managed-sourcing',1,'Sourcing mission','Describe a sourcing or machinery need so Corridra can review the fit and propose a scope.',ARRAY['Review the buying requirement','Agree the work and next steps'],ARRAY['Unagreed travel and third-party costs','Guaranteed supplier quality or commercial results'],ARRAY['Scope agreed per request'],'fixed_scope',true,false,'SEED'),
('managed-market-access',1,'Market access mission','Describe a buyer, partner or market-entry objective for review and a proposed scope.',ARRAY['Review the commercial objective','Agree the work and next steps'],ARRAY['Guaranteed introductions or orders','Unagreed third-party costs'],ARRAY['Scope agreed per request'],'fixed_scope',true,false,'SEED'),
('managed-delegation',1,'Delegation programme','Describe a group programme and participant objectives for review and a proposed scope.',ARRAY['Review the programme objectives','Agree coordination responsibilities and next steps'],ARRAY['Unagreed participant travel costs','Guaranteed meetings or commercial results'],ARRAY['Scope agreed per request'],'fixed_scope',true,false,'SEED');
