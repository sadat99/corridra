-- Removed members, part 9: the inbox. A customer's inbox is read through the row level security policy inbox_customer_read on
-- app.inbox_notification (commercial readiness 0001; no later file redefines it). It now also hides a notice that points at a
-- request whose author, the recipient, is no longer a current member of the workspace of that request (owner decision, 11 Nov 2026:
-- "No, remove access (Recommended)"; ADR-033 amendment). Notices that point at no request, and every staff notice, are unaffected.
-- The notice types a customer receives that point at a request, and where the writers put the reference:
--   REQUEST_RECEIVED  event_key 'request:<private request id>'           (customer.record_request_received, readiness 0002 and 0011)
--   REPLY_POSTED      payload href '/account/requests/<private request id>'  (app.record_reply_posted, readiness 0009)
--   REPORT_PUBLISHED  event_key 'assignment:<delivery assignment id>', which names the request  (app.record_report_published, 0005)
--   QUOTE_SENT        payload href '/account/service-requests/<workspace id>/<request id>'  (app.record_quote_sent, 0008): a service
--                     request belongs to a workspace, so it follows the workspace membership of the recipient.
-- Policy: the expression runs as the reading role (corridra_runtime, the only role that holds SELECT on the table; corridra_auth
-- has no grant; the table owner bypasses row level security as before). A policy expression can call only what that role may execute,
-- so the rule sits in one new definer function app.inbox_notice_visible(recipient, type, key, payload), granted to corridra_runtime
-- and revoked from PUBLIC and corridra_auth. It answers true for any recipient other than the signed-in customer, and looks only at
-- requests that recipient wrote, so calling it by hand tells a caller nothing about anyone else's requests or membership. It
-- reads, writes nothing, and calls the membership helper of customer migration 0004. ALTER POLICY keeps the name, the command, the
-- role list and the permissive kind; the staff policies, the update policies, the table grants and the column grants are not touched.
-- The staff side functions that write notices (record_*) and the update policy inbox_customer_mark are unchanged: a hidden notice
-- cannot be marked read through a query that cannot select it, and recording a notice still happens only for a current member.
-- A new invitation is a new member row, so a re-admitted member sees the notices again. Nothing is deleted or rewritten.
-- Guard, one DO block that runs first. It compares the live policy with the constants below (command, permissive kind, role names and
-- the expressions with string literals taken out, casts, schema names, parentheses, quotes and spaces removed, so the result is the
-- same on every PostgreSQL major version; never the text of a policy definition dump). Three states. ABSENT: the policy does not
-- exist and the registry has no row for the file before this one: a notice, nothing changed or created. CHANGED: the policy
-- differs or is missing, or the registry holds another hash for the file before this one: an error, nothing changed. MATCHING:
-- the policy equals its constants: the function is created, the policy is altered, then the command, roles, permissive kind, the
-- new expression, every other policy on the table, the table grants and the column grants are proved as expected. The constants sit
-- between the begin and end marker comments of the fingerprint block; the live query sits between the begin and end marker comments
-- of the fingerprint query block, and an owner can run it on any database to read the live values.
DO $guard$
DECLARE spec record; present boolean; recorded text; before_state jsonb; after_state jsonb; holder text;
 policy_now text;
