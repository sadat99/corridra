-- Decision cards for real workspaces (owner, 23 Nov 2026: "decision cards for real"). Until now a card answered only when
-- the publication tenant and the workspace were both sample. From this file a card also answers when BOTH are real, under
-- the same authority, row security and history rules as before. Sample behaviour is unchanged.
-- What a real card needs, on every preview, creation, list and public read, in addition to every existing check:
--  * both sides real, never a mix of a sample side and a real side;
--  * real use open for both (app.real_use_allowed), and the creator a current person of an enabled real-use issuer;
--  * the real purpose in effect for this transaction (app.delivery_purpose): a verified real customer session while
--    the owner's signed-in report switch is on, or the anonymous read while the application has set the owner's
--    public report link switch for that one transaction. The card opens no purpose of its own, so neither switch
--    can be passed by using a card instead of the report;
--  * no staff tenant set on the transaction (a customer session or the anonymous read only).
-- The creator must still be an owner or admin of the workspace on every read, as before. The shared role function
-- answers for a real workspace only inside a verified real session, and the anonymous read has no session, so for
-- that one case (a real workspace, the public link setting on, no customer session on the transaction) the same
-- role rule is written out here without the session test, as file 0002 of this module writes out its membership rule.
-- If the real-use module is not installed, a real side never answers (fail closed) and nothing else changes.
-- Additive: two new private helpers and two functions replaced with the same name, arguments, language, security mode,
-- volatility, search path and grants. No table, policy, trigger, row or event is created, changed or deleted, and no
-- stored card changes: a card still stores no decision text and still re-derives its six fields on every read.
-- The public read now reports the true kind of the card's workspace in "synthetic" instead of always true.
DO $guard$
DECLARE spec record; live text;
BEGIN
 IF to_regprocedure('customer_private.workspace_member_role_now(uuid)') IS NULL THEN
  RAISE EXCEPTION 'Decision card prerequisite function is missing: customer_private.workspace_member_role_now(uuid)';
 END IF;
 FOR spec IN SELECT * FROM (VALUES
  ('customer_private.decision_card_workspace(uuid,uuid)','6b54693a5da0ea2a36cff982ab7abf95cc110f1a0c03818e2359ae3d6e93670a'),
  ('app.read_decision_card(text)','9dab46d10e6e67f1eee200bc83537c2679d18ce92694c1a01c35f2cf892911f2')) AS e(signature,fingerprint)
 LOOP
  SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') INTO live FROM pg_proc p WHERE p.oid=to_regprocedure(spec.signature);
  IF live IS DISTINCT FROM spec.fingerprint THEN
   RAISE EXCEPTION 'Decision card prerequisite function is missing or differs: %',spec.signature;
  END IF;
 END LOOP;
END $guard$;

-- Whether a card may answer for a real publication tenant and a real workspace in this transaction. Never raises.
CREATE FUNCTION customer_private.decision_card_real_allowed(publisher uuid,workspace uuid,who uuid) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF to_regprocedure('app.real_use_allowed(uuid)') IS NULL OR to_regprocedure('app.delivery_purpose(uuid)') IS NULL
 OR to_regclass('customer_private.real_use_configuration') IS NULL THEN RETURN false; END IF;
 IF NULLIF(current_setting('corridra.tenant_id',true),'') IS NOT NULL THEN RETURN false; END IF;
 RETURN coalesce(app.real_use_allowed(publisher) AND app.real_use_allowed(workspace)
  AND app.delivery_purpose(publisher)='commercial_qualification'
  AND EXISTS(SELECT FROM customer_private.principal p JOIN customer_private.real_use_configuration c ON c.issuer=p.issuer AND c.enabled
   WHERE p.id=who AND p.disabled_at IS NULL),false);
EXCEPTION WHEN insufficient_privilege OR undefined_function OR undefined_table OR undefined_column THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION customer_private.decision_card_real_allowed(uuid,uuid,uuid) FROM PUBLIC,corridra_runtime,corridra_auth;

