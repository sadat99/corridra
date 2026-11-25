'use client';
import { Flagged, placeMark } from '../../../../components/ux/flag';
import { countryName } from '../../country-name';
import { routePlaces } from './mission-labels';

/** A stored route ("BD to CN") as people read it: each place by name, with its mark where it has one. */
export function RouteWords({ label, none }: { label: string | null | undefined; none: string }) {
  const places = routePlaces(label);
  if (!places) return <>{label ?? none}</>;
  return (
    <>
      <Flagged code={placeMark(places[0])}>{countryName(places[0])}</Flagged> to{' '}
      <Flagged code={placeMark(places[1])}>{countryName(places[1])}</Flagged>
    </>
  );
}

/** The route state at the top of an action dialog (decision 3), in the same words as the page header. */
export function RouteState({ label, note }: { label: string | null | undefined; note?: string }) {
  return (
    <p data-step-route>
      Route: <RouteWords label={label} none="not assigned yet" />.{note ? ` ${note}` : ''}
    </p>
  );
}
