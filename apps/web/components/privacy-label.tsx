'use client';
// Who can see it (PL1). A quiet, read-only group beside a share or send: each reader with a visible word, "Can see it"
// for a reader the code confirms and "Not stated" for one it does not. It holds no control, adds no step and changes
// nothing about the share or send it sits beside. It speaks the page's own language (`locale`, English by default
// for the English frames of the account pages) and sets that language and direction on itself. It takes no generated
// id, so no other id on the page moves. With member access on (ADR-087 U5 and U6, passed down from the server page) the
// saved report and decision card rows name the workspace's owners and admins; off or absent, the output is unchanged.
// The saved report passes it through PrivacyLabelScope, so the label keeps its place right after the report's expiry
// line; an explicit memberAccess wins over that. The same scope leaves the label out where the reader is not the person
// the label speaks to (a workspace owner or admin reading a member's saved report).
import { createContext, useContext } from 'react';
import { translate } from '../lib/i18n/messages';
import { localeMeta, type Locale } from '../lib/i18n/locales';
import { privacyReaders, type PrivacySurface } from '../lib/privacy-label';
import './privacy-label.css';

/** For every label inside it. Outside any provider: member access off and the label shown. */
export const PrivacyLabelScope = createContext<{ memberAccess: boolean; omitted?: boolean }>({
  memberAccess: false,
});

export function PrivacyLabel({
  surface,
  locale = 'en',
  memberAccess,
}: {
  surface: PrivacySurface;
  locale?: Locale;
  memberAccess?: boolean;
}) {
  const scope = useContext(PrivacyLabelScope);
  if (scope.omitted) return null;
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
        {privacyReaders(surface, { memberAccess: memberAccess ?? scope.memberAccess }).map(
          (row) => (
            <li key={row.reader}>
              <span>{say(row.reader)}</span>{' '}
              <span className="privacy-label-status" data-status={row.status}>
                {say(row.status === 'confirmed' ? 'privacy.canSee' : 'privacy.notStated')}
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
