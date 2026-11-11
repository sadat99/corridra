-- Removed members, erasure: a person who has left or been removed from every workspace can still ask for their personal data to be
-- erased, the right staff team receives the request, and staff can list the requests that person wrote without any membership test.
-- Owner decisions, 11 Nov 2026: "Yes, add an erasure path (Recommended)", "Staff by hand, tracked (Recommended)", "One team only
-- (Recommended)" and "No, workspace decides (Recommended)" (the middle two as relayed by the orchestrating session), after "No,
-- remove access (Recommended)" (ADR-033 amendment, ADR-078 decision 6 and its erasure amendment). Needs customer migration 0004.
-- Three changes, no table, column, policy, trigger, row or event:
--  (1) customer_private.account_chain_tenant: after the stored chain row and the workspaces the person holds now, a third lookup over
--      every membership and member row the person ever had, revoked ones included, earliest workspace first. The chain row is written
--      once, as before. A person who never held a workspace is refused with the same text as before (ADR-078 gap 1).
--  (2) customer_private.erasure_in_scope: "has a real workspace now" also counts a request the person wrote in a real (not sample)
--      workspace. Routing stays exclusive: one team handles the whole erasure request, the real team when any request is in a real
--      workspace. customer.problem_report_remove_words and customer.erasure_queue and customer.erasure_transition call it unchanged.
--  (3) customer.erasure_request_reach(request, after_created, after_id): staff only, under the erasure authority (staff_privacy_actor
--      and erasure_in_scope), keyed on the erasure request id and never on a person id. Owner decision, 11 Nov 2026 (relayed by
--      Guardian S40): "Owning team sees all ids (Recommended)". The team that owns the erasure request lists every owned request of
--      the person who filed it, in every workspace and on both sides, by owned_request.principal_id with no membership test, so removal
--      does not hide the data from erasure. Pages of at most 100 in (created_at, id) order; the optional cursor is the pair of the last
--      row of the page before, and nextAfter in the answer is that pair, or null on the last page. It returns ids, workspace, side,
--      status word, times and flags, never a word, name, email or person id. removalIsManual is always true: removing request words
--      stays a manual step for staff, who record exactly what was and was not erased in the staff note. Nothing here withdraws,
--      revokes, restores, closes, rewrites or deletes a request, and no money or history record is read or changed.
-- Closing an account uses the same chain, so a person who left or was removed from their last workspace can now also close and undo
-- (owner decision, 11 Nov 2026, relayed by Guardian S40: "Allow self-close (Recommended)"); closing deletes nothing.
-- Guard, one DO block that runs first and holds every statement that changes anything. It compares the two functions this file
-- replaces with the owner-run fingerprint below (stored body, settings, security mode, volatility, argument types, defaults and
-- EXECUTE grantees; no catalogue text dump, so the result is the same on every PostgreSQL major version). Three states. ABSENT: neither
-- function exists and the registry has no row for the file before this one: a notice, nothing changed, nothing created. CHANGED: a
-- function differs or only one exists, or the registry holds another hash for the file before this one (so this file was applied, or
-- the module is not the one it was written for): an error, and nothing is replaced or created because both are compared first.
-- MATCHING: both equal their constants: both are replaced, the new function is created, then the owner, settings, security mode,
-- volatility, argument types and grantees of the two are proved unchanged and the grants of the new one are proved. The constants sit
-- between the begin and end marker comments of the fingerprint block. The live query sits between the begin and end marker comments of
-- the fingerprint query block; an owner can copy it, add a semicolon and run it on any database to read the live values.
-- The install log says how many open erasure requests move from sample staff to real staff (expected 0).
DO $guard$
DECLARE spec record; total integer:=0; present integer:=0; wrong text; registered boolean; recorded text;
 before_state jsonb; after_state jsonb; helper text; holder text; moving integer; reach_grants text;
