-- requires-table: customer_private.decision_card
-- ADR-087 U5, part 2: workspace owners and admins read the decision cards of current members (decision 4 and 4a). It waits, and
-- installs nothing, until the decision card module (customer-decision-card-migrations) is installed; the installer then applies it
-- on its next run of field_modules_action=member_access.
-- What this file adds, and nothing else:
--   customer.workspace_decision_cards(workspace, after, size): the cards of the workspace made by a current member other than the
--   reader, on a saved report that is not removed, leaving out every withdrawn card (the creator's own list still shows those as
--   not live; this view shows them not at all, decision 4, Protections kept). Each entry carries its state: EXPIRED, UNAVAILABLE
--   (the sources or the creator's access no longer give the card's digest) or ACTIVE, with the company and the decision.
--   customer.workspace_decision_card(workspace, card): the six fields of one ACTIVE card, read only, resolved exactly as the public
--   card read resolves them (customer_private.decision_card_resolve with the creator's authority and the stored digest). It does not
--   count an open: the open counter is for people who hold the link.
--   Both use the gate of part 1 (current owner or admin, the workspace notice delivered at least 24 hours ago) and write exactly one
--   customer.member_item.read event, ids only, through customer_private.workspace_access_event (a list with no card writes none).
-- customer.withdraw_decision_card and app.read_decision_card are untouched: only the creator withdraws, and the public read, its
-- expiry and its withdrawal are unchanged.
DO $guard$
BEGIN
 IF to_regprocedure('customer_private.member_access_reader(uuid)') IS NULL THEN
  RAISE EXCEPTION 'Member decision cards need 0001_member_access.sql first';
 END IF;
 IF to_regprocedure('customer_private.decision_card_resolve(uuid,uuid,uuid)') IS NULL
  OR to_regprocedure('customer_private.decision_card_iso(timestamptz)') IS NULL
  OR to_regclass('customer_private.decision_card_withdrawal') IS NULL THEN
  RAISE EXCEPTION 'Member decision cards need the decision card module';
 END IF;
 IF to_regprocedure('customer.workspace_decision_cards(uuid,uuid,integer)') IS NOT NULL
  OR to_regprocedure('customer.workspace_decision_card(uuid,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'Member access: a decision card object of this module already exists outside this module';
 END IF;
END
$guard$;

CREATE FUNCTION customer.workspace_decision_cards(workspace uuid,after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reader uuid:=customer_private.member_access_reader(workspace);c customer_private.decision_card;resolved jsonb;live text;
 items jsonb:='[]'::jsonb;ids jsonb:='[]'::jsonb;last_id uuid;more boolean:=false;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514'; END IF;
 FOR c IN SELECT d.* FROM customer_private.decision_card d JOIN customer_private.saved_mission s ON s.id=d.saved_mission_id
  WHERE d.workspace_id=workspace AND d.principal_id<>reader AND s.removed_at IS NULL AND (after_id IS NULL OR d.id>after_id)
   AND customer_private.workspace_member_current(workspace,d.principal_id)
   AND NOT EXISTS(SELECT FROM customer_private.decision_card_withdrawal w WHERE w.card_id=d.id)
  ORDER BY d.id LIMIT page_size+1 LOOP
  IF jsonb_array_length(ids)=page_size THEN more:=true; EXIT; END IF;
  resolved:=NULL;
  IF c.expires_at<=clock_timestamp() THEN live:='EXPIRED';
  ELSE
   resolved:=customer_private.decision_card_resolve(c.saved_mission_id,c.decision_id,c.principal_id);
   live:=CASE WHEN resolved IS NULL OR resolved->>'digest' IS DISTINCT FROM c.field_digest
    OR (resolved->>'expiresAt')::timestamptz<=clock_timestamp() THEN 'UNAVAILABLE' ELSE 'ACTIVE' END;
  END IF;
  items:=items||jsonb_build_array(jsonb_build_object('id',c.id,'resourceId',c.saved_mission_id,'decisionId',c.decision_id,'state',live,
   'createdAt',customer_private.decision_card_iso(c.created_at),'expiresAt',customer_private.decision_card_iso(c.expires_at),
   'company',CASE WHEN live='ACTIVE' THEN resolved->'fields'->>'company' END,
   'decision',CASE WHEN live='ACTIVE' THEN resolved->'fields'->>'decision' END,
   'memberLabel',customer_private.member_access_label(workspace,c.principal_id)));
  ids:=ids||jsonb_build_array(c.id);last_id:=c.id;
 END LOOP;
 IF jsonb_array_length(ids)>0 THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||workspace::text,0));
  PERFORM customer_private.workspace_access_event(workspace,reader,gen_random_uuid(),'customer.member_item.read',
   jsonb_build_object('view','card_list','cardIds',ids));
 END IF;
 IF customer.actor_id() IS DISTINCT FROM reader THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',workspace,'cards',items,'nextAfter',CASE WHEN more THEN last_id END);
END $$;

CREATE FUNCTION customer.workspace_decision_card(workspace uuid,card uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reader uuid:=customer_private.member_access_reader(workspace);c customer_private.decision_card;resolved jsonb;expiry timestamptz;
BEGIN
 SELECT d.* INTO c FROM customer_private.decision_card d JOIN customer_private.saved_mission s ON s.id=d.saved_mission_id
  WHERE d.id=card AND d.workspace_id=workspace AND d.principal_id<>reader AND s.removed_at IS NULL
   AND customer_private.workspace_member_current(workspace,d.principal_id)
   AND NOT EXISTS(SELECT FROM customer_private.decision_card_withdrawal w WHERE w.card_id=d.id);
 IF NOT FOUND OR c.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Decision card unavailable' USING ERRCODE='42501'; END IF;
 resolved:=customer_private.decision_card_resolve(c.saved_mission_id,c.decision_id,c.principal_id);
 IF resolved IS NULL OR resolved->>'digest' IS DISTINCT FROM c.field_digest THEN
  RAISE EXCEPTION 'Decision card unavailable' USING ERRCODE='42501';
 END IF;
 expiry:=least(c.expires_at,(resolved->>'expiresAt')::timestamptz);
 IF expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Decision card unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||workspace::text,0));
 PERFORM customer_private.workspace_access_event(workspace,reader,gen_random_uuid(),'customer.member_item.read',
  jsonb_build_object('view','card','cardId',card));
 -- Recheck after the lock wait: a card withdrawn meanwhile rolls back the event and answers as unavailable.
 IF customer.actor_id() IS DISTINCT FROM reader THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM customer_private.decision_card_withdrawal w WHERE w.card_id=card) OR expiry<=clock_timestamp() THEN
  RAISE EXCEPTION 'Decision card unavailable' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object('workspaceId',workspace,'cardId',card,'resourceId',c.saved_mission_id,'fields',resolved->'fields',
  'expiresAt',customer_private.decision_card_iso(expiry),'memberLabel',customer_private.member_access_label(workspace,c.principal_id));
