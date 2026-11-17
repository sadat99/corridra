// What happens when you press Send response (visual grammar PR 5, V3-05-033). One quiet, read-only preview per page,
// above the evidence requests and so before every "Send response" button: who can read the response (the PL1 label for this surface), what is sent, and
// until when. It holds no control, adds no step and changes nothing about the request the button sends. Every line
// is a fact the database enforces (see apps/web/lib/consequence-preview.ts). It speaks the page's own language and
// reuses the PL1 card's classes, so it adds no colour, size, space or layer.
import { translate } from '../lib/i18n/messages';
import { localeMeta, type Locale } from '../lib/i18n/locales';
import { PrivacyLabel } from './privacy-label';
import './privacy-label.css';

export function ConsequencePreview({
  expires,
  locale = 'en',
}: {
  /** The moment the link ends, already written for the reader (the page's "Link expires" value). */
  expires: string;
  locale?: Locale;
}) {
  const say = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const { html, dir } = localeMeta[locale];
  return (
    <>
      <PrivacyLabel surface="evidenceReply" locale={locale} />
      <div
        className="privacy-label"
        role="group"
        aria-label={say('consequence.heading')}
        lang={html}
        dir={dir}
      >
        <p className="privacy-label-title" aria-hidden="true">
          {say('consequence.heading')}
        </p>
        <ul>
          <li>
            <span>{say('consequence.what')}</span> <span>{say('consequence.whatBody')}</span>
          </li>
          <li>
            <span>{say('consequence.until')}</span>{' '}
            <span>
              {say('consequence.untilBody')} <bdi>{expires}</bdi>.
            </span>
          </li>
        </ul>
      </div>
    </>
  );
}
