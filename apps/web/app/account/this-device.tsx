'use client';

import { useState } from 'react';
import { useLanguage } from '../../components/language-provider';
import { translate } from '../../lib/i18n/messages';
import { forgetSeen, storageWords, useStorageBlocked } from '../../lib/ux/move-seen';

/**
 * "This device": clears the record of which replies were read, kept in this browser only. It clears at once with
 * no confirmation (nothing here is lost that the server holds), says so in a polite status line that is always in the
 * page, and leaves focus on the button.
 */
export function ThisDevice() {
  const { locale } = useLanguage();
  const [done, setDone] = useState(false);
  const blocked = useStorageBlocked();
  return (
    <>
      <h3>This device</h3>
      <p>Which replies you have read is kept on this device only.</p>
      <button
        type="button"
        className="button button-secondary"
        onClick={() => {
          forgetSeen();
          setDone(true);
        }}
      >
        {translate(locale, 'move.forget')}
      </button>
      <p role="status">{done ? translate(locale, 'move.forgotten') : ''}</p>
      {blocked ? (
        <p role="alert" lang="en" dir="ltr">
          {storageWords}
        </p>
      ) : null}
    </>
  );
}
