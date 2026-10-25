import type { PulseJob } from '@corridra/auth/customer-notifications';
import { foundations } from './foundations';
export async function sendPulseStep(job: PulseJob) {
  'use step';
  const s = foundations();
  if (!s) throw new Error('Pulse is unavailable');
  await s.ready;
  const status = await s.pulse.send(job);
  // Ids and a state only. Never an address, a name or message text.
  console.info(JSON.stringify({ event: 'pulse_attempt', queueId: job.queueId, status }));
  return status;
}
