import { sleep } from 'workflow';
import type { PulseJob } from '@corridra/auth/customer-notifications';
import { sendPulseStep } from '../lib/pulse-step';
// A few spaced attempts, and a wait for quiet hours or a daily digest to end. The database also caps
// attempts at three and expires a message 24 hours after it can first be sent, so nothing here can send
// more than that. Quiet hours and digests only delay: a WAIT answer sleeps and asks again.
export async function deliverPulse(job: PulseJob) {
  'use workflow';
  // Waits for quiet hours and a daily digest do not use up the attempts: a digest can wait up to a day for
  // 08:00 and a quiet window can push it a further day, so a message can be due almost two days away.
  // The budget for a WAIT is 60 hours; the budget for real attempts is 60 spaced tries.
  let tries = 0;
  let waits = 0;
  while (tries < 60 && waits < 120) {
    const status = await sendPulseStep(job);
    if (['SENT', 'DEAD', 'SUPPRESSED', 'CLOSED', 'UNAVAILABLE'].includes(status)) return status;
    if (status === 'WAIT') {
      waits += 1;
      await sleep('30m');
    } else {
      tries += 1;
      await sleep('30s');
    }
  }
  return 'PENDING';
}
