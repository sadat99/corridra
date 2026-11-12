'use client';
import { useEffect, useState } from 'react';
import {
  parseSharedObjectiveCount,
  sharedObjectiveCountLine,
} from '../../../lib/shared-objective-count';

type Props = { subject: string; issuer: string; workspaceId: string; programmeId: string };

// Planning aid for owners and admins: how many delegates have shared the one-sentence summary of their
// objective. A count only. What kind of objective it is stays in the delegate's private request and is not
// read. Hidden, not zero, while the total cannot be read.
export function ProgrammeSharedObjectiveCount(props: Props) {
  return (
    <ScopedCount
      key={props.issuer + ':' + props.subject + ':' + props.workspaceId + ':' + props.programmeId}
      {...props}
    />
  );
}

function ScopedCount({ subject, issuer, workspaceId, programmeId }: Props) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ view: 'count', workspaceId, programmeId });
    fetch('/api/customer-programme-objectives?' + query, {
      headers: {
        'x-corridra-customer-subject': subject,
        'x-corridra-customer-issuer': issuer,
      },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        if (!controller.signal.aborted) setCount(parseSharedObjectiveCount(value));
      })
      .catch(() => {
        if (!controller.signal.aborted) setCount(null);
      });
    return () => controller.abort();
  }, [subject, issuer, workspaceId, programmeId]);
  if (count === null) return null;
  return (
    <p className="programme-note" data-shared-objective-count={count}>
      <b>{sharedObjectiveCountLine(count)}</b> Only the summary sentence is shared. The kind of
      objective stays private.
    </p>
  );
}
