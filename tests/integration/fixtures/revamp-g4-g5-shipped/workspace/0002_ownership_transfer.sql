-- CRUD G4: a workspace owner can hand ownership to an active member of the workspace. This amends the rule that the
-- original owner's grant is immutable in exactly one case. Owner decision recorded by the guardian: the only change the
-- database accepts to customer.membership is owner to admin for the previous owner, in the same transaction that wrote the
-- ownership history row naming that person and made the named member the owner. Nothing else may change and nothing may
-- be deleted. At every commit a workspace has exactly one owner; a deferred check refuses a commit with none or two.
-- The new owner gets an owner row, the former owner becomes an admin (and cannot be removed by the new owner), and no
-- email or notice is sent. Offers hold seven days, name one member, and only that member can accept.
DO $guard$ BEGIN
 IF to_regclass('customer_private.workspace_transfer_offer') IS NULL
 OR to_regclass('customer_private.workspace_ownership_history') IS NULL
 OR to_regclass('customer_private.workspace_lifecycle_request') IS NULL
 OR to_regprocedure('customer_private.workspace_current(uuid)') IS NULL
 OR to_regprocedure('customer_private.workspace_command_uuid(jsonb)') IS NULL
 OR to_regprocedure('customer_private.lock_workspace_access(uuid,uuid)') IS NULL
 OR to_regprocedure('customer_private.workspace_access_event(uuid,uuid,uuid,text,jsonb)') IS NULL
 OR to_regclass('customer.membership') IS NULL
 THEN RAISE EXCEPTION 'Ownership transfer prerequisites are missing'; END IF;
END $guard$;

-- Replaces membership_immutable. A delete is always refused. An update is accepted only as described above, and any other
-- change is refused with the same words as before.
CREATE FUNCTION customer_private.membership_guard() RETURNS trigger
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.role='owner' AND NEW.role='admin'
  AND (NEW.tenant_id,NEW.principal_id,NEW.created_at)=(OLD.tenant_id,OLD.principal_id,OLD.created_at)
  AND EXISTS(SELECT FROM customer_private.workspace_ownership_history h
   JOIN customer.membership successor ON successor.tenant_id=h.tenant_id AND successor.principal_id=h.to_principal_id
   WHERE h.tenant_id=OLD.tenant_id AND h.from_principal_id=OLD.principal_id AND h.occurred_at=transaction_timestamp()
   AND successor.role='owner' AND successor.created_at=transaction_timestamp())
  THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Immutable record; append a new record' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION customer_private.membership_guard() FROM PUBLIC,corridra_runtime,corridra_auth;
DROP TRIGGER membership_immutable ON customer.membership;
CREATE TRIGGER membership_guard BEFORE UPDATE OR DELETE ON customer.membership FOR EACH ROW EXECUTE FUNCTION customer_private.membership_guard();

-- Exactly one owner when a transaction commits. A workspace with no owner row, or with two, cannot be committed.
CREATE FUNCTION customer_private.workspace_one_owner() RETURNS trigger
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF (SELECT count(*) FROM customer.membership m WHERE m.tenant_id=NEW.tenant_id AND m.role='owner')<>1 THEN
  RAISE EXCEPTION 'A workspace has exactly one owner' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION customer_private.workspace_one_owner() FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE CONSTRAINT TRIGGER membership_one_owner AFTER INSERT OR UPDATE ON customer.membership
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_private.workspace_one_owner();
CREATE CONSTRAINT TRIGGER workspace_one_owner AFTER INSERT ON customer.workspace
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_private.workspace_one_owner();

