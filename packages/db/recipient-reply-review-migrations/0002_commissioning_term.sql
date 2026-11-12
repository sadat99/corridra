-- Reply review accepts the commissioning term (Source follow-up 1 from PR 422; see real-use 0020 for the reason).
-- A team member may ask a supplier to state any term of the offer, so the list of terms that can be asked for and its length limit grow
-- by one key. Both are CHECK constraints on app.recipient_reply_review, rebuilt here with the new key; every stored row still satisfies them
-- (the new lists contain the old ones). No row, grant, policy or function changes. Safe to run more than once.
DO $change$
DECLARE terms text:='recipient_reply_review_ask_terms_check'; size text:='recipient_reply_review_check1';
 def text;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint WHERE conrelid='app.recipient_reply_review'::regclass AND conname=terms;
 IF def IS NULL THEN RAISE EXCEPTION 'Reply review prerequisite constraint is missing: %',terms; END IF;
 IF position('commissioning' IN def)=0 THEN
  IF position('''spares''::text, ''paymentTerms''::text' IN def)=0 THEN RAISE EXCEPTION 'Reply review prerequisite constraint differs: %',terms; END IF;
  ALTER TABLE app.recipient_reply_review DROP CONSTRAINT recipient_reply_review_ask_terms_check;
  ALTER TABLE app.recipient_reply_review ADD CONSTRAINT recipient_reply_review_ask_terms_check CHECK(ask_terms <@ ARRAY['specification','quantity','moq','unit','unitPriceMinor','totalPriceMinor','toolingMinor','setupMinor','packagingMinor','leadTime','validUntil','incoterm','shipping','warranty','installation','training','spares','commissioning','paymentTerms']::text[]);
 END IF;
 SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint WHERE conrelid='app.recipient_reply_review'::regclass AND conname=size;
 IF def IS NULL THEN RAISE EXCEPTION 'Reply review prerequisite constraint is missing: %',size; END IF;
 IF position('<= 19' IN def)=0 THEN
  IF position('<= 18' IN def)=0 THEN RAISE EXCEPTION 'Reply review prerequisite constraint differs: %',size; END IF;
  ALTER TABLE app.recipient_reply_review DROP CONSTRAINT recipient_reply_review_check1;
  ALTER TABLE app.recipient_reply_review ADD CONSTRAINT recipient_reply_review_check1 CHECK((decision='ASK')=(ask_terms IS NOT NULL AND cardinality(ask_terms) BETWEEN 1 AND 19));
 END IF;
END $change$;
