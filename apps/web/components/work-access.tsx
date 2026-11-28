'use client';

import Link from 'next/link';
import { Inter } from 'next/font/google';
import { useState, type ReactNode } from 'react';
import { OperatorSignin } from '../app/operator/signin/signin-form';
import './account-window.css';

// The work sign-in (owner canvas board v12, 28 Nov 2026): one window for the Corridra team and for field helpers. Both
// sign in with the same work password and authenticator through the same form; the switch only chooses the words and
// where the person goes after signing in. A customer account does not grant work access, and the page says so.
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--aw-font', display: 'swap' });

export type WorkTab = 'team' | 'helper';

const words = {
  team: {
    title: 'Team sign-in.',
    lead: 'Operator, reviewer, viewer, admin or founder. Use your separate work password.',
    forgot: '/operator/forgot-password',
    setup: '/operator/setup',
  },
  helper: {
    title: 'Helper sign-in.',
    lead: 'You were invited to do local tasks for the Corridra Network.',
    forgot: '/operator/forgot-password?for=helper',
    setup: '/contributor/setup',
  },
} as const;

export function WorkAccess({
  initial,
  teamReturn,
  helperReturn,
  hint,
  interestForm,
}: {
  initial: WorkTab;
  teamReturn: string;
  helperReturn: string;
  /** The invitation hint the operator page shows to a signed-in customer. */
  hint?: ReactNode;
  /** The helper interest form, already built on the server, or nothing when it is not offered. */
  interestForm?: ReactNode;
}) {
  const [tab, setTab] = useState<WorkTab>(initial);
  const [interestOpen, setInterestOpen] = useState(false);
  const w = words[tab];
  return (
    <main id="main" lang="en" dir="ltr" tabIndex={-1} className={`operator-page aw ${inter.variable}`}>
      <div className="aw-window">
        <aside className="aw-side" aria-label="About work access">
          <p className="aw-eb">Work access</p>
          <p className="aw-side-title">Sign in to your work.</p>
          <div className="aw-ring" aria-hidden="true">
            <svg viewBox="0 0 210 210" width="210" height="210">
              <circle cx="105" cy="105" r="92" className="aw-ring-track" />
              <circle cx="105" cy="105" r="92" className="aw-ring-run" pathLength="1" transform="rotate(-90 105 105)" />
            </svg>
            <span>
              <small>Authenticator</small>
              <b>482 913</b>
              <em>Changes every 30 seconds</em>
            </span>
          </div>
          <ul className="aw-ticks">
            <li>Separate from your customer account</li>
            <li>An invitation and an authenticator app are needed</li>
            {tab === 'helper' && <li>Your access covers one task, not the whole mission</li>}
          </ul>
          {tab === 'helper' && (
            <p className="aw-side-link">
              <Link prefetch={false} href="/network">
                How the Corridra Network works
              </Link>
            </p>
          )}
        </aside>
        <div className="aw-main">
          <div className="aw-switch" role="group" aria-label="Who is signing in">
            <button type="button" aria-pressed={tab === 'team'} onClick={() => setTab('team')}>
              Corridra team
            </button>
            <button type="button" aria-pressed={tab === 'helper'} onClick={() => setTab('helper')}>
              Field helper
            </button>
          </div>
          <h1 className="aw-title">{w.title}</h1>
          <p className="aw-lead">{w.lead}</p>
          {tab === 'team' && hint}
          <OperatorSignin key={tab} returnTo={tab === 'team' ? teamReturn : helperReturn} />
          <p className="aw-row">
            <Link prefetch={false} href={w.forgot}>
              Forgot password?
            </Link>
            <Link prefetch={false} href={w.setup}>
              First time? Set up access
            </Link>
          </p>
          {tab === 'helper' && interestForm && (
            <div className="aw-interest">
              <button
                type="button"
                className="aw-link"
                aria-expanded={interestOpen}
                onClick={() => setInterestOpen((open) => !open)}
              >
                Not invited yet? Tell us you are interested
              </button>
              {interestOpen && <div className="aw-interest-body">{interestForm}</div>}
            </div>
          )}
          <p className="aw-foot">
            Customer? <Link prefetch={false} href="/signin">Customer sign-in</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
