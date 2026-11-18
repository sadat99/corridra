-- ROLLBACK for ADR-087 U5, member access (0001_member_access.sql and 0002_member_decision_cards.sql). Not applied by the installer:
-- the migrator reads only the .sql files directly in the module folder, never this rollback folder. To roll back, with the owner's
-- word, copy this file unchanged to the next free number of the module (0003_drop_member_access.sql), review and merge it, and run
-- field_modules_action=member_access again. The quicker pause is the application switch: CORRIDRA_MEMBER_ACCESS off answers 404
-- on every member access route and shows nothing.
-- It deletes nothing. It refuses once any owner or admin read or book exists: the customer.member_item.read and
-- customer.member_item.book events and the book records written with a workspace id are history and are never deleted (ADR-087
-- Rollback). Otherwise it drops the functions 0001 and 0002 created, and nothing else; no existing object was replaced, so there
-- is nothing to restore.
DO $guard$
BEGIN
 IF EXISTS(SELECT FROM app.domain_event e WHERE e.aggregate_type='customer_workspace_access'
   AND e.type IN ('customer.member_item.read','customer.member_item.book'))
  OR EXISTS(SELECT FROM customer_private.saved_mission_command c WHERE c.input->>'action'='book' AND c.input ? 'workspaceId') THEN
  RAISE EXCEPTION 'Member access rollback refused: owners or admins have read or downloaded members'' items, and that history is never deleted. Turn CORRIDRA_MEMBER_ACCESS off instead';
 END IF;
END
$guard$;

DROP FUNCTION IF EXISTS customer.workspace_decision_card(uuid,uuid);
DROP FUNCTION IF EXISTS customer.workspace_decision_cards(uuid,uuid,integer);
DROP FUNCTION customer.workspace_saved_mission_book(uuid,uuid,text,uuid,boolean);
DROP FUNCTION customer.workspace_saved_mission(uuid,uuid);
DROP FUNCTION customer.workspace_saved_missions(uuid,uuid,integer);
DROP FUNCTION customer_private.member_saved_item(uuid,uuid,uuid);
DROP FUNCTION customer_private.member_access_label(uuid,uuid);
DROP FUNCTION customer_private.member_access_reader(uuid);

DO $proof$
BEGIN
 IF to_regprocedure('customer.workspace_decision_card(uuid,uuid)') IS NOT NULL
  OR to_regprocedure('customer.workspace_decision_cards(uuid,uuid,integer)') IS NOT NULL
  OR to_regprocedure('customer.workspace_saved_mission_book(uuid,uuid,text,uuid,boolean)') IS NOT NULL
  OR to_regprocedure('customer.workspace_saved_mission(uuid,uuid)') IS NOT NULL
  OR to_regprocedure('customer.workspace_saved_missions(uuid,uuid,integer)') IS NOT NULL
  OR to_regprocedure('customer_private.member_saved_item(uuid,uuid,uuid)') IS NOT NULL
  OR to_regprocedure('customer_private.member_access_label(uuid,uuid)') IS NOT NULL
  OR to_regprocedure('customer_private.member_access_reader(uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'Member access rollback: an object of the module is still present';
 END IF;
END
$proof$;
