-- ROLLBACK for ADR-087 U4, the member notice (0001_member_notice.sql). Not applied by the installer: the migrator reads only the
-- .sql files directly in the module folder, never this rollback folder. To roll back, with the owner's word, copy this file
-- unchanged to the next free number of the module (0002_drop_member_notice.sql), review and merge it, and run
-- field_modules_action=member_notice again. The quicker pause is the application switch: CORRIDRA_MEMBER_NOTICE off hides the
-- notice at once.
-- It deletes nothing. It refuses once any notice was delivered or dismissed: MEMBER_NOTICE inbox rows, delivery records and
-- dismissals are history and are never deleted (ADR-087 Rollback). Otherwise it restores the exact original inbox type check
-- (same name, found by the column it constrains), only when the live check is exactly the one 0001 created, and drops the two
-- tables (with their triggers) and four functions 0001 created, and nothing else.
DO $guard$
DECLARE live text;
BEGIN
 IF EXISTS(SELECT FROM app.inbox_notification WHERE type='MEMBER_NOTICE')
  OR EXISTS(SELECT FROM customer_private.member_notice_delivery)
  OR EXISTS(SELECT FROM customer_private.member_notice_dismissal) THEN
  RAISE EXCEPTION 'Member notice rollback refused: notices were delivered or dismissed, and that history is never deleted. Turn CORRIDRA_MEMBER_NOTICE off instead';
 END IF;
 SELECT pg_get_constraintdef(c.oid) INTO live FROM pg_constraint c
  WHERE c.conrelid='app.inbox_notification'::regclass AND c.contype='c'
   AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid='app.inbox_notification'::regclass AND a.attname='type')];
 -- replaced-check-begin
 IF live IS NULL OR encode(sha256(convert_to(live,'UTF8')),'hex')<>'909f926eb790433d7842d1a4e405282a1ea20dd161d373b3345e855f46407891' THEN
  RAISE EXCEPTION 'Member notice rollback refused: the inbox type check is not the one 0001 created';
 END IF;
 -- replaced-check-end
END
$guard$;

DROP FUNCTION customer.member_notice_dismiss(uuid);
DROP FUNCTION customer.member_notice_for_saved(uuid);
DROP FUNCTION customer.member_notice_state(uuid);
DROP FUNCTION customer_private.member_notice_deliver(uuid,text);
DROP TABLE customer_private.member_notice_dismissal;
DROP TABLE customer_private.member_notice_delivery;

DO $type$
DECLARE name text;
BEGIN
 SELECT c.conname INTO name FROM pg_constraint c
  WHERE c.conrelid='app.inbox_notification'::regclass AND c.contype='c'
   AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid='app.inbox_notification'::regclass AND a.attname='type')];
 EXECUTE format('ALTER TABLE app.inbox_notification DROP CONSTRAINT %I',name);
 EXECUTE format($c$ALTER TABLE app.inbox_notification ADD CONSTRAINT %I CHECK(type IN ('TEAM_INVITE','CONTRIBUTOR_INVITE','PARTICIPANT_INVITE','TASK_ASSIGNED','QUOTE_SENT','QUOTE_ACCEPTED','REPORT_PUBLISHED','REQUEST_RECEIVED','REPLY_POSTED'))$c$,name);
END
$type$;

DO $proof$
DECLARE live text;
BEGIN
 SELECT pg_get_constraintdef(c.oid) INTO live FROM pg_constraint c
  WHERE c.conrelid='app.inbox_notification'::regclass AND c.contype='c'
   AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid='app.inbox_notification'::regclass AND a.attname='type')];
 -- original-check-begin
 IF encode(sha256(convert_to(live,'UTF8')),'hex')<>'5846e8bd9a5b660413c04d72a9149d909e3f281c16afb548061a660b654dbd90' THEN
  RAISE EXCEPTION 'Member notice rollback: the original inbox type check was not restored';
 END IF;
 -- original-check-end
 IF to_regclass('customer_private.member_notice_delivery') IS NOT NULL
  OR to_regclass('customer_private.member_notice_dismissal') IS NOT NULL
  OR to_regprocedure('customer_private.member_notice_deliver(uuid,text)') IS NOT NULL
  OR to_regprocedure('customer.member_notice_state(uuid)') IS NOT NULL
  OR to_regprocedure('customer.member_notice_for_saved(uuid)') IS NOT NULL
  OR to_regprocedure('customer.member_notice_dismiss(uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'Member notice rollback: an object of the module is still present';
 END IF;
END
$proof$;
