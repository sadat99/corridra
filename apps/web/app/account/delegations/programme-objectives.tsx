'use client';
import { lazy, Suspense, useState } from 'react';
import type { ParticipantScope } from './participant-client';
const ObjectiveEditor = lazy(() =>
  import('./programme-objective-editor').then((m) => ({ default: m.ProgrammeObjectiveEditor })),
);
export type ObjectiveScope = ParticipantScope & {
  registrationId: string;
  view: 'own' | 'manage';
  /** The delegate's own words, ready to approve: the tools open on the share form with this text filled in. */
  start?: { summary: string };
};
export function ProgrammeObjectives(props: ObjectiveScope) {
  const [chosen, setChosen] = useState(false);
  // A start request opens the tools once; hiding them is remembered for that same request.
  const [dismissed, setDismissed] = useState<object | null>(null);
  const open = chosen || (!!props.start && dismissed !== props.start);
  const setOpen = (next: (was: boolean) => boolean) => {
    const value = next(open);
    setChosen(value);
    setDismissed(value ? null : (props.start ?? null));
  };
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
          ? 'Hide Shared Objectives'
          : props.view === 'own'
            ? 'Manage My Shared Objectives'
            : 'View Shared Objectives'}
      </button>
      {open && (
        <Suspense fallback={<p role="status">Loading shared objectives…</p>}>
          <ObjectiveEditor
            key={[props.issuer, props.subject, props.registrationId, props.view].join(':')}
            {...props}
            start={props.start && dismissed !== props.start ? props.start : undefined}
          />
        </Suspense>
      )}
    </>
  );
}
