-- D12: a private display lease slides on fresh authorized reads, up to30 minutes.
-- Provider/resource expiry and every actor, revocation and MFA check stay in force.
-- The25-second authentication attestation is unchanged. Nullable metadata permits schema/code rollouts in either order.
ALTER TABLE customer_private.session_proof ADD COLUMN provider_expires_at timestamptz
 CHECK(provider_expires_at IS NULL OR (isfinite(provider_expires_at) AND provider_expires_at>=expires_at));

CREATE FUNCTION customer_private.set_view_expiry(proof text,provider_expiry timestamptz) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE customer_private.session_proof SET provider_expires_at=provider_expiry
 WHERE hash=proof AND expires_at>clock_timestamp() AND provider_expiry>=expires_at;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer view attestation unavailable' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION customer_private.set_view_expiry(text,timestamptz) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer_private.set_view_expiry(text,timestamptz) TO corridra_auth;

CREATE FUNCTION customer_private.private_view_expiry() RETURNS timestamptz
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT least(clock_timestamp()+interval '30 minutes',coalesce(provider_expires_at,expires_at))
  FROM customer_private.session_proof WHERE hash=current_setting('corridra.customer_proof_hash',true)
  AND expires_at>clock_timestamp()),clock_timestamp())
$$;
REVOKE ALL ON FUNCTION customer_private.private_view_expiry() FROM PUBLIC,corridra_runtime,corridra_auth;

-- Only the eight reviewed display-window expressions change. Fingerprints protect newer/unexpected definitions.
DO $window$
DECLARE spec record;original text;updated text;reader_owner text;
BEGIN
 FOR spec IN SELECT * FROM (VALUES
  ('customer_private.coordination_expiry()','8362a7f0425d2260e537142c8c364d4aadd01b214480919dffba3729523b78b7'),
  ('customer_private.mission_draft_expiry()','3382f9f0df4409ec59afce90870ba8c52ef39f7d9b2562811d62e0dc8484d510'),
  ('customer_private.organisation_link_expiry()','46d12aa387ca11a5ec1e9bbd59883848e009c6c6a91b422da8b890d35f8146f4'),
  ('customer_private.organisation_profile_expiry()','df39226c38e7ccbd37555df94f6881cc7043b634c86ae6cf4fe89fc5fe72dd9b'),
  ('customer_private.programme_ledger_expiry()','2545b9dffc82c5b98b218637be98fc76ec7a1341cb96478fb75d540d87506aab'),
  ('customer.programme_context_view(uuid,uuid,uuid)','55aed59e37fa889a553d2509ea4a36a8f284c8ea3f973cd1df3325a3fac77572'),
  ('customer.programme_mission_choices(uuid,uuid,integer)','88a48246477bbcd9ada6e5f053380b5f31a2187a7105a08df9ca3d645aff14ae'),
  ('customer.programme_mission_summaries(uuid,boolean,uuid,integer)','bfe51b4f7783aee326e6ebad8e360f588e28c0fd2a1a92252422bd4c19d79eff')) AS v(signature,fingerprint) LOOP
  original:=pg_get_functiondef(spec.signature::regprocedure);
  IF encode(sha256(convert_to(original,'UTF8')),'hex')<>spec.fingerprint THEN
   RAISE EXCEPTION 'Private-view prerequisite differs: %',spec.signature;
  END IF;
  updated:=replace(original,'least(clock_timestamp()+interval ''60 seconds'',(SELECT expires_at FROM customer_private.session_proof WHERE hash=current_setting(''corridra.customer_proof_hash'',true)))','customer_private.private_view_expiry()');
  updated:=replace(updated,'clock_timestamp()+interval ''60 seconds''','customer_private.private_view_expiry()');
  IF updated=original OR position('60 seconds' IN updated)>0 THEN RAISE EXCEPTION 'Private-view replacement differs: %',spec.signature; END IF;
  SELECT pg_get_userbyid(proowner) INTO reader_owner FROM pg_proc WHERE oid=spec.signature::regprocedure;
  EXECUTE format('GRANT EXECUTE ON FUNCTION customer_private.private_view_expiry() TO %I',reader_owner);
  EXECUTE updated;
 END LOOP;
END $window$;
