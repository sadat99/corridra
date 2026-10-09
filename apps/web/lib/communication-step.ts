import { foundations } from './foundations';
export async function deliverAttempt(messageId: string) {
  'use step';
  const s = foundations();
  if (!s) throw new Error('Workspace delivery is unavailable');
  await s.ready;
  const status = await s.dispatcher.attempt(
    messageId,
    s.communications.dispatchCapability(messageId),
  );
  console.info(JSON.stringify({ event: 'communication_delivery', messageId, status }));
  return status;
}
