-- Real customers could not save or open a shared commercial report. A customer session carries no tenant, so the purpose
-- used to re-check the staff member who created the share resolved to the sample purpose, and a real staff member holds
-- only the real purpose. app.delivery_purpose gives the real purpose to a verified real customer session reading a
-- non-sample tenant's share, and leaves every other session exactly as before (staff and public views set a tenant;
-- sample sessions keep the sample purpose; a real session never reaches a sample tenant's share).
-- Three functions change only in the purpose they pass to app.delivery_subject_access.
CREATE FUNCTION app.delivery_purpose(t uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN NULLIF(current_setting('corridra.tenant_id',true),'') IS NULL AND customer_private.real_session() AND app.tenant_is_synthetic(t)=false THEN 'commercial_qualification'
 ELSE app.tenant_processing_purpose(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid) END
$$;
REVOKE ALL ON FUNCTION app.delivery_purpose(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.delivery_authorized(text,text)'::regprocedure),'UTF8')),'hex')<>'b82a85ed68f30607e589604c4549b07e96c57331dbe08ad29bf638441e8e3299' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.delivery_authorized'; END IF; END $guard$;

CREATE OR REPLACE FUNCTION app.delivery_authorized(h text, audience text)
 RETURNS app.delivery_link
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE l app.delivery_link;pid uuid;
BEGIN
 SELECT * INTO l FROM app.delivery_link WHERE token_hash=h AND delivery_link.audience=delivery_authorized.audience AND expires_at>now();
 IF l.id IS NULL OR NOT app.delivery_subject_access(l.tenant_id,l.created_by,'INTERNAL',app.delivery_purpose(l.tenant_id)) OR EXISTS(SELECT FROM app.delivery_revocation WHERE tenant_id=l.tenant_id AND link_id=l.id) THEN RAISE EXCEPTION 'Link unavailable or expired' USING ERRCODE='42501'; END IF;
 FOREACH pid IN ARRAY l.publication_ids LOOP IF NOT app.delivery_publication_valid(pid) THEN RAISE EXCEPTION 'Published scope unavailable' USING ERRCODE='42501'; END IF; END LOOP;
 RETURN l;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.delivery_publication_valid(uuid)'::regprocedure),'UTF8')),'hex')<>'b6becb90c06921689209684f59a9b26a053ca4d4bc796e8c1d926edfaea3ee5d' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.delivery_publication_valid'; END IF; END $guard$;

CREATE OR REPLACE FUNCTION app.delivery_publication_valid(pid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT FROM app.delivery_publication p JOIN app.mission_intake i ON i.tenant_id=p.tenant_id AND i.id=p.mission_id
 WHERE p.id=pid AND i.retention_until>now() AND app.delivery_subject_access(p.tenant_id,p.created_by,'INTERNAL',app.delivery_purpose(p.tenant_id))
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

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.experience_publication_valid(app.delivery_experience_publication)'::regprocedure),'UTF8')),'hex')<>'c1ffc6d75f638801be419ca0f1f5de01a12aec25066efe9d163032a2b0dc5ab1' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.experience_publication_valid'; END IF; END $guard$;

CREATE OR REPLACE FUNCTION app.experience_publication_valid(e app.delivery_experience_publication)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE p app.delivery_publication; req app.mission_requirements;q app.mission_quotation;tid uuid; BEGIN
 SELECT * INTO p FROM app.delivery_publication WHERE tenant_id=e.tenant_id AND id=e.publication_id;
 IF p.id IS NULL OR NOT app.delivery_publication_valid(p.id) OR NOT app.delivery_subject_access(e.tenant_id,e.created_by,'INTERNAL',app.delivery_purpose(e.tenant_id)) THEN RETURN false;END IF;
 IF e.requirement_id IS NOT NULL THEN SELECT * INTO req FROM app.mission_requirements WHERE tenant_id=e.tenant_id AND id=e.requirement_id AND mission_id=p.mission_id;IF req.id IS NULL OR NOT app.experience_source_valid(e.tenant_id,req.source_id,req.claim_id,e.created_by) THEN RETURN false;END IF;END IF;
 FOREACH tid IN ARRAY e.target_ids LOOP IF NOT app.experience_target_valid(e.tenant_id,tid,p.mission_id,e.created_by) THEN RETURN false;END IF;END LOOP;
 IF EXISTS(SELECT FROM jsonb_array_elements(e.target_snapshots) v WHERE v->>'assessmentId' IS NOT NULL AND NOT app.experience_assessment_valid(e.tenant_id,(v->>'assessmentId')::uuid,e.created_by)) THEN RETURN false;END IF;
 FOREACH tid IN ARRAY e.quotation_ids LOOP SELECT * INTO q FROM app.mission_quotation WHERE tenant_id=e.tenant_id AND id=tid AND mission_id=p.mission_id AND target_id=ANY(e.target_ids) AND requirement_id=e.requirement_id;IF q.id IS NULL OR NOT app.experience_source_valid(e.tenant_id,q.source_id,q.claim_id,e.created_by) THEN RETURN false;END IF;END LOOP;
 RETURN true;
END $function$
;
