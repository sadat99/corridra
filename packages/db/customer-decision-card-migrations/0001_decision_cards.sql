-- ADR-076 item 4. The decision card: an expiring, read-only link to ONE reviewed decision of a saved report, made by
-- the owner or an admin of the workspace that owns the request, for someone without an account.
-- The card stores NO decision text. It stores ids, a digest of the exact fields the creator previewed, the SHA-256
-- of the link secret and timestamps. Every public read re-derives the six fields live from the same sources the
-- customer already reads and answers only if the digest still matches and every source check still passes.
-- Nothing existing is replaced: three new tables, new functions, no policy, no change to any grant of an old object.
-- Cards are for synthetic workspaces only; a real tenant never answers.
DO $guard$ BEGIN
 IF to_regprocedure('customer_private.saved_mission_actor()') IS NULL
 OR to_regprocedure('app.delivery_authorized(text,text)') IS NULL
 OR to_regprocedure('app.delivery_report(text,text)') IS NULL
 OR to_regprocedure('app.client_decision_valid(uuid,uuid,uuid,uuid)') IS NULL
 OR to_regprocedure('app.customer_delivery_scope(uuid,uuid,uuid,uuid)') IS NULL
 OR to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regprocedure('customer_private.organisation_profile_role(uuid,uuid)') IS NULL
 OR to_regprocedure('customer_private.workspace_access_event(uuid,uuid,uuid,text,jsonb)') IS NULL
 OR to_regclass('customer_private.saved_mission') IS NULL
 OR to_regclass('customer_private.owned_request') IS NULL
 OR to_regclass('app.customer_delivery_assignment') IS NULL
 OR to_regclass('app.delivery_decision_publication') IS NULL THEN
  RAISE EXCEPTION 'Decision card prerequisite is missing';
 END IF;
END $guard$;

-- The two limits live here and nowhere else in the database. The table also holds seven days as a hard bound.
CREATE FUNCTION customer_private.decision_card_max_active() RETURNS integer
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT 5 $$;
CREATE FUNCTION customer_private.decision_card_lifetime() RETURNS interval
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT interval '7 days' $$;
-- Times leave the database as UTC ISO text, so a digest or a screen never depends on a session time zone.
CREATE FUNCTION customer_private.decision_card_iso(t timestamptz) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT to_char(t AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;

CREATE TABLE customer_private.decision_card (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL,
 saved_mission_id uuid NOT NULL REFERENCES customer_private.saved_mission(id),
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 decision_id uuid NOT NULL,
 field_digest text NOT NULL CHECK(field_digest ~ '^[a-f0-9]{64}$'),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 UNIQUE(principal_id,command_id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '7 days')
);
CREATE INDEX decision_card_by_report ON customer_private.decision_card(saved_mission_id,created_at DESC);
CREATE TABLE customer_private.decision_card_withdrawal (
 card_id uuid PRIMARY KEY REFERENCES customer_private.decision_card(id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(principal_id,command_id)
);
-- The only visitor-derived datum: how many times and when the card was opened. No address, agent or cookie.
CREATE TABLE customer_private.decision_card_open (
 card_id uuid PRIMARY KEY REFERENCES customer_private.decision_card(id),
 opens bigint NOT NULL CHECK(opens>=1),
 first_opened_at timestamptz NOT NULL,
 last_opened_at timestamptz NOT NULL CHECK(last_opened_at>=first_opened_at)
);
CREATE FUNCTION customer_private.guard_decision_card_open() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.opens<>1 OR NEW.last_opened_at<>NEW.first_opened_at THEN RAISE EXCEPTION 'The first open counts one' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 ELSIF TG_OP='UPDATE' THEN
  IF NEW.card_id IS DISTINCT FROM OLD.card_id OR NEW.opens<>OLD.opens+1 OR NEW.first_opened_at IS DISTINCT FROM OLD.first_opened_at
   OR NEW.last_opened_at<OLD.last_opened_at THEN RAISE EXCEPTION 'An open counter only counts up by one' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'An open counter is never deleted' USING ERRCODE='23514';
END $$;
CREATE TRIGGER decision_card_immutable BEFORE UPDATE OR DELETE ON customer_private.decision_card FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER decision_card_withdrawal_immutable BEFORE UPDATE OR DELETE ON customer_private.decision_card_withdrawal FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER decision_card_open_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_private.decision_card_open FOR EACH ROW EXECUTE FUNCTION customer_private.guard_decision_card_open();
ALTER TABLE customer_private.decision_card ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.decision_card_withdrawal ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.decision_card_open ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.decision_card,customer_private.decision_card_withdrawal,customer_private.decision_card_open FROM PUBLIC,corridra_runtime,corridra_auth;

-- The workspace that may share this saved report, or NULL. Never raises. The person must hold the report, be the
-- customer who made the request it was delivered for, and be an owner or admin of the workspace that owns that
-- request now. Publication tenant and workspace must both be synthetic: this deliberately does not rely on the
-- real-use widening of the publisher test inside app.delivery_authorized.
CREATE FUNCTION customer_private.decision_card_workspace(saved_id uuid,who uuid) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved customer_private.saved_mission;l app.delivery_link;assigned app.customer_delivery_assignment;req customer_private.owned_request;
BEGIN
 SELECT * INTO saved FROM customer_private.saved_mission WHERE id=saved_id AND principal_id=who AND removed_at IS NULL;
 IF NOT FOUND OR NOT EXISTS(SELECT FROM customer_private.principal WHERE id=who AND disabled_at IS NULL) THEN RETURN NULL; END IF;
 l:=app.delivery_authorized(saved.token_hash,'CLIENT_PROGRESS');
 IF l.id<>saved.link_id OR l.tenant_id<>saved.link_tenant_id OR l.programme_id IS NOT NULL OR cardinality(l.publication_ids)<>1
 OR l.allow_export OR l.include_delegation OR l.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT FROM app.tenant WHERE id=l.tenant_id AND synthetic) THEN RETURN NULL; END IF;
 SELECT * INTO assigned FROM app.customer_delivery_assignment WHERE tenant_id=l.tenant_id AND link_id=l.id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO req FROM customer_private.owned_request WHERE id=assigned.request_id AND principal_id=who;
 IF NOT FOUND OR NOT app.customer_delivery_scope(l.tenant_id,req.id,l.id,assigned.created_by) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT FROM app.tenant WHERE id=req.workspace_id AND synthetic)
 OR customer_private.organisation_profile_role(req.workspace_id,who) IS DISTINCT FROM 'writer' THEN RETURN NULL; END IF;
 RETURN req.workspace_id;
