import Link from 'next/link';
import { translate, type MessageKey } from '../../lib/i18n/messages';
import './organise-entry.css';

// The self-serve route for organisers (ADR-080), shown on the public trade missions page only where the programme
// pages switch is on. It sits after the team request, which stays the first option. The words are English-source
// entries and stay English until a native review is recorded, so the locale is fixed here, as for the programme page.
const t = (key: MessageKey) => translate('en', key);

export function OrganiseEntry() {
  return (
    <section
      className="guide-page-steps guide-page-steps--compact organise-entry"
      aria-labelledby="organise-entry-title"
    >
      <div>
        <header className="organise-entry-head">
          <p className="label">{t('organise.entry.label')}</p>
          <h2 id="organise-entry-title">{t('organise.entry.title')}</h2>
          <p className="guide-lead">{t('organise.entry.lead')}</p>
        </header>
        <ol data-count="3" aria-label={t('organise.entry.steps.aria')}>
          <li>
            <span className="guide-step-number" aria-hidden="true">
              1
            </span>
            <h3>{t('organise.entry.step.create.title')}</h3>
            <p>{t('organise.entry.step.create.text')}</p>
          </li>
          <li>
            <span className="guide-step-number" aria-hidden="true">
              2
            </span>
            <h3>{t('organise.entry.step.publish.title')}</h3>
            <p>{t('organise.entry.step.publish.text')}</p>
          </li>
          <li>
            <span className="guide-step-number" aria-hidden="true">
              3
            </span>
            <h3>{t('organise.entry.step.review.title')}</h3>
            <p>{t('organise.entry.step.review.text')}</p>
          </li>
        </ol>
        <div className="organise-entry-actions">
          <Link prefetch={false} className="button-secondary" href="/account/delegations">
            {t('organise.entry.action')}
          </Link>
          <p>{t('organise.entry.note')}</p>
        </div>
      </div>
    </section>
  );
}
