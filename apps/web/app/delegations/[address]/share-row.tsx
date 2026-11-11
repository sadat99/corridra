'use client';
import { useState } from 'react';
import { pp } from '../../../lib/i18n/programme-pages';

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
      <h2 id="programme-share-title">{pp('pp.share.title')}</h2>
      <div className="guide-actions-row">
        <button type="button" className="text-link" onClick={() => void copy()}>
          {pp('pp.share.copy')}
        </button>
        <a
          className="text-link"
          href={`https://wa.me/?text=${text}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {pp('pp.share.whatsapp')}
        </a>
        <a
          className="text-link"
          href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {pp('pp.share.facebook')}
        </a>
      </div>
      <p role="status" className={copied === 'idle' ? 'sr-only' : 'programme-public-note'}>
        {copied === 'done'
          ? pp('pp.share.copied')
          : copied === 'failed'
            ? pp('pp.share.copyManually', { url })
            : ''}
      </p>
    </section>
  );
}
