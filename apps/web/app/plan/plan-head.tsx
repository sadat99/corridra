'use client';
import { useSignedInSeen } from '../../components/use-signed-in';
import { useFormWords } from './form-words';

/**
 * The request page heading in the form's language. UI/UX.v4 (owner 2a, 18 November 2026): the "Your Request" callout box
 * is gone and its one useful line, the account sentence, stays here in the heading lead. Its privacy sentence in real mode stays English. A customer
 * already signed in (the public header's own answer, no request of its own) is not asked to create an account.
 * The draft still lives in this browser until it is sent, so the sentence never says it is saved to the account.
 */
export function PlanHead({ realMode }: { realMode: boolean }) {
  const { say, withEnglish } = useFormWords();
  const signedIn = useSignedInSeen() === 'customer';
  return (
    <header className="guide-plan-head">
      <p className="label">{say('form.head.label')}</p>
      <h1>{say('form.head.title')}</h1>
      <p className="guide-lead">
        {realMode
          ? withEnglish(
              'form.head.realLead',
              signedIn
                ? 'You are signed in, so your request and its replies stay private in your account.'
                : 'Create an account at the final step to keep your request and replies private.',
            )
          : say('form.head.sampleLead')}
      </p>
    </header>
  );
}
