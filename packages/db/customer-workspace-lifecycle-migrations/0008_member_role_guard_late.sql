-- CRUD G4 follow-up: the same refusal as file 0005 for a role change, for a database where the member-role module was
-- installed after this one (that module owns the role table). It runs on every install (its name ends in _late), does
-- nothing when the table is absent, and is repeatable. A role change of an invited member who holds a membership row would
-- report success while the membership row still decides the access, so it is refused with the same words.
CREATE OR REPLACE FUNCTION customer_private.member_role_keeps_access_guard() RETURNS trigger
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF customer_private.workspace_member_keeps_access(NEW.member_id) THEN
  RAISE EXCEPTION 'This person is or was an owner of this workspace and keeps admin access. Ask support to remove it.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION customer_private.member_role_keeps_access_guard() FROM PUBLIC,corridra_runtime,corridra_auth;
DO $role$ BEGIN
 IF to_regclass('customer_private.workspace_member_role') IS NULL THEN
  RAISE NOTICE 'Workspace lifecycle: the member role module is not installed, so no role guard was added';
  RETURN;
 END IF;
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid='customer_private.workspace_member_role'::regclass AND tgname='workspace_member_role_keeps_access') THEN
  CREATE TRIGGER workspace_member_role_keeps_access BEFORE INSERT ON customer_private.workspace_member_role
   FOR EACH ROW EXECUTE FUNCTION customer_private.member_role_keeps_access_guard();
 END IF;
END $role$;
