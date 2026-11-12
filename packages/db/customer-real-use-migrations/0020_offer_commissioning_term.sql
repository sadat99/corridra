-- A commissioning term on a supplier's offer (Source follow-up 1 from PR 422).
-- Machinery buyers need to see whether an offer covers commissioning, but the database refuses any quotation term it does not list, so a
-- machinery offer could never state it and could never be reported as missing it. This file adds the one key, 'commissioning', to the two
-- places in the core and real-use ladders that decide which term keys are accepted:
--   app.guard_commercial_mission()   the team records an offer (real-use 0003)
--   app.recipient_detail_respond     a supplier's first answer on the reply page (core 0025)
-- The same key is added to the reply review table and to the answer correction function by their own module files
-- (recipient-reply-review 0002, recipient-response-revision 0002), so the four lists stay equal.
-- No stored offer changes, no table changes, no grants change, and nothing shows a commissioning field yet: the form and the cards come
-- in a later change. A reply that does not use the key is checked exactly as before.
-- Each function is replaced by itself with ONE token added, behind a hash guard of the installed definition. Safe to run more than once.
DO $guard$ BEGIN
 IF to_regprocedure('app.guard_commercial_mission()') IS NULL
  OR to_regprocedure('app.recipient_detail_respond(text,uuid,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'Offer commissioning term prerequisite is missing';
 END IF;
END $guard$;

DO $replace$
DECLARE def text:=pg_get_functiondef('app.guard_commercial_mission()'::regprocedure);
 old text:='''spares'',''paymentTerms''';
 new text:='''spares'',''commissioning'',''paymentTerms''';
BEGIN
 IF position('''spares'',''commissioning''' IN def)>0 THEN RETURN; END IF;
 IF encode(sha256(convert_to(def,'UTF8')),'hex')<>'c3507374952031429b804dc4741be371061a32ac75a3c2ff3ebd5500e70ae2df' THEN RAISE EXCEPTION 'Offer commissioning term prerequisite function differs: app.guard_commercial_mission'; END IF;
 IF (length(def)-length(replace(def,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'Offer commissioning term anchor not found once: app.guard_commercial_mission'; END IF;
 EXECUTE replace(def,old,new);
END $replace$;

DO $replace$
DECLARE def text:=pg_get_functiondef('app.recipient_detail_respond(text,uuid,jsonb)'::regprocedure);
 old text:='''spares'',''paymentTerms''';
 new text:='''spares'',''commissioning'',''paymentTerms''';
BEGIN
 IF position('''spares'',''commissioning''' IN def)>0 THEN RETURN; END IF;
 IF encode(sha256(convert_to(def,'UTF8')),'hex')<>'1dc1904954a747f950b6aab2c53bb2a9f947978f93fc95e09830ff31abc02c0a' THEN RAISE EXCEPTION 'Offer commissioning term prerequisite function differs: app.recipient_detail_respond'; END IF;
 IF (length(def)-length(replace(def,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'Offer commissioning term anchor not found once: app.recipient_detail_respond'; END IF;
 EXECUTE replace(def,old,new);
END $replace$;
