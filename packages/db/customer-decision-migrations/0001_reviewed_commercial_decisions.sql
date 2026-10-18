CREATE TABLE app.delivery_decision_publication (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,publication_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),
 decision_ids uuid[] NOT NULL CHECK(cardinality(decision_ids)<=30),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,publication_id,version),
 FOREIGN KEY(tenant_id,publication_id) REFERENCES app.delivery_publication(tenant_id,id)
);
CREATE FUNCTION app.client_decision_valid(t uuid,pub uuid,selected_decision uuid,who uuid) RETURNS boolean
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.delivery_publication p JOIN app.delivery_experience_publication e ON e.tenant_id=p.tenant_id AND e.publication_id=p.id
 JOIN app.mission_selection d ON d.tenant_id=p.tenant_id AND d.mission_id=p.mission_id AND d.id=selected_decision
 JOIN app.mission_requirements r ON r.tenant_id=d.tenant_id AND r.id=d.requirement_id
 JOIN app.mission_assessment a ON a.tenant_id=d.tenant_id AND a.id=d.assessment_id
 WHERE p.tenant_id=t AND p.id=pub AND p.created_by=who AND app.delivery_publication_valid(p.id) AND app.experience_publication_valid(e)
 AND d.requirement_id=e.requirement_id AND d.target_id=ANY(e.target_ids) AND (d.quotation_id IS NULL OR d.quotation_id=ANY(e.quotation_ids))
 AND app.experience_source_valid(t,d.source_id,d.claim_id,who) AND app.experience_source_valid(t,r.source_id,r.claim_id,who)
 AND app.experience_source_valid(t,a.source_id,a.claim_id,who)
 AND NOT EXISTS(SELECT FROM app.source_record s WHERE s.tenant_id=t AND s.id IN (d.source_id,r.source_id,a.source_id) AND s.retention_until<=clock_timestamp())
 AND (d.quotation_id IS NULL OR EXISTS(SELECT FROM app.mission_quotation q JOIN app.source_record s ON s.tenant_id=q.tenant_id AND s.id=q.source_id WHERE q.tenant_id=t AND q.id=d.quotation_id AND q.requirement_id=d.requirement_id AND q.target_id=d.target_id AND s.retention_until>clock_timestamp() AND app.experience_source_valid(t,q.source_id,q.claim_id,who))))
$$;
REVOKE ALL ON FUNCTION app.client_decision_valid(uuid,uuid,uuid,uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE FUNCTION app.assert_decision_disclosure(disclosure app.delivery_decision_publication) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE decision uuid;
BEGIN
 IF disclosure.created_by IS DISTINCT FROM app.actor_id() OR NOT coalesce(app.can_access(disclosure.tenant_id,'INTERNAL','synthetic_validation'),false)
 OR coalesce(app.member_role(disclosure.tenant_id),'') NOT IN ('owner','admin') OR NOT app.fresh_mfa()
 OR NOT EXISTS(SELECT FROM app.tenant WHERE id=disclosure.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Decision disclosure requires owner/admin and fresh MFA' USING ERRCODE='42501'; END IF;
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
END $$;
REVOKE ALL ON FUNCTION app.assert_decision_disclosure(app.delivery_decision_publication) FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE FUNCTION app.guard_decision_disclosure() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('delivery-decision:'||NEW.tenant_id::text||':'||NEW.publication_id::text,0));
 IF NEW.created_at IS DISTINCT FROM now() OR cardinality(NEW.decision_ids)<>(SELECT count(DISTINCT id) FROM unnest(NEW.decision_ids) id)
 OR NEW.version<>coalesce((SELECT max(version) FROM app.delivery_decision_publication WHERE tenant_id=NEW.tenant_id AND publication_id=NEW.publication_id),0)+1 THEN RAISE EXCEPTION 'Sequential immutable disclosure required' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_decision_disclosure(NEW);RETURN NEW;
END $$;
CREATE FUNCTION app.finish_decision_disclosure() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM app.assert_decision_disclosure(NEW);RETURN NEW;END $$;
REVOKE ALL ON FUNCTION app.guard_decision_disclosure(),app.finish_decision_disclosure() FROM PUBLIC,corridra_runtime,corridra_auth;
ALTER TABLE app.delivery_decision_publication ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON app.delivery_decision_publication FOR SELECT TO corridra_runtime
 USING(app.can_access(tenant_id,'INTERNAL','synthetic_validation'));
CREATE POLICY add ON app.delivery_decision_publication FOR INSERT TO corridra_runtime
 WITH CHECK(app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND created_by=app.actor_id() AND app.member_role(tenant_id) IN ('owner','admin'));
GRANT SELECT,INSERT ON app.delivery_decision_publication TO corridra_runtime;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.delivery_decision_publication FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER guard BEFORE INSERT ON app.delivery_decision_publication FOR EACH ROW EXECUTE FUNCTION app.guard_decision_disclosure();
CREATE TRIGGER event AFTER INSERT ON app.delivery_decision_publication FOR EACH ROW EXECUTE FUNCTION app.record_change();
CREATE TRIGGER zz_freshness AFTER INSERT ON app.delivery_decision_publication FOR EACH ROW EXECUTE FUNCTION app.finish_decision_disclosure();
CREATE FUNCTION app.decision_disclosure_receipt(command uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE disclosure app.delivery_decision_publication;
BEGIN
 SELECT * INTO disclosure FROM app.delivery_decision_publication WHERE id=command AND tenant_id=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid AND created_by=app.actor_id();
 IF NOT FOUND THEN RAISE EXCEPTION 'Decision disclosure unavailable' USING ERRCODE='42501'; END IF;
 PERFORM app.assert_decision_disclosure(disclosure);
 RETURN jsonb_build_object('id',disclosure.id,'version',disclosure.version);
END $$;
REVOKE ALL ON FUNCTION app.decision_disclosure_receipt(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION app.decision_disclosure_receipt(uuid) TO corridra_runtime;
CREATE FUNCTION customer.saved_mission_decisions(resource uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
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
  RETURN jsonb_build_object('resourceId',resource,'state','NOT_APPROVED','decisions','[]'::jsonb,'synthetic',true);
 END IF;
 expiry:=(document->>'expiresAt')::timestamptz;
 FOREACH sid IN ARRAY approval.decision_ids LOOP
  IF NOT app.client_decision_valid(approval.tenant_id,approval.publication_id,sid,approval.created_by) THEN
   IF customer.actor_id() IS DISTINCT FROM actor OR (customer.saved_mission_action(resource)->'report') IS DISTINCT FROM document THEN RAISE EXCEPTION 'Customer access expired or changed' USING ERRCODE='42501'; END IF;
   RETURN jsonb_build_object('resourceId',resource,'state','SOURCE_UNAVAILABLE','decisions','[]'::jsonb,'synthetic',true);
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
 RETURN jsonb_build_object('resourceId',resource,'state','APPROVED','version',approval.version,'decisions',items,'expiresAt',expiry,'synthetic',true);
END $$;
REVOKE ALL ON FUNCTION customer.saved_mission_decisions(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.saved_mission_decisions(uuid) TO corridra_runtime;
