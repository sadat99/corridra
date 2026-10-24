import { sleep } from 'workflow';
import type { PulseJob } from '@corridra/auth/customer-notifications';
import { sendPulseStep } from '../lib/pulse-step';
// A few spaced attempts, and a wait for quiet hours or a daily digest to end. The database also caps
// attempts at three and expires a message 24 hours after it can first be sent, so nothing here can send
// more than that. Quiet hours and digests only delay: a WAIT answer sleeps and asks again.
export async function deliverPulse(job: PulseJob) {
  'use workflow';
  for (let n = 0; n < 60; n++) {
    const status = await sendPulseStep(job);
    if (['SENT', 'DEAD', 'SUPPRESSED', 'CLOSED', 'UNAVAILABLE'].includes(status)) return status;
    await sleep(status === 'WAIT' ? '30m' : '30s');
  }
  return 'PENDING';
}
