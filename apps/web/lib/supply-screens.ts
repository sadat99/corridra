// Shared parts of the supply source screens (ADR-082 slice S3): the one fetch helper, the words for each status, source kind,
// refusal and file row code, and the review reason choices. Presentation only: the server decides every allow and refuse.
import { supplyRowCodes, supplyWords } from '@corridra/domain/supply-sources';
import { ActionError, readJson } from './ux/step-up';

export const supplyBase = '/operator/supply';
export const withWorkspace = (path: string, tenant: string) =>
  `${path}${path.includes('?') ? '&' : '?'}workspace=${encodeURIComponent(tenant)}`;

export async function supplyGet<T>(
  tenant: string,
  action: string,
  extra: Record<string, string> = {},
) {
  const query = new URLSearchParams({ tenant, ...extra });
  return readJson<T>(await fetch(`/api/supply/${action}?${query}`, { cache: 'no-store' }));
}

export async function supplyPost<T>(tenant: string, action: string, body: unknown) {
  return readJson<T>(
    await fetch(`/api/supply/${action}?${new URLSearchParams({ tenant })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

export async function supplyUpload<T>(tenant: string, form: FormData) {
  return readJson<T>(
    await fetch(`/api/supply/import-file?${new URLSearchParams({ tenant })}`, {
      method: 'POST',
      body: form,
    }),
  );
}

/** What a person sees for a failed write: the server's sentence, or the not installed state. */
export const isNotInstalled = (error: unknown) =>
  error instanceof ActionError && error.code === 'SUPPLY_UNAVAILABLE';

export const sourceKindWords: Record<string, string> = {
  staff_research: 'Staff Research',
  partner_organisation: 'Partner Organisation',
  partner_person: 'Partner Person',
  data_platform: 'Data Platform',
};
export const sourceStatusWords: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  retired: 'Retired',
  expired: 'Expired',
  no_agreement: 'No agreement',
};
export const methodWords: Record<string, string> = {
  manual: 'by hand',
  file_import: 'file import',
  partner_submission: 'partner submission',
  connector: 'connector',
};
export const sizeWords: Record<string, string> = {
  micro: 'Micro',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};
export const typeWords: Record<string, string> = {
  importer: 'Importer',
  distributor: 'Distributor',
  wholesaler: 'Wholesaler',
  retailer: 'Retailer',
  brand_owner: 'Brand owner',
  manufacturer: 'Manufacturer',
  online_retailer: 'Online retailer',
  agent: 'Agent',
  institutional_buyer: 'Institutional buyer',
};
export const reviewWords: Record<string, string> = {
  QUALIFIED: 'Qualified',
  WRONG_FIT: 'Wrong fit',
  DUPLICATE: 'Duplicate',
  EXPIRED: 'Expired',
  REJECTED_SOURCE: 'Source rejected',
};
export const reviewDecisionLabels = [
  ['QUALIFIED', 'Qualified'],
  ['WRONG_FIT', 'Wrong Fit'],
  ['DUPLICATE', 'Duplicate'],
  ['EXPIRED', 'Expired'],
  ['REJECTED_SOURCE', 'Source Rejected'],
] as const;
// The reason code is a short key that the server stores beside the decision. These are the choices the screen offers.
export const reasonCodes: [string, string][] = [
  ['matches_profile', 'Matches the profile'],
  ['wrong_country', 'Wrong country'],
  ['wrong_size', 'Wrong size'],
  ['wrong_type', 'Wrong company type'],
  ['same_company', 'Same company as another candidate'],
  ['retention_passed', 'Retention date passed'],
  ['source_not_usable', 'Source cannot be used'],
  ['other', 'Another reason'],
];

export const whatToFix: Record<(typeof supplyRowCodes)[number], string> = {
  ok: 'This row was added.',
  bad_country: 'Use a country that Corridra lists.',
  bad_size: 'Use one of the listed size bands.',
  bad_types: 'Use one of the listed company types.',
  bad_date: 'Write the date as 2026-11-13.',
  too_long: 'Company name is required, up to 160 characters.',
  contact_details: supplyWords.contactDetails,
  dnc_blocked: supplyWords.blocked,
  duplicate_key: 'This company is already on the list from this source.',
  source_inactive: supplyWords.notActive,
  bad_name: 'Company name is required, up to 160 characters.',
  bad_host: 'Use the host only, such as example.com.',
  bad_locator: 'Say where you read it.',
};
export const unknownRowFix = 'This row was rejected. Check it against the eight columns.';
export const rowFix = (code: string) =>
  (whatToFix as Record<string, string>)[code] ?? unknownRowFix;

/** Short sentences for the refusals the server words may leave unexplained. */
export const refusalWords = {
  paused:
    'Supply sources are paused. Records stay readable. New entries wait until the team resumes them.',
  denied:
    'Your role can read this but not change it. Ask an owner or admin if you need to add records.',
  notInstalled: 'Supply sources are not installed yet. Ask the owner when they will be.',
};

/** True for a role that may write (owner, admin, operator). The server still decides. */
export const canWrite = (role: string) => ['owner', 'admin', 'operator'].includes(role);
export const canLift = (role: string) => role === 'owner' || role === 'admin';
