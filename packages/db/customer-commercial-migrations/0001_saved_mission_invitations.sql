-- Private navigation state only. Canonical delivery scope is revalidated on
-- every use; no source/company/quotation/financial content is copied here.
CREATE TABLE customer_private.saved_mission (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 link_tenant_id uuid NOT NULL,link_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),removed_at timestamptz,
 FOREIGN KEY(link_tenant_id,link_id) REFERENCES app.delivery_link(tenant_id,id)
);
CREATE UNIQUE INDEX saved_mission_active ON customer_private.saved_mission(principal_id,link_tenant_id,link_id) WHERE removed_at IS NULL;
CREATE FUNCTION customer_private.guard_saved_mission_removal() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF (to_jsonb(NEW)-'removed_at') IS DISTINCT FROM (to_jsonb(OLD)-'removed_at') OR OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL OR NEW.removed_at<OLD.created_at THEN
  RAISE EXCEPTION 'Immutable saved mission binding' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION customer_private.guard_saved_mission_removal() FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER saved_mission_remove_only BEFORE UPDATE ON customer_private.saved_mission FOR EACH ROW EXECUTE FUNCTION customer_private.guard_saved_mission_removal();
CREATE TRIGGER saved_mission_no_delete BEFORE DELETE ON customer_private.saved_mission FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TABLE customer_private.saved_mission_command (
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object'),resource_id uuid NOT NULL REFERENCES customer_private.saved_mission(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(principal_id,command_id)
);
CREATE TRIGGER saved_mission_command_immutable BEFORE UPDATE OR DELETE ON customer_private.saved_mission_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.saved_mission ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.saved_mission_command ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.saved_mission,customer_private.saved_mission_command FROM PUBLIC,corridra_runtime,corridra_auth;

CREATE FUNCTION customer_private.saved_mission_actor() RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer mission access denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM customer_private.principal WHERE id=actor AND disabled_at IS NULL FOR SHARE;
 IF NOT FOUND OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer mission access denied' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;

