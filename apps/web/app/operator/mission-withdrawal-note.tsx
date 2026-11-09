'use client';
import { useEffect, useState } from 'react';
import { formatDate } from '../../lib/ux/format';

// Read only. Says when the customer withdrew the request behind this mission (CRUD G1); the reason stays with the
// customer. Shown only while it is withdrawn, so a mission that was never withdrawn, or was restored, shows nothing.
type Signal = { withdrawn: boolean; at: string | null };

export function WithdrawalNote({ tenant, missionId }: { tenant: string; missionId: string }) {
  const [signal, setSignal] = useState<Signal | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(
      `/api/mission-withdrawal?tenant=${encodeURIComponent(tenant)}&mission=${encodeURIComponent(missionId)}`,
      { cache: 'no-store' },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('unreadable');
        const data = (await response.json()) as Signal;
        if (active) setSignal(data);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [tenant, missionId]);
  if (failed) return <p role="status">The withdrawal status could not be read.</p>;
  if (!signal?.withdrawn || !signal.at) return null;
  return (
    <p role="status" data-testid="withdrawn-by-customer">
      <strong>Withdrawn by the customer on {formatDate(signal.at)}.</strong> The reason stays
      private to the customer.
    </p>
  );
}
