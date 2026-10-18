CREATE TABLE app.customer_delivery_assignment (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,request_id uuid NOT NULL REFERENCES customer_private.owned_request(id),
 link_id uuid NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,link_id),FOREIGN KEY(tenant_id,link_id) REFERENCES app.delivery_link(tenant_id,id)
);
CREATE FUNCTION app.customer_delivery_scope(t uuid,selected_request uuid,selected_link uuid,publisher uuid) RETURNS boolean
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app.delivery_link;
BEGIN
 SELECT link.* INTO l FROM app.delivery_link link
 JOIN app.delivery_publication pub ON pub.tenant_id=link.tenant_id AND pub.id=link.publication_ids[1] AND pub.created_by=publisher
 JOIN customer_private.owned_request req ON req.mission_tenant_id=pub.tenant_id AND req.mission_id=pub.mission_id AND req.id=selected_request
 JOIN customer_private.principal cp ON cp.id=req.principal_id AND cp.disabled_at IS NULL
 JOIN customer_private.configuration config ON config.issuer=cp.issuer AND config.synthetic
 JOIN customer_private.request_admission admission ON admission.principal_id=cp.id AND admission.disabled_at IS NULL
 JOIN app.mission_intake intake ON intake.tenant_id=req.mission_tenant_id AND intake.id=req.mission_id AND intake.retention_until>clock_timestamp()
 WHERE link.tenant_id=t AND link.id=selected_link AND link.created_by=publisher AND link.audience='CLIENT_PROGRESS'
 AND link.programme_id IS NULL AND cardinality(link.publication_ids)=1 AND NOT link.allow_export AND NOT link.include_delegation
 AND link.expires_at>clock_timestamp() AND NOT EXISTS(SELECT FROM customer_private.request_revocation rev WHERE rev.request_id=req.id);
 IF NOT FOUND THEN RETURN false; END IF;
 l:=app.delivery_authorized(l.token_hash,'CLIENT_PROGRESS');
 RETURN l.expires_at>clock_timestamp();
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION app.customer_delivery_scope(uuid,uuid,uuid,uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE FUNCTION app.assert_customer_delivery(disclosure app.customer_delivery_assignment) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF disclosure.created_by IS DISTINCT FROM app.actor_id() OR NOT coalesce(app.can_access(disclosure.tenant_id,'INTERNAL','synthetic_validation'),false)
 OR coalesce(app.member_role(disclosure.tenant_id),'') NOT IN ('owner','admin') OR NOT app.fresh_mfa()
 OR NOT EXISTS(SELECT FROM app.tenant WHERE id=disclosure.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Account delivery requires owner/admin and fresh MFA' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM identity.session s JOIN identity.assurance a ON a.session_id=s.id JOIN identity.principal p ON p.identity_id=s."userId"
 JOIN identity."user" u ON u.id=p.identity_id JOIN app.membership m ON m.user_id=p.id AND m.tenant_id=disclosure.tenant_id
 WHERE p.id=disclosure.created_by AND p.disabled_at IS NULL AND u."twoFactorEnabled" AND m.revoked_at IS NULL AND m.role IN ('owner','admin')
 AND p.operating_country=ANY(m.allowed_countries) AND current_setting('corridra.purpose',true)=ANY(m.allowed_purposes)
 AND encode(sha256(convert_to(s.token,'UTF8')),'hex')=current_setting('corridra.session_hash',true)
 AND s."expiresAt">clock_timestamp() AND s."createdAt">clock_timestamp()-interval '24 hours' AND a.verified_at>clock_timestamp()-interval '5 minutes'
 FOR SHARE OF s,a,p,u,m;
 IF NOT FOUND OR NOT app.customer_delivery_scope(disclosure.tenant_id,disclosure.request_id,disclosure.link_id,disclosure.created_by) THEN RAISE EXCEPTION 'Original request or reviewed report unavailable' USING ERRCODE='42501';END IF;
END $$;
REVOKE ALL ON FUNCTION app.assert_customer_delivery(app.customer_delivery_assignment) FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE FUNCTION app.guard_customer_delivery() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.delivery.link:'||NEW.tenant_id::text||':'||NEW.link_id::text,0));
 IF NEW.created_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'Original assignment timestamp required' USING ERRCODE='23514';END IF;
 PERFORM app.assert_customer_delivery(NEW);RETURN NEW;
END $$;
CREATE FUNCTION app.finish_customer_delivery() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM app.assert_customer_delivery(NEW);RETURN NEW;END $$;
REVOKE ALL ON FUNCTION app.guard_customer_delivery(),app.finish_customer_delivery() FROM PUBLIC,corridra_runtime,corridra_auth;
ALTER TABLE app.customer_delivery_assignment ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON app.customer_delivery_assignment FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND app.member_role(tenant_id) IN ('owner','admin'));
CREATE POLICY add ON app.customer_delivery_assignment FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND created_by=app.actor_id() AND app.member_role(tenant_id) IN ('owner','admin'));
GRANT SELECT,INSERT ON app.customer_delivery_assignment TO corridra_runtime;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.customer_delivery_assignment FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER guard BEFORE INSERT ON app.customer_delivery_assignment FOR EACH ROW EXECUTE FUNCTION app.guard_customer_delivery();
CREATE TRIGGER event AFTER INSERT ON app.customer_delivery_assignment FOR EACH ROW EXECUTE FUNCTION app.record_change();
CREATE TRIGGER zz_freshness AFTER INSERT ON app.customer_delivery_assignment FOR EACH ROW EXECUTE FUNCTION app.finish_customer_delivery();
CREATE FUNCTION app.customer_delivery_receipt(command uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE disclosure app.customer_delivery_assignment;
BEGIN
 SELECT * INTO disclosure FROM app.customer_delivery_assignment WHERE id=command AND tenant_id=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid AND created_by=app.actor_id();
 IF NOT FOUND THEN RAISE EXCEPTION 'Account delivery unavailable' USING ERRCODE='42501';END IF;
 PERFORM app.assert_customer_delivery(disclosure);
 RETURN jsonb_build_object('id',disclosure.id);
END $$;
REVOKE ALL ON FUNCTION app.customer_delivery_receipt(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION app.customer_delivery_receipt(uuid) TO corridra_runtime;
CREATE FUNCTION app.customer_delivery_options(selected_mission uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=app.actor_id();t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;req customer_private.owned_request;links jsonb;
BEGIN
 IF actor IS NULL OR NOT coalesce(app.can_access(t,'INTERNAL','synthetic_validation'),false) OR coalesce(app.member_role(t),'') NOT IN ('owner','admin') OR NOT EXISTS(SELECT FROM app.mission WHERE tenant_id=t AND id=selected_mission) THEN RAISE EXCEPTION 'Owner/admin mission review required' USING ERRCODE='42501';END IF;
 SELECT * INTO req FROM customer_private.owned_request WHERE mission_tenant_id=t AND mission_id=selected_mission;
 IF NOT FOUND THEN RETURN jsonb_build_object('missionId',selected_mission,'request',NULL,'links','[]'::jsonb,'synthetic',true);END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'title',p.copy->>'title','expiresAt',l.expires_at,'assignmentId',a.id) ORDER BY l.created_at DESC,l.id),'[]'::jsonb) INTO links
 FROM (SELECT link.* FROM app.delivery_link link JOIN app.delivery_publication pub ON pub.tenant_id=link.tenant_id AND pub.id=link.publication_ids[1] WHERE link.tenant_id=t AND link.created_by=actor AND link.audience='CLIENT_PROGRESS' AND pub.mission_id=selected_mission AND pub.created_by=actor ORDER BY link.created_at DESC,link.id LIMIT 1000) l
 JOIN app.delivery_publication p ON p.tenant_id=l.tenant_id AND p.id=l.publication_ids[1] AND p.mission_id=selected_mission AND p.created_by=actor
 LEFT JOIN app.customer_delivery_assignment a ON a.tenant_id=l.tenant_id AND a.link_id=l.id
 WHERE app.customer_delivery_scope(t,req.id,l.id,actor);
 IF app.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('missionId',selected_mission,'request',jsonb_build_object('id',req.id,'createdAt',req.created_at),'links',links,'synthetic',true);
