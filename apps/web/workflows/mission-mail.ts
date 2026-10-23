import { sleep } from 'workflow';
import type { MissionMailJob } from '@corridra/auth/mission-mail';
import { sendMissionMailStep } from '../lib/mission-mail-step';
// A few spaced attempts. The database also caps attempts at three and expires the message after 24
// hours, so nothing here can send more than that or keep an address longer.
export async function deliverMissionMail(job: MissionMailJob) {
  'use workflow';
  for (let n = 0; n < 6; n++) {
    const status = await sendMissionMailStep(job);
    if (['SENT', 'DEAD', 'SUPPRESSED', 'CLOSED', 'UNAVAILABLE'].includes(status)) return status;
    await sleep('30s');
  }
  return 'PENDING';
}
