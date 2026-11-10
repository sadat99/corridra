-- CRUD G11 (ADR-017 amendment, 10 November 2026): withdraw, correct and hide private contacts and notes.
-- Optional module: installing it changes nothing anyone can see, because its control starts closed and only an offline
-- schema-owner operation opens it.
-- Additive only: no existing function, policy, constraint, grant or row is replaced or changed (no CREATE OR REPLACE).
-- Contacts and notes stay Record class. A withdrawal or correction is a new row that names the exact version the person
-- saw; a correction also adds a normal new contact or note row through the existing reviewed guard. Hiding is a new row
-- that covers a whole chain (the first version and every correction of it). Stored text is never changed, so the opt-out
-- hash recomputed from the stored address keeps suppressing. Hidden is not deleted: the original bytes stay in the base
-- rows, in backups and inside request hashes.
-- The two state views are the only runtime readers of contact and note text. For a hidden chain they return NULL for the
-- name, job title, email, body and change reason, with status HIDDEN.
-- Events carry ids and a version only, never text, reasons, ticket references or addresses.
DO $guard$ BEGIN
 IF to_regclass('app.private_contact_data') IS NULL
 OR to_regclass('app.private_note') IS NULL
 OR to_regclass('app.target_contact') IS NULL
 OR to_regclass('app.communication') IS NULL
 OR to_regclass('app.communication_optout') IS NULL
 OR to_regclass('app.communication_dispatch') IS NULL
 OR to_regclass('app.communication_receipt') IS NULL
 OR to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regprocedure('app.record_change()') IS NULL
 OR to_regprocedure('app.research_relationship_access(uuid,uuid,boolean)') IS NULL
 OR to_regprocedure('app.fresh_mfa()') IS NULL
 OR to_regprocedure('app.actor_id()') IS NULL
 OR to_regprocedure('app.can_access(uuid,text,text)') IS NULL
 OR to_regprocedure('app.member_role(uuid)') IS NULL
 OR NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='app.private_contact_data'::regclass AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (tenant_id, relationship_id, id)')
 THEN RAISE EXCEPTION 'Contact and note change prerequisites are missing'; END IF;
END $guard$;

-- One switch for withdraw, correct and hide. Closed unless the latest row says enabled; no row means closed.
CREATE TABLE app.counterparty_change_control (
 version integer PRIMARY KEY CHECK(version>0),enabled boolean NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE app.counterparty_change_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.counterparty_change_control FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER counterparty_change_control_immutable BEFORE UPDATE OR DELETE ON app.counterparty_change_control
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE FUNCTION app.counterparty_change_enabled() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT enabled FROM app.counterparty_change_control ORDER BY version DESC LIMIT 1),false)
$$;

-- WITHDRAW or CORRECT of one exact contact version. Each version can be superseded once.
CREATE TABLE app.private_contact_change (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), relationship_id uuid NOT NULL,
 chain_id uuid NOT NULL, contact_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('WITHDRAW','CORRECT')), replacement_id uuid,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 command_id uuid NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 classification text NOT NULL CHECK(classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL','SENSITIVE_COMMERCIAL','HIGHLY_RESTRICTED')), purpose text NOT NULL,
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='CORRECT')=(replacement_id IS NOT NULL) AND replacement_id IS DISTINCT FROM contact_id),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,contact_id), UNIQUE(tenant_id,replacement_id), UNIQUE(tenant_id,command_id),
 FOREIGN KEY(tenant_id,relationship_id,contact_id) REFERENCES app.private_contact_data(tenant_id,relationship_id,id),
 FOREIGN KEY(tenant_id,relationship_id,replacement_id) REFERENCES app.private_contact_data(tenant_id,relationship_id,id)
);
CREATE INDEX private_contact_change_chain_idx ON app.private_contact_change(tenant_id,chain_id);