BEGIN
 FOR spec IN
  SELECT e.signature,e.fingerprint,e.grantees,q.fp,q.grantees live_grantees
  FROM (VALUES
   -- fingerprint-begin
   ('customer_private.account_chain_tenant(uuid)','98cf8d5dacdd82da0b2de7facc9af7d0b7b19dd6d6c9cf36d4256c603e539db0',''),
   ('customer_private.erasure_in_scope(uuid)','08f856748511e2fbf14c82b2244fd0c3759954b577b1dac11a81ea97717ffdf2','')
   -- fingerprint-end
  ) AS e(signature,fingerprint,grantees)
  LEFT JOIN (
   -- fingerprint-query-begin
   SELECT v.signature,f.fp,f.grantees
   FROM (VALUES
    ('customer_private.account_chain_tenant(uuid)'),
    ('customer_private.erasure_in_scope(uuid)')
   ) v(signature)
   LEFT JOIN LATERAL (
    SELECT encode(sha256(convert_to(concat_ws(E'\x1f',p.prosrc,coalesce(array_to_string(p.proconfig,E'\x1e'),''),p.prosecdef::text,p.provolatile::text,
      p.proisstrict::text,p.proretset::text,p.prokind::text,p.proparallel::text,p.proleakproof::text,array_to_string(p.proargtypes::regtype[],','),
      p.prorettype::regtype::text,l.lanname,coalesce(array_to_string(p.proargnames,','),''),p.pronargdefaults::text,coalesce(pg_get_expr(p.proargdefaults,0),'')),'UTF8')),'hex') fp,
     (SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'')
      FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner) grantees
    FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(v.signature)
   ) f ON true
   -- fingerprint-query-end
  ) q ON q.signature=e.signature
 LOOP
  total:=total+1;
  IF spec.fp IS NOT NULL THEN present:=present+1; END IF;
  IF spec.fp IS DISTINCT FROM spec.fingerprint OR spec.live_grantees IS DISTINCT FROM spec.grantees THEN
   wrong:=coalesce(wrong||', ','')||split_part(spec.signature,'(',1);
  END IF;
 END LOOP;
 registered:=to_regclass('customer_account_lifecycle_migrations.applied') IS NOT NULL;
 IF registered THEN
  EXECUTE 'SELECT sha256 FROM customer_account_lifecycle_migrations.applied WHERE name=$1' INTO recorded USING '0004_erasure_scope_by_workspaces.sql';
 END IF;
 -- ABSENT: neither function exists and the registry has no row for the file before this one. Nothing is changed or created.
 IF present=0 AND recorded IS NULL THEN
  RAISE NOTICE 'Removed member erasure skipped: account lifecycle 0004 is not applied';
  RETURN;
 END IF;
 -- CHANGED: a function is missing, or any compared property of either function differs, or the registry holds another hash for the
 -- file before this one. Both are compared before the first one is replaced.
 IF present<total THEN
  RAISE EXCEPTION 'Removed member erasure prerequisite function is missing (% of % present)',present,total;
 END IF;
 IF wrong IS NOT NULL THEN
  RAISE EXCEPTION 'Removed member erasure prerequisite function differs: %',wrong;
 END IF;
 IF recorded IS NOT NULL AND recorded<>'3f9eba7c12ad3ea91858c7e5950a7987fb0c18e3daf73e71b450059291526bc2' THEN
  RAISE EXCEPTION 'Removed member erasure prerequisite file differs: 0004_erasure_scope_by_workspaces.sql';
 END IF;
 IF to_regprocedure('customer_private.workspace_member_current(uuid,uuid)') IS NULL
  OR to_regprocedure('customer_private.staff_privacy_actor()') IS NULL
  OR to_regclass('customer_private.owned_request') IS NULL OR to_regclass('customer_private.request_revocation') IS NULL THEN
  RAISE EXCEPTION 'Removed member erasure needs customer migration 0004_workspace_member_current.sql and account lifecycle 0001 first';
 END IF;
 -- MATCHING: both equal their constants. Say how many open requests change team, remember the parts that CREATE OR REPLACE must not
 -- change, then replace both and create the reach function. A request moves only from sample staff to real staff: a person whose
 -- first workspace is a sample one, with no real workspace now, who wrote a request in a real workspace.
 SELECT count(*)::integer INTO moving FROM customer_private.erasure_request r
 JOIN customer_private.account_chain c ON c.principal_id=r.principal_id JOIN app.tenant ct ON ct.id=c.tenant_id
 WHERE ct.synthetic
 AND (SELECT x.state FROM customer_private.erasure_status_event x WHERE x.request_id=r.id ORDER BY x.seq DESC LIMIT 1) IN ('received','in_progress')
 AND NOT EXISTS(SELECT FROM customer.membership m JOIN app.tenant t ON t.id=m.tenant_id WHERE m.principal_id=r.principal_id AND NOT t.synthetic)
 AND NOT EXISTS(SELECT FROM customer_private.workspace_member wm JOIN app.tenant t ON t.id=wm.tenant_id
  WHERE wm.principal_id=r.principal_id AND NOT t.synthetic AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation v WHERE v.member_id=wm.id))
 AND EXISTS(SELECT FROM customer_private.owned_request o JOIN app.tenant t ON t.id=o.workspace_id WHERE o.principal_id=r.principal_id AND NOT t.synthetic);
 RAISE NOTICE 'Removed member erasure: % open erasure request(s) move from sample staff to real staff',moving;
 SELECT coalesce(jsonb_object_agg(v.signature,encode(sha256(convert_to(concat_ws(E'\x1f',p.proowner::regrole::text,coalesce(array_to_string(p.proconfig,E'\x1e'),''),p.prosecdef::text,p.provolatile::text,
      p.proisstrict::text,p.proretset::text,p.prokind::text,p.proparallel::text,p.proleakproof::text,array_to_string(p.proargtypes::regtype[],','),
      p.prorettype::regtype::text,l.lanname,coalesce(array_to_string(p.proargnames,','),''),p.pronargdefaults::text,coalesce(pg_get_expr(p.proargdefaults,0),''),
      (SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'')
       FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)),'UTF8')),'hex')),'{}'::jsonb) INTO before_state
 FROM (VALUES
    ('customer_private.account_chain_tenant(uuid)'),
    ('customer_private.erasure_in_scope(uuid)')
   ) v(signature)
 JOIN pg_proc p ON p.oid=to_regprocedure(v.signature) JOIN pg_language l ON l.oid=p.prolang;
 -- The earliest workspace the person ever held, when none is held now. Same ordering as the lookup before it.
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer_private.account_chain_tenant(person uuid) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE chosen uuid;
BEGIN
 SELECT c.tenant_id INTO chosen FROM customer_private.account_chain c WHERE c.principal_id=person;
 IF chosen IS NOT NULL THEN RETURN chosen; END IF;
 SELECT w.tenant_id INTO chosen FROM customer.workspace w WHERE
  EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=w.tenant_id AND m.principal_id=person)
  OR EXISTS(SELECT FROM customer_private.workspace_member m WHERE m.tenant_id=w.tenant_id AND m.principal_id=person
   AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=m.id))
 ORDER BY w.created_at,w.tenant_id LIMIT 1;
 IF chosen IS NULL THEN
  SELECT w.tenant_id INTO chosen FROM customer.workspace w WHERE w.tenant_id IN (
   SELECT m.tenant_id FROM customer.membership m WHERE m.principal_id=person
   UNION SELECT x.tenant_id FROM customer_private.workspace_member x WHERE x.principal_id=person)
  ORDER BY w.created_at,w.tenant_id LIMIT 1;
 END IF;
 IF chosen IS NULL THEN
  RAISE EXCEPTION 'There is no workspace on this account. Write to the privacy contact on the privacy page.' USING ERRCODE='23514';
 END IF;
 INSERT INTO customer_private.account_chain(principal_id,tenant_id) VALUES(person,chosen);
 RETURN chosen;
