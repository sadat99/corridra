'use client';
import { useFormWords } from './form-words';

/** The request page heading in the form's language. Its privacy sentence in real mode stays English. */
export function PlanHead({ realMode }: { realMode: boolean }) {
  const { say, withEnglish } = useFormWords();
  return (
    <header className="guide-plan-head">
      <p className="label">{say('form.head.label')}</p>
      <h1>{say('form.head.title')}</h1>
      <p className="guide-lead">
        {realMode
          ? withEnglish(
              'form.head.realLead',
              'Create an account at the final step to keep your request and replies private.',
            )
          : say('form.head.sampleLead')}
      </p>
    </header>
  );
}