-- The same for notes. private_note has no (tenant, relationship, id) key, so the guard checks the relationship.
CREATE TABLE app.private_note_change (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), relationship_id uuid NOT NULL,
 chain_id uuid NOT NULL, note_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('WITHDRAW','CORRECT')), replacement_id uuid,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 command_id uuid NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 classification text NOT NULL CHECK(classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL','SENSITIVE_COMMERCIAL','HIGHLY_RESTRICTED')), purpose text NOT NULL,
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='CORRECT')=(replacement_id IS NOT NULL) AND replacement_id IS DISTINCT FROM note_id),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,note_id), UNIQUE(tenant_id,replacement_id), UNIQUE(tenant_id,command_id),
 FOREIGN KEY(tenant_id,note_id) REFERENCES app.private_note(tenant_id,id),
 FOREIGN KEY(tenant_id,replacement_id) REFERENCES app.private_note(tenant_id,id)
);
CREATE INDEX private_note_change_chain_idx ON app.private_note_change(tenant_id,chain_id);

-- Hiding one contact chain or one note chain. Permanent: no undo row and no update path.
CREATE TABLE app.private_record_redaction (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), relationship_id uuid NOT NULL,
 subject text NOT NULL CHECK(subject IN ('contact','note')), chain_id uuid NOT NULL, contact_chain_id uuid, note_chain_id uuid,
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 ticket_reference text NOT NULL CHECK(ticket_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,63}$'),
 command_id uuid NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 classification text NOT NULL CHECK(classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL','SENSITIVE_COMMERCIAL','HIGHLY_RESTRICTED')), purpose text NOT NULL,
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((subject='contact' AND contact_chain_id=chain_id AND note_chain_id IS NULL) OR (subject='note' AND note_chain_id=chain_id AND contact_chain_id IS NULL)),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,subject,chain_id), UNIQUE(tenant_id,command_id),
 FOREIGN KEY(tenant_id,relationship_id,contact_chain_id) REFERENCES app.private_contact_data(tenant_id,relationship_id,id),
 FOREIGN KEY(tenant_id,note_chain_id) REFERENCES app.private_note(tenant_id,id)
);

