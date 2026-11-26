'use client';

import Link from 'next/link';
import type { RefObject } from 'react';
import './site-header-v43.css';
import { CorridraIcon, type IconName } from './corridra-icon';
import { useT } from './language-provider';
import { PlaceWords } from './place-words';
import { solutionRows } from '../lib/home-v43-nav';
import { v43 } from '../lib/home-v43-data';
import type { MessageKey } from '../lib/i18n/messages';
import { revealThenFocus } from '../lib/ux/anchor-focus';

export type PublicJob = { href: string; icon: IconName; title: MessageKey; line: MessageKey };

// The Solutions menu of the public header while CORRIDRA_UX_HOME_V43 is on (owner, 26 Nov 2026, via the Guardian:
// "update as per attachment 100% correctly"). It takes the place of the What We Do button and its panel and keeps the
// same panel id, open state, Escape, outside-click and focus behaviour, which the header owns. Four rows go to the home
// sections; the six job pages stay one step down under More Ways to Work.
export function SiteHeaderSolutions({
  open,
  onToggle,
  onClose,
  buttonRef,
  jobs,
  pathname,
  english,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
  jobs: readonly PublicJob[];
  pathname: string | null;
  english: (key: MessageKey) => 'en' | undefined;
}) {
  const t = useT();
  // A word with no translation shows English: an English island keeps its own order inside a right-to-left page.
  const island = (key: MessageKey) =>
    english(key) ? ({ lang: 'en', dir: 'ltr' } as const) : ({} as const);
  const solutions = v43('menu.solutions');
  const more = v43('menu.more');
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="public-nav-what public-nav-sol"
        aria-expanded={open}
        aria-controls="public-jobs"
        data-current={jobs.some(({ href }) => href === pathname) ? 'true' : undefined}
        onClick={onToggle}
      >
        <span {...island(solutions)}>{t(solutions)}</span>
        <CorridraIcon name="chevron" size={16} className="public-nav-chevron" />
      </button>
      <div id="public-jobs" className="public-jobs public-jobs-sol" hidden={!open}>
        <p className="public-nav-label public-sol-label" {...island(solutions)}>
          {t(solutions)}
        </p>
        <ul>
          {solutionRows.map(({ id, href, icon, title, line }) => (
            <li key={id}>
              <Link
                prefetch={false}
                href={href}
                onClick={() => {
                  onClose();
                  // On the home page the section may be hidden (a route block, a closed disclosure): open it, then focus.
                  if (pathname === '/') revealThenFocus(id);
                }}
              >
                <span className="public-job-icon">
                  <CorridraIcon name={icon} size={20} />
                </span>
                <span className="public-job-words">
                  <span className="public-job-title" {...island(title)}>
                    <PlaceWords text={t(title)} />
                  </span>
                  <span className="public-job-line" {...island(line)}>
                    {t(line)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <details className="public-more">
          <summary {...island(more)}>{t(more)}</summary>
          <ul>
            {jobs.map(({ href, title }) => (
              <li key={href}>
                <Link
                  prefetch={false}
                  href={href}
                  aria-current={pathname === href ? 'page' : undefined}
                  onClick={onClose}
                >
                  <span {...island(title)}>{t(title)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link prefetch={false} className="public-jobs-else" href="/plan" onClick={onClose}>
            {t('home.else')}
            <CorridraIcon name="arrow" size={18} />
          </Link>
        </details>
      </div>
    </>
  );
}
