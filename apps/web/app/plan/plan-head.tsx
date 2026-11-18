'use client';
import { useFormWords } from './form-words';

/**
 * The request page heading in the form's language. UI/UX.v4 (owner 2a, 18 November 2026): the "Your Request" callout
 * box is gone and its one useful line, "Start with your objective.", is the lead under the heading. The privacy
 * sentence about the account now sits under the choices, where the person decides, and says whether they are
 * already signed in. The draft still lives in this browser until it is sent, so no sentence says it is saved to
 * the account.
 */
export function PlanHead({ realMode }: { realMode: boolean }) {
  const { say } = useFormWords();
  return (
    <header className="guide-plan-head">
      <p className="label">{say('form.head.label')}</p>
      <h1>{say('form.head.title')}</h1>
      <p className="guide-lead">
        {realMode ? say('form.head.realLead') : say('form.head.sampleLead')}
      </p>
    </header>
  );
}
