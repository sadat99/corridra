'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export type PendingNoticeWhere = 'signin' | 'signup' | 'verify' | 'account';

// A saved request waits for its owner for 24 hours. It can only be sent from the browser that saved
// it, so each message says that plainly. Short sentences, no promises about other devices.
const messages: Record<PendingNoticeWhere, string[]> = {
  verify: [
    'Your request is saved. It has not been sent yet.',
    'Verify your email, then sign in on this device and browser. We send it then.',
    'We keep it for 24 hours.',
  ],
  signin: [
    'Your request is saved. It has not been sent yet.',
    'Sign in with the account you made for it, on this device and browser. We send it then.',
    'We keep it for 24 hours.',
  ],
  signup: [
    'Your request is saved. It has not been sent yet.',
    'Make your account, verify your email and sign in on this device and browser. We send it then.',
    'We keep it for 24 hours.',
  ],
  account: [
    'You have a saved request. It has not been sent yet.',
    'Open it on this device and browser to send it. We keep it for 24 hours.',
  ],
};

export function pendingNoticeText(where: PendingNoticeWhere) {
  return messages[where];
}

export function PendingRequestMessage({ where }: { where: PendingNoticeWhere }) {
  return (
    <div className="ux-draft-notice" data-pending-request-notice={where}>
      {pendingNoticeText(where).map((sentence) => (
        <span key={sentence}>{sentence} </span>
      ))}
      {where === 'account' && (
        <Link className="text-link" href="/plan" prefetch={false}>
          Open your request
        </Link>
      )}
    </div>
  );
}

/**
 * Shows the notice only when this browser holds a saved request. The server answers with two
 * booleans and nothing about the request. Any failure shows nothing: the page works as before.
 */
export function PendingRequestNotice({ where }: { where: PendingNoticeWhere }) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/intake/pending', { cache: 'no-store', signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (body && body.pending === true) setPending(true);
      })
      .catch(() => {
        /* Without the answer the page simply shows nothing extra. */
      });
    return () => controller.abort();
  }, []);
  return <div aria-live="polite">{pending && <PendingRequestMessage where={where} />}</div>;
}
