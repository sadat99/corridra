-- ADR056. Fresh staff identity and unchanged role/country scope, with each tenant's actual purpose.
DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.my_tenants()'::regprocedure),'UTF8')),'hex')<>'11fcb4db7547cbe297a03dd9cb3fd682be30f7b6c0fc48d5e16a2be5e140ba71' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.my_tenants';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.my_tenants()
 RETURNS TABLE(id uuid, name text, role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT t.id,t.name,m.role FROM app.tenant t JOIN app.membership m ON m.tenant_id=t.id JOIN identity.principal p ON p.id=m.user_id
 WHERE m.user_id=app.actor_id() AND m.revoked_at IS NULL AND p.operating_country=ANY(m.allowed_countries)
 AND (app.tenant_processing_purpose(t.id)=ANY(m.allowed_purposes) AND (t.synthetic OR app.real_use_allowed(t.id)))
$function$
;
DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.customer_organisation_link_review(uuid)'::regprocedure),'UTF8')),'hex')<>'887a763f42ae92ef133407fe80793e72a35fa7d53c03ca349a198f9e279c1b5b' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.customer_organisation_link_review';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.customer_organisation_link_review(p_claim uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_staff uuid:=customer_private.organisation_link_staff(); c customer_private.organisation_link_claim; r customer_private.organisation_profile_revision;
 v_seq integer; v_state text; v_profile integer; v_ledger customer_private.organisation_link; v_active jsonb:='null'::jsonb; v_evidence jsonb; v_history jsonb; v_chosen jsonb:='null'::jsonb;
BEGIN
 IF p_claim IS NULL THEN RAISE EXCEPTION 'Company link request unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM customer_private.organisation_link_claim x WHERE x.id=p_claim AND app.tenant_is_synthetic(x.tenant_id)=customer_private.synthetic_context();
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
END $function$
;
