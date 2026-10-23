import type { MissionMailJob } from '@corridra/auth/mission-mail';
import { foundations } from './foundations';
export async function sendMissionMailStep(job: MissionMailJob) {
  'use step';
  const s = foundations();
  if (!s) throw new Error('Mission mail is unavailable');
  await s.ready;
  const status = await s.missionMail.send(job);
  // Ids and a state only. Never an address, a name or message text.
  console.info(JSON.stringify({ event: 'mission_mail_attempt', queueId: job.queueId, status }));
  return status;
}
