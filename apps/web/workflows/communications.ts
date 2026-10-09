import { sleep } from 'workflow';
import { deliverAttempt } from '../lib/communication-step';
export async function deliverCommunication(messageId: string) {
  'use workflow';
  for (let n = 0; n < 20; n++) {
    const status = await deliverAttempt(messageId);
    if (['DELIVERED', 'DEAD', 'SUPPRESSED', 'UNAVAILABLE'].includes(status)) return status;
    await sleep('5s');
  }
  console.info(JSON.stringify({ event: 'communication_requires_recovery', messageId }));
  return 'PENDING_OPERATOR_RECOVERY';
}
