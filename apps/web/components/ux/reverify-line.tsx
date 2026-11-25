'use client';
// One quiet line for a read that needs a fresh authenticator check, in place of an error block or a silent gap. It says
// what is waiting, and its one action opens the same "Confirm it is you" check every action uses (StepUpDialog, through
// requestStepUp). When the code is accepted `onVerified` runs so the screen can read again; if the check is closed,
// nothing changes and the line stays. A screen shows ONE of these for all the reads it holds back, and does not read
// them again until the person has confirmed.
import './reverify-line.css';
import { useState } from 'react';
import { requestStepUp } from '../../lib/ux/step-up';

export function ReverifyLine({ what, onVerified }: { what: string; onVerified: () => void }) {
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      if (await requestStepUp()) onVerified();
    } finally {
      setBusy(false);
    }
  }
  return (
    <p className="ux-reverify" role="status" data-testid="reverify-line">
      <span>Confirm your code to see {what}.</span>
      <button
        type="button"
        className="button button-secondary"
        disabled={busy}
        onClick={() => void confirm()}
      >
        Confirm Code
      </button>
    </p>
  );
}
