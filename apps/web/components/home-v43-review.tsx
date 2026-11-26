'use client';

import Link from 'next/link';
import { useState } from 'react';
import { RouteSummary } from './home-v43-route-summary';
import { useT } from './language-provider';
import { Dialog } from './ux/dialog';
import { v43, type PlaceCode } from '../lib/home-v43-data';
import { fill } from '../lib/i18n/fill';

// Home page v4.3 request preview: what the request form will open with, shown before the visitor leaves. It is the
// platform's own <dialog>, drawn only while open (so a closed page has no second link to /plan), and it sends nothing.
// Escape and "Close Preview" close it and focus returns to the button that opened it. Copying is local: when the
// clipboard refuses, a plain sentence says how to copy by hand.
export function HomeV43Review({
  open,
  help,
  origin,
  target,
  title,
  timing,
  need,
  href,
  onClose,
}: {
  open: boolean;
  help: boolean;
  origin: PlaceCode;
  target: PlaceCode;
  title: string;
  /** The chosen timing as words, or an empty string. */
  timing: string;
  need: string;
  href: string;
  onClose: () => void;
}) {
  const t = useT();
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const details = [timing ? fill(t(v43('dialog.timing')), { timing }) : '', need.trim()]
    .filter(Boolean)
    .join('\n');
  const canCopy = !!details && typeof navigator !== 'undefined' && !!navigator.clipboard;
  const close = () => {
    setCopy('idle');
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={t(v43('dialog.title'))}
      closeLabel={t(v43('dialog.close'))}
    >
      <div className="hv43-dialog">
        <RouteSummary origin={origin} target={target} />
        <h3>{help ? t(v43('dialog.help.title')) : title}</h3>
        <p className="hv43-dialog-line">
          {timing
            ? fill(t(v43('dialog.timing')), { timing })
            : fill(t(v43('dialog.timing')), { timing: t(v43('brief.tbd')) })}
        </p>
        <p className="hv43-dialog-notes">{need.trim() || t(v43('dialog.notes.empty'))}</p>
        <p>{t(v43(help ? 'dialog.text.help' : 'dialog.text'))}</p>
        <div className="hv43-dialog-actions">
          <Link prefetch={false} className="primary-link" href={href}>
            {t(v43(help ? 'dialog.go.help' : 'dialog.go'))}
          </Link>
          {canCopy ? (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                Promise.resolve()
                  .then(() => navigator.clipboard.writeText(details))
                  .then(
                    () => setCopy('copied'),
                    () => setCopy('failed'),
                  );
              }}
            >
              {t(v43('dialog.copy'))}
            </button>
          ) : null}
        </div>
        {copy === 'copied' ? <p role="status">{t(v43('dialog.copied'))}</p> : null}
        {copy === 'failed' ? <p role="status">{t(v43('dialog.copyfail'))}</p> : null}
      </div>
    </Dialog>
  );
}