-- Whether this person is an owner or admin of the workspace now: the rule of customer_private.organisation_profile_role
-- (an owner or admin membership, or an invited member whose role is admin now, not removed, and not also an original
-- member), without its session test. Used only for the anonymous read of a real workspace's card.
CREATE FUNCTION customer_private.decision_card_public_writer(target uuid,actor uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT r.role='writer' FROM (
  SELECT CASE WHEN m.role IN ('owner','admin') THEN 'writer' ELSE 'reader' END
  FROM customer.membership m JOIN customer.workspace w ON w.tenant_id=m.tenant_id
  WHERE m.tenant_id=target AND m.principal_id=actor
  UNION ALL
  SELECT CASE WHEN customer_private.workspace_member_role_now(wm.id)='admin' THEN 'writer' ELSE 'reader' END
  FROM customer_private.workspace_member wm JOIN customer.workspace w ON w.tenant_id=wm.tenant_id
  WHERE wm.tenant_id=target AND wm.principal_id=actor
  AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=wm.id)
  AND NOT EXISTS(SELECT FROM customer.membership original WHERE original.tenant_id=wm.tenant_id AND original.principal_id=actor)
  ORDER BY 1 DESC LIMIT 1) r(role)),false)
$$;
REVOKE ALL ON FUNCTION customer_private.decision_card_public_writer(uuid,uuid) FROM PUBLIC,corridra_runtime,corridra_auth;

-- The workspace that may share this saved report, or NULL. Never raises. The person must hold the report, be the
-- customer who made the request it was delivered for, and be an owner or admin of the workspace that owns that
-- request now. The publication tenant and the workspace must be of the same kind: both sample (exactly as before), or
-- both real with everything customer_private.decision_card_real_allowed asks for.
CREATE OR REPLACE FUNCTION customer_private.decision_card_workspace(saved_id uuid,who uuid) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved customer_private.saved_mission;l app.delivery_link;assigned app.customer_delivery_assignment;req customer_private.owned_request;
 sample_publisher boolean;sample_workspace boolean;
BEGIN
 SELECT * INTO saved FROM customer_private.saved_mission WHERE id=saved_id AND principal_id=who AND removed_at IS NULL;
 IF NOT FOUND OR NOT EXISTS(SELECT FROM customer_private.principal WHERE id=who AND disabled_at IS NULL) THEN RETURN NULL; END IF;
 l:=app.delivery_authorized(saved.token_hash,'CLIENT_PROGRESS');
 IF l.id<>saved.link_id OR l.tenant_id<>saved.link_tenant_id OR l.programme_id IS NOT NULL OR cardinality(l.publication_ids)<>1
 OR l.allow_export OR l.include_delegation OR l.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
 SELECT t.synthetic INTO sample_publisher FROM app.tenant t WHERE t.id=l.tenant_id;
 IF sample_publisher IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO assigned FROM app.customer_delivery_assignment WHERE tenant_id=l.tenant_id AND link_id=l.id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO req FROM customer_private.owned_request WHERE id=assigned.request_id AND principal_id=who;
 IF NOT FOUND OR NOT app.customer_delivery_scope(l.tenant_id,req.id,l.id,assigned.created_by) THEN RETURN NULL; END IF;
 SELECT t.synthetic INTO sample_workspace FROM app.tenant t WHERE t.id=req.workspace_id;
 IF sample_workspace IS NULL OR sample_workspace IS DISTINCT FROM sample_publisher THEN RETURN NULL; END IF;
 IF NOT sample_publisher AND NOT customer_private.decision_card_real_allowed(l.tenant_id,req.workspace_id,who) THEN RETURN NULL; END IF;
 IF customer_private.organisation_profile_role(req.workspace_id,who) IS DISTINCT FROM 'writer' THEN
  -- Only the anonymous read of a real card gets this far: the public link setting is on and no customer session is
  -- on the transaction. The role is then read without a session, and the workspace and purpose are set for the
  -- checks that follow, exactly as the shared role function sets them when it answers.
  IF sample_publisher OR current_setting('corridra.real_report_public',true) IS DISTINCT FROM 'on'
  OR NULLIF(current_setting('corridra.customer_proof_hash',true),'') IS NOT NULL
  OR NOT customer_private.decision_card_public_writer(req.workspace_id,who) THEN RETURN NULL; END IF;
  PERFORM set_config('corridra.customer_workspace_id',req.workspace_id::text,true),
   set_config('corridra.purpose',app.tenant_processing_purpose(req.workspace_id),true);
 END IF;
 RETURN req.workspace_id;
