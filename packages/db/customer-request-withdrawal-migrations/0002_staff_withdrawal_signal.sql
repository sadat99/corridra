-- CRUD G1 follow-up: the Corridra team can see that the customer withdrew a request. Additive only: one new read-only
-- function, nothing existing is changed or replaced. It answers three facts about one mission: its id, whether the
-- request behind it is withdrawn right now, and when that was recorded. It never returns the reason the customer gave,
-- a person id or a workspace id, and writes nothing (it only locks the staff session rows it checks, for the transaction). The team's own tools still decide what to do. A request the schema
-- owner revoked offline shows no signal.
-- Who may read it: an owner, admin or operator of the staff workspace named in the session (the erasure queue admits owner
-- and admin only; operators work missions and act on a withdrawal), with the same session, side and fresh-authenticator
-- checks as the erasure queue: a sample workspace, or a real one while real use is allowed, a live session and a
-- fresh authenticator check, all read from the staff session and never from the caller. The mission must belong to that
-- workspace and the customer's workspace must be on the same side (sample or real), so a sample workspace never learns
-- about a real customer's withdrawal. A customer session, another workspace or a weaker role is refused.
DO $guard$ BEGIN
 IF to_regclass('customer_private.request_withdrawal_event') IS NULL
 OR to_regclass('customer_private.owned_request') IS NULL
 OR to_regclass('customer_private.request_revocation') IS NULL
 OR to_regprocedure('app.actor_id()') IS NULL
 OR to_regprocedure('app.member_role(uuid)') IS NULL
 OR to_regprocedure('app.fresh_mfa()') IS NULL
 OR to_regprocedure('app.can_access(uuid,text,text)') IS NULL
 OR to_regprocedure('app.tenant_processing_purpose(uuid)') IS NULL
 OR to_regprocedure('app.real_use_allowed(uuid)') IS NULL
 THEN RAISE EXCEPTION 'Staff withdrawal signal prerequisites are missing'; END IF;
END $guard$;

CREATE FUNCTION app.mission_request_withdrawal(mission uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff uuid:=app.actor_id();t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;hit timestamptz;
BEGIN
 IF staff IS NULL OR t IS NULL OR mission IS NULL
  OR NOT coalesce(app.can_access(t,'INTERNAL',app.tenant_processing_purpose(t)),false)
  OR coalesce(app.member_role(t),'') NOT IN ('owner','admin','operator') OR NOT app.fresh_mfa()
  OR NOT EXISTS(SELECT FROM app.tenant w WHERE w.id=t AND (w.synthetic OR app.real_use_allowed(w.id)))
 THEN RAISE EXCEPTION 'Mission access denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM identity.session s JOIN identity.assurance a ON a.session_id=s.id JOIN identity.principal p ON p.identity_id=s."userId"
 JOIN identity."user" u ON u.id=p.identity_id JOIN app.membership m ON m.user_id=p.id AND m.tenant_id=t
 WHERE p.id=staff AND p.disabled_at IS NULL AND u."twoFactorEnabled" AND m.revoked_at IS NULL AND m.role IN ('owner','admin','operator')
 AND p.operating_country=ANY(m.allowed_countries) AND current_setting('corridra.purpose',true)=ANY(m.allowed_purposes)
 AND encode(sha256(convert_to(s.token,'UTF8')),'hex')=current_setting('corridra.session_hash',true)
 AND s."expiresAt">clock_timestamp() AND s."createdAt">clock_timestamp()-interval '24 hours' AND a.verified_at>clock_timestamp()-interval '5 minutes'
 FOR SHARE OF s,a,p,u,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Mission access denied' USING ERRCODE='42501'; END IF;
 -- The newest event of each request decides, by its sequence number (never by a clock).
 SELECT max(l.occurred_at) INTO hit
 FROM (SELECT DISTINCT ON (e.request_id) e.state,e.occurred_at
   FROM customer_private.request_withdrawal_event e
   JOIN customer_private.owned_request o ON o.id=e.request_id
   WHERE o.mission_tenant_id=t AND o.mission_id=mission
   AND (SELECT w.synthetic FROM app.tenant w WHERE w.id=o.workspace_id)=(SELECT w.synthetic FROM app.tenant w WHERE w.id=t)
   AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=e.request_id)
   ORDER BY e.request_id,e.seq DESC) l
 WHERE l.state='withdrawn';
 RETURN jsonb_build_object('missionId',mission,'withdrawn',hit IS NOT NULL,'at',hit);
END $$;
REVOKE ALL ON FUNCTION app.mission_request_withdrawal(uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.mission_request_withdrawal(uuid) TO corridra_runtime;
