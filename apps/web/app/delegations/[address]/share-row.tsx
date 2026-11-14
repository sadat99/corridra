'use client';
import { useState } from 'react';
import { pp } from '../../../lib/i18n/programme-pages';
import type { ShareKitParts } from './share-kit';

/** Ways to pass the page on. Each one is started by the person: nothing is sent by Corridra. The share kit (ADR-084 S1),
 * when it is switched on, is drawn by the server and handed in, so the code that makes a QR code stays on the server. Its
 * links join the same row; the QR code opens under the row when the person asks for it. */
export function ShareRow({ url, title, kit }: { url: string; title: string; kit?: ShareKitParts }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const [showCode, setShowCode] = useState(false);
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
        {kit?.links}
        {kit && (
          <button
            type="button"
            className="text-link"
            aria-expanded={showCode}
            aria-controls="programme-kit-qr"
            onClick={() => setShowCode((open) => !open)}
          >
            {showCode ? pp('pp.kit.qr.hide') : pp('pp.kit.qr.show')}
          </button>
        )}
      </div>
      {kit && (
        <div id="programme-kit-qr" hidden={!showCode}>
          {kit.qr}
        </div>
      )}
      <p role="status" className={copied === 'idle' ? 'sr-only' : 'programme-public-note'}>
        {copied === 'done'
          ? pp('pp.share.copied')
          : copied === 'failed'
            ? pp('pp.share.copyManually', { url })
            : ''}
      </p>
      {kit?.after}
    </section>
  );
}
