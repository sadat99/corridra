-- Explicitly installed optional customer module. No existing function, policy, grant or row is replaced.
-- Owner decision (19 Oct 2026): during the synthetic test period every email-verified customer account may
-- be admitted automatically. The application calls this only when open admission is configured, so
-- installing the function changes nothing by itself. Admission is still the same immutable principal row
-- that the offline procedure writes, with the same disable switch, so access can be revoked per account.
CREATE FUNCTION customer_private.admit_verified_subject(proof text) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attested customer_private.session_proof%ROWTYPE; admitted uuid;
 cap constant integer:=2000;
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
 -- An existing principal is returned as is. A disabled principal is never re-enabled here.
 SELECT p.id INTO admitted FROM customer_private.principal p WHERE p.issuer=attested.issuer AND p.subject=attested.subject;
 IF FOUND THEN RETURN admitted; END IF;
 -- A hard ceiling so an abusive burst of signups cannot grow the database without bound.
 IF (SELECT count(*) FROM customer_private.principal)>=cap THEN
  RAISE EXCEPTION 'Customer admission is full' USING ERRCODE='53400';
 END IF;
 INSERT INTO customer_private.principal(issuer,subject,admission_reason)
 VALUES(attested.issuer,attested.subject,'Open synthetic admission: email-verified account, owner-approved test period')
 RETURNING id INTO admitted;
 RETURN admitted;
END $$;
REVOKE ALL ON FUNCTION customer_private.admit_verified_subject(text) FROM PUBLIC,corridra_runtime;
GRANT EXECUTE ON FUNCTION customer_private.admit_verified_subject(text) TO corridra_auth;
