'use client';

import Link from 'next/link';
import { Inter } from 'next/font/google';
import { useSearchParams } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { accountAccessPath, accountReturnTo } from '../lib/account-return';
import { operatorSignInPage } from '../lib/workspace-navigation';
import './account-window.css';

// The sign-in and create-account window (owner canvas board v11, 28 Nov 2026): one two-pane window in the home page's
// design. The left pane shows what the account is for; the right pane holds the form, which keeps its own logic.
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--aw-font', display: 'swap' });

export type AccountWindowMode = 'signin' | 'signup' | 'other';

// Invented examples, labelled as such on the page. They are not anyone's request.
const examples = [
  { title: 'Cotton fabric', route: 'Bangladesh to China', tone: 'green', status: 'Reply ready' },
  { title: 'Machinery quotes', route: 'Bangladesh to China', tone: 'gold', status: 'In review' },
  { title: 'Buyers in Dubai', route: 'Bangladesh to UAE', tone: 'grey', status: 'Received' },
] as const;

function Switch({ mode, extended }: { mode: AccountWindowMode; extended: boolean }) {
  const query = useSearchParams();
  const destination = accountReturnTo(query.get('returnTo'), extended);
  const to = (page: '/signin' | '/signup') => accountAccessPath(page, destination, undefined, extended);
  return (
    <nav className="aw-switch" aria-label="Account">
      <Link prefetch={false} href={to('/signin')} aria-current={mode === 'signin' ? 'page' : undefined}>
        Sign in
      </Link>
      <Link prefetch={false} href={to('/signup')} aria-current={mode === 'signup' ? 'page' : undefined}>
        Create account
      </Link>
    </nav>
  );
}

export function AccountWindow({
  mode,
  title,
  lead,
  extended = false,
  children,
}: {
  mode: AccountWindowMode;
  title: string;
  lead: string;
  extended?: boolean;
  children: ReactNode;
}) {
  return (
    <main
      id="main"
      lang="en"
      dir="ltr"
      tabIndex={-1}
      className={`operator-page aw ${inter.variable}`}
    >
      <div className="aw-window">
        <aside className="aw-side" aria-label="What your account is for">
          <p className="aw-eb">Your account</p>
          <p className="aw-side-title">Your requests, in one place.</p>
          <div className="aw-stack" aria-hidden="true">
            <p className="aw-ex">Example</p>
            {examples.map((item) => (
              <div className="aw-card" key={item.title}>
                <span>
                  <b>{item.title}</b>
                  <em>{item.route}</em>
                </span>
                <span className={`aw-pill aw-${item.tone}`}>
                  <i />
                  {item.status}
                </span>
              </div>
            ))}
          </div>
          <ul className="aw-ticks">
            <li>See every request you have sent</li>
            <li>Read replies and shared missions</li>
          </ul>
        </aside>
        <div className="aw-main">
          {mode !== 'other' && (
            <Suspense fallback={null}>
              <Switch mode={mode} extended={extended} />
            </Suspense>
          )}
          <h1 className="aw-title">{title}</h1>
          <p className="aw-lead">{lead}</p>
          {children}
          <p className="aw-foot">
            Team member or invited operator?{' '}
            <a href={operatorSignInPage}>Team access</a>
          </p>
        </div>
      </div>
    </main>
  );
}