END $$
$fn$;
 -- A request the person wrote in a real workspace makes the person real for routing, whether or not they are still a member.
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer_private.erasure_in_scope(person uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH staff AS (SELECT s.synthetic FROM app.tenant s WHERE s.id=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid),
 first_side AS (SELECT t.synthetic FROM customer_private.account_chain c JOIN app.tenant t ON t.id=c.tenant_id WHERE c.principal_id=person),
 real_now AS (SELECT EXISTS(
   SELECT FROM customer.membership m JOIN app.tenant t ON t.id=m.tenant_id WHERE m.principal_id=person AND NOT t.synthetic
   UNION ALL SELECT FROM customer_private.workspace_member wm JOIN app.tenant t ON t.id=wm.tenant_id
    WHERE wm.principal_id=person AND NOT t.synthetic AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=wm.id)
   UNION ALL SELECT FROM customer_private.owned_request o JOIN app.tenant t ON t.id=o.workspace_id WHERE o.principal_id=person AND NOT t.synthetic) AS yes)
 SELECT coalesce((SELECT CASE WHEN NOT staff.synthetic THEN NOT first_side.synthetic OR real_now.yes
   ELSE first_side.synthetic AND NOT real_now.yes END FROM staff,first_side,real_now),false)
$$
$fn$;
 -- Staff only. For one erasure request, every request its person wrote, in every workspace and on both sides, oldest first in
 -- (created_at, id) order, at most 100 a page, with the total of all of them and the keyset cursor of the next page. No brief, name,
 -- email, company, objective, reason or person id: staff read the words with their existing mission tools. A withdrawal module
 -- that is not installed means no request can have been withdrawn.
 EXECUTE $fn$
