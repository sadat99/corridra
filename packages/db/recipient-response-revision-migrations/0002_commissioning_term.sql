-- Answer corrections accept the commissioning term (Source follow-up 1 from PR 422; see real-use 0020 for the reason).
-- app.recipient_detail_body_check holds the rules for an answer body exactly as app.recipient_detail_respond applies them to the first
-- answer, so the two lists of quotation term keys must stay equal. It is replaced by itself with ONE token added, behind a hash guard of the
-- definition installed by 0001. Safe to run more than once.
DO $replace$
DECLARE def text:=pg_get_functiondef('app.recipient_detail_body_check(jsonb,app.recipient_disclosure)'::regprocedure);
 old text:='''spares'',''paymentTerms''';
 new text:='''spares'',''commissioning'',''paymentTerms''';
BEGIN
 IF position('''spares'',''commissioning''' IN def)>0 THEN RETURN; END IF;
 IF encode(sha256(convert_to(def,'UTF8')),'hex')<>'7a89e747b643c2d16911816319f75ee8187ff41a46c00fd253dd572be318c71d' THEN RAISE EXCEPTION 'Response revision prerequisite function differs: app.recipient_detail_body_check'; END IF;
 IF (length(def)-length(replace(def,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'Response revision anchor not found once: app.recipient_detail_body_check'; END IF;
 EXECUTE replace(def,old,new);
END $replace$;