CREATE FUNCTION customer_private.saved_mission_summary(resource uuid,actor uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved customer_private.saved_mission;l app.delivery_link;title text;
BEGIN
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO saved FROM customer_private.saved_mission WHERE id=resource AND principal_id=actor FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501'; END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 IF saved.removed_at IS NOT NULL THEN RETURN jsonb_build_object('id',saved.id,'available',false,'removed',true); END IF;
 BEGIN
  l:=app.delivery_authorized(saved.token_hash,'CLIENT_PROGRESS');
  IF l.id<>saved.link_id OR l.tenant_id<>saved.link_tenant_id OR l.expires_at<=clock_timestamp() THEN RAISE insufficient_privilege; END IF;
  SELECT copy->>'title' INTO title FROM app.delivery_publication WHERE tenant_id=l.tenant_id AND id=l.publication_ids[1];
 EXCEPTION WHEN insufficient_privilege THEN
  IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('id',saved.id,'available',false,'removed',false);
 END;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 IF l.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('id',saved.id,'available',false,'removed',false); END IF;
 RETURN jsonb_build_object('id',saved.id,'available',true,'removed',false,'title',title,'expiresAt',l.expires_at);
END $$;

CREATE FUNCTION customer.save_mission_invitation(command uuid,h text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.saved_mission_actor();l app.delivery_link;resource uuid;prior customer_private.saved_mission_command;payload jsonb:=jsonb_build_object('action','save','digest',h);
BEGIN
 IF command IS NULL OR h IS NULL OR h !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invitation required' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.saved_mission:'||actor::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM customer_private.saved_mission_command WHERE principal_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.input IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Command conflicts' USING ERRCODE='23514'; END IF;
  RETURN customer_private.saved_mission_summary(prior.resource_id,actor);
 END IF;
 l:=app.delivery_authorized(h,'CLIENT_PROGRESS');
 IF l.programme_id IS NOT NULL OR cardinality(l.publication_ids)<>1 OR l.allow_export OR l.include_delegation OR l.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Client mission invitation required' USING ERRCODE='42501'; END IF;
 SELECT id INTO resource FROM customer_private.saved_mission WHERE principal_id=actor AND link_tenant_id=l.tenant_id AND link_id=l.id AND removed_at IS NULL FOR SHARE;
 IF NOT FOUND THEN
  IF (SELECT count(*) FROM customer_private.saved_mission WHERE principal_id=actor AND removed_at IS NULL)>=100 THEN RAISE EXCEPTION 'Saved mission limit reached' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.saved_mission(principal_id,token_hash,link_tenant_id,link_id) VALUES(actor,h,l.tenant_id,l.id) RETURNING id INTO resource;
 END IF;
 INSERT INTO customer_private.saved_mission_command(principal_id,command_id,input,resource_id) VALUES(actor,command,payload,resource);
 RETURN customer_private.saved_mission_summary(resource,actor);
END $$;

CREATE FUNCTION customer.saved_missions(after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 RETURN jsonb_build_object('missions',items,'nextAfter',next_id,'synthetic',true);
END $$;

CREATE FUNCTION customer.saved_mission_action(resource uuid,command uuid DEFAULT NULL,request_id uuid DEFAULT NULL,body text DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.saved_mission_actor();saved customer_private.saved_mission;result jsonb;l app.delivery_link;
BEGIN
 SELECT * INTO saved FROM customer_private.saved_mission WHERE id=resource AND principal_id=actor AND removed_at IS NULL FOR SHARE;
 IF NOT FOUND OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501'; END IF;
 l:=app.delivery_authorized(saved.token_hash,'CLIENT_PROGRESS');
 IF l.id<>saved.link_id OR l.tenant_id<>saved.link_tenant_id OR l.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501'; END IF;
 IF command IS NULL AND request_id IS NULL AND body IS NULL THEN result:=app.delivery_report(saved.token_hash,'CLIENT_PROGRESS');
 ELSIF command IS NOT NULL AND request_id IS NOT NULL AND body IS NOT NULL THEN result:=app.delivery_respond(saved.token_hash,command,request_id,body);
 ELSE RAISE EXCEPTION 'Invalid mission action' USING ERRCODE='23514'; END IF;
 IF customer.actor_id() IS DISTINCT FROM actor OR l.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN CASE WHEN command IS NULL THEN jsonb_build_object('resourceId',resource,'report',result) ELSE jsonb_build_object('resourceId',resource,'response',result) END;
END $$;

CREATE FUNCTION customer.remove_saved_mission(command uuid,resource uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.saved_mission_actor();saved customer_private.saved_mission;prior customer_private.saved_mission_command;payload jsonb:=jsonb_build_object('action','remove','id',resource);
BEGIN
 IF command IS NULL OR resource IS NULL THEN RAISE EXCEPTION 'Command required' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.saved_mission:'||actor::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM customer_private.saved_mission_command WHERE principal_id=actor AND command_id=command;
 IF FOUND AND prior.input IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Command conflicts' USING ERRCODE='23514'; END IF;
 SELECT * INTO saved FROM customer_private.saved_mission WHERE id=resource AND principal_id=actor FOR UPDATE;
 IF NOT FOUND OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501'; END IF;
 IF saved.removed_at IS NULL THEN UPDATE customer_private.saved_mission SET removed_at=clock_timestamp() WHERE id=saved.id; END IF;
 IF prior.command_id IS NULL THEN INSERT INTO customer_private.saved_mission_command(principal_id,command_id,input,resource_id) VALUES(actor,command,payload,resource); END IF;
 RETURN jsonb_build_object('id',resource,'removed',true);
END $$;
REVOKE ALL ON FUNCTION customer_private.saved_mission_actor(),customer_private.saved_mission_summary(uuid,uuid),customer.save_mission_invitation(uuid,text),customer.saved_missions(uuid,integer),customer.saved_mission_action(uuid,uuid,uuid,text),customer.remove_saved_mission(uuid,uuid) FROM PUBLIC,corridra_auth,corridra_runtime;
GRANT EXECUTE ON FUNCTION customer.save_mission_invitation(uuid,text),customer.saved_missions(uuid,integer),customer.saved_mission_action(uuid,uuid,uuid,text),customer.remove_saved_mission(uuid,uuid) TO corridra_runtime;
