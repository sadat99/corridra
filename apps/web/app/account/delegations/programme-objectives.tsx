'use client';
import { lazy, Suspense, useState } from 'react';
import type { ParticipantScope } from './participant-client';
const ObjectiveEditor = lazy(() =>
  import('./programme-objective-editor').then((m) => ({ default: m.ProgrammeObjectiveEditor })),
);
export type ObjectiveScope = ParticipantScope & { registrationId: string; view: 'own' | 'manage' };
export function ProgrammeObjectives(props: ObjectiveScope) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="text-link"
        onClick={() => {
          if (
            open &&
            !window.dispatchEvent(
              new CustomEvent('corridra-objective-close', {
                cancelable: true,
                detail: { registrationId: props.registrationId, view: props.view },
              }),
            )
          )
            return;
          setOpen((v) => !v);
        }}
      >
        {open
          ? 'Hide shared objectives'
          : props.view === 'own'
            ? 'Manage my shared objectives'
            : 'View shared objectives'}
      </button>
      {open && (
        <Suspense fallback={<p role="status">Loading shared objectives…</p>}>
          <ObjectiveEditor
            key={[props.issuer, props.subject, props.registrationId, props.view].join(':')}
            {...props}
          />
        </Suspense>
      )}
    </>
  );
}
