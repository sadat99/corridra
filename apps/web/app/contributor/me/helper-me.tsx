'use client';
// The settings a field helper uses in one place. Language and reading aloud are real; text size and data saver are not
// built yet, so they say Coming soon and are not controls. The private link note describes the invitation link only
// in words that are true of any link: it is for one person and the Corridra team renews it. Owner: S4.
import Link from 'next/link';
import { LanguageSwitcher } from '../../../components/language-switcher';
import { useListen } from '../../../components/ux/utility-menus';

export function HelperMe({ workspace }: { workspace: string }) {
  const listen = useListen();
  return (
    <>
      <section aria-labelledby="me-language" className="detail-card">
        <h2 id="me-language">Language</h2>
        <LanguageSwitcher />
      </section>
      <section aria-labelledby="me-comfort" className="detail-card">
        <h2 id="me-comfort">Make it easier to read</h2>
        {listen.supported ? (
          <button
            type="button"
            className="text-link"
            onClick={listen.toggle}
            aria-pressed={listen.speaking}
          >
            {listen.speaking ? 'Stop Reading' : 'Read This Page Aloud'}
          </button>
        ) : null}
        <p>
          Text Size <span className="ux-soon-tag">Coming soon</span>
        </p>
        <p>
          Data Saver <span className="ux-soon-tag">Coming soon</span>
        </p>
      </section>
      <section aria-labelledby="me-link" className="detail-card">
        <h2 id="me-link">Your private link</h2>
        <p>
          The link that opened your tasks is for you alone. Do not share it. If it stops working,
          ask the Corridra team to renew it.
        </p>
        <Link
          className="text-link"
          href={
            '/operator/signin?next=' + encodeURIComponent('/contributor?workspace=' + workspace)
          }
          target="_blank"
          rel="noopener noreferrer"
        >
          Verify your authenticator again (opens a new tab)
        </Link>
        <Link className="text-link" href="/network">
          About assigned work
        </Link>
      </section>
    </>
  );
}
