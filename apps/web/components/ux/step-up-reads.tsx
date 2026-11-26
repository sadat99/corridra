'use client';
// One quiet re-verify line for a group of reads that all need the same fresh authenticator check (the billing panels
// of Reports). The first read of the group (the probe) goes alone; only when it is not refused for the check do the
// others read, so a lapsed check costs one refused request, not one per panel, and the screen shows ONE line with the
// in-place check instead of four dead-end messages. After the code is accepted every panel reads again.
// Without a provider (a panel mounted alone) a read is always allowed and nothing here changes.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ReverifyLine } from './reverify-line';
import { isStepUpResponse } from '../../lib/ux/step-up';

type Gate = 'probing' | 'open' | 'needs-check';
type Reads = {
  gate: Gate;
  epoch: number;
  settle: (refusedForCheck: boolean) => void;
};
const Context = createContext<Reads | null>(null);

export function StepUpReads({ what, children }: { what: string; children: ReactNode }) {
  const [gate, setGate] = useState<Gate>('probing');
  const [epoch, setEpoch] = useState(0);
  // A panel stops its read when the page is hidden (customer details are cleared while away). If that was the probe
  // before it answered, the group would wait for ever, so coming back reads the probe again.
  useEffect(() => {
    if (gate !== 'probing') return;
    const back = () => {
      if (document.visibilityState === 'visible') setEpoch((n) => n + 1);
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [gate]);
  const settle = useCallback(
    (refused: boolean) =>
      setGate((now) => (refused ? 'needs-check' : now === 'probing' ? 'open' : now)),
    [],
  );
  const value = useMemo<Reads>(() => ({ gate, epoch, settle }), [gate, epoch, settle]);
  return (
    <Context.Provider value={value}>
      {gate === 'needs-check' ? (
        <ReverifyLine
          what={what}
          onVerified={() => {
            setGate('open');
            setEpoch((n) => n + 1);
          }}
        />
      ) : null}
      {children}
    </Context.Provider>
  );
}

/**
 * What one panel of the group uses. `allowed` is false while the group waits for the probe or for the code; `epoch`
 * changes after the code is accepted; `settle(true)` says this read was refused for the check, `settle(false)` that it
 * was answered (or failed some other way, which the panel shows itself). `grouped` is false for a panel mounted alone,
 * which then shows its own re-verify line.
 */
const noSettle: (refusedForCheck: boolean) => void = () => undefined;
const alone = { allowed: true, epoch: 0, settle: noSettle, grouped: false };
export function useStepUpRead(probe = false) {
  const reads = useContext(Context);
  if (!reads) return alone;
  return {
    allowed: reads.gate === 'open' || (probe && reads.gate === 'probing'),
    epoch: reads.epoch,
    settle: reads.settle,
    grouped: true,
  };
}

/** True when a refused read was refused only for the authenticator check (401 STEP_UP_REQUIRED). */
export const refusedForCheck = isStepUpResponse;
