import { SdkInferenceAdapter } from './adapters';
// Transport injection is limited to an explicit loopback synthetic browser fixture.
// It is rejected on every Vercel environment and every remote database configuration.
export function localFixtureAdapter(
  region: string,
  vercelEnvironment: string | undefined,
  fixtureUrl: string | undefined,
) {
  if (!fixtureUrl) return undefined;
  if (
    region !== 'local' ||
    vercelEnvironment ||
    !/^http:\/\/127\.0\.0\.1:[0-9]{2,5}$/.test(fixtureUrl)
  )
    throw new Error('Local inference fixtures are forbidden in deployed environments');
  const transport: typeof fetch = async (input, init) => {
    const target = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (target.origin !== 'https://api.openai.com' || target.pathname !== '/v1/chat/completions')
      throw new Error('Fixture transport only supports the approved test protocol');
    return fetch(fixtureUrl + '/v1/chat/completions', init);
  };
  return new SdkInferenceAdapter(
    { CORRIDRA_OPENAI_API_KEY: 'synthetic-fixture-only' },
    transport,
    true,
  );
}