CREATE FUNCTION customer.erasure_request_reach(request uuid,after_created timestamptz DEFAULT NULL,after_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE filed customer_private.erasure_request%ROWTYPE;
 page uuid[];withdrawn uuid[]:=ARRAY[]::uuid[];listed integer;next_after jsonb;items jsonb;
BEGIN
 PERFORM customer_private.staff_privacy_actor();
 SELECT * INTO filed FROM customer_private.erasure_request r WHERE r.id=request;
 IF NOT FOUND OR NOT customer_private.erasure_in_scope(filed.principal_id) THEN
  RAISE EXCEPTION 'Erasure request not found' USING ERRCODE='23514';
 END IF;
 IF (after_created IS NULL) <> (after_id IS NULL) THEN
  RAISE EXCEPTION 'Give both parts of the cursor, or neither' USING ERRCODE='22023';
 END IF;
 SELECT count(*)::integer INTO listed FROM customer_private.owned_request o WHERE o.principal_id=filed.principal_id;
 page:=ARRAY(SELECT o.id FROM customer_private.owned_request o WHERE o.principal_id=filed.principal_id
  AND (after_id IS NULL OR (o.created_at,o.id)>(after_created,after_id)) ORDER BY o.created_at,o.id LIMIT 101);
 IF cardinality(page)>100 THEN
  page:=page[1:100];
  SELECT jsonb_build_object('createdAt',o.created_at,'id',o.id) INTO next_after FROM customer_private.owned_request o WHERE o.id=page[100];
 END IF;
 IF to_regclass('customer_private.request_withdrawal_event') IS NOT NULL THEN
  withdrawn:=ARRAY(SELECT x.request_id FROM (SELECT DISTINCT ON (e.request_id) e.request_id,e.state FROM customer_private.request_withdrawal_event e
   WHERE e.request_id=ANY(page) ORDER BY e.request_id,e.seq DESC) x WHERE x.state='withdrawn');
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'workspaceId',o.workspace_id,'side',CASE WHEN t.synthetic THEN 'sample' ELSE 'real' END,
  'missionId',o.mission_id,'status',m.status,'createdAt',o.created_at,'retentionUntil',i.retention_until,
  'authorStillMember',customer_private.workspace_member_current(o.workspace_id,o.principal_id),
  'revoked',EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=o.id),'withdrawn',o.id=ANY(withdrawn)) ORDER BY o.created_at,o.id),'[]'::jsonb) INTO items
 FROM customer_private.owned_request o JOIN app.tenant t ON t.id=o.workspace_id
 JOIN app.mission m ON m.tenant_id=o.mission_tenant_id AND m.id=o.mission_id
 LEFT JOIN app.mission_intake i ON i.tenant_id=o.mission_tenant_id AND i.id=o.mission_id
 WHERE o.id=ANY(page);
 RETURN jsonb_build_object('reference',filed.reference,'removalIsManual',true,'total',listed,'requests',items,'nextAfter',next_after);
END $$
$fn$;
 EXECUTE 'REVOKE ALL ON FUNCTION customer.erasure_request_reach(uuid,timestamptz,uuid) FROM PUBLIC,corridra_auth';
 EXECUTE 'GRANT EXECUTE ON FUNCTION customer.erasure_request_reach(uuid,timestamptz,uuid) TO corridra_runtime';
 -- The helper is a definer owned by whoever installed it. The new function needs EXECUTE on it when its owner is another role.
 helper:='customer_private.workspace_member_current(uuid,uuid)';
 holder:=pg_get_userbyid((SELECT p.proowner FROM pg_proc p WHERE p.oid=to_regprocedure('customer.erasure_request_reach(uuid,timestamptz,uuid)')));
 IF pg_get_userbyid((SELECT h.proowner FROM pg_proc h WHERE h.oid=to_regprocedure(helper)))<>holder THEN
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',helper,holder);
 END IF;
 SELECT coalesce(jsonb_object_agg(v.signature,encode(sha256(convert_to(concat_ws(E'\x1f',p.proowner::regrole::text,coalesce(array_to_string(p.proconfig,E'\x1e'),''),p.prosecdef::text,p.provolatile::text,
      p.proisstrict::text,p.proretset::text,p.prokind::text,p.proparallel::text,p.proleakproof::text,array_to_string(p.proargtypes::regtype[],','),
      p.prorettype::regtype::text,l.lanname,coalesce(array_to_string(p.proargnames,','),''),p.pronargdefaults::text,coalesce(pg_get_expr(p.proargdefaults,0),''),
      (SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'')
       FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)),'UTF8')),'hex')),'{}'::jsonb) INTO after_state
 FROM (VALUES
    ('customer_private.account_chain_tenant(uuid)'),
    ('customer_private.erasure_in_scope(uuid)')
   ) v(signature)
 JOIN pg_proc p ON p.oid=to_regprocedure(v.signature) JOIN pg_language l ON l.oid=p.prolang;
 IF after_state IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'Removed member erasure changed more than function bodies';
 END IF;
 SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'') INTO reach_grants
 FROM pg_proc p, aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid=to_regprocedure('customer.erasure_request_reach(uuid,timestamptz,uuid)') AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner;
 IF reach_grants<>'corridra_runtime' THEN
  RAISE EXCEPTION 'Removed member erasure reach function has the wrong grants: %',reach_grants;
 END IF;
END $guard$;
