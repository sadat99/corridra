// Who can see it (PL1). A quiet, read-only group beside a share or send: each reader with a visible word, "Can see it"
// for a reader the code confirms and "Not stated" for one it does not. It holds no control, adds no step and changes
// nothing about the share or send it sits beside. It speaks the page's own language (`locale`, English by default
// for the English frames of the account pages) and sets that language and direction on itself. It takes no generated
// id, so no other id on the page moves.
import { translate } from '../lib/i18n/messages';
import { localeMeta, type Locale } from '../lib/i18n/locales';
import { privacyReaders, type PrivacySurface } from '../lib/privacy-label';
import './privacy-label.css';

export function PrivacyLabel({
  surface,
  locale = 'en',
}: {
  surface: PrivacySurface;
  locale?: Locale;
}) {
  const say = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const { html, dir } = localeMeta[locale];
  return (
    <div
      className="privacy-label"
      role="group"
      aria-label={say('privacy.heading')}
      lang={html}
      dir={dir}
    >
      <p className="privacy-label-title" aria-hidden="true">
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
