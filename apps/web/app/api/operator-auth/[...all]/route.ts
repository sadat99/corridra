import { foundations } from '../../../../lib/foundations';
export const runtime = 'nodejs';
async function handle(request: Request) {
  try {
    const services = foundations();
    if (!services)
      return Response.json({ error: 'Operator sign-in is unavailable' }, { status: 503 });
    await services.ready;
    const response = await services.handler(request);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return Response.json(
      { error: 'Operator sign-in is unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
export const GET = handle;
export const POST = handle;
