'use client';

import './first-question.css';
import './scripts.css';
import { CorridraIcon } from '../corridra-icon';
import { useLanguage } from '../language-provider';
import { translate, type MessageKey } from '../../lib/i18n/messages';
import { pictures, type PictureKey } from '../../lib/first-question';

const words: Record<PictureKey, { label: MessageKey; hint: MessageKey }> = {
  'buy-products': { label: 'fq.buyProducts.label', hint: 'fq.buyProducts.hint' },
  'buy-machine': { label: 'fq.buyMachine.label', hint: 'fq.buyMachine.hint' },
  'sell-abroad': { label: 'fq.sellAbroad.label', hint: 'fq.sellAbroad.hint' },
  'group-trip': { label: 'fq.groupTrip.label', hint: 'fq.groupTrip.hint' },
  'something-else': { label: 'fq.visits.label', hint: 'fq.visits.hint' },
};

/**
 * The first question as five pictures. Each is a real radio button with an icon, a short label and
 * one line of help, so the choice is never colour alone and works with a keyboard and a screen
 * reader. It only chooses a start: every job type stays selectable below it.
 */
export function FirstQuestion({
  value,
  onChoose,
}: {
  value: PictureKey | null;
  onChoose: (key: PictureKey) => void;
}) {
  const { locale } = useLanguage();
  const say = (key: MessageKey) => translate(locale, key);
  return (
    <div role="radiogroup" aria-label={say('fq.legend')} className="mr-fq">
      <p className="mr-fq-legend">{say('fq.legend')}</p>
      <div className="mr-fq-grid">
        {pictures.map((picture) => (
          <label key={picture.key} className="mr-fq-card" data-checked={value === picture.key}>
            <input
              type="radio"
              name="first-question"
              value={picture.key}
              checked={value === picture.key}
              onChange={() => onChoose(picture.key)}
            />
            <CorridraIcon name={picture.icon} />
            <span lang={picture.key === 'something-else' ? 'en' : undefined}>
              <b>{say(words[picture.key].label)}</b>
              <small>{say(words[picture.key].hint)}</small>
            </span>
            <span className="mr-fq-check" aria-hidden="true">
              <CorridraIcon name="check" />
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