END $$;
REVOKE ALL ON FUNCTION app.customer_delivery_options(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION app.customer_delivery_options(uuid) TO corridra_runtime;
CREATE FUNCTION customer_private.assignment_summary(selected_assignment uuid,actor uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE assigned app.customer_delivery_assignment;req customer_private.owned_request;l app.delivery_link;title text;expires timestamptz;saved uuid;
BEGIN
 IF customer_private.request_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501';END IF;
 SELECT a.* INTO assigned FROM app.customer_delivery_assignment a JOIN customer_private.owned_request r ON r.id=a.request_id AND r.principal_id=actor WHERE a.id=selected_assignment;
 IF NOT FOUND THEN RAISE EXCEPTION 'Assigned mission unavailable' USING ERRCODE='42501';END IF;
 IF NOT app.customer_delivery_scope(assigned.tenant_id,assigned.request_id,assigned.link_id,assigned.created_by) THEN
  IF customer_private.request_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('id',assigned.id,'requestId',assigned.request_id,'available',false);
 END IF;
 SELECT * INTO req FROM customer_private.owned_request WHERE id=assigned.request_id AND principal_id=actor FOR SHARE;
 SELECT * INTO l FROM app.delivery_link WHERE tenant_id=assigned.tenant_id AND id=assigned.link_id;
 SELECT least(l.expires_at,retention_until) INTO expires FROM app.mission_intake WHERE tenant_id=req.mission_tenant_id AND id=req.mission_id;
 SELECT copy->>'title' INTO title FROM app.delivery_publication WHERE tenant_id=l.tenant_id AND id=l.publication_ids[1];
 SELECT id INTO saved FROM customer_private.saved_mission WHERE principal_id=actor AND link_tenant_id=l.tenant_id AND link_id=l.id AND removed_at IS NULL;
 IF customer_private.request_actor() IS DISTINCT FROM actor OR expires<=clock_timestamp() OR NOT app.customer_delivery_scope(assigned.tenant_id,assigned.request_id,assigned.link_id,assigned.created_by) THEN RAISE EXCEPTION 'Account delivery access expired' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('id',assigned.id,'requestId',assigned.request_id,'available',true,'title',title,'expiresAt',expires,'savedResourceId',saved);
END $$;
REVOKE ALL ON FUNCTION customer_private.assignment_summary(uuid,uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE FUNCTION customer.assigned_missions(after_id uuid DEFAULT NULL,page_size integer DEFAULT 10) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 RETURN jsonb_build_object('assignments',items,'nextAfter',CASE WHEN more THEN last_id END,'synthetic',true);
END $$;
CREATE FUNCTION customer.accept_assigned_mission(command uuid,selected_assignment uuid,acknowledged boolean) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();summary jsonb;assigned app.customer_delivery_assignment;h text;result jsonb;
BEGIN
 IF command IS NULL OR acknowledged IS DISTINCT FROM true THEN RAISE EXCEPTION 'Explicit acknowledgement required' USING ERRCODE='23514';END IF;
 summary:=customer_private.assignment_summary(selected_assignment,actor);
 IF (summary->>'available')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assigned mission unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO assigned FROM app.customer_delivery_assignment WHERE id=selected_assignment;
 SELECT token_hash INTO h FROM app.delivery_link WHERE tenant_id=assigned.tenant_id AND id=assigned.link_id;
 result:=customer.save_mission_invitation(command,h);
 summary:=customer_private.assignment_summary(selected_assignment,actor);
 IF (summary->>'available')::boolean IS DISTINCT FROM true OR customer_private.request_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Assigned mission access expired' USING ERRCODE='42501';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION customer.assigned_missions(uuid,integer),customer.accept_assigned_mission(uuid,uuid,boolean) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.assigned_missions(uuid,integer),customer.accept_assigned_mission(uuid,uuid,boolean) TO corridra_runtime;
