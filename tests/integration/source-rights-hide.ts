// Pure gate shared by the source rights suites. It imports nothing, because the vi.mock of node:fs/promises in each suite loads
// it while that module is being replaced.
//
// RIGHTS_BASE_CHECK=1 keeps real-use 0021 (organisation source rights and takedown) away from the migrator for the whole run.
// That is how each new test is shown to fail on the commit before this change: the migrator then builds exactly what main builds.
export const SOURCE_RIGHTS_FILE = '0021_organisation_source_rights_and_takedown.sql';
export function sourceRightsHidden(directory: string, name: string) {
  return (
    process.env.RIGHTS_BASE_CHECK === '1' &&
    directory.includes('customer-real-use-migrations') &&
    name === SOURCE_RIGHTS_FILE
  );
}