-- Invoker on purpose: the inserting person must already see the parent row through its own RLS.
CREATE FUNCTION app.guard_private_record_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE rec jsonb:=to_jsonb(NEW); parent record; replacement record; target uuid; chain uuid; contact boolean;
BEGIN
 IF NOT app.counterparty_change_enabled() THEN RAISE EXCEPTION 'Withdraw, correct and hide are not open yet in this workspace.'; END IF;
 IF NEW.created_by IS DISTINCT FROM app.actor_id() THEN RAISE EXCEPTION 'Authenticated actor required' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='private_record_redaction' THEN
  contact:=rec->>'subject'='contact'; target:=NEW.chain_id;
 ELSE
  contact:=TG_TABLE_NAME='private_contact_change'; target:=CASE WHEN contact THEN (rec->>'contact_id')::uuid ELSE (rec->>'note_id')::uuid END;
 END IF;
 IF contact THEN
  SELECT relationship_id,classification,purpose INTO parent FROM app.private_contact_data WHERE tenant_id=NEW.tenant_id AND id=target;
 ELSE
  SELECT relationship_id,classification,purpose INTO parent FROM app.private_note WHERE tenant_id=NEW.tenant_id AND id=target;
 END IF;
 IF NOT FOUND OR parent.relationship_id<>NEW.relationship_id THEN RAISE EXCEPTION 'Record unavailable' USING ERRCODE='42501'; END IF;
 IF NEW.purpose<>parent.purpose OR NEW.classification<>parent.classification THEN RAISE EXCEPTION 'The change must keep the record provenance'; END IF;
 IF contact THEN
  chain:=coalesce((SELECT chain_id FROM app.private_contact_change WHERE tenant_id=NEW.tenant_id AND replacement_id=target),target);
 ELSE
  chain:=coalesce((SELECT chain_id FROM app.private_note_change WHERE tenant_id=NEW.tenant_id AND replacement_id=target),target);
 END IF;
 IF TG_TABLE_NAME='private_record_redaction' THEN
  IF chain<>target THEN RAISE EXCEPTION 'Hide needs the first version of the record'; END IF;
 ELSE
  NEW.chain_id:=chain;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||CASE WHEN contact THEN ':private-contact:' ELSE ':private-note:' END||chain::text,0));
 IF EXISTS(SELECT FROM app.private_record_redaction WHERE tenant_id=NEW.tenant_id AND subject=CASE WHEN contact THEN 'contact' ELSE 'note' END AND chain_id=chain) THEN
  RAISE EXCEPTION '%',CASE WHEN contact THEN 'This contact is hidden.' ELSE 'This note is hidden.' END;
 END IF;
 IF TG_TABLE_NAME='private_record_redaction' THEN
  IF app.member_role(NEW.tenant_id) NOT IN ('owner','admin') OR NOT app.fresh_mfa() THEN
   RAISE EXCEPTION '%',CASE WHEN contact THEN 'Only a workspace owner or admin can hide contact details.' ELSE 'Only a workspace owner or admin can hide notes.' END USING ERRCODE='42501';
  END IF;
  RETURN NEW;
 END IF;
 IF (contact AND EXISTS(SELECT FROM app.private_contact_change WHERE tenant_id=NEW.tenant_id AND contact_id=target))
 OR (NOT contact AND EXISTS(SELECT FROM app.private_note_change WHERE tenant_id=NEW.tenant_id AND note_id=target)) THEN
  RAISE EXCEPTION '%',CASE WHEN contact THEN 'This contact changed. Refresh to see the latest.' ELSE 'This note changed. Refresh to see the latest.' END;
 END IF;
 IF rec->>'kind'='CORRECT' THEN
  IF contact THEN
   SELECT relationship_id,created_at INTO replacement FROM app.private_contact_data WHERE tenant_id=NEW.tenant_id AND id=NEW.replacement_id;
  ELSE
   SELECT relationship_id,created_at INTO replacement FROM app.private_note WHERE tenant_id=NEW.tenant_id AND id=NEW.replacement_id;
  END IF;
  IF NOT FOUND OR replacement.relationship_id<>NEW.relationship_id OR replacement.created_at<>now()
  OR (contact AND (EXISTS(SELECT FROM app.private_contact_change WHERE tenant_id=NEW.tenant_id AND (contact_id=NEW.replacement_id OR replacement_id=NEW.replacement_id))
   OR EXISTS(SELECT FROM app.target_contact WHERE tenant_id=NEW.tenant_id AND contact_id=NEW.replacement_id)
   OR EXISTS(SELECT FROM app.communication WHERE tenant_id=NEW.tenant_id AND contact_id=NEW.replacement_id)))
  OR (NOT contact AND EXISTS(SELECT FROM app.private_note_change WHERE tenant_id=NEW.tenant_id AND (note_id=NEW.replacement_id OR replacement_id=NEW.replacement_id))) THEN
   RAISE EXCEPTION 'A correction needs a new version created with it';
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- True when this contact version can no longer be used for a new target or message: it was withdrawn or corrected, its
-- chain is hidden, or (for messages) any address in its chain is opted out. Reads only ids, booleans and hashes.
CREATE FUNCTION app.private_contact_inactive(target uuid,contact uuid,with_optout boolean) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH chain AS (SELECT coalesce((SELECT chain_id FROM app.private_contact_change WHERE tenant_id=target AND replacement_id=contact),contact) AS id)
 SELECT EXISTS(SELECT FROM app.private_contact_change WHERE tenant_id=target AND contact_id=contact)
  OR EXISTS(SELECT FROM app.private_record_redaction r,chain WHERE r.tenant_id=target AND r.subject='contact' AND r.chain_id=chain.id)
  OR (with_optout AND EXISTS(SELECT FROM app.private_contact_data pc JOIN app.communication_optout o ON o.tenant_id=pc.tenant_id
   AND o.recipient_key=encode(sha256(convert_to(lower(pc.email),'UTF8')),'hex'),chain
   WHERE pc.tenant_id=target AND (pc.id=chain.id OR pc.id IN(SELECT replacement_id FROM app.private_contact_change WHERE tenant_id=target AND chain_id=chain.id))))
