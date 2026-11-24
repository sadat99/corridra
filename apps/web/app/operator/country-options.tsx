'use client';
// The country choices of a select. The values are the stored codes and never change. Country names come from the
// browser's own locale data, which can differ from the server's, so the server and the first browser draw show
// the codes in the stored order; once the page has hydrated the list shows names, sorted by the name shown.
import { useSyncExternalStore } from 'react';
import { countryCodes } from '@corridra/domain/countries';

const subscribe = () => () => {};
let named: readonly { code: string; name: string }[] | undefined;
function byName() {
  if (!named) {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    named = countryCodes
      .map((code) => ({ code, name: names.of(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }
  return named;
}
const codesOnly = () => undefined;

export function CountryOptions() {
  const names = useSyncExternalStore(subscribe, byName, codesOnly);
  return (
    <>
      {(names ?? countryCodes.map((code) => ({ code, name: code }))).map(({ code, name }) => (
        <option value={code} key={code}>
          {name}
        </option>
      ))}
    </>
  );
}
