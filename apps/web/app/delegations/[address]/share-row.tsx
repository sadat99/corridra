'use client';
import { useState } from 'react';

/** Ways to pass the page on. Each one is started by the person: nothing is sent by Corridra. */
export function ShareRow({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const text = encodeURIComponent(`${title} ${url}`);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
  }
  return (
    <section className="programme-public-share" aria-labelledby="programme-share-title">
      <h2 id="programme-share-title">Share this page</h2>
      <div className="guide-actions-row">
        <button type="button" className="text-link" onClick={() => void copy()}>
          Copy Link
        </button>
        <a
          className="text-link"
          href={`https://wa.me/?text=${text}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Share on WhatsApp
        </a>
        <a
          className="text-link"
          href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Share on Facebook
        </a>
      </div>
      <p role="status" className={copied === 'idle' ? 'sr-only' : 'programme-public-note'}>
        {copied === 'done' ? 'Link copied.' : copied === 'failed' ? `Copy this link: ${url}` : ''}
      </p>
    </section>
  );
}