EXCEPTION WHEN insufficient_privilege THEN RETURN NULL;
END $$;

-- The one place the six fields are made. Preview, creation, the owner's list and the public read all call it, so what
-- the owner confirms is by construction what the reader sees. Returns NULL (never raises) unless the decision is in
-- the latest approved disclosure of the report and every source behind it is still valid. The fields are the company
-- (from the reviewed shortlist), the decision, the rationale, the next action, the due date in UTC and one provenance
-- label (source kind and claim status). Nothing else of the report, quotation, contact or evidence is read out.
-- The expiry is the earlier of the link and the retention end of every source behind the decision.
CREATE FUNCTION customer_private.decision_card_resolve(saved_id uuid,chosen uuid,who uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE workspace uuid;saved customer_private.saved_mission;l app.delivery_link;approval app.delivery_decision_publication;
 selection app.mission_selection;mission jsonb;company jsonb;fields jsonb;expiry timestamptz;
BEGIN
 workspace:=customer_private.decision_card_workspace(saved_id,who);
 IF workspace IS NULL OR chosen IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO saved FROM customer_private.saved_mission WHERE id=saved_id;
 l:=app.delivery_authorized(saved.token_hash,'CLIENT_PROGRESS');
 SELECT * INTO approval FROM app.delivery_decision_publication WHERE tenant_id=l.tenant_id AND publication_id=l.publication_ids[1] ORDER BY version DESC LIMIT 1;
 IF NOT FOUND OR NOT chosen=ANY(approval.decision_ids) OR NOT app.client_decision_valid(approval.tenant_id,approval.publication_id,chosen,approval.created_by) THEN RETURN NULL; END IF;
 SELECT * INTO selection FROM app.mission_selection WHERE tenant_id=approval.tenant_id AND id=chosen;
 IF NOT FOUND THEN RETURN NULL; END IF;
 mission:=(app.delivery_report(saved.token_hash,'CLIENT_PROGRESS')->'missions'->0);
 IF mission IS NULL OR mission->>'publicationId' IS DISTINCT FROM l.publication_ids[1]::text THEN RETURN NULL; END IF;
 SELECT value INTO company FROM jsonb_array_elements(mission->'experience'->'shortlist') WHERE value->>'id'=selection.target_id::text;
 IF company IS NULL OR company->>'company' IS NULL THEN RETURN NULL; END IF;
 fields:=jsonb_build_object('company',company->>'company','decision',selection.decision,'rationale',selection.rationale,'nextAction',selection.next_action,
  'dueAt',customer_private.decision_card_iso(selection.due_at),
  'provenance',jsonb_build_object(
   'sourceKind',(SELECT kind FROM app.source_record WHERE tenant_id=selection.tenant_id AND id=selection.source_id),
   'claimStatus',(SELECT status FROM app.claim WHERE tenant_id=selection.tenant_id AND id=selection.claim_id)));
 SELECT least(l.expires_at,min(retention_until)) INTO expiry FROM app.source_record WHERE tenant_id=selection.tenant_id AND id=ANY(ARRAY[selection.source_id,
  (SELECT source_id FROM app.mission_requirements WHERE tenant_id=selection.tenant_id AND id=selection.requirement_id),
  (SELECT source_id FROM app.mission_assessment WHERE tenant_id=selection.tenant_id AND id=selection.assessment_id),
  (SELECT source_id FROM app.mission_quotation WHERE tenant_id=selection.tenant_id AND id=selection.quotation_id)]);
 IF expiry IS NULL OR expiry<=clock_timestamp() THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('fields',fields,'digest',encode(sha256(convert_to(fields::text,'UTF8')),'hex'),
  'expiresAt',customer_private.decision_card_iso(expiry),'workspaceId',workspace);
EXCEPTION WHEN insufficient_privilege THEN RETURN NULL;
END $$;

-- One card as its creator sees it. The state is live: WITHDRAWN and EXPIRED come from the record, UNAVAILABLE means
-- the sources or the creator's access no longer give the digest the card was made for (it can heal if they do again).
CREATE FUNCTION customer_private.decision_card_summary(card customer_private.decision_card) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live text;resolved jsonb;counted customer_private.decision_card_open;
BEGIN
 IF EXISTS(SELECT FROM customer_private.decision_card_withdrawal WHERE card_id=card.id) THEN live:='WITHDRAWN';
 ELSIF card.expires_at<=clock_timestamp() THEN live:='EXPIRED';
 ELSE
  resolved:=customer_private.decision_card_resolve(card.saved_mission_id,card.decision_id,card.principal_id);
  live:=CASE WHEN resolved IS NULL OR resolved->>'digest' IS DISTINCT FROM card.field_digest
   OR (resolved->>'expiresAt')::timestamptz<=clock_timestamp() THEN 'UNAVAILABLE' ELSE 'ACTIVE' END;
 END IF;
 SELECT * INTO counted FROM customer_private.decision_card_open WHERE card_id=card.id;
 RETURN jsonb_build_object('id',card.id,'decisionId',card.decision_id,'state',live,'createdAt',customer_private.decision_card_iso(card.created_at),
  'expiresAt',customer_private.decision_card_iso(card.expires_at),'opens',coalesce(counted.opens,0),
  'lastOpenedAt',customer_private.decision_card_iso(counted.last_opened_at));
END $$;

-- The creator's own cards for one saved report, newest first (at most 100 are returned), and whether they may share.
CREATE FUNCTION customer.decision_card_state(resource uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.saved_mission_actor();allowed boolean;cards jsonb;
BEGIN
 IF resource IS NULL OR NOT EXISTS(SELECT FROM customer_private.saved_mission WHERE id=resource AND principal_id=actor) THEN
  RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501';
 END IF;
 allowed:=customer_private.decision_card_workspace(resource,actor) IS NOT NULL;
 SELECT coalesce(jsonb_agg(customer_private.decision_card_summary(c) ORDER BY c.created_at DESC,c.id),'[]'::jsonb) INTO cards
 FROM (SELECT * FROM customer_private.decision_card WHERE saved_mission_id=resource AND principal_id=actor ORDER BY created_at DESC,id LIMIT 100) c;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('resourceId',resource,'canShare',allowed,'maxActive',customer_private.decision_card_max_active(),'cards',cards);
END $$;

-- Read-only. The digest and expiry returned here are what creation checks.
CREATE FUNCTION customer.decision_card_preview(resource uuid,chosen uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.saved_mission_actor();resolved jsonb;
BEGIN
 resolved:=customer_private.decision_card_resolve(resource,chosen,actor);
 IF resolved IS NULL THEN RAISE EXCEPTION 'Decision card unavailable' USING ERRCODE='42501'; END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('resourceId',resource,'decisionId',chosen,'fields',resolved->'fields','digest',resolved->>'digest',
  'expiresAt',customer_private.decision_card_iso(least(clock_timestamp()+customer_private.decision_card_lifetime(),(resolved->>'expiresAt')::timestamptz)),
  'maxActive',customer_private.decision_card_max_active());
END $$;

-- Makes one card. Two distinct conflicts, so the caller can tell them apart (both are 409, never access loss):
--   23514 DECISION_CARD_CHANGED       the digest, the shown expiry or a reused command no longer matches
--   53400 DECISION_CARD_CAP_REACHED   five cards for this report are already live
-- Access loss is 42501. The link secret never arrives: only its SHA-256, which the caller derives from the command.
-- expected_expires is the expiry the preview showed. When given, the card gets exactly that expiry (so the stored time
-- is the time the owner saw), and a card that would now end sooner than shown is refused as CHANGED.
-- The limit counts cards that are not withdrawn and not expired, including any that are momentarily UNAVAILABLE: that
-- is cheaper than resolving every card and it can only be stricter; the owner can withdraw an unavailable card.
CREATE FUNCTION customer.create_decision_card(command uuid,resource uuid,chosen uuid,expected_digest text,token_hash text,expected_expires timestamptz DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.decision_card;made customer_private.decision_card;resolved jsonb;created timestamptz;expiry timestamptz;
BEGIN
 IF command IS NULL OR resource IS NULL OR chosen IS NULL OR expected_digest IS NULL OR expected_digest !~ '^[a-f0-9]{64}$'
 OR token_hash IS NULL OR token_hash !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Decision card request required' USING ERRCODE='23514';
 END IF;
 actor:=customer_private.saved_mission_actor();
 -- One writer per customer, so a double submit sees the first card and the limit counts every card.
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.decision_card:'||actor::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM customer_private.decision_card WHERE principal_id=actor AND command_id=command;
 IF FOUND THEN
  -- An exact retry returns the card that exists, before the limit is looked at. Any other use of the command is refused.
  IF prior.saved_mission_id<>resource OR prior.decision_id<>chosen OR prior.field_digest<>expected_digest OR prior.token_hash<>token_hash THEN
   RAISE EXCEPTION 'DECISION_CARD_CHANGED' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('cardId',prior.id,'expiresAt',customer_private.decision_card_iso(prior.expires_at),
   'state',customer_private.decision_card_summary(prior)->>'state');
 END IF;
 created:=clock_timestamp();
 resolved:=customer_private.decision_card_resolve(resource,chosen,actor);
 IF resolved IS NULL THEN RAISE EXCEPTION 'Decision card unavailable' USING ERRCODE='42501'; END IF;
 IF resolved->>'digest' IS DISTINCT FROM expected_digest THEN RAISE EXCEPTION 'DECISION_CARD_CHANGED' USING ERRCODE='23514'; END IF;
 expiry:=least(created+customer_private.decision_card_lifetime(),(resolved->>'expiresAt')::timestamptz);
 IF expected_expires IS NOT NULL THEN
  IF expected_expires<=created OR expected_expires>created+customer_private.decision_card_lifetime() OR expected_expires>expiry THEN
   RAISE EXCEPTION 'DECISION_CARD_CHANGED' USING ERRCODE='23514';
  END IF;
  expiry:=expected_expires;
 END IF;
 IF (SELECT count(*) FROM customer_private.decision_card c WHERE c.saved_mission_id=resource AND c.principal_id=actor AND c.expires_at>created
  AND NOT EXISTS(SELECT FROM customer_private.decision_card_withdrawal w WHERE w.card_id=c.id))>=customer_private.decision_card_max_active() THEN
  RAISE EXCEPTION 'DECISION_CARD_CAP_REACHED' USING ERRCODE='53400';
 END IF;
 INSERT INTO customer_private.decision_card(principal_id,command_id,saved_mission_id,workspace_id,decision_id,field_digest,token_hash,created_at,expires_at)
 VALUES(actor,command,resource,(resolved->>'workspaceId')::uuid,chosen,expected_digest,token_hash,created,expiry) RETURNING * INTO made;
 -- The event names the card, report, decision and expiry. No field, digest or link secret.
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||made.workspace_id::text,0));
 PERFORM customer_private.workspace_access_event(made.workspace_id,actor,command,'customer.decision_card.created',
  jsonb_build_object('cardId',made.id,'resourceId',resource,'decisionId',chosen,'expiresAt',customer_private.decision_card_iso(expiry)));
 -- Recheck after any lock wait: access lost or content changed meanwhile rolls back the card and the event.
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 resolved:=customer_private.decision_card_resolve(resource,chosen,actor);
 IF resolved IS NULL THEN RAISE EXCEPTION 'Decision card unavailable' USING ERRCODE='42501'; END IF;
 IF resolved->>'digest' IS DISTINCT FROM expected_digest THEN RAISE EXCEPTION 'DECISION_CARD_CHANGED' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('cardId',made.id,'expiresAt',customer_private.decision_card_iso(made.expires_at),'state','ACTIVE');
END $$;

-- Only the creator can withdraw, and even after losing the admin role: retraction is always safe. Idempotent on the card.
CREATE FUNCTION customer.withdraw_decision_card(command uuid,card uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;target customer_private.decision_card;prior customer_private.decision_card_withdrawal;
BEGIN
 IF command IS NULL OR card IS NULL THEN RAISE EXCEPTION 'Decision card request required' USING ERRCODE='23514'; END IF;
 actor:=customer_private.saved_mission_actor();
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.decision_card:'||actor::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO target FROM customer_private.decision_card WHERE id=card AND principal_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Decision card unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM customer_private.decision_card_withdrawal WHERE principal_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.card_id<>card THEN RAISE EXCEPTION 'Withdrawal command conflicts' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('cardId',card,'state','WITHDRAWN');
 END IF;
 IF EXISTS(SELECT FROM customer_private.decision_card_withdrawal WHERE card_id=card) THEN RETURN jsonb_build_object('cardId',card,'state','WITHDRAWN'); END IF;
 INSERT INTO customer_private.decision_card_withdrawal(card_id,principal_id,command_id) VALUES(card,actor,command);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||target.workspace_id::text,0));
 PERFORM customer_private.workspace_access_event(target.workspace_id,actor,command,'customer.decision_card.withdrawn',
  jsonb_build_object('cardId',card,'resourceId',target.saved_mission_id,'decisionId',target.decision_id));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('cardId',card,'state','WITHDRAWN');
END $$;

-- The anonymous read. h is the SHA-256 of the link secret. Malformed, absent, withdrawn, expired, a removed report,
-- an unauthorised publisher or creator, a changed field and a real tenant all answer the same single value.
-- A successful read counts one open and writes nothing else: no event, no outbox row, nothing about the visitor.
CREATE FUNCTION app.read_decision_card(h text) RETURNS jsonb
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
 INSERT INTO customer_private.decision_card_open(card_id,opens,first_opened_at,last_opened_at) VALUES(card.id,1,opened,opened)
 ON CONFLICT (card_id) DO UPDATE SET opens=customer_private.decision_card_open.opens+1,
  last_opened_at=greatest(customer_private.decision_card_open.last_opened_at,excluded.last_opened_at);
 RETURN jsonb_build_object('state','OPEN','card',resolved->'fields','expiresAt',customer_private.decision_card_iso(expiry),'synthetic',true);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('state','unknown');
END $$;

REVOKE ALL ON FUNCTION customer_private.decision_card_max_active(),customer_private.decision_card_lifetime(),customer_private.decision_card_iso(timestamptz),
 customer_private.guard_decision_card_open(),customer_private.decision_card_workspace(uuid,uuid),customer_private.decision_card_resolve(uuid,uuid,uuid),
 customer_private.decision_card_summary(customer_private.decision_card),customer.decision_card_state(uuid),customer.decision_card_preview(uuid,uuid),
 customer.create_decision_card(uuid,uuid,uuid,text,text,timestamptz),customer.withdraw_decision_card(uuid,uuid),app.read_decision_card(text)
 FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.decision_card_state(uuid),customer.decision_card_preview(uuid,uuid),
 customer.create_decision_card(uuid,uuid,uuid,text,text,timestamptz),customer.withdraw_decision_card(uuid,uuid),app.read_decision_card(text)
 TO corridra_runtime;
