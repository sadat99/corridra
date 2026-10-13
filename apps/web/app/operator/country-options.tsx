import { countryCodes } from '@corridra/domain/countries';
const names = new Intl.DisplayNames(['en'], { type: 'region' });
export function CountryOptions() {
  return (
    <>
      {countryCodes.map((code) => (
        <option value={code} key={code}>
          {names.of(code) ?? code}
        </option>
      ))}
    </>
  );
}
