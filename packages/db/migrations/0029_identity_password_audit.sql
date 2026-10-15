-- Audit credential changes without retaining hashes, tokens, mail or passwords.
-- The existing auth role cannot write or rewrite the security log directly.
CREATE FUNCTION identity.record_password_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW."providerId"='credential' AND NEW.password IS DISTINCT FROM OLD.password THEN
  INSERT INTO identity.security_event(identity_id,action)
  VALUES(NEW."userId",'credential.password.changed');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION identity.record_password_change() FROM PUBLIC;
CREATE TRIGGER credential_password_audit AFTER UPDATE OF password ON identity.account
FOR EACH ROW EXECUTE FUNCTION identity.record_password_change();
