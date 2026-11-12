-- Buyer outreach counts on the approved mission detail (Sell room, owner mandate family B).
-- When an owner or admin approves a participant's mission detail (app.delivery_experience_publication), the number of the approved
-- targets that were approached, that responded and that were interested is counted ONCE and stored on that publication row with the
-- time of counting. The client report adds those four values under experience.outreach and reads nothing live: later outreach never
-- reaches a customer unless staff approve a new publication. A publication approved before this file has outreach NULL and the
-- report simply has no outreach key, which the product shows as "Not shared", never as zero.
-- Definitions (aggregate only, one count per approved target, no name, contact, message or response text is stored or returned):
--   approached: a delivery receipt exists for a message to the target (app.communication_receipt; a DELIVERED dispatch always has one),
--               or the target has a recorded buyer response (a reply proves the message reached the buyer).
--   responded:  the target has a recorded buyer response of any kind (interested, needs information, not relevant).
--   interested: the target has a buyer response of INTERESTED.
-- Additive. app.delivery_report(text,text) keeps its signature and grants; it is replaced by itself with ONE line changed, behind a
-- hash guard of the definition installed by core 0025. Nothing else in a module reads that function's text (programme lifecycle
-- guards delivery_report_v1, which is not touched). Safe to run more than once.
DO $guard$ BEGIN
 IF to_regclass('app.delivery_experience_publication') IS NULL
  OR to_regclass('app.communication') IS NULL
  OR to_regclass('app.communication_receipt') IS NULL
  OR to_regclass('app.buyer_link') IS NULL
  OR to_regclass('app.buyer_response') IS NULL
  OR to_regclass('app.target_account') IS NULL
  OR to_regprocedure('app.delivery_report(text,text)') IS NULL
  OR to_regprocedure('app.member_role(uuid)') IS NULL THEN
  RAISE EXCEPTION 'Experience outreach counts prerequisite is missing';
 END IF;
END $guard$;

ALTER TABLE app.delivery_experience_publication ADD COLUMN IF NOT EXISTS outreach jsonb;
DO $constraint$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='app.delivery_experience_publication'::regclass AND conname='delivery_experience_outreach_shape') THEN
  ALTER TABLE app.delivery_experience_publication ADD CONSTRAINT delivery_experience_outreach_shape CHECK(outreach IS NULL OR (
   jsonb_typeof(outreach)='object'
   AND outreach ?& ARRAY['approached','responded','interested','asOf']
   AND outreach-ARRAY['approached','responded','interested','asOf']='{}'::jsonb
   AND CASE WHEN (outreach->>'approached') ~ '^[0-9]{1,3}$' AND (outreach->>'responded') ~ '^[0-9]{1,3}$' AND (outreach->>'interested') ~ '^[0-9]{1,3}$'
     AND jsonb_typeof(outreach->'asOf')='string'
     THEN (outreach->>'interested')::int<=(outreach->>'responded')::int AND (outreach->>'responded')::int<=(outreach->>'approached')::int AND (outreach->>'approached')::int<=cardinality(target_ids)
     ELSE false END));
 END IF;
END $constraint$;

-- One row per listed target of the tenant, from the private records. Internal: no login can call it.
CREATE OR REPLACE FUNCTION app.experience_outreach_rows_for(t uuid, targets uuid[]) RETURNS TABLE(target_id uuid, approached boolean, responded boolean, interested boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT x.id,
  r.any OR EXISTS(SELECT FROM app.communication c JOIN app.communication_receipt cr ON cr.tenant_id=c.tenant_id AND cr.id=c.id WHERE c.tenant_id=t AND c.target_id=x.id),
  r.any,
  r.interested
 FROM unnest(targets) AS x(id)
 CROSS JOIN LATERAL(SELECT coalesce(bool_or(true),false) AS any, coalesce(bool_or(br.status='INTERESTED'),false) AS interested
  FROM app.communication c
  JOIN app.buyer_link l ON l.tenant_id=c.tenant_id AND l.message_id=c.id
  JOIN app.buyer_response br ON br.tenant_id=l.tenant_id AND br.link_id=l.id
  WHERE c.tenant_id=t AND c.target_id=x.id) r
 WHERE EXISTS(SELECT FROM app.target_account ta WHERE ta.tenant_id=t AND ta.id=x.id)
$$;

-- The counts that are stored at approval. Internal.
CREATE OR REPLACE FUNCTION app.experience_outreach_count(t uuid, targets uuid[]) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object(
  'approached',count(*) FILTER(WHERE approached)::int,
  'responded',count(*) FILTER(WHERE responded)::int,
  'interested',count(*) FILTER(WHERE interested)::int,
  'asOf',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
 FROM app.experience_outreach_rows_for(t,targets)
$$;

-- What the approving staff member sees before approving: the same rows, for the caller's own workspace, owner or admin only.
CREATE OR REPLACE FUNCTION app.experience_outreach_preview(targets uuid[]) RETURNS TABLE(target_id uuid, approached boolean, responded boolean, interested boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t uuid:=nullif(current_setting('corridra.tenant_id',true),'')::uuid;
BEGIN
 IF t IS NULL OR app.member_role(t) IS NULL OR app.member_role(t) NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Owner or admin required' USING ERRCODE='42501'; END IF;
 IF cardinality(targets)>100 THEN RAISE EXCEPTION 'Too many targets' USING ERRCODE='23514'; END IF;
 RETURN QUERY SELECT * FROM app.experience_outreach_rows_for(t,targets);
END $$;

-- The counting happens in the database, inside the approving insert, so nothing a caller supplies can set or change it.
CREATE OR REPLACE FUNCTION app.experience_outreach_freeze() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 NEW.outreach:=app.experience_outreach_count(NEW.tenant_id,NEW.target_ids);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS outreach ON app.delivery_experience_publication;
CREATE TRIGGER outreach BEFORE INSERT ON app.delivery_experience_publication FOR EACH ROW EXECUTE FUNCTION app.experience_outreach_freeze();

REVOKE ALL ON FUNCTION app.experience_outreach_rows_for(uuid,uuid[]),app.experience_outreach_count(uuid,uuid[]),app.experience_outreach_freeze() FROM PUBLIC,corridra_auth,corridra_runtime;
REVOKE ALL ON FUNCTION app.experience_outreach_preview(uuid[]) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.experience_outreach_preview(uuid[]) TO corridra_runtime;

-- The report: the line that adds the experience now also adds the stored outreach counts, when there are some.
DO $replace$
DECLARE def text:=pg_get_functiondef('app.delivery_report(text,text)'::regprocedure);
 old text:='item:=item||jsonb_build_object(''experience'',extended);';
 new text:='item:=item||jsonb_build_object(''experience'',CASE WHEN e.outreach IS NULL THEN extended ELSE extended||jsonb_build_object(''outreach'',e.outreach) END);';
BEGIN
 IF position('e.outreach' IN def)>0 THEN RETURN; END IF;
 IF encode(sha256(convert_to(def,'UTF8')),'hex')<>'40ff104e2be96a328ee4d8002f474f05cc1bcc1eeef6b896952d4208dc77cad4' THEN RAISE EXCEPTION 'Experience outreach prerequisite function differs: app.delivery_report'; END IF;
 IF (length(def)-length(replace(def,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'Experience outreach anchor not found once: app.delivery_report'; END IF;
 EXECUTE replace(def,old,new);
END $replace$;
