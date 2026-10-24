import type { ReactNode } from 'react';
import './ghost-state.css';
import './scripts.css';
import { mrLabels } from './labels';

/**
 * An empty screen drawn as a faded real one, tagged "Example", so a person sees what will appear
 * here before there is anything to show. The faded part is decoration: it is hidden from assistive
 * technology and cannot take focus, so no one can mistake the example for their own record.
 */
export function GhostState({
  title,
  text,
  children,
  labels = mrLabels.ghost,
}: {
  title: string;
  text: string;
  /** The faded example, built from the same components as the real screen. */
  children: ReactNode;
  labels?: typeof mrLabels.ghost;
}) {
  return (
    <section className="mr-ghost" aria-labelledby="mr-ghost-title">
      <h2 id="mr-ghost-title">{title}</h2>
      <p>{text}</p>
      <div className="mr-ghost-example" aria-hidden="true" inert>
        <span className="mr-ghost-tag">{labels.example}</span>
        {children}
      </div>
    </section>
  );
}