BEGIN
 present:=to_regclass('app.inbox_notification') IS NOT NULL
  AND EXISTS(SELECT FROM pg_policy p WHERE p.polrelid=to_regclass('app.inbox_notification') AND p.polname='inbox_customer_read');
 IF to_regclass('commercial_readiness_migrations.applied') IS NOT NULL THEN
  EXECUTE 'SELECT sha256 FROM commercial_readiness_migrations.applied WHERE name=$1' INTO recorded USING '0011_removed_member_request_received.sql';
 END IF;
 -- ABSENT: the policy does not exist and the registry has no row for the file before this one. Nothing is changed or created.
 IF NOT present AND recorded IS NULL THEN
  RAISE NOTICE 'Removed member access skipped: commercial readiness 0011 is not applied';
  RETURN;
 END IF;
 -- CHANGED: the policy is missing, or differs in any compared part, or the registry holds another hash for the file before this one.
 IF NOT present THEN
  RAISE EXCEPTION 'Removed member access prerequisite policy is missing: inbox_customer_read';
 END IF;
 FOR spec IN
  SELECT e.signature,e.fingerprint,e.grantees,q.fp,q.grantees live_grantees
  FROM (VALUES
   -- fingerprint-begin
   ('app.inbox_notification:inbox_customer_read','d00ff09dd6582d0b92267892f04b55e56e199c79bd14b252a204c8845195bdd6','corridra_runtime')
   -- fingerprint-end
  ) AS e(signature,fingerprint,grantees)
  LEFT JOIN (
   -- fingerprint-query-begin
   SELECT 'app.inbox_notification:inbox_customer_read'::text AS signature,
    encode(sha256(convert_to(concat_ws(E'\x1f',p.polcmd::text,p.polpermissive::text,
      array_to_string(ARRAY(SELECT CASE r WHEN 0 THEN 'PUBLIC' ELSE r::regrole::text END FROM unnest(p.polroles) r ORDER BY 1),','),
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polqual,p.polrelid),''),$q$'(?:[^']|'')*'$q$,'?','g'),'::[a-z_]+','','g'),'[a-z_]+\.','','g'),'[[:space:]()"]','','g'),
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),$q$'(?:[^']|'')*'$q$,'?','g'),'::[a-z_]+','','g'),'[a-z_]+\.','','g'),'[[:space:]()"]','','g'),
      coalesce((SELECT string_agg(m.lit[1],E'\x1e' ORDER BY m.n) FROM regexp_matches(coalesce(pg_get_expr(p.polqual,p.polrelid),''),$q$('(?:[^']|'')*')$q$,'g') WITH ORDINALITY AS m(lit,n)),'')),'UTF8')),'hex') AS fp,
    array_to_string(ARRAY(SELECT CASE r WHEN 0 THEN 'PUBLIC' ELSE r::regrole::text END FROM unnest(p.polroles) r ORDER BY 1),',') AS grantees
   FROM pg_policy p WHERE p.polrelid=to_regclass('app.inbox_notification') AND p.polname='inbox_customer_read'
   -- fingerprint-query-end
  ) q ON q.signature=e.signature
 LOOP
  IF spec.fp IS DISTINCT FROM spec.fingerprint OR spec.live_grantees IS DISTINCT FROM spec.grantees THEN
   RAISE EXCEPTION 'Removed member access prerequisite policy differs: inbox_customer_read';
  END IF;
 END LOOP;
 IF recorded IS NOT NULL AND recorded<>'08c7c32d908eea3f1c28b94e72979fc08ac6ec20a6fbdeba34f2a3c30febbce4' THEN
  RAISE EXCEPTION 'Removed member access prerequisite file differs: 0011_removed_member_request_received.sql';
 END IF;
 IF to_regprocedure('customer_private.workspace_member_current(uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'Removed member access needs customer migration 0004_workspace_member_current.sql first: customer_private.workspace_member_current';
 END IF;
 -- MATCHING. Remember everything the change must leave as it is: every other policy of the table, its grants and its column grants.
 SELECT jsonb_build_object(
   'policies',coalesce((SELECT jsonb_object_agg(p.polname,encode(sha256(convert_to(concat_ws(E'\x1f',p.polcmd::text,p.polpermissive::text,
      array_to_string(ARRAY(SELECT CASE r WHEN 0 THEN 'PUBLIC' ELSE r::regrole::text END FROM unnest(p.polroles) r ORDER BY 1),','),regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polqual,p.polrelid),''),$q$'(?:[^']|'')*'$q$,'?','g'),'::[a-z_]+','','g'),'[a-z_]+\.','','g'),'[[:space:]()"]','','g'),regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),$q$'(?:[^']|'')*'$q$,'?','g'),'::[a-z_]+','','g'),'[a-z_]+\.','','g'),'[[:space:]()"]','','g')),'UTF8')),'hex'))
     FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname<>'inbox_customer_read'),'{}'::jsonb),
   'acl',coalesce(c.relacl::text,''),'rls',c.relrowsecurity::text||c.relforcerowsecurity::text,
   'columns',coalesce((SELECT string_agg(a.attname||':'||a.attacl::text,',' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attacl IS NOT NULL),''),
   'policy_shape',(SELECT p.polcmd::text||p.polpermissive::text||array_to_string(ARRAY(SELECT CASE r WHEN 0 THEN 'PUBLIC' ELSE r::regrole::text END FROM unnest(p.polroles) r ORDER BY 1),',') FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='inbox_customer_read'))
 INTO before_state FROM pg_class c WHERE c.oid=to_regclass('app.inbox_notification');
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION app.inbox_notice_visible(recipient uuid,notice_type text,notice_key text,body jsonb) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE href text:=coalesce(body->>'href',''); rid uuid;
BEGIN
 -- Only the signed-in customer's own notices are looked at. For anyone else the answer is true and says nothing.
 IF recipient IS NULL OR recipient IS DISTINCT FROM customer.actor_id() THEN RETURN true; END IF;
 IF notice_type='REQUEST_RECEIVED' AND notice_key ~ '^request:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  rid:=substr(notice_key,9)::uuid;
 ELSIF notice_type='REPLY_POSTED' AND href ~ '^/account/requests/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  rid:=substr(href,19)::uuid;
 ELSIF notice_type='REPORT_PUBLISHED' AND notice_key ~ '^assignment:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  RETURN NOT EXISTS(SELECT FROM app.customer_delivery_assignment a JOIN customer_private.owned_request o ON o.id=a.request_id
   WHERE a.id=substr(notice_key,12)::uuid AND o.principal_id=recipient AND NOT customer_private.workspace_member_current(o.workspace_id,recipient));
 ELSIF notice_type='QUOTE_SENT' AND href ~ '^/account/service-requests/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  RETURN customer_private.workspace_member_current(substr(href,27,36)::uuid,recipient);
 ELSE
  RETURN true;
 END IF;
 RETURN NOT EXISTS(SELECT FROM customer_private.owned_request o WHERE o.id=rid AND o.principal_id=recipient
  AND NOT customer_private.workspace_member_current(o.workspace_id,recipient));
END $$
$fn$;
 EXECUTE 'REVOKE ALL ON FUNCTION app.inbox_notice_visible(uuid,text,text,jsonb) FROM PUBLIC,corridra_auth';
 EXECUTE 'GRANT EXECUTE ON FUNCTION app.inbox_notice_visible(uuid,text,text,jsonb) TO corridra_runtime';
 -- The new function is a definer owned by whoever installs it. It calls the membership helper, so that helper needs EXECUTE for its owner.
 SELECT pg_get_userbyid(p.proowner) INTO holder FROM pg_proc p WHERE p.oid=to_regprocedure('app.inbox_notice_visible(uuid,text,text,jsonb)');
 IF pg_get_userbyid((SELECT h.proowner FROM pg_proc h WHERE h.oid=to_regprocedure('customer_private.workspace_member_current(uuid,uuid)')))<>holder THEN
  EXECUTE format('GRANT EXECUTE ON FUNCTION customer_private.workspace_member_current(uuid,uuid) TO %I',holder);
 END IF;
 -- Same name, same command, same roles, same kind: only the expression changes.
 EXECUTE $p$ALTER POLICY inbox_customer_read ON app.inbox_notification
  USING(recipient_kind='customer' AND recipient_account_id=customer.actor_id()
   AND app.inbox_notice_visible(recipient_account_id,type,event_key,payload))$p$;
 SELECT jsonb_build_object(
   'policies',coalesce((SELECT jsonb_object_agg(p.polname,encode(sha256(convert_to(concat_ws(E'\x1f',p.polcmd::text,p.polpermissive::text,
      array_to_string(ARRAY(SELECT CASE r WHEN 0 THEN 'PUBLIC' ELSE r::regrole::text END FROM unnest(p.polroles) r ORDER BY 1),','),regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polqual,p.polrelid),''),$q$'(?:[^']|'')*'$q$,'?','g'),'::[a-z_]+','','g'),'[a-z_]+\.','','g'),'[[:space:]()"]','','g'),regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),$q$'(?:[^']|'')*'$q$,'?','g'),'::[a-z_]+','','g'),'[a-z_]+\.','','g'),'[[:space:]()"]','','g')),'UTF8')),'hex'))
     FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname<>'inbox_customer_read'),'{}'::jsonb),
   'acl',coalesce(c.relacl::text,''),'rls',c.relrowsecurity::text||c.relforcerowsecurity::text,
   'columns',coalesce((SELECT string_agg(a.attname||':'||a.attacl::text,',' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attacl IS NOT NULL),''),
   'policy_shape',(SELECT p.polcmd::text||p.polpermissive::text||array_to_string(ARRAY(SELECT CASE r WHEN 0 THEN 'PUBLIC' ELSE r::regrole::text END FROM unnest(p.polroles) r ORDER BY 1),',') FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='inbox_customer_read'))
 INTO after_state FROM pg_class c WHERE c.oid=to_regclass('app.inbox_notification');
 IF after_state IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'Removed member access changed more than the expression of inbox_customer_read';
 END IF;
 SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polqual,p.polrelid),''),$q$'(?:[^']|'')*'$q$,'?','g'),'::[a-z_]+','','g'),'[a-z_]+\.','','g'),'[[:space:]()"]','','g') INTO policy_now FROM pg_policy p
  WHERE p.polrelid=to_regclass('app.inbox_notification') AND p.polname='inbox_customer_read';
 IF policy_now IS DISTINCT FROM 'recipient_kind=?ANDrecipient_account_id=actor_idANDinbox_notice_visiblerecipient_account_id,type,event_key,payload' THEN
  RAISE EXCEPTION 'Removed member access did not produce the expected policy expression';
 END IF;
END $guard$;
