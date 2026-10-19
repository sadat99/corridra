'use client';
import { lazy, Suspense, useState } from 'react';
const Editor = lazy(() =>
  import('./programme-context-editor').then((m) => ({ default: m.ProgrammeContextEditor })),
);
export type ProgrammeContextScope = {
  subject: string;
  issuer: string;
  programmeId: string;
  workspaceId?: string;
  registrationId?: string;
};
export function ProgrammeContext(props: ProgrammeContextScope) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button type="button" className="text-link" onClick={() => setOpen(true)} disabled={open}>
        Programme dates and details
      </button>
      {open && (
        <Suspense fallback={<p role="status">Loading programme details…</p>}>
          <Editor
            key={
              props.issuer +
              ':' +
              props.subject +
              ':' +
              props.programmeId +
              ':' +
              (props.registrationId ?? props.workspaceId)
            }
            {...props}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </section>
  );
}
