-- Read-only navigation over already approved commercial scopes. No company copy.
CREATE FUNCTION customer.company_portfolio(after_id uuid DEFAULT NULL,page_size integer DEFAULT 5) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 RETURN jsonb_build_object('companies',items,'nextAfter',next_id,'scopesRead',processed,'unavailableScopes',unavailable,'expiresAt',minimum_expiry,'synthetic',true);
END $$;
REVOKE ALL ON FUNCTION customer.company_portfolio(uuid,integer) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.company_portfolio(uuid,integer) TO corridra_runtime;
