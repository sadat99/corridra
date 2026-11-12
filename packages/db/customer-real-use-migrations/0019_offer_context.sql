-- Offer context on the approved mission detail (Source follow-ups 2 and 3 from PR 422).
-- The buyer's detail now carries three more facts, each copied from a record that already exists. Nothing is inferred and no value is stored twice:
--   experience.requirements.assignmentType  the mission type key of the mission's latest route assignment, the same value the team's
--                                           comparison reads (packages/missions/src/commercial.ts), so both sides choose the machinery
--                                           or general context from one source. null when the assignment has no type.
--   agenda meetings[].activityKind          the stored activity kind of the meeting (FACTORY_VISIT, SHOWROOM_VISIT, TRADE_FAIR_MEETING ...).
--   experience.quotations[].sourceId        the source record the original quotation was recorded from, and observedAt, when the quote
--   experience.quotations[].observedAt      was observed. A reference only: no locator, no file access (documentAccess is unchanged).
-- Additive. app.delivery_report(text,text) (as left by real-use 0017) and app.experience_agenda_dto(app.delivery_agenda) (core 0025) keep
-- their signatures and grants; each is replaced by itself with one anchored insertion, behind a hash guard of the installed definition.
-- Safe to run more than once. No table, column, policy or grant changes.
DO $guard$ BEGIN
 IF to_regprocedure('app.delivery_report(text,text)') IS NULL
  OR to_regprocedure('app.experience_agenda_dto(app.delivery_agenda)') IS NULL
  OR to_regclass('app.mission_route_assignment') IS NULL
  OR to_regclass('app.mission_type_definition') IS NULL
  OR to_regclass('app.mission_quotation') IS NULL
  OR NOT EXISTS(SELECT FROM information_schema.columns WHERE table_schema='app' AND table_name='meeting' AND column_name='activity_kind') THEN
  RAISE EXCEPTION 'Offer context prerequisite is missing';
 END IF;
END $guard$;

DO $replace$
DECLARE def text:=pg_get_functiondef('app.delivery_report(text,text)'::regprocedure);
 old1 text:='''requirements'',(SELECT jsonb_build_object(''version'',r.version,';
 new1 text:='''requirements'',(SELECT jsonb_build_object(''assignmentType'',(SELECT t.key FROM app.mission_route_assignment a LEFT JOIN app.mission_type_definition t ON t.tenant_id=a.tenant_id AND t.id=a.mission_type_id WHERE a.tenant_id=r.tenant_id AND a.mission_id=r.mission_id ORDER BY a.version DESC LIMIT 1),''version'',r.version,';
 old2 text:='''sourceKind'',s.kind,''claimStatus'',c.status,''superseded''';
 new2 text:='''sourceId'',q.source_id,''observedAt'',q.observed_at,''sourceKind'',s.kind,''claimStatus'',c.status,''superseded''';
BEGIN
 IF position('assignmentType' IN def)>0 THEN RETURN; END IF;
 IF encode(sha256(convert_to(def,'UTF8')),'hex')<>'d70c91e3d8b986d0012ca143f0cb73f5f1540e839760dcd6420b4ccdcb925d7e' THEN RAISE EXCEPTION 'Offer context prerequisite function differs: app.delivery_report'; END IF;
 IF (length(def)-length(replace(def,old1,'')))/length(old1)<>1 OR (length(def)-length(replace(def,old2,'')))/length(old2)<>1 THEN RAISE EXCEPTION 'Offer context anchor not found once: app.delivery_report'; END IF;
 EXECUTE replace(replace(def,old1,new1),old2,new2);
END $replace$;

DO $replace$
DECLARE def text:=pg_get_functiondef('app.experience_agenda_dto(app.delivery_agenda)'::regprocedure);
 old text:='''id'',m.id,''status'',m.status,';
 new text:='''id'',m.id,''activityKind'',m.activity_kind,''status'',m.status,';
BEGIN
 IF position('activityKind' IN def)>0 THEN RETURN; END IF;
 IF encode(sha256(convert_to(def,'UTF8')),'hex')<>'8cd905f37bd3d3cafd6de765def757191bf05c823a1d5d2f4d5c07dbe7ae7bea' THEN RAISE EXCEPTION 'Offer context prerequisite function differs: app.experience_agenda_dto'; END IF;
 IF (length(def)-length(replace(def,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'Offer context anchor not found once: app.experience_agenda_dto'; END IF;
 EXECUTE replace(def,old,new);
END $replace$;
