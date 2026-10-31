-- Commercial readiness program, Wave 0 (31 Oct 2026). Additive only: one new table, nullable columns,
-- one write function. No rename, no drop, no state machine or money change.
-- Rollback notes: the application reads every object below only behind CORRIDRA_NOTIFICATIONS_V2 or as
-- optional columns, so switching the flag off is the rollback. If the owner ever wants the objects gone,
-- a reviewed forward migration drops app.inbox_record, the policies and app.inbox_notification, then
-- the four nullable columns; nothing else depends on them.

-- 1. In-app inbox (D7). Only the recipient can read or mark an item. Writes go through one function.
CREATE TABLE app.inbox_notification (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid REFERENCES app.tenant(id),
 recipient_kind text NOT NULL CHECK(recipient_kind IN ('staff','customer')),
 recipient_account_id uuid NOT NULL,
 type text NOT NULL CHECK(type IN ('TEAM_INVITE','CONTRIBUTOR_INVITE','PARTICIPANT_INVITE','TASK_ASSIGNED','QUOTE_SENT','QUOTE_ACCEPTED','REPORT_PUBLISHED','REQUEST_RECEIVED','REPLY_POSTED')),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=8192),
 read_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(read_at IS NULL OR read_at>=created_at)
);
CREATE INDEX inbox_notification_recipient_idx ON app.inbox_notification(recipient_kind,recipient_account_id,created_at DESC);
ALTER TABLE app.inbox_notification ENABLE ROW LEVEL SECURITY;
CREATE POLICY inbox_staff_read ON app.inbox_notification FOR SELECT TO corridra_runtime
 USING(recipient_kind='staff' AND recipient_account_id=app.actor_id());
CREATE POLICY inbox_staff_mark ON app.inbox_notification FOR UPDATE TO corridra_runtime
 USING(recipient_kind='staff' AND recipient_account_id=app.actor_id())
 WITH CHECK(recipient_kind='staff' AND recipient_account_id=app.actor_id());
CREATE POLICY inbox_customer_read ON app.inbox_notification FOR SELECT TO corridra_runtime
 USING(recipient_kind='customer' AND recipient_account_id=customer.actor_id());
CREATE POLICY inbox_customer_mark ON app.inbox_notification FOR UPDATE TO corridra_runtime
 USING(recipient_kind='customer' AND recipient_account_id=customer.actor_id())
 WITH CHECK(recipient_kind='customer' AND recipient_account_id=customer.actor_id());
GRANT SELECT ON app.inbox_notification TO corridra_runtime;
GRANT UPDATE(read_at) ON app.inbox_notification TO corridra_runtime;

-- The writer must be a signed-in person. A staff writer naming a workspace must belong to it. The
-- function never returns another person's items; it only records one.
CREATE FUNCTION app.inbox_record(kind text, recipient uuid, tenant uuid, item_type text, body jsonb) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff uuid := app.actor_id(); person uuid := customer.actor_id(); created uuid;
BEGIN
 IF staff IS NULL AND person IS NULL THEN RAISE EXCEPTION 'Sign in to continue' USING ERRCODE='42501'; END IF;
 IF tenant IS NOT NULL AND staff IS NOT NULL AND app.member_role(tenant) IS NULL THEN
  RAISE EXCEPTION 'Workspace access denied' USING ERRCODE='42501';
 END IF;
 INSERT INTO app.inbox_notification(tenant_id,recipient_kind,recipient_account_id,type,payload)
 VALUES(tenant,kind,recipient,item_type,coalesce(body,'{}'::jsonb)) RETURNING id INTO created;
 RETURN created;
END $$;
REVOKE ALL ON FUNCTION app.inbox_record(text,uuid,uuid,text,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.inbox_record(text,uuid,uuid,text,jsonb) TO corridra_runtime;

-- 2. Optional mission and company links on sources and claims (CQ-80). Existing insert policies still
-- apply; the new values are nullable and unconstrained so no existing row changes meaning.
ALTER TABLE app.source_record ADD COLUMN IF NOT EXISTS mission_id uuid;
ALTER TABLE app.source_record ADD COLUMN IF NOT EXISTS organisation_id uuid;
ALTER TABLE app.claim ADD COLUMN IF NOT EXISTS mission_id uuid;
ALTER TABLE app.claim ADD COLUMN IF NOT EXISTS organisation_id uuid;

-- 3. Optional participant email on programme invitations (D13). The code itself is never stored in
-- plain text; the address only lets an organiser send the code again through the notification service.
ALTER TABLE customer_private.programme_invitation ADD COLUMN IF NOT EXISTS recipient_email text
 CHECK(recipient_email IS NULL OR (length(recipient_email) BETWEEN 3 AND 254 AND recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'));
