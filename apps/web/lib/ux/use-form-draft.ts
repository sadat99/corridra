'use client';
// Session-scoped draft persistence (commercial readiness program, D12 and 5.2). Restores after a
// reload or a re-verify, cleared on success. Storage may be missing or blocked, so every access is
// guarded and the form still works without it. Owner after Wave 0: WS-E.
import { useCallback, useEffect, useState } from 'react';

const prefix = 'corridra.draft.';

function read<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(prefix + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function useFormDraft<T extends Record<string, unknown>>(key: string) {
  const [draft, setDraft] = useState<T | null>(null);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    // Read after mount so the server render and the first client render match.
    const value = read<T>(key);
    const timer = window.setTimeout(() => {
      setDraft(value);
      setRestored(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key]);
  const save = useCallback(
    (values: T) => {
      setDraft(values);
      try {
        window.sessionStorage.setItem(prefix + key, JSON.stringify(values));
      } catch {
        // Storage blocked: the draft lives only in memory for this page.
      }
    },
    [key],
  );
  const clear = useCallback(() => {
    setDraft(null);
    try {
      window.sessionStorage.removeItem(prefix + key);
    } catch {
      // Nothing stored.
    }
  }, [key]);
  return { draft, restored, save, clear };
}