$$;

-- Definer on purpose: the refusal must not depend on the caller's RLS view. It also runs inside queue_communication and
-- deliver_synthetic, which have no person behind them, and an opt-out row the caller cannot read must still refuse.
-- It returns NEW unchanged and raises fixed words only.
CREATE FUNCTION app.refuse_inactive_contact() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rec jsonb:=to_jsonb(NEW); contact uuid; chain uuid;
BEGIN
 IF TG_TABLE_NAME IN ('target_contact','communication') THEN contact:=(rec->>'contact_id')::uuid;
 ELSE SELECT c.contact_id INTO contact FROM app.communication c WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.id; END IF;
 IF contact IS NULL THEN RETURN NEW; END IF;
 chain:=coalesce((SELECT chain_id FROM app.private_contact_change WHERE tenant_id=NEW.tenant_id AND replacement_id=contact),contact);
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':private-contact:'||chain::text,0));
 IF app.private_contact_inactive(NEW.tenant_id,contact,TG_TABLE_NAME<>'target_contact') THEN
  RAISE EXCEPTION 'Choose a current contact. This one was withdrawn, corrected or hidden.';
 END IF;
 RETURN NEW;
END $$;

-- The dispatcher's send-time check for one claimed message, keyed by the same capability hash as claim_communication.
CREATE FUNCTION app.private_contact_message_active(mid uuid,h text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.communication_dispatch j JOIN app.communication c ON c.tenant_id=j.tenant_id AND c.id=j.id
  WHERE j.id=mid AND j.capability_hash=h AND NOT app.private_contact_inactive(c.tenant_id,c.contact_id,true))
$$;

DO $$
DECLARE tbl text; roles text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['private_contact_change','private_note_change','private_record_redaction'] LOOP
  roles:=CASE WHEN tbl='private_record_redaction' THEN 'app.member_role(tenant_id) IN (''owner'',''admin'') AND app.fresh_mfa()' ELSE 'app.member_role(tenant_id) IN (''owner'',''admin'',''operator'')' END;
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tbl);
  -- Reading follows the record's own boundary exactly: if a person could see a contact but not its hide row, the view
  -- would show them the hidden text.
  EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose) AND app.research_relationship_access(tenant_id,relationship_id))',tbl||'_read',tbl);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,classification,purpose) AND %s AND created_by=app.actor_id() AND app.research_relationship_access(tenant_id,relationship_id,true))',tbl||'_insert',tbl,roles);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO corridra_runtime',tbl);
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_private_record_change()',tbl||'_guard',tbl);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',tbl||'_immutable',tbl);
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_change()',tbl||'_event',tbl);
 END LOOP;
END $$;

-- Separate additive triggers; guard_research_record, guard_communication and the dispatch functions stay unchanged.
CREATE TRIGGER target_contact_contact_state BEFORE INSERT ON app.target_contact FOR EACH ROW EXECUTE FUNCTION app.refuse_inactive_contact();
CREATE TRIGGER communication_contact_state BEFORE INSERT ON app.communication FOR EACH ROW EXECUTE FUNCTION app.refuse_inactive_contact();
CREATE TRIGGER communication_dispatch_contact_state BEFORE INSERT ON app.communication_dispatch FOR EACH ROW EXECUTE FUNCTION app.refuse_inactive_contact();
-- A staff retry moves a stopped message back to PENDING with an UPDATE, so it is refused here as well.
CREATE TRIGGER communication_dispatch_retry_contact_state BEFORE UPDATE OF status ON app.communication_dispatch FOR EACH ROW
 WHEN (NEW.status='PENDING' AND OLD.status IN ('DEAD','SUPPRESSED')) EXECUTE FUNCTION app.refuse_inactive_contact();
