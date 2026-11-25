'use client';
import { useEffect, useState } from 'react';
import { formatDate } from '../../lib/ux/format';
import { ReverifyLine } from '../../components/ux/reverify-line';
import { refusedForCheck } from '../../components/ux/step-up-reads';

// Read only. Says when the customer withdrew the request behind this mission (CRUD G1); the reason stays with the
// customer. Shown only while it is withdrawn, so a mission that was never withdrawn, or was restored, shows nothing.
type Signal = { withdrawn: boolean; at: string | null };

export function WithdrawalNote({
  tenant,
  missionId,
  role,
}: {
  tenant: string;
  missionId: string;
  /**
   * The signed-in person's role, where the page knows it. The signal is for the roles that work on the mission
   * (owner, admin, operator); for any other role the read is refused every time, so it is not asked at all.
   */
  role?: string;
}) {
  const asks = role === undefined || ['owner', 'admin', 'operator'].includes(role);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [failed, setFailed] = useState(false);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!asks) return;
    let active = true;
    fetch(
      `/api/mission-withdrawal?tenant=${encodeURIComponent(tenant)}&mission=${encodeURIComponent(missionId)}`,
      { cache: 'no-store' },
    )
      .then(async (response) => {
        // A role that may not read it, or the module not being available: show nothing.
        if (response.status === 403 || response.status === 503) return;
        // A lapsed authenticator check is not a failure to read: one line asks for the code in place.
        if (await refusedForCheck(response)) {
          if (active) setNeedsCheck(true);
          return;
        }
        if (!response.ok) throw new Error('unreadable');
        const data = (await response.json()) as Signal;
        if (active) {
          setNeedsCheck(false);
          setSignal(data);
        }
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [tenant, missionId, asks, round]);
  if (needsCheck)
    return (
      <ReverifyLine
        what="whether the customer withdrew"
        onVerified={() => setRound((n) => n + 1)}
      />
    );
  if (failed) return <p role="status">The withdrawal status could not be read.</p>;
  if (!signal?.withdrawn || !signal.at) return null;
  return (
    <p role="status" data-testid="withdrawn-by-customer">
      Withdrawn by the customer on {formatDate(signal.at)}
    </p>
  );
}
