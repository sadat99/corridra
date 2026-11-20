// Before Send (Wave 3 unit 09, owner approved 20 November 2026). One read-only block directly above a Send: who can see
// what is sent, what is sent and until when, each row an icon, a bold question and one fact. It holds no control, adds
// no step and changes nothing about the request the button sends. Every row comes from lib/consequence-preview.ts and
// lib/privacy-label.ts, each with the code fact behind it. The evidence reply adds the one-response sentence with a
// lock; the recipient reply does not, because a correction exists there. It speaks the page's own language.
import { CorridraIcon } from './corridra-icon';
import { translate } from '../lib/i18n/messages';
import { localeMeta, type Locale } from '../lib/i18n/locales';
import { privacyReaders } from '../lib/privacy-label';
import { beforeSendRows, oneResponseFact, type BeforeSendRow } from '../lib/consequence-preview';
import './before-send.css';

type BeforeSendProps = { locale?: Locale } & (
  | {
      surface: 'evidenceReply';
      /** The moment the link ends, already written for the reader (the page's "Link expires" value). */
      expires: string;
    }
  | {
      surface: 'recipientReply';
      /** The reply page's own "What is sent" sentence (its receipt source line). */
      sent: string;
      /** The reply page's own expiry sentence, already filled with the date. */
      until: string;
    }
);

export function BeforeSend(props: BeforeSendProps) {
  const { surface, locale = 'en' } = props;
  const say = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const { html, dir } = localeMeta[locale];
  const fact = (row: BeforeSendRow) => {
    if (row.id === 'who')
      return (
        <ul className="before-send-readers">
          {privacyReaders(surface).map((reader) => (
            <li key={reader.reader}>
              <span>{say(reader.reader)}</span>{' '}
              <span className="before-send-status">
                {say(reader.status === 'confirmed' ? 'privacy.canSee' : 'privacy.notStated')}
              </span>
            </li>
          ))}
        </ul>
      );
    if (props.surface === 'recipientReply')
      return <p>{row.id === 'sent' ? props.sent : props.until}</p>;
    return row.id === 'sent' ? (
      <p>{say('consequence.whatSent')}</p>
    ) : (
      <p>
        {say('consequence.untilBody')} <bdi>{props.expires}</bdi>.
      </p>
    );
  };
  return (
    <div className="before-send" lang={html} dir={dir}>
      <ul className="before-send-rows">
        {beforeSendRows[surface].map((row) => (
          <li key={row.id} className="before-send-row">
            <CorridraIcon name={row.icon} />
            <div>
              <p className="before-send-question">{say(row.question)}</p>
              {fact(row)}
            </div>
          </li>
        ))}
      </ul>
      {surface === oneResponseFact.surface && (
        <p className="before-send-once">
          <CorridraIcon name="lock" />
          <span>{say(oneResponseFact.body)}</span>
        </p>
      )}
    </div>
  );
}
