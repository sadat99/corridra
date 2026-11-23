'use client';
import { useFormWords } from './form-words';

/**
 * The last line of the contact step (B2a, D-007). A person who is signed in with a verified address has an active
 * account, so the line only says what happens after sending. Anyone else in the real form is also told to activate
 * the account; that sentence stays English. The sample form keeps its own sentence.
 */
export function PlanContactNote({
  realMode,
  account,
}: {
  realMode: boolean;
  account: { email: string; emailVerified: boolean } | null;
}) {
  const { say, withEnglish } = useFormWords();
  return (
    <p className="guide-hint">
      {!realMode
        ? say('form.contact.sampleHint')
        : account?.emailVerified
          ? say('form.contact.realHint')
          : withEnglish(
              'form.contact.realHint',
              'Activate your account to submit it and read replies privately.',
            )}
    </p>
  );
}
