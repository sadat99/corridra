// Who can see it (PL1). A quiet, read-only group beside a share or send: each reader with a visible word, "Can see it"
// for a reader the code confirms and "Not stated" for one it does not. It holds no control, adds no step and changes
// nothing about the share or send it sits beside. The words are English drafts in every catalogue until a native
// review, so the group says so with `lang="en"`.
import { useId } from 'react';
import { translate } from '../lib/i18n/messages';
import { privacyReaders, type PrivacySurface } from '../lib/privacy-label';
import './privacy-label.css';

const say = (key: Parameters<typeof translate>[1]) => translate('en', key);

export function PrivacyLabel({ surface }: { surface: PrivacySurface }) {
  const id = useId();
  return (
    <div className="privacy-label" role="group" aria-labelledby={id} lang="en" dir="ltr">
      <p className="privacy-label-title" id={id}>
        {say('privacy.heading')}
      </p>
      <ul>
        {privacyReaders(surface).map((row) => (
          <li key={row.reader}>
            <span>{say(row.reader)}</span>{' '}
            <span className="privacy-label-status" data-status={row.status}>
              {say(row.status === 'confirmed' ? 'privacy.canSee' : 'privacy.notStated')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