EXCEPTION WHEN insufficient_privilege THEN RETURN NULL;
END $$;

-- The anonymous read, unchanged except for the last line: "synthetic" is the kind of the card's workspace.
CREATE OR REPLACE FUNCTION app.read_decision_card(h text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE card customer_private.decision_card;resolved jsonb;expiry timestamptz;opened timestamptz;
BEGIN
 IF h IS NULL OR h !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('state','unknown'); END IF;
 SELECT * INTO card FROM customer_private.decision_card WHERE token_hash=h;
 IF NOT FOUND OR card.expires_at<=clock_timestamp() OR EXISTS(SELECT FROM customer_private.decision_card_withdrawal WHERE card_id=card.id) THEN
  RETURN jsonb_build_object('state','unknown');
 END IF;
 resolved:=customer_private.decision_card_resolve(card.saved_mission_id,card.decision_id,card.principal_id);
 IF resolved IS NULL OR resolved->>'digest' IS DISTINCT FROM card.field_digest THEN RETURN jsonb_build_object('state','unknown'); END IF;
 expiry:=least(card.expires_at,(resolved->>'expiresAt')::timestamptz);
 opened:=clock_timestamp();
 IF expiry<=opened THEN RETURN jsonb_build_object('state','unknown'); END IF;
 BEGIN
  -- Readers of one card contend on its counter row, so this write can wait for another transaction, and the card can
  -- be withdrawn, lapse or change meanwhile. Everything is therefore checked again, with fresh statements, after the
  -- write. Any change raises inside this nested block, which undoes the count, so an unknown answer never counts.
  INSERT INTO customer_private.decision_card_open(card_id,opens,first_opened_at,last_opened_at) VALUES(card.id,1,opened,opened)
  ON CONFLICT (card_id) DO UPDATE SET opens=customer_private.decision_card_open.opens+1,
   last_opened_at=greatest(customer_private.decision_card_open.last_opened_at,excluded.last_opened_at);
  SELECT * INTO card FROM customer_private.decision_card WHERE id=card.id;
  IF EXISTS(SELECT FROM customer_private.decision_card_withdrawal WHERE card_id=card.id) THEN RAISE EXCEPTION 'Card changed while it was read' USING ERRCODE='DC001'; END IF;
  resolved:=customer_private.decision_card_resolve(card.saved_mission_id,card.decision_id,card.principal_id);
  IF resolved IS NULL OR resolved->>'digest' IS DISTINCT FROM card.field_digest THEN RAISE EXCEPTION 'Card changed while it was read' USING ERRCODE='DC001'; END IF;
  expiry:=least(card.expires_at,(resolved->>'expiresAt')::timestamptz);
  IF expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Card changed while it was read' USING ERRCODE='DC001'; END IF;
 EXCEPTION WHEN SQLSTATE 'DC001' THEN RETURN jsonb_build_object('state','unknown');
 END;
 RETURN jsonb_build_object('state','OPEN','card',resolved->'fields','expiresAt',customer_private.decision_card_iso(expiry),'synthetic',coalesce((SELECT t.synthetic FROM app.tenant t WHERE t.id=card.workspace_id),true));
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('state','unknown');
END $$;

-- The helpers are owned by whoever installs them. They call the role helper and, when they exist, three real-use
-- functions, so their owner must be able to; without that a real card stays closed.
DO $owner$
DECLARE holder text; helper text;
BEGIN
 SELECT pg_get_userbyid(p.proowner) INTO holder FROM pg_proc p WHERE p.oid='customer_private.decision_card_real_allowed(uuid,uuid,uuid)'::regprocedure;
 FOREACH helper IN ARRAY ARRAY['app.real_use_allowed(uuid)','app.delivery_purpose(uuid)','app.tenant_processing_purpose(uuid)','customer_private.workspace_member_role_now(uuid)'] LOOP
  IF to_regprocedure(helper) IS NOT NULL AND NOT has_function_privilege(holder,helper,'EXECUTE') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',helper,holder);
  END IF;
 END LOOP;
END
$owner$;
