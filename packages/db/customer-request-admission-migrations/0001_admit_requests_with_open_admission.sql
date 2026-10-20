-- Explicitly installed optional customer module. It only replaces customer_private.admit_verified_subject from the
-- open synthetic admission module; no table, policy, grant or existing row changes.
-- Owner decision (19 Oct 2026): during the synthetic test period every email-verified customer account may be
-- admitted automatically. Workspace admission alone never authorised private requests, so a new account saw
-- "private request access could not be confirmed" on its first visit. The same admission now also writes the
-- account's request authority (customer_private.request_admission), which the offline procedure writes today.
-- Nothing changes for a disabled principal, and a request authority that was revoked (disabled_at set) is never
-- re-enabled because the insert does nothing on conflict.
CREATE OR REPLACE FUNCTION customer_private.admit_verified_subject(proof text) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attested customer_private.session_proof%ROWTYPE; existing customer_private.principal%ROWTYPE; admitted uuid;
 cap constant integer:=2000;
 reason constant text:='Open synthetic admission: email-verified account, owner-approved test period';
BEGIN
 IF proof IS NULL OR proof !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501';
 END IF;
 -- Only a fresh provider attestation written by the auth role for the pinned synthetic issuer counts.
 SELECT * INTO attested FROM customer_private.session_proof WHERE hash=proof AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM customer_private.configuration c WHERE c.issuer=attested.issuer AND c.synthetic) THEN
  RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.open_admission',0));
 -- An existing principal is returned as is. A disabled principal is never re-enabled here and gets no request authority.
 SELECT * INTO existing FROM customer_private.principal p WHERE p.issuer=attested.issuer AND p.subject=attested.subject;
 IF FOUND THEN
  IF existing.disabled_at IS NULL THEN
   INSERT INTO customer_private.request_admission(principal_id,reason) VALUES(existing.id,reason)
   ON CONFLICT(principal_id) DO NOTHING;
  END IF;
  RETURN existing.id;
 END IF;
 -- A hard ceiling so an abusive burst of signups cannot grow the database without bound.
 IF (SELECT count(*) FROM customer_private.principal)>=cap THEN
  RAISE EXCEPTION 'Customer admission is full' USING ERRCODE='53400';
 END IF;
 INSERT INTO customer_private.principal(issuer,subject,admission_reason)
 VALUES(attested.issuer,attested.subject,reason)
 RETURNING id INTO admitted;
 INSERT INTO customer_private.request_admission(principal_id,reason) VALUES(admitted,reason);
 RETURN admitted;
END $$;
REVOKE ALL ON FUNCTION customer_private.admit_verified_subject(text) FROM PUBLIC,corridra_runtime;
GRANT EXECUTE ON FUNCTION customer_private.admit_verified_subject(text) TO corridra_auth;