END $$;

REVOKE ALL ON FUNCTION customer.workspace_decision_cards(uuid,uuid,integer),customer.workspace_decision_card(uuid,uuid)
 FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.workspace_decision_cards(uuid,uuid,integer),customer.workspace_decision_card(uuid,uuid) TO corridra_runtime;

DO $owner$
DECLARE holder text; helper text;
BEGIN
 SELECT pg_get_userbyid(p.proowner) INTO holder FROM pg_proc p WHERE p.oid='customer.workspace_decision_cards(uuid,uuid,integer)'::regprocedure;
 FOREACH helper IN ARRAY ARRAY['customer_private.member_access_reader(uuid)','customer_private.decision_card_resolve(uuid,uuid,uuid)',
  'customer_private.decision_card_iso(timestamptz)','customer_private.workspace_member_current(uuid,uuid)','customer_private.member_access_label(uuid,uuid)',
  'customer_private.workspace_access_event(uuid,uuid,uuid,text,jsonb)','customer.actor_id()'] LOOP
  IF NOT has_function_privilege(holder,helper,'EXECUTE') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',helper,holder);
  END IF;
 END LOOP;
END
$owner$;

DO $proof$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure::text AS sig,p.prosecdef,p.proconfig,p.proacl FROM pg_proc p
  WHERE p.oid IN ('customer.workspace_decision_cards(uuid,uuid,integer)'::regprocedure,'customer.workspace_decision_card(uuid,uuid)'::regprocedure) LOOP
  IF NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
   RAISE EXCEPTION 'Member access: % is not the definer this file defines',f.sig;
  END IF;
  IF EXISTS(SELECT FROM aclexplode(f.proacl) a WHERE a.grantee=0) OR has_function_privilege('corridra_auth',f.sig,'EXECUTE') THEN
   RAISE EXCEPTION 'Member access: only the runtime role may execute %',f.sig;
  END IF;
  IF NOT has_function_privilege('corridra_runtime',f.sig,'EXECUTE') THEN
   RAISE EXCEPTION 'Member access: the runtime role must execute %',f.sig;
  END IF;
 END LOOP;
END
$proof$;
