'use client';

import Link from 'next/link';
import { FaqSection } from './home-more';
import { useT } from './language-provider';
import { PlaceWords } from './place-words';
import { Eyebrow } from './ux/example-tag';
import { faqIds, v43 } from '../lib/home-v43-data';

// Home page v4.3 "Common questions": the pack's eight, all closed on load. The questions are headings, so they keep
// sentence case. The product's own eight answers (privacy, limits, cost) stay complete under "More Answers", so no
// sentence is lost. The privacy link is a prose link to /privacy.
export function HomeV43Faq({ more = true }: { more?: boolean }) {
  const t = useT();
  return (
    <section className="hv43-band hv43-faq" id="questions" aria-labelledby="questions-title">
      <header className="hv43-head">
        <div>
          <Eyebrow>{t(v43('faq.eyebrow'))}</Eyebrow>
          <h2 id="questions-title">{t(v43('faq.title'))}</h2>
        </div>
      </header>
      <div className="hv43-faq-list">
        {faqIds.map((n) => (
          <details key={n}>
            <summary>{t(v43(`faq.${n}.q`))}</summary>
            <p>
              <PlaceWords text={t(v43(`faq.${n}.a`))} />
              {n === 6 ? (
                <>
                  {' '}
                  <Link prefetch={false} href="/privacy">
                    {t(v43('faq.6.link'))}
                  </Link>
                </>
              ) : null}
            </p>
          </details>
        ))}
        {more ? (
          <details className="hv43-more">
            <summary>{t(v43('faq.more'))}</summary>
            <div className="hv43-more-body">
              <FaqSection />
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