-- Offer, cancel, accept and decline. One command id per decision (a repeat answers with the first result; the same id for
-- anything else is refused), and every denial happens before the first write. Cancel and decline work while the control is
-- paused. An offer that is not open (cancelled, declined, accepted or expired) is the same refusal to everyone.
CREATE FUNCTION customer.workspace_ownership_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;target uuid;previous customer_private.workspace_lifecycle_request%ROWTYPE;cur record;allowed text[];
 offer customer_private.workspace_transfer_offer%ROWTYPE;member customer_private.workspace_member%ROWTYPE;offer_id uuid;
 result jsonb;kind text;open_offer boolean;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF input IS NULL OR jsonb_typeof(input)<>'object' OR operation IS NULL OR operation NOT IN ('offer','cancel','accept','decline') THEN
  RAISE EXCEPTION 'Invalid ownership command' USING ERRCODE='22023';
 END IF;
 allowed:=CASE operation WHEN 'offer' THEN ARRAY['workspaceId','memberId','confirmName','expectedVersion']
  WHEN 'cancel' THEN ARRAY['workspaceId','offerId'] ELSE ARRAY['offerId'] END;
 IF input-allowed<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid ownership command' USING ERRCODE='22023'; END IF;
 IF operation IN ('offer','cancel') THEN
  target:=customer_private.workspace_command_uuid(input->'workspaceId');
  IF target IS NULL THEN RAISE EXCEPTION 'Invalid ownership command' USING ERRCODE='22023'; END IF;
 END IF;
 IF operation IN ('cancel','accept','decline') THEN
  offer_id:=customer_private.workspace_command_uuid(input->'offerId');
  IF offer_id IS NULL THEN RAISE EXCEPTION 'Invalid ownership command' USING ERRCODE='22023'; END IF;
 END IF;
 IF operation='offer' AND (customer_private.workspace_command_uuid(input->'memberId') IS NULL
  OR jsonb_typeof(input->'confirmName') IS DISTINCT FROM 'string'
  OR jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR input->>'expectedVersion' !~ '^[0-9]{1,9}$') THEN
  RAISE EXCEPTION 'Invalid ownership command' USING ERRCODE='22023';
 END IF;
 -- Accept and decline name only the offer, so the workspace comes from it. An unknown offer reads like one that is not yours.
 IF operation IN ('accept','decline') THEN
  SELECT * INTO offer FROM customer_private.workspace_transfer_offer o WHERE o.id=offer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer offer unavailable' USING ERRCODE='42501'; END IF;
  target:=offer.tenant_id;
 END IF;
 -- The person who accepts takes the account lifecycle lock first, so a close of that account and this acceptance run in turn.
 IF operation='accept' THEN PERFORM customer_private.lock_person_lifecycle(customer.actor_id()); END IF;
 actor:=customer_private.lock_workspace_access(command,target);
 SELECT * INTO previous FROM customer_private.workspace_lifecycle_request q WHERE q.actor_id=actor AND q.command_id=command;
 IF FOUND THEN
  IF previous.operation<>operation OR previous.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN previous.result;
 END IF;
 IF operation IN ('offer','cancel') THEN
  IF NOT EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=target AND m.principal_id=actor AND m.role='owner') THEN
   RAISE EXCEPTION 'Workspace owner required' USING ERRCODE='42501';
  END IF;
 END IF;
 IF operation IN ('cancel','accept','decline') THEN
  SELECT * INTO offer FROM customer_private.workspace_transfer_offer o WHERE o.id=offer_id AND o.tenant_id=target;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer offer unavailable' USING ERRCODE='42501'; END IF;
  open_offer:=offer.expires_at>clock_timestamp() AND NOT EXISTS(SELECT FROM customer_private.workspace_transfer_outcome x WHERE x.offer_id=offer.id);
 END IF;

 IF operation='offer' THEN
  IF NOT customer_private.workspace_lifecycle_open() THEN RAISE EXCEPTION 'Workspace changes are not available yet' USING ERRCODE='0A000'; END IF;
  SELECT * INTO cur FROM customer_private.workspace_current(target);
  IF cur.version<>(input->>'expectedVersion')::integer THEN
   RETURN jsonb_build_object('stale',true,'workspaceId',target,'currentVersion',cur.version,'currentName',cur.name,'archived',cur.archived);
  END IF;
  IF input->>'confirmName' IS DISTINCT FROM cur.name THEN RAISE EXCEPTION 'Type the workspace name to confirm' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT FROM customer_private.personal_workspace p WHERE p.workspace_id=target) THEN
   RAISE EXCEPTION 'A personal workspace belongs to one person. Archive it instead' USING ERRCODE='23514';
  END IF;
  SELECT * INTO member FROM customer_private.workspace_member m WHERE m.id=customer_private.workspace_command_uuid(input->'memberId') AND m.tenant_id=target;
  IF NOT FOUND OR member.principal_id=actor
   OR EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=member.id)
   OR EXISTS(SELECT FROM customer_private.principal p WHERE p.id=member.principal_id AND p.disabled_at IS NOT NULL)
   OR EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=target AND m.principal_id=member.principal_id) THEN
   RAISE EXCEPTION 'Membership unavailable' USING ERRCODE='42501';
  END IF;
  IF customer_private.closed_person(member.principal_id) THEN RAISE EXCEPTION 'That account is closed' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT FROM customer_private.workspace_transfer_offer o WHERE o.tenant_id=target AND o.expires_at>clock_timestamp()
   AND NOT EXISTS(SELECT FROM customer_private.workspace_transfer_outcome x WHERE x.offer_id=o.id)) THEN
   RAISE EXCEPTION 'An ownership offer is already open. Cancel it first' USING ERRCODE='23514';
  END IF;
  INSERT INTO customer_private.workspace_transfer_offer(tenant_id,from_principal_id,to_member_id,to_principal_id,command_id,expires_at)
  VALUES(target,actor,member.id,member.principal_id,command,clock_timestamp()+interval '7 days') RETURNING * INTO offer;
  result:=jsonb_build_object('workspaceId',target,'offerId',offer.id,'toMemberId',offer.to_member_id,'expiresAt',offer.expires_at,'operation','offer');
  kind:='customer.workspace.ownership.offered';

 ELSIF operation='cancel' THEN
  IF NOT open_offer THEN RAISE EXCEPTION 'Offer is no longer open' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.workspace_transfer_outcome(offer_id,state,actor_id,command_id) VALUES(offer.id,'cancelled',actor,command);
  result:=jsonb_build_object('workspaceId',target,'offerId',offer.id,'operation','cancel','status','cancelled');
  kind:='customer.workspace.ownership.cancelled';

 ELSIF operation='decline' THEN
  IF offer.to_principal_id<>actor OR NOT open_offer THEN RAISE EXCEPTION 'Transfer offer unavailable' USING ERRCODE='42501'; END IF;
  INSERT INTO customer_private.workspace_transfer_outcome(offer_id,state,actor_id,command_id) VALUES(offer.id,'declined',actor,command);
  result:=jsonb_build_object('workspaceId',target,'offerId',offer.id,'operation','decline','status','declined');
  kind:='customer.workspace.ownership.declined';

 ELSE
  IF offer.to_principal_id<>actor OR NOT open_offer THEN RAISE EXCEPTION 'Transfer offer unavailable' USING ERRCODE='42501'; END IF;
  IF NOT customer_private.workspace_lifecycle_open() THEN RAISE EXCEPTION 'Workspace changes are not available yet' USING ERRCODE='0A000'; END IF;
  IF customer_private.closed_person(actor) THEN RAISE EXCEPTION 'That account is closed' USING ERRCODE='23514'; END IF;
  -- Still true inside the lock: the named person is an active member and the person who offered is still the owner.
  IF NOT EXISTS(SELECT FROM customer_private.workspace_member m WHERE m.id=offer.to_member_id AND m.tenant_id=target AND m.principal_id=actor
    AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=m.id))
   OR NOT EXISTS(SELECT FROM customer_private.principal p WHERE p.id=actor AND p.disabled_at IS NULL)
   OR NOT EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=target AND m.principal_id=offer.from_principal_id AND m.role='owner')
   OR EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=target AND m.principal_id=actor) THEN
   RAISE EXCEPTION 'Transfer offer unavailable' USING ERRCODE='42501';
  END IF;
  -- The history row and the new owner come first: they are what lets the former owner's row change to admin.
  INSERT INTO customer_private.workspace_ownership_history(tenant_id,from_principal_id,to_principal_id,offer_id,command_id)
  VALUES(target,offer.from_principal_id,actor,offer.id,command);
  INSERT INTO customer.membership(tenant_id,principal_id,role) VALUES(target,actor,'owner');
  UPDATE customer.membership SET role='admin' WHERE tenant_id=target AND principal_id=offer.from_principal_id AND role='owner';
  INSERT INTO customer_private.workspace_transfer_outcome(offer_id,state,actor_id,command_id) VALUES(offer.id,'accepted',actor,command);
  result:=jsonb_build_object('workspaceId',target,'offerId',offer.id,'operation','accept','status','accepted');
  kind:='customer.workspace.ownership.transferred';
 END IF;
 PERFORM customer_private.workspace_access_event(target,actor,command,kind,jsonb_build_object('workspaceId',target,'offerId',offer.id));
 INSERT INTO customer_private.workspace_lifecycle_request(actor_id,command_id,operation,request,result) VALUES(actor,command,operation,input,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION customer.workspace_ownership_command(uuid,text,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.workspace_ownership_command(uuid,text,jsonb) TO corridra_runtime;
