'use client';
import { useId, useRef, useState } from 'react';
import { parsePrivateLink } from '../lib/private-link-paths';

/**
 * Paste a private link and open it. Browser only: there is no <form>, no request and no storage, because a form
 * would put the link in the address bar, history and server logs. The check runs here against this site's own origin
 * and a closed list of paths, then location.assign opens the link, so the part after the # never reaches a server.
 * Whatever is refused, the one fixed message is shown and the pasted text is never repeated in it.
 */
export function PrivateLinkField({
  label,
  action,
  refused,
}: {
  label: string;
  action: string;
  refused: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const [value, setValue] = useState('');
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function open() {
    const href = parsePrivateLink(value, window.location.origin);
    if (!href) {
      setFailed(true);
      return;
    }
    setFailed(false);
    // Empty the field in the page itself before leaving, so a Back that restores this page from the browser's
    // back/forward cache never shows the link again.
    if (input.current) input.current.value = '';
    setValue('');
    window.location.assign(href);
  }

  return (
    <div className="access-link-field">
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <div className="access-link-row">
          <input
            ref={input}
            id={id}
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (failed) setFailed(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                open();
              }
            }}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            aria-invalid={failed || undefined}
            aria-describedby={failed ? errorId : undefined}
          />
          <button type="button" className="button" onClick={open}>
            {action}
          </button>
        </div>
      </div>
      {failed ? (
        <p id={errorId} role="alert" className="field-error">
          {refused}
        </p>
      ) : null}
    </div>
  );
}