CREATE TRIGGER communication_receipt_contact_state BEFORE INSERT ON app.communication_receipt FOR EACH ROW EXECUTE FUNCTION app.refuse_inactive_contact();

-- The only runtime readers of contact and note text. Status order: HIDDEN, WITHDRAWN, CORRECTED, EXPIRED, SOURCE_REPORTED.
CREATE VIEW app.private_contact_state WITH (security_invoker=true,security_barrier=true) AS
SELECT c.id,c.tenant_id,c.relationship_id,c.source_id,c.valid_until,c.classification,c.purpose,c.created_by,c.created_at,
 coalesce(p.chain_id,c.id) AS chain_id,
 CASE WHEN r.id IS NULL THEN c.name END AS name,
 CASE WHEN r.id IS NULL THEN c.job_title END AS job_title,
 CASE WHEN r.id IS NULL THEN c.email END AS email,
 CASE WHEN r.id IS NOT NULL THEN 'HIDDEN' WHEN x.kind='WITHDRAW' THEN 'WITHDRAWN' WHEN x.kind='CORRECT' THEN 'CORRECTED'
  WHEN c.valid_until<=now() THEN 'EXPIRED' ELSE 'SOURCE_REPORTED' END AS status,
 x.id AS change_id,x.kind AS change_kind,x.replacement_id,CASE WHEN r.id IS NULL THEN x.reason END AS change_reason,
 x.created_by AS changed_by,x.created_at AS changed_at,r.id AS redaction_id,r.created_at AS hidden_at,r.created_by AS hidden_by
FROM app.private_contact_data c
LEFT JOIN app.private_contact_change p ON p.tenant_id=c.tenant_id AND p.replacement_id=c.id
LEFT JOIN app.private_contact_change x ON x.tenant_id=c.tenant_id AND x.contact_id=c.id
LEFT JOIN app.private_record_redaction r ON r.tenant_id=c.tenant_id AND r.subject='contact' AND r.chain_id=coalesce(p.chain_id,c.id);
CREATE VIEW app.private_note_state WITH (security_invoker=true,security_barrier=true) AS
SELECT n.id,n.tenant_id,n.relationship_id,n.source_id,n.classification,n.purpose,n.created_by,n.created_at,
 coalesce(p.chain_id,n.id) AS chain_id,
 CASE WHEN r.id IS NULL THEN n.body END AS body,
 CASE WHEN r.id IS NOT NULL THEN 'HIDDEN' WHEN x.kind='WITHDRAW' THEN 'WITHDRAWN' WHEN x.kind='CORRECT' THEN 'CORRECTED'
  ELSE 'SOURCE_REPORTED' END AS status,
 x.id AS change_id,x.kind AS change_kind,x.replacement_id,CASE WHEN r.id IS NULL THEN x.reason END AS change_reason,
 x.created_by AS changed_by,x.created_at AS changed_at,r.id AS redaction_id,r.created_at AS hidden_at,r.created_by AS hidden_by
FROM app.private_note n
LEFT JOIN app.private_note_change p ON p.tenant_id=n.tenant_id AND p.replacement_id=n.id
LEFT JOIN app.private_note_change x ON x.tenant_id=n.tenant_id AND x.note_id=n.id
LEFT JOIN app.private_record_redaction r ON r.tenant_id=n.tenant_id AND r.subject='note' AND r.chain_id=coalesce(p.chain_id,n.id);

REVOKE ALL ON app.private_contact_state,app.private_note_state FROM PUBLIC;
GRANT SELECT ON app.private_contact_state,app.private_note_state TO corridra_runtime;
REVOKE ALL ON FUNCTION app.counterparty_change_enabled(),app.guard_private_record_change(),app.private_contact_inactive(uuid,uuid,boolean),
 app.refuse_inactive_contact(),app.private_contact_message_active(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.counterparty_change_enabled(),app.private_contact_message_active(uuid,text) TO corridra_runtime;
