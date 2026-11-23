'use client';
import { useSignedInSeen } from '../../components/use-signed-in';
import { formEn } from '../../lib/i18n/form-words/en';
import { useFormWords } from './form-words';

/**
 * The request page heading in the form's language. UI/UX.v4 (owner 2a, 18 November 2026): the "Your Request" callout box
 * is gone and its one useful line, the account sentence, stays here in the heading lead. Its privacy sentence in real mode stays English. A customer
 * already signed in (the public header's own answer, no request of its own) is not asked to create an account.
 * In the sample form the old lead sits inside the one-line test notice (G29 round 1, D2). The draft still lives in this browser until it is sent, so the sentence never says it is saved to the account.
 */
export function PlanHead({ realMode }: { realMode: boolean }) {
  const { say, withEnglish } = useFormWords();
  const signedIn = useSignedInSeen() === 'customer';
  // B2a (D-008): the signed-in sentence is a form word. Until a language has its own, it is shown as English.
  const signedInLead = say('form.head.signedInLead');
  return (
    <header className="guide-plan-head">
      <p className="label">{say('form.head.label')}</p>
      <h1>{say('form.head.title')}</h1>
      {realMode && (
        <p className="guide-lead">
          {signedIn && signedInLead !== formEn['form.head.signedInLead'] ? (
            <>
              {say('form.head.realLead')} {signedInLead}
            </>
          ) : (
            withEnglish(
              'form.head.realLead',
              signedIn
                ? signedInLead
                : 'Create an account at the final step to keep your request and replies private.',
            )
          )}
        </p>
      )}
    </header>
  );
}
